-- Capability-URL plans: no accounts. Each plan is addressed by a public, unguessable
-- `id` (the read-only/view token in the URL path) and protected for writes by a separate
-- secret `edit_key` (carried in the URL hash and required on PUT). Only the SHA-256 of
-- the edit key is stored, so a DB read alone doesn't grant edit capability.
CREATE TABLE plans (
  id             TEXT    PRIMARY KEY,             -- public view token (URL: /p/<id>)
  edit_key_hash  TEXT    NOT NULL,                -- base64url SHA-256 of the edit key
  schema_version INTEGER NOT NULL DEFAULT 1,
  plan_json      TEXT    NOT NULL,
  rev            INTEGER NOT NULL DEFAULT 1,      -- optimistic concurrency (multi-tab/device)
  created_at     INTEGER NOT NULL,                -- unix seconds
  updated_at     INTEGER NOT NULL
);
