-- Self-service password reset tokens. Only the SHA-256 of the token is stored; the raw
-- token lives only in the emailed link. Tokens are single-use (used_at) and short-lived
-- (expires_at). Cascade-deletes with the user.
CREATE TABLE password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  token_hash  TEXT    NOT NULL,                 -- base64url SHA-256 of the raw token
  expires_at  INTEGER NOT NULL,                 -- unix seconds
  used_at     INTEGER,                          -- set when consumed; NULL = still valid
  created_at  INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
