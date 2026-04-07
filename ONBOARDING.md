# Sauron Observability Onboarding

**Onboarded by:** Helldiver Squadron Alpha
**Date:** 2026-04-07
**Sauron hub:** https://sauron.7ports.ca

---

## What Sauron Monitors for Project Hammer

Project Hammer is monitored via **Blackbox HTTP probing** from the Sauron observability hub. No client-side agent is required — Sauron probes the public HTTP endpoints from the outside every 30 seconds.

### Endpoints Being Probed

| Endpoint | URL | Type |
|---|---|---|
| Frontend | `https://ferries.yyz.live` | S3/CloudFront SPA |
| Backend health | `https://project-hammer-api.fly.dev/api/health` | Fly.io Express API |

### What is Collected

- **Uptime (probe_success)** — 0 (DOWN) or 1 (UP) for each endpoint
- **Response time (probe_duration_seconds)** — HTTP round-trip latency in seconds
- **HTTP status code (probe_http_status_code)** — e.g., 200, 404, 500
- **Probe interval:** every 30 seconds

### Why No Client-Side Agent

- The frontend is a static CDN asset (AWS S3 + CloudFront) — there is no persistent host to run an agent on
- The backend runs on Fly.io managed infrastructure — no persistent host access for an agent
- External Blackbox probing covers the most important signal: **is the service reachable and responding correctly?**

---

## Viewing the Dashboard

The Grafana dashboard for Project Hammer is available at:

**https://sauron.7ports.ca** → Dashboards → **Project Hammer — Ferry Tracker Overview**

Dashboard panels:
1. **Frontend Uptime** — live UP/DOWN status for ferries.yyz.live
2. **Backend Uptime** — live UP/DOWN status for the Fly.io /api/health endpoint
3. **Response Time** — time-series graph of HTTP latency for both endpoints
4. **HTTP Status Codes** — last seen HTTP status code from each probe

---

## Alert Rules

The following alerts are configured in Sauron:

| Alert | Condition | Severity |
|---|---|---|
| `HammerFrontendDown` | Frontend unreachable for 2+ minutes | critical |
| `HammerBackendDown` | Backend health endpoint unreachable for 2+ minutes | critical |
| `HammerHighLatency` | Response time > 3s for 5+ minutes | warning |

> **Note:** Alertmanager routing is not yet configured in Sauron — alerts are visible in the Prometheus UI at `:9090/alerts` but are not yet delivered via email/Slack. This is tracked as known tech debt.

---

## Adding New Endpoints to Monitoring

To add a new endpoint (e.g., a new API route, a staging environment) to Sauron monitoring:

1. Contact the Sauron operator (Rajesh) or open an issue in [7ports/project-sauron](https://github.com/7ports/project-sauron)
2. Provide the full URL and expected HTTP status code
3. The operator will add it to the `blackbox_http` job in `prometheus.yml` and deploy

---

## Notes

- The Fly.io backend uses `auto_stop_machines = true`. Cold starts may cause occasional latency spikes on the backend probe. The high-latency alert threshold is set to 3s to account for this.
- The frontend is served globally via CloudFront — probe latency reflects the AWS edge closest to the Sauron EC2 instance (us-east-1).
