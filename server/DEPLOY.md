# Deploying the Backend to Fly.io

The backend is a Node.js/Express server that proxies AIS data from aisstream.io
to the React frontend over SSE. It runs on Fly.io in the `yyz` (Toronto) region.

**App name:** `project-hammer-api`
**URL:** `https://project-hammer-api.fly.dev`
**Health check:** `https://project-hammer-api.fly.dev/api/health`

---

## Prerequisites

Install the Fly CLI (`flyctl`):

```bash
curl -L https://fly.io/install.sh | sh
```

---

## First-time setup

These steps only need to be run once per environment.

```bash
# Authenticate with Fly.io
fly auth login

# Create the app in the Toronto (yyz) region
# Skip this if the app already exists in your Fly.io dashboard
fly apps create project-hammer-api --region yyz

# Set required secrets (these are injected as env vars at runtime — never stored in fly.toml)
fly secrets set AISSTREAM_API_KEY=<your-aisstream-api-key> --app project-hammer-api
fly secrets set CORS_ORIGIN=https://ferries.yyz.live --app project-hammer-api
```

**Required secrets:**

| Secret | Description |
|---|---|
| `AISSTREAM_API_KEY` | aisstream.io WebSocket API key. Never commit this. |
| `CORS_ORIGIN` | Allowed frontend origin. Must match the deployed frontend URL. |

**Optional env vars (set in fly.toml or via `fly secrets set`):**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | TCP port the server binds to. Fly.io maps this via `internal_port`. |

---

## Deploy

All deploys are run from the `server/` directory.

```bash
cd server/

# Build + deploy (Fly.io builds the Docker image remotely)
fly deploy

# Or, build locally and push (slower but useful for debugging build failures)
fly deploy --local-only
```

CI/CD (`.github/workflows/deploy-backend.yml`) runs `fly deploy --remote-only`
automatically on every push to `main` that touches `server/**`.

---

## Verify

```bash
# Check machine and release status
fly status --app project-hammer-api

# Tail live logs
fly logs --app project-hammer-api

# Confirm the health endpoint is responding
curl https://project-hammer-api.fly.dev/api/health
# Expected response:
# {"status":"ok","uptime":<seconds>,"timestamp":"<ISO date>"}

# Test the AIS SSE stream (should receive events within ~10s of vessel activity)
curl -N https://project-hammer-api.fly.dev/api/ais/stream
```

---

## Scaling

The default `fly.toml` configuration uses `auto_stop_machines = true` with
`min_machines_running = 1`. This means one machine always runs (no cold starts)
but Fly.io can spin up additional machines under load.

To scale manually:

```bash
# Scale to 2 machines
fly scale count 2 --app project-hammer-api

# Upgrade machine size
fly scale vm shared-cpu-2x --app project-hammer-api
```

---

## Rollback

```bash
# List recent releases
fly releases --app project-hammer-api

# Roll back to a specific release
fly deploy --image <image-id>
```

---

## Environment parity

| Variable | Local dev | Production |
|---|---|---|
| `AISSTREAM_API_KEY` | `.env` in `server/` (gitignored) | Fly.io secret |
| `CORS_ORIGIN` | `http://localhost:5173` (default in config.ts) | Fly.io secret |
| `PORT` | `3001` | `3001` (set in fly.toml `internal_port`) |
