-- Optimistic-concurrency revision counter for multi-tab / multi-device edit safety.
-- Every successful write bumps plans.rev; a write that carries a stale base rev is
-- rejected (409) instead of silently clobbering a newer version. A monotonic counter
-- (not updated_at, which is only second-precision) guarantees the token always advances.
ALTER TABLE plans ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
