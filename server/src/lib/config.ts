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
}

export const config: Config = {
  port: optionalEnvNumber('PORT', 3001),
  aisstreamApiKey: requireEnv('AISSTREAM_API_KEY'),
  corsOrigin: optionalEnv('CORS_ORIGIN', 'http://localhost:5173'),
};
