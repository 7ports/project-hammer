/**
 * SQLite schema for AIS positions, ferry events, provider state, daily rollups,
 * and schedule snapshots.
 *
 * Source of truth: .voltron/reports/ais-storage.md §6.
 *
 * All tables use STRICT mode so type mismatches surface at write time, not
 * silently coerce. Indexes are designed for the common access pattern:
 * "last N positions for vessel X" (covering index on mmsi+timestamp DESC).
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ais_positions (
    id          INTEGER PRIMARY KEY,
    mmsi        INTEGER NOT NULL,
    provider    TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    sog         REAL NOT NULL,
    cog         REAL NOT NULL,
    heading     INTEGER NOT NULL,
    nav_status  INTEGER
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_ais_mmsi_ts ON ais_positions (mmsi, timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ais_ts ON ais_positions (timestamp DESC)`,

  `CREATE TABLE IF NOT EXISTS ferry_events (
    id           INTEGER PRIMARY KEY,
    status       TEXT NOT NULL,
    message      TEXT,
    reason       TEXT,
    posted_at    INTEGER,
    detected_at  INTEGER NOT NULL,
    parsed_times TEXT
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_ferry_events_detected ON ferry_events (detected_at DESC)`,

  `CREATE TABLE IF NOT EXISTS provider_state (
    id            INTEGER PRIMARY KEY,
    transition    TEXT NOT NULL,
    from_provider TEXT,
    to_provider   TEXT,
    timestamp     INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_provider_state_ts ON provider_state (timestamp DESC)`,

  `CREATE TABLE IF NOT EXISTS daily_rollups (
    date                          TEXT PRIMARY KEY,
    total_positions               INTEGER NOT NULL,
    vessels_active                INTEGER NOT NULL,
    avg_sog                       REAL,
    max_sog                       REAL,
    service_status_minutes_open   INTEGER NOT NULL,
    service_status_minutes_alert  INTEGER NOT NULL,
    service_status_minutes_closed INTEGER NOT NULL,
    schedule_adherence_score      REAL
  ) STRICT`,

  `CREATE TABLE IF NOT EXISTS schedule_snapshots (
    id            INTEGER PRIMARY KEY,
    snapshot_hash TEXT NOT NULL UNIQUE,
    generated_at  INTEGER NOT NULL,
    captured_at   INTEGER NOT NULL,
    content       TEXT NOT NULL
  ) STRICT`,
];
