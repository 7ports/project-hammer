/**
 * Simple in-memory token bucket rate limiter.
 *
 * One bucket per endpoint. Default: 5 tokens, refill 5/sec — i.e. at most
 * 5 calls/sec sustained, with a burst of up to 5.
 *
 * Deliberately not Redis-backed (per task spec) — the LLM endpoints are
 * low-volume convenience features, not load-bearing traffic.
 */

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  /**
   * Attempt to consume one token. Returns true on success, false when the
   * bucket is empty.
   */
  tryConsume(): boolean {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private _refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    const refilled = elapsedSec * this.refillPerSec;
    this.tokens = Math.min(this.capacity, this.tokens + refilled);
    this.lastRefillMs = now;
  }

  /** Test seam — manually reset the bucket. */
  _reset(): void {
    this.tokens = this.capacity;
    this.lastRefillMs = Date.now();
  }
}
