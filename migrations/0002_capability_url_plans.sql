-- Production was first initialized with the older account-based schema.
-- The current app uses capability URLs instead: public id for reads, edit key
-- hash for writes, and a revision number for optimistic concurrency.

DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS users;

CREATE TABLE plans (
  id             TEXT    PRIMARY KEY,
  edit_key_hash  TEXT    NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  plan_json      TEXT    NOT NULL,
  rev            INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
