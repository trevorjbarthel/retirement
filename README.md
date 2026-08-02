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
| Front‑end | `public/index.html` (markup only) + ES modules `public/js/{app,calc,store,icons}.js`, styles in `public/css/{tailwind,app}.css`. **No inline script, no inline style, no third‑party origin.** |
| Worker API | `src/` — [Hono](https://hono.dev) app: `POST /api/p`, `GET /api/p/:id`, `PUT /api/p/:id` |
| Access model | **Capability URLs, no accounts.** A plan's public `id` (the `/p/<id>` path) is a read‑only token; a separate secret `edit_key` (the `#k=<key>` hash) is required to write. Only the SHA‑256 of the edit key is stored. |
| Data | D1 (`migrations/0001_init.sql`): one `plans` row, keyed by `id`, holding the plan JSON + `edit_key_hash` + a monotonic `rev`. |
| Static serving | Workers Static Assets (`public/`), `run_worker_first: ["/api/*"]`, SPA fallback so `/p/<id>` serves the app |

- `public/js/calc.js` holds the **pure** data + calculation logic and is imported
  by the browser, the Worker (write validation + the calendar feed), and the test suite —
  one source of truth. Everything domain-shaped lives here: the deadline engine, the pay and
  VA math, the phase checklist, the plan allow-list.
- `public/js/app.js` is the DOM layer: rendering and event wiring, and nothing else. Its
  module-scope `let`s are the app's mutable UI state and stay in one module deliberately —
  an imported binding is read-only, so splitting them would turn every assignment into a
  setter for no benefit.
- `public/js/icons.js` + `icons.generated.js` replace the CDN icon library with inline path
  data for just the icons this app uses (`npm run build:icons`, ~17 KB vs ~96 KB gzipped).
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
npm run typecheck  # tsc on src/ + test/, tsc on public/js/*, then the icon + CSP guards
npm run build      # regenerate the icon sprite, fonts, and Tailwind CSS
```

`typecheck` also runs two guards that protect production-only invariants:

- `check:icons` — fails if `icons.generated.js` has drifted from the icons the source
  references (a missing icon renders as nothing, silently).
- `check:no-inline` — fails if an inline `<script>`/`<style>`, a `style="…"` attribute, or a
  third-party subresource reappears. Any of those work fine locally and break only under the
  deployed CSP.

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
| DELETE | `/api/p/:id` | `{edit_key}` (or `Authorization: Bearer <key>`) | `{deleted:true}`, `403`, or `404` |
| GET | `/p/:id/calendar.ics` | – | `text/calendar` — a **subscribable** feed of the plan's milestones |

- **Every API response is `Cache-Control: no-store`.** `public/_headers` applies only to static
  asset responses, not to ones the Worker generates, so the headers are set in middleware
  (`src/index.ts`).
- **What gets stored is a sanitized projection**, not the caller's object: `sanitizeState()` in
  `calc.js` rebuilds the plan from an explicit field allow‑list, so unknown keys are dropped
  rather than persisted.
- **The calendar feed** is read‑only and keyed on the public `id`. Unlike the one‑shot `.ics`
  download, a subscription is re‑fetched — so when a separation date slips, every downstream
  deadline moves in the subscriber's calendar. It shares `computeMilestones` with the page, so
  the two can't disagree. `run_worker_first` in `wrangler.jsonc` must list
  `/p/*/calendar.ics`, or the SPA fallback answers it with `index.html`.

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

- **Content Security Policy.** `public/_headers` covers **static asset** responses; Worker
  responses (`/api/*`, the calendar feed) get their own headers from middleware in
  `src/index.ts` — `_headers` does not reach them.

  The policy is now `default-src 'none'` with `script-src 'self'; style-src 'self';
  font-src 'self'`. There is **no `'unsafe-inline'` anywhere and no third-party origin at
  all.** Getting there took four changes:

  | Was | Now |
  |---|---|
  | ~2,700-line inline `<script type="module">` | `public/js/app.js` |
  | Inline `<style>` + 151 `style="…"` attributes | `public/css/app.css` + classes |
  | `lucide.min.js` from unpkg (~96 KB gzipped, ~1,600 icons) | self-hosted sprite, 85 icons |
  | Inter from fonts.googleapis.com / fonts.gstatic.com | `public/fonts/*.woff2` |

  Genuinely computed styling (a bar width, a per-milestone colour) is applied through the
  **CSSOM**, which CSP does not restrict: templates emit `data-css-*` hints and
  `paintDynamicStyles()` in `app.js` applies them after insertion. `npm run check:no-inline`
  fails the build if an inline script/style or a third-party subresource reappears — that
  class of regression works fine in a dev server that ignores `_headers` and only breaks in
  production, so it needs a gate rather than vigilance.

- **Retention / deletion.** `DELETE /api/p/:id` (key-gated) removes a plan, and the results
  screen exposes it as a "Delete plan" button. There is still **no automatic expiry**:
  `migrations/0003` adds an index on `updated_at` so a retention policy *can* be written, but
  none is enforced, deliberately — deletion here is unrecoverable and there is no email to warn
  anyone on, so the retention window is an explicit operator decision rather than something a
  migration starts doing on its own.

- **Deploy safety.** `deploy.yml` fails the build if any generated asset (Tailwind CSS, the
  icon sprite, the fonts) is stale, then records a **D1 Time Travel bookmark** in the run
  summary before applying migrations. To roll back a bad migration:
  `npx wrangler d1 time-travel restore mtc-db --bookmark <bookmark from the run summary>`.

  Deliberately **not** `wrangler d1 export` + `upload-artifact`: this repository is public,
  and workflow artifacts on a public repo are downloadable by anyone with the run URL. A dump
  of `mtc-db` is every user's name, rank, separation date, location, TSP balance and VA
  rating — exactly the dataset that makes transition-benefit fraud easy against a population
  already targeted by it. Time Travel keeps the restore point inside Cloudflare, where the
  data already lives.
- **No accounts by design.** A plan's edit link is a bearer capability: anyone with it
  can edit, a leaked link exposes the plan's (planning‑only) data, and a lost link can't
  be recovered. Mitigations in place: the edit key is 128‑bit random and rides in the URL
  hash (off server logs/`Referer`), only its hash is stored, the read‑only `/p/<id>` link
  is offered separately for sharing, `POST /api/p` and `PUT /api/p/:id` are each
  rate‑limited per IP (`CREATE_LIMITER` 20/min, `UPDATE_LIMITER` 60/min — more generous
  since one legitimate editing session makes many small debounced saves), and every write
  is validated server‑side against the same field allow‑list the browser uses
  (`isValidState` in `calc.js`, imported directly into `src/routes/plan.ts`) — a plan
  can't reach the database with a field shape the front end wouldn't have produced
  itself, which is what makes a hostile plan (e.g. `transType` holding a script payload)
  structurally unable to reach a shared link's page. Both limiters are skipped when
  `APP_ENV="development"` (local dev / tests); tune `limit`/`period` in `wrangler.jsonc`.
  Request bodies are also read via a byte-capped stream reader rather than trusting the
  `Content-Length` header, which chunked transfer-encoding has no header to check.
- **VA disability rates** in `calc.js` are `VA_RATES` (veteran‑alone) plus
  `VA_RATES_WITH_DEPENDENTS`, both on the Dec 1 2025 COLA vintage. Every VA figure in the app
  goes through `vaCompensation({rating, spouse, childrenU18, …})` so a married member is never
  quoted the veteran‑alone rate. Refresh both tables as a set when a new COLA lands, and update
  `DATA_VINTAGE.vaRates` in the same change. (The constant is deliberately *not* named for a
  year — the old `VA_RATES_2025` name disagreed with both its own comment and `DATA_VINTAGE`.)
- **The VA waiver is applied everywhere.** A retiree who accepts VA compensation waives an equal
  amount of retired pay; CRDP restores it only at 20+ years **and** a 50%+ rating. The income
  table, bar chart, insight cards, full income summary and state‑tax panel all route through
  `applyVAWaiver()` so they cannot disagree with each other or with `compareConcurrentReceipt`.
- **Retired pay uses a real High‑3.** `computeHigh3()` walks back 36 months from the separation
  date applying the correct pay‑table year and YOS bracket per month, rather than multiplying
  current base pay. Only the current year's table is committed today, so months outside it are
  estimated from the nearest year and the UI says so. Committing prior‑year tables to
  `PAY_TABLES` improves accuracy with no code change.
- **CSB/REDUX** is a third retirement system (`computeRetirementPay({system:'redux'})`):
  40% at 20 years, +3.5%/yr, capped at 75%. Its reduced COLA (CPI − 1%) is disclosed in the UI
  but not modeled.
- **State tax** figures are damped‑effective‑rate *upper‑bound* estimates from a
  single top‑marginal rate per state, not bracket‑accurate; the UI labels them as
  approximate. For real accuracy, store a per‑state bracket schedule. States carry an optional
  `lastVerified` stamp (`YYYY-MM`); the five most recently corrected entries have one.
- **Federal tax** (`FEDERAL_TAX_2026`) holds the 2026 brackets and standard deduction, used by
  the civilian-salary break-even tool. FICA is applied as a flat 7.65% with no wage-base cap —
  exact for the salary range this tool is used at, slightly conservative above it.
- **The phase checklist** lives in `calc.js` (`buildPhases`), not in the HTML, so its ~110 task
  ids are unit-tested for uniqueness and for legacy-key resolution. Checklist progress is keyed
  **by task id**, so renaming or duplicating one silently loses a user's ticked boxes.
- **Scenario comparison** (`compareScenarios`) answers "March or September?": moving a
  separation date can cross a longevity step or a service year, changing both the High-3
  average and the multiplier permanently. The panel prices that against the active-duty pay
  earned or forgone in between. The 20-year column is an illustration, not a present value —
  no COLA, no discounting — and the UI says so.
- **Multi‑tab / concurrent edits** are guarded by optimistic concurrency on a monotonic
  `plans.rev` counter. The client sends the last‑seen `rev` as `base_rev`; a stale write
  returns `409` with the server's current plan, and the front‑end prompts to keep this
  tab's version (overwrite) or load the other one. A counter is used rather than
  `updated_at` because the latter is only second‑precision.
