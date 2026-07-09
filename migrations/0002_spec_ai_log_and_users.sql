-- 0002: Reproducibility + observability (2026-07-06 audit follow-up).
--
-- spec_data and ai_log already exist in production D1 (created out-of-band
-- during the 2026-07-04/05 sessions) but were never captured in migrations,
-- so a fresh environment could not be rebuilt from migrations alone. The
-- CREATE statements below match the live production schema exactly; the
-- ALTERs then widen ai_log for token/cost tracking and add user_id columns
-- ahead of the auth work (MASTERPLAN Phase 2).
--
-- Safe on both fresh and existing databases: CREATE IF NOT EXISTS is a no-op
-- in prod; the ALTERs add columns that do not exist anywhere yet.

CREATE TABLE IF NOT EXISTS spec_data (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT,
  model      TEXT,
  cached     INTEGER DEFAULT 0,
  latency_ms REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Widen ai_log for spend/anomaly analytics (Automated Loops sweep engine).
ALTER TABLE ai_log ADD COLUMN tokens_in  INTEGER;
ALTER TABLE ai_log ADD COLUMN tokens_out INTEGER;
ALTER TABLE ai_log ADD COLUMN cost_usd   REAL;
ALTER TABLE ai_log ADD COLUMN status     TEXT;

-- Per-user ownership ahead of the Better Auth migration. Nullable for now;
-- enforcement (WHERE user_id = ?) lands with the auth work.
ALTER TABLE chat_messages ADD COLUMN user_id TEXT;
ALTER TABLE chat_runs     ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_log_endpoint_time ON ai_log (endpoint, created_at);
