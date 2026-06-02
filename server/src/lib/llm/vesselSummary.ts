/**
 * Vessel-summary LLM call.
 *
 * Caller passes the vessel state (a thin, serialisable subset of the
 * runtime Vessel object — no Date instances, no DOM-bound refs). We
 * forward it to Claude Haiku with the cached system preamble and return
 * the generated string.
 */

import { getAnthropicClient, LLM_MAX_TOKENS, LLM_MODEL } from './client';
import { VESSEL_SUMMARY_SYSTEM } from './prompts';

export interface VesselSummaryInput {
  /** Vessel name (e.g. "Sam McBride") */
  name: string;
  /** "moving" | "docked" | "offline" */
  status: string;
  /** Speed over ground in knots (null if AIS hasn't reported) */
  sog: number | null;
  /** Course over ground in degrees (null if AIS hasn't reported) */
  cog: number | null;
  /** Geometric nearest dock name */
  nearestDock: string;
  /** Inferred destination dock name (only when moving) */
  destination?: string | null;
  /** Most-recent departure dock name */
  departedFrom?: string | null;
  /** Estimated minutes to nearest dock */
  etaMinutes?: number | null;
  /** ISO timestamp of next scheduled departure */
  nextDepartureAt?: string | null;
  /** 0..1 destination-inference confidence */
  destinationConfidence?: number | null;
  /** Per-candidate reason tags (debug-style: ["schedule_match", "bearing"]) */
  destinationReasons?: string[];
}

export interface VesselSummaryResult {
  summary: string;
}

export async function generateVesselSummary(
  input: VesselSummaryInput,
): Promise<VesselSummaryResult> {
  const client = getAnthropicClient();
  const userPayload = JSON.stringify(input);

  const response = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: VESSEL_SUMMARY_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPayload }],
  });

  const summary = extractText(response);
  return { summary };
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
