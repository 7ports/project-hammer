/**
 * Anthropic SDK client — lazily initialised.
 *
 * The LLM endpoints are gated on ANTHROPIC_API_KEY being present (see
 * config.anthropicApiKey). When the key is absent, getAnthropicClient()
 * throws a typed error and the routes respond 503 "LLM disabled" — the
 * server never crashes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

export const LLM_MODEL = 'claude-haiku-4-5-20251001';

/** Haiku-tier max output tokens. The summaries are tiny — 256 is plenty. */
export const LLM_MAX_TOKENS = 256;

export class LlmDisabledError extends Error {
  constructor() {
    super('LLM disabled');
    this.name = 'LlmDisabledError';
  }
}

let _client: Anthropic | null = null;

export function isLlmEnabled(): boolean {
  return config.anthropicApiKey !== null;
}

export function getAnthropicClient(): Anthropic {
  if (!config.anthropicApiKey) {
    throw new LlmDisabledError();
  }
  if (_client === null) {
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}

/** Test seam — lets tests inject a mock. */
export function _setAnthropicClient(client: Anthropic | null): void {
  _client = client;
}
