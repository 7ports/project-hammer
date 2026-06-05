/**
 * Disruption-narrative LLM call.
 *
 * Caller passes the disruption metadata (City status code, the raw HTML-
 * stripped message, the reason tag, parsed altered-schedule times). We
 * forward it to Claude Haiku with the cached system preamble and return
 * the 2-3 sentence narrative.
 */

import { getAnthropicClient, LLM_MAX_TOKENS, LLM_MODEL } from './client';
import { DISRUPTION_NARRATIVE_SYSTEM } from './prompts';

export interface DisruptionNarrativeInput {
  /** City status code: "alert" (partial disruption) | "closed" (suspended) */
  status: 'alert' | 'closed';
  /** Short reason code from the City (e.g. "Weather"). May be null. */
  reason: string | null;
  /** HTML-stripped human-readable message from the City. May be null. */
  message: string | null;
  /** Altered-schedule departure times parsed out of `message` (HH:MM 24h). */
  parsedTimes: string[];
  /** ISO timestamp the City posted the disruption. May be null. */
  postedAt: string | null;
}

export interface DisruptionNarrativeResult {
  narrative: string;
}

export async function generateDisruptionNarrative(
  input: DisruptionNarrativeInput,
): Promise<DisruptionNarrativeResult> {
  const client = getAnthropicClient();
  const userPayload = JSON.stringify(input);

  const response = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: DISRUPTION_NARRATIVE_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPayload }],
  });

  const narrative = extractText(response);
  return { narrative };
}

function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('').trim();
}
