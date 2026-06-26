# Military Transition & Retirement Calculator

A planning tool for U.S. service members leaving active duty: a transition
**timeline** (countdown, milestone grid, horizontal timeline, pre‑transition
breakdown, 6‑phase checklist) plus **pay/TSP/VA/state‑tax estimators**.

Originally a single static HTML file, it now runs on **Cloudflare Workers + D1**
with optional **email + password accounts** so a user's plan syncs across
devices. Guests still work fully offline (data stays in `localStorage`).

> ⚠️ Estimates only — not financial, tax, or legal advice. Verify all figures
> with DFAS, the VA, and a qualified professional.

## Architecture

| Layer | What |
|------|------|
| Front‑end | `public/index.html` (vanilla JS, Tailwind/Lucide via CDN) + ES modules `public/js/{calc,store,auth-ui}.js` |
| Worker API | `src/` — [Hono](https://hono.dev) app: `/api/auth/*`, `/api/me`, `/api/plan`, `/api/account` |
| Auth | Self‑contained email+password. PBKDF2‑HMAC‑SHA‑256 (Web Crypto), HMAC‑signed `HttpOnly` session cookies, `token_version` revocation. No external services. |
| Data | D1 (`migrations/0001_init.sql`): `users` + one `plans` row per user (plan JSON incl. checklist) |
| Static serving | Workers Static Assets (`public/`), `run_worker_first: ["/api/*"]` |

- `public/js/calc.js` holds the **pure** data + calculation logic and is imported
  by both the browser and the test suite (one source of truth).
- `public/js/store.js` is the persistence seam: API when signed in, `localStorage`
  for guests; the page's `saveState`/`loadState` route through it.

## Prerequisites

- Node 18+ and npm
- A Cloudflare account + `npx wrangler login` (only for remote D1 / deploy)

## Setup

```bash
npm install

# Create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create mtc-db

# Apply the schema locally (and later remotely)
npx wrangler d1 migrations apply mtc-db --local

# Local secret for `wrangler dev` (already gitignored)
echo 'SESSION_SECRET=dev-only-change-me' > .dev.vars
```

## Develop

```bash
npm run dev        # wrangler dev — serves public/ + the API at http://127.0.0.1:8787
```

## Test

```bash
npm test           # vitest: pure-function tests (calc.js) + Worker/D1 integration (Miniflare)
npm run typecheck  # tsc --noEmit
```

Tests use `@cloudflare/vitest-pool-workers` against a local Miniflare D1 — no
Cloudflare account or network needed.

## Deploy

```bash
npx wrangler d1 migrations apply mtc-db --remote
npx wrangler secret put SESSION_SECRET    # a long random value, e.g. `openssl rand -base64 48`
npx wrangler deploy
```

## API

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/auth/register` | – | `{email,password}` | `201 {user}` + cookie |
| POST | `/api/auth/login` | – | `{email,password}` | `200 {user}` + cookie |
| POST | `/api/auth/logout` | – | – | `204` |
| POST | `/api/auth/change-password` | ✓ | `{current,next}` | `204` |
| GET | `/api/me` | opt | – | `{user|null}` |
| GET | `/api/plan` | ✓ | – | `{plan, schema_version, updated_at}` |
| PUT | `/api/plan` | ✓ | `{plan, schema_version}` | `{updated_at}` |
| DELETE | `/api/account` | ✓ | – | `204` (cascades plan) |

State‑changing requests require `X-Requested-With: fetch` (CSRF guard) and
`application/json`.

## Notes & follow‑ups

- `BASE_PAY_2026` omits exact O‑8/O‑9/O‑10 rows (statutorily capped at Executive
  Schedule Level II); those grades get a tailored manual‑entry prompt. Drop the
  official figures into `public/js/calc.js` to enable auto‑populate.
- Tailwind/Lucide load from CDNs; for production consider self‑hosting/building
  CSS and adding security headers (CSP) — static assets are served edge‑direct,
  so header injection would need a Worker pass.
