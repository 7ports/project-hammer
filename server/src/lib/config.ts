/**
 * Validated environment configuration for the Toronto Island Ferry Tracker backend.
 *
 * This is the ONLY place in the server codebase that reads process.env.
 * All other modules must import from this file rather than accessing process.env directly.
 *
 * The module validates required variables at load time so the server fails fast
 * on startup rather than silently producing errors at runtime.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalEnvNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var: ${name}=${JSON.stringify(raw)}`);
  }
  return parsed;
}

interface Config {
  /** TCP port the Express server listens on. Defaults to 3001. */
  port: number;
  /** aisstream.io API key — required, never sent to the browser. */
  aisstreamApiKey: string;
  /**
   * Allowed CORS origin for the frontend.
   * Defaults to the Vite dev server; in production Fly.io sets this to
   * the CloudFront frontend URL via a Fly.io secret.
   */
  corsOrigin: string;
  /** aprs.fi API key — optional fallback provider. */
  aprsfiApiKey: string | null;
  /** VesselAPI.com API key — optional last-resort fallback provider. */
  vesselApiKey: string | null;
  /**
   * Ordered list of provider names to use.
   * Comma-separated string from AIS_PROVIDER_ORDER env var.
   * Defaults to 'aisstream'.
   */
  aisProviderOrder: string[];
  /**
   * Milliseconds of silence before the manager triggers a failover.
   * Defaults to 5 minutes (300 000 ms).
   */
  aisSilenceTimeoutMs: number;
  /**
   * Polling interval for REST-based providers (aprsfi, vesselapi).
   * Defaults to 30 000 ms (30 seconds).
   */
  aisPollingIntervalMs: number;
  /**
   * How often the FerryStatusMonitor polls the City ferry status API.
   * Defaults to 30 000 ms (30 seconds).
   */
  ferryStatusPollMs: number;
}

export const config: Config = {
  port: optionalEnvNumber('PORT', 3001),
  aisstreamApiKey: requireEnv('AISSTREAM_API_KEY'),
  corsOrigin: optionalEnv('CORS_ORIGIN', 'http://localhost:5173'),
  aprsfiApiKey: process.env['APRSFI_API_KEY'] ?? null,
  vesselApiKey: process.env['VESSEL_API_KEY'] ?? null,
  aisProviderOrder: optionalEnv('AIS_PROVIDER_ORDER', 'aisstream')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  aisSilenceTimeoutMs: optionalEnvNumber('AIS_SILENCE_TIMEOUT_MS', 5 * 60 * 1_000),
  aisPollingIntervalMs: optionalEnvNumber('AIS_POLLING_INTERVAL_MS', 30_000),
  ferryStatusPollMs: optionalEnvNumber('FERRY_STATUS_POLL_MS', 30_000),
};
