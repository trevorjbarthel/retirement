-- Self-contained email + password accounts, and one saved plan per user.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,          -- stored lowercased/trimmed
  password_hash TEXT    NOT NULL,                 -- base64 PBKDF2 derived bits
  password_salt TEXT    NOT NULL,                 -- base64 of 16 random bytes
  iterations    INTEGER NOT NULL,                 -- PBKDF2 iterations used (per-user, upgradable)
  token_version INTEGER NOT NULL DEFAULT 1,       -- bump to invalidate all sessions
  created_at    INTEGER NOT NULL,                 -- unix seconds
  updated_at    INTEGER NOT NULL
);

CREATE TABLE plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,      -- mirrors the localStorage '...-v5' versioning intent
  plan_json      TEXT    NOT NULL,                -- full buildState() object incl. checks{}
  updated_at     INTEGER NOT NULL,
  UNIQUE(user_id),                                -- one plan per user for now (drop later for many)
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_plans_user ON plans(user_id);
