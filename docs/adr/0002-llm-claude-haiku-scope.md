# ADR-0002: Claude Haiku for human-readable narratives only

**Status:** Accepted
**Date:** 2026-06-02
**Deciders:** Voltron agent team

---

## Context

Phase 9 adds LLM-powered text generation to the Toronto Island Ferry Tracker. The motivation is to surface plain-English summaries of vessel state and service disruptions — information that is technically derivable from existing data but requires interpretive formatting that is awkward with pure template strings.

The candidate scopes evaluated:

1. **Narrow (accepted):** LLM generates only human-readable narrative strings (vessel summary, disruption narrative). All schedule logic, destination inference, and route-matching remain deterministic TypeScript.
2. **Broad (rejected):** LLM replaces or augments schedule matching, destination inference, or route logic.
3. **Full RAG (rejected):** LLM answers open-ended questions about the ferry system using retrieved context.

---

## Decision

Use **Claude Haiku 4.5** for two endpoints only:

| Endpoint | Output |
|---|---|
| `POST /api/llm/vessel-summary` | 2–3 sentence plain-English vessel status paragraph |
| `POST /api/llm/disruption-narrative` | 1–2 sentence disruption explanation for OutageBanner |

All other logic (schedule lookup, destination inference, nearest-dock detection, trip inference) remains **deterministic TypeScript** with no LLM involvement.

---

## Rationale

**Why Haiku (not Sonnet/Opus)?**

- Narratives are short, low-stakes, and best-effort — latency and cost matter more than reasoning depth
- Haiku's output quality is sufficient for 2–3 sentence summaries
- Input tokens are small (~200 prompt tokens per call); Haiku with prompt caching makes repeated calls effectively free

**Why not replace deterministic logic?**

- Schedule matching and destination inference have hard correctness requirements (wrong destination = wrong ETAs shown to users)
- LLM outputs are probabilistic and hallucination-prone; ferry schedule data is structured and authoritative
- Deterministic code is testable, debuggable, and auditable; LLM logic is none of those things at runtime

**Why prompt caching?**

- System prompts (vessel context, disruption schema) are stable across calls; caching them reduces per-call cost by ~80%
- Anthropic cache TTL of 5 minutes is sufficient for vessel-summary refresh cadence

---

## Implementation Details

- **Model:** `claude-haiku-4-5-20251001`
- **Rate limiting:** Token-bucket (server-side, in-memory) — 10 requests/min per IP
- **Response cache:** In-memory LRU (TTL: 5 min for vessel summaries, 2 min for disruption narratives)
- **Fallback:** If `ANTHROPIC_API_KEY` is absent or the Anthropic API returns an error, endpoints return HTTP 503. Frontend handles gracefully (no summary shown; no user-facing error).
- **Feature gate:** `VITE_LLM_FEATURES=true` must be set in the frontend environment. Defaults to off in all environments.
- **Prompt design:** System prompt includes vessel name, MMSI, current navStatus, SOG, COG, nearest dock, and schedule context. No PII, no location history beyond current position.

---

## Consequences

**Positive:**
- Richer UX for users who want natural-language vessel status at a glance
- Zero impact on schedule correctness or destination logic
- Graceful degradation — LLM failure is invisible to users

**Negative / Deferred:**
- Additional API cost (negligible at current traffic; ~$0.001/100 summaries with caching)
- Adds `ANTHROPIC_API_KEY` as a new optional server secret
- Narrative quality depends on prompt; may require tuning as vessel data schema evolves

**Out of scope (explicitly):**
- Using LLM for schedule lookup, trip inference, or route matching
- LLM-powered chat or Q&A interface
- Fine-tuning or RAG over historical ferry data
