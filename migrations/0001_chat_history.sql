-- AuraFlare chat history + durable Workflow registry.
-- Each chat message is stored with its TRUE role (user/ai/system) and never
-- conflated. The durable ChatWorkflow writes here as it runs, so a user can
-- close the browser and return to a complete, correctly-attributed thread.

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,           -- uuid; also used as the client's ascending cursor
  session_id  TEXT NOT NULL,              -- groups a conversation thread
  instance_id TEXT,                       -- the Workflow instance that produced this message
  role        TEXT NOT NULL CHECK (role IN ('user', 'ai', 'system')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL               -- datetime('now') ISO string
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_instance ON chat_messages (instance_id);

-- One row per Workflow run. Lets the client poll a single run's status
-- (queued / running / paused-on-block / complete / errored) cheaply.
CREATE TABLE IF NOT EXISTS chat_runs (
  instance_id TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',  -- running | paused | complete | errored
  prompt      TEXT,                              -- first user message (for listing/recall)
  created_at  TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_runs_session ON chat_runs (session_id, created_at DESC);
