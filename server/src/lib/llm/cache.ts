/**
 * Hash-keyed TTL cache for LLM responses.
 *
 * A re-fetch of the same vessel within `ttlMs` returns the cached summary
 * without re-calling Claude. The key is a SHA-256 of the canonicalised
 * input JSON so structurally-identical payloads hit the same entry.
 */

import { createHash } from 'crypto';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number) {}

  /** Deterministically hash an arbitrary JSON-serialisable value. */
  static hashKey(value: unknown): string {
    const canonical = canonicalJson(value);
    return createHash('sha256').update(canonical).digest('hex');
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // Opportunistic GC — keeps the map from growing without bound when
    // many distinct inputs flow through.
    if (this.store.size > 256) {
      const now = Date.now();
      for (const [k, v] of this.store) {
        if (v.expiresAt < now) this.store.delete(k);
      }
    }
  }

  /** Test seam — wipe all entries. */
  _clear(): void {
    this.store.clear();
  }
}

/**
 * Canonical JSON: stable key ordering at every depth. Ensures two
 * structurally-equal objects produce the same hash regardless of property
 * insertion order.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  );
}
