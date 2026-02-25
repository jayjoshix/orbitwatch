-- OrbitWatch Demo Schema

CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    route_id TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_cid TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_outbox (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cursors (
    id TEXT PRIMARY KEY,
    cursor_type TEXT NOT NULL,
    last_processed_block BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_events (
    id TEXT PRIMARY KEY,
    l1_block_number BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INT NOT NULL,
    batch_seq_num TEXT NOT NULL,
    block_timestamp BIGINT NOT NULL,
    UNIQUE(tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_batch_events_timestamp ON batch_events(block_timestamp DESC, l1_block_number DESC);
CREATE INDEX IF NOT EXISTS idx_alert_outbox_pending ON alert_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);
