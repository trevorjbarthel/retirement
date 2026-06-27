# Military Transition & Retirement Calculator

A planning tool for U.S. service members leaving active duty: a transition
**timeline** (countdown, milestone grid, horizontal timeline, pre‑transition
breakdown, 6‑phase checklist) plus **pay/TSP/VA/state‑tax estimators**.

Originally a single static HTML file, it now runs on **Cloudflare Workers + D1**.
There are **no accounts** — when you build a plan it's saved at a private, unguessable
URL. Bookmark that link to return and edit; share the read‑only version with others.
A copy is also kept in `localStorage` so the same browser can recover.

> ⚠️ Estimates only — not financial, tax, or legal advice. Verify all figures
> with DFAS, the VA, and a qualified professional.

## Architecture

| Layer | What |
|------|------|
| Front‑end | `public/index.html` (vanilla JS, Tailwind/Lucide via CDN) + ES modules `public/js/{calc,store}.js` |
| Worker API | `src/` — [Hono](https://hono.dev) app: `POST /api/p`, `GET /api/p/:id`, `PUT /api/p/:id` |
| Access model | **Capability URLs, no accounts.** A plan's public `id` (the `/p/<id>` path) is a read‑only token; a separate secret `edit_key` (the `#k=<key>` hash) is required to write. Only the SHA‑256 of the edit key is stored. |
| Data | D1 (`migrations/0001_init.sql`): one `plans` row, keyed by `id`, holding the plan JSON + `edit_key_hash` + a monotonic `rev`. |
| Static serving | Workers Static Assets (`public/`), `run_worker_first: ["/api/*"]`, SPA fallback so `/p/<id>` serves the app |

- `public/js/calc.js` holds the **pure** data + calculation logic and is imported
  by both the browser and the test suite (one source of truth).
- `public/js/store.js` is the persistence seam: it creates a plan on first save,
  loads `/p/<id>`, and PUTs edits with the edit key (debounced); it also mirrors a
  copy to `localStorage` for same‑browser recovery.
- **Trade‑off:** anyone with a plan's edit link can edit it, and there's no recovery
  if the link is lost (no email, no reset) — the link *is* the credential.

## Prerequisites

- Node 22+ and npm (the pinned `wrangler` requires Node ≥ 22)
- A Cloudflare account + `npx wrangler login` (only for remote D1 / deploy)

## Setup

```bash
npm install

# Create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create mtc-db

# Apply the schema locally (and later remotely)
npx wrangler d1 migrations apply mtc-db --local
```

No secrets are required — there's no auth.

## Develop

```bash
npm run dev        # wrangler dev — serves public/ + the API at http://127.0.0.1:8787
```

## Test

```bash
npm test           # vitest: pure-function tests (calc.js) + Worker/D1 integration (Miniflare)
npm run typecheck  # tsc on src/ + test/, then tsc -p tsconfig.calc.json on the shared calc.js
```

Tests use `@cloudflare/vitest-pool-workers` against a local Miniflare D1 — no
Cloudflare account or network needed.

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`: the Action installs
dependencies, runs tests, applies pending remote D1 migrations, then deploys the
Worker. You can also run the same workflow manually from the GitHub Actions tab.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Local/manual deploy:

```bash
npx wrangler d1 migrations apply mtc-db --remote
npx wrangler deploy
```

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/p` | `{plan, schema_version}` | `201 {id, edit_key, rev, ...}` — mints a new plan |
| GET | `/api/p/:id` | – | `{plan, schema_version, updated_at, rev}` or `404` (read‑only; no key) |
| PUT | `/api/p/:id` | `{plan, schema_version, edit_key, base_rev?}` | `{updated_at, rev}`, `403` (wrong/no key), `404`, or `409 {error:"conflict", current}` |

- The `id` is the public/read token (appears in the `/p/<id>` URL); the `edit_key` —
  returned once on create — is required to write and travels only in the URL hash
  (`#k=<key>`), so it stays out of server logs and `Referer`.
- **Optimistic concurrency:** `PUT` sends `base_rev` (the `rev` you last loaded). A stale
  token is rejected with `409` + the server's `current` plan instead of silently
  overwriting a newer edit. Every successful write returns the new monotonic `rev`.
- No sessions/cookies and no CSRF token are needed: an attacker can't forge an unguessable
  capability, so there's nothing to ride a cross‑site request.

## Pay tables (auto‑refresh)

There is no official military‑pay API, so the basic‑pay table is **generated from
the official DFAS pages**. The committed data lives in `public/data/pay-tables.json`
(canonical) and `public/js/pay-tables.generated.js` (imported by `calc.js`).

- Regenerate locally: `npm run update-pay-tables -- --year 2026 --write`
  (parses DFAS, validates, rewrites both files). Use `--fixture` to run against
  the test fixtures (always a dry run).
- `.github/workflows/update-pay-tables.yml` runs the generator on demand
  (`workflow_dispatch`) and each January, then opens a **PR** with the new numbers
  for review. The refresh workflow itself does not deploy; merging the PR to
  `main` triggers the Cloudflare deploy workflow.
- The parser (`scripts/parse-pay-tables.mjs`) is pure and unit‑tested against
  `test/fixtures/dfas-*.html` via `npm run test:scripts`. Key convention:
  "2 or less" → key `2`, "Over N" → key `N+1`, flats collapsed.
- Generating from real DFAS fills the previously‑missing O‑8/O‑9/O‑10 rows. Until
  the first live run, those grades show a tailored manual‑entry prompt. The first
  live fetch must run where outbound internet is available (the Action runner).

## Notes & follow‑ups

- Tailwind/Lucide load from CDNs; for production consider self‑hosting/building
  CSS and adding security headers (CSP) — static assets are served edge‑direct,
  so header injection would need a Worker pass.
- **No accounts by design.** A plan's edit link is a bearer capability: anyone with it
  can edit, a leaked link exposes the plan's (planning‑only) data, and a lost link can't
  be recovered. Mitigations in place: the edit key is 128‑bit random and rides in the URL
  hash (off server logs/`Referer`), only its hash is stored, the read‑only `/p/<id>` link
  is offered separately for sharing, and `POST /api/p` is rate‑limited per IP
  (`CREATE_LIMITER`, 20/min) to blunt bulk creation. The limiter is skipped when
  `APP_ENV="development"` (local dev / tests); tune the `limit`/`period` in `wrangler.jsonc`.
- **VA disability rates** in `calc.js` (`VA_RATES_2025`) are the veteran‑alone
  (no‑dependents) amounts on the Dec 1 2024 COLA vintage. Refresh them as a set
  (not per‑bracket) when a new COLA lands, and update `DATA_VINTAGE.vaRates` in
  the same change so the label and data never drift apart.
- **State tax** figures are damped‑effective‑rate *upper‑bound* estimates from a
  single top‑marginal rate per state, not bracket‑accurate; the UI labels them as
  approximate. For real accuracy, store a per‑state bracket schedule.
- **Multi‑tab / concurrent edits** are guarded by optimistic concurrency on a monotonic
  `plans.rev` counter. The client sends the last‑seen `rev` as `base_rev`; a stale write
  returns `409` with the server's current plan, and the front‑end prompts to keep this
  tab's version (overwrite) or load the other one. A counter is used rather than
  `updated_at` because the latter is only second‑precision.
