/**
 * SQLite schema for AIS positions, ferry events, provider state, daily rollups,
 * schedule snapshots, inferred trips, weather snapshots, and trip-weather links.
 *
 * Source of truth for v1: .voltron/reports/ais-storage.md §6.
 * Migration v2 (trips, weather_snapshots, trip_weather) supports task
 * project-hammer-yw2 (trip inference + weather snapshots).
 *
 * All tables use STRICT mode so type mismatches surface at write time, not
 * silently coerce. Indexes are designed for the common access pattern:
 * "last N positions for vessel X" (covering index on mmsi+timestamp DESC).
 */

export const SCHEMA_VERSION = 2;

/** Migration v1 — original storage scaffolding (Task 4, commit 966db60). */
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

/**
 * Migration v2 — inferred trips + weather snapshots (project-hammer-yw2).
 *
 * trips: one row per inferred ferry trip (dock-leave → dock-arrive).
 *   UNIQUE(mmsi, start_at) makes re-runs idempotent via INSERT OR IGNORE.
 *
 * weather_snapshots: rolling buffer of weather observations captured by the
 *   periodic poller and at trip boundaries. Used as the join target for
 *   trip_weather; lets us reuse one observation across multiple trips.
 *
 * trip_weather: links trips to weather_snapshots at the start and end
 *   boundaries. PK (trip_id, boundary) means a trip has at most one weather
 *   row per boundary.
 */
export const SCHEMA_V2_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS trips (
    id             INTEGER PRIMARY KEY,
    mmsi           INTEGER NOT NULL,
    from_dock      TEXT NOT NULL,
    to_dock        TEXT NOT NULL,
    start_at       INTEGER NOT NULL,
    end_at         INTEGER NOT NULL,
    duration_s     INTEGER NOT NULL,
    distance_m     REAL NOT NULL,
    position_count INTEGER NOT NULL,
    inferred_at    INTEGER NOT NULL,
    UNIQUE (mmsi, start_at)
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_trips_mmsi_start ON trips (mmsi, start_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_trips_end ON trips (end_at DESC)`,

  `CREATE TABLE IF NOT EXISTS weather_snapshots (
    id                    INTEGER PRIMARY KEY,
    captured_at           INTEGER NOT NULL,
    observed_at           TEXT,
    temperature_c         REAL,
    feels_like_c          REAL,
    wind_kmh              REAL,
    wind_dir_deg          REAL,
    wind_gust_kmh         REAL,
    visibility_km         REAL,
    precip_1h_mm          REAL,
    condition             TEXT,
    precipitation_warning INTEGER NOT NULL,
    raw_observation       TEXT
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_weather_snapshots_captured ON weather_snapshots (captured_at DESC)`,

  `CREATE TABLE IF NOT EXISTS trip_weather (
    trip_id             INTEGER NOT NULL,
    boundary            TEXT NOT NULL,
    weather_snapshot_id INTEGER NOT NULL,
    PRIMARY KEY (trip_id, boundary),
    FOREIGN KEY (trip_id) REFERENCES trips(id),
    FOREIGN KEY (weather_snapshot_id) REFERENCES weather_snapshots(id)
  ) STRICT`,
];
