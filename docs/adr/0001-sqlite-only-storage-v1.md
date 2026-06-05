# ADR-0001: SQLite-only storage for Analytics v1

**Status:** Accepted
**Date:** 2026-06-02
**Deciders:** Voltron agent team

---

## Context

Phase 9 adds an analytics backend to the Toronto Island Ferry Tracker. The backend runs on a single Fly.io machine in the `yyz` region with a 3 GB persistent volume (`hammer_data`, mounted at `/data`). We need a durable, queryable store for:

- AIS position timeseries (~4 vessels × 6 pings/min = ~34,560 rows/day)
- Ferry events (arrivals, departures, service disruptions)
- Trip segments inferred from position data
- Weather snapshots at trip boundaries
- Daily schedule snapshots from TTC ferry timetable

Candidates evaluated: SQLite (local file), PostgreSQL (Fly managed), Redis (in-memory cache only), DynamoDB (AWS, cross-region).

---

## Decision

Ship **SQLite only** for v1, stored on the Fly.io persistent volume, with no replication or cold-tier backup initially.

Key implementation details:
- `better-sqlite3` (synchronous, Node bindings) — avoids async complexity for an append-heavy write pattern
- Migration runner using `PRAGMA user_version` for schema versioning
- Batched `PositionWriter` (100-row flush or 5-second timeout) to avoid per-ping writes
- Daily rollup aggregation job to bound table growth
- Weekly `VACUUM` on Sunday 03:00 UTC to reclaim deleted-row space

---

## Rationale

| Factor | SQLite | PostgreSQL (Fly) |
|---|---|---|
| Ops overhead | Zero — file on volume | Managed, but still a separate service |
| Latency | Sub-millisecond (in-process) | ~1ms round-trip (same region) |
| Write throughput | 10k+ rows/s (WAL mode) | Comparable |
| Storage cost | Included in Fly volume ($0.15/GB/mo) | $29+/mo for smallest managed instance |
| Backup / durability | Single volume, no replication | Daily managed snapshots |
| Growth at current rate | ~34k rows/day; 3 GB volume → ~2+ years | N/A |

PostgreSQL's main advantage (managed snapshots, read replicas) is unnecessary at this scale and budget. The primary risk is single-volume durability: a Fly volume loss loses analytics history but not the live AIS relay.

---

## Consequences

**Positive:**
- Zero infrastructure cost increase
- No additional service to manage or connect
- Sub-millisecond query latency from within the same process
- Trivially embeddable in CI (no test database to spin up)

**Negative / Deferred:**
- No automatic backup — a volume failure loses analytics history (not app-critical)
- SQLite does not support concurrent writers across multiple Fly machines; horizontal scaling requires migration to Turso/libsql or PostgreSQL
- Litestream (SQLite → S3 streaming replication) was evaluated and deferred as a known follow-up; it would add durability at ~$0.023/GB/mo (S3 storage only)

**Follow-up items:**
- Add Litestream replication to S3 when analytics data becomes business-critical
- Monitor volume fill rate; alert at 80% (≈2.4 GB)
- Evaluate Turso/libsql if multi-region reads are needed
