# Password reset — design sketch

Status: **proposed, not implemented.** This documents how to add a self-service
"forgot password" flow to the self-contained email+password auth, and the one hard
prerequisite (sending email) that the app does not have today.

## Why it's not already here

Accounts are self-contained: PBKDF2 hashes in D1, HMAC-signed session cookies,
revocation via `users.token_version`. There is **no email infrastructure**, and a
Cloudflare Worker cannot send mail on its own. So the only real blocker is choosing a
delivery channel; the token/flow logic reuses patterns already in `src/`.

## Prerequisite: an email sender

Pick one transactional email provider and call its REST API from the Worker with `fetch`,
keying off a Worker secret. Recommended: **[Resend](https://resend.com)** (simple API,
free tier). Alternatives: Postmark, Mailgun, SendGrid, AWS SES.

- Verify a sending domain with the provider (SPF/DKIM).
- `npx wrangler secret put RESEND_API_KEY` (add `RESEND_API_KEY?: string` to `Env`).
- Note: MailChannels' free Workers sending **ended in 2024**, so it is no longer the
  zero-config option it once was. Cloudflare Email Routing is for *receiving*, not
  general transactional *sending*.

`src/auth/email.ts` (sketch):

```ts
export async function sendResetEmail(env: Env, to: string, link: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "Transition Calc <no-reply@yourdomain>",
      to,
      subject: "Reset your password",
      text: `Reset your password (valid 1 hour): ${link}\nIf you didn't request this, ignore this email.`,
    }),
  });
}
```

## Data model

New migration `migrations/0003_password_resets.sql`:

```sql
CREATE TABLE password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  token_hash  TEXT    NOT NULL,   -- SHA-256 of the raw token; the raw token only ever lives in the email
  expires_at  INTEGER NOT NULL,   -- unix seconds (now + 3600)
  used_at     INTEGER,            -- set when consumed; NULL = still valid
  created_at  INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_password_resets_token ON password_resets(token_hash);
```

**Token:** 32 random bytes (`crypto.getRandomValues`) → base64url = the raw token in the
link. Store only `SHA-256(token)` so a DB leak yields no usable tokens. TTL **1 hour**,
**single-use** (`used_at`).

## API

Both endpoints are mounted under `/api/auth`, already covered by `csrfGuard`, and should
be wrapped with the existing optional `AUTH_LIMITER` throttle.

### `POST /api/auth/forgot` — `{ email }` → always `204`

Enumeration-resistant: **always returns 204**, whether or not the email exists, and does
comparable work in both branches (mirrors the `/login` timing equalization). If the user
exists: create a `password_resets` row and send the email with
`https://<app>/?reset=<rawToken>`. Throttle per IP+email.

### `POST /api/auth/reset` — `{ token, password }` → `204`

1. Look up `SHA-256(token)` in `password_resets` where `used_at IS NULL AND expires_at > now`.
2. Not found / expired / used → generic `400 invalid_or_expired` (don't distinguish).
3. `passwordIssue(password)` must pass (≥12 chars; optionally "must differ").
4. `hashPassword` + **`updateUserPasswordAndRevoke`** — this already bumps `token_version`,
   so every existing session for that account is invalidated on reset.
5. Mark the token `used_at = now` (single-use). Optionally issue a fresh session cookie so
   the user lands logged in.

Query helpers to add in `src/db/queries.ts`: `createPasswordReset(userId, tokenHash, expiresAt)`,
`findValidReset(tokenHash, now)`, `markResetUsed(id)`. `updateUserPasswordAndRevoke` already exists.

## Front-end

- **Login modal** (`auth-ui.js`): add a "Forgot password?" link that switches the modal to
  a request mode (email only) → `POST /api/auth/forgot` → always show
  *"If that address has an account, we've emailed a reset link."*
- **Reset entry**: the email link is `/?reset=<token>`. The SPA already falls back to
  `index.html` for any path (`not_found_handling: single-page-application`), so on boot, if
  `?reset=` is present, render a "Set a new password" form → `POST /api/auth/reset` → on
  success, show the signed-in state (or the login modal). Strip the token from the URL with
  `history.replaceState` after reading it (don't leave it in history/referrer).

## Security checklist

- [x] `/forgot` always 204 + equalized timing (no account enumeration).
- [x] Token hashed at rest (SHA-256); raw token only in the email.
- [x] Short TTL (1h) + single-use (`used_at`).
- [x] Reset bumps `token_version` → revokes all existing sessions.
- [x] Rate-limit `/forgot` and `/reset` via `AUTH_LIMITER` (per IP, and per email/token).
- [x] Generic error on bad/expired/used token (don't reveal which).
- [x] Token-in-URL risk (browser history) mitigated by single-use + short TTL + `replaceState`.
- [ ] Optional: cap unused tokens per user; invalidate older ones when a new one is requested.

## Rough effort

~Half a day: 1 migration, 2 routes, 3 query helpers, 1 email helper, a front-end reset form
+ "forgot" link, and tests (valid reset, expired token → 400, used token → 400, wrong/garbage
token → 400, enumeration parity on `/forgot`, session-revocation after reset). The token and
revocation pieces reuse existing Web-Crypto and `updateUserPasswordAndRevoke` code; the only
genuinely new dependency is the email provider.
