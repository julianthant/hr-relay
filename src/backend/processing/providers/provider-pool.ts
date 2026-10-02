/**
 * The production provider pool (ref data-intake-and-edit-data §4.11, 2h-D): ONE `ProviderAdapter`
 * per capability that selects WHICH child — a (key, model) pairing — answers
 * each invocation.
 *
 * "One invocation is ONE model call" is load-bearing for admission
 * accounting: the kernel admitted and budgeted exactly one request, so the
 * pool NEVER makes a second remote attempt under the same admission.
 * Rotation happens ACROSS invocations instead: an EXHAUSTION answer
 * (rate/daily/cost/concurrency — the retryable family) advances the cursor,
 * so the caller's next admitted attempt lands on the next child in priority
 * order; success and non-retryable failures keep the cursor where it is
 * (legacy `provider-limits.ts`' priority-1-first behaviour, ported as a
 * policy). The cursor is in-process state — a restart begins again at
 * priority 1, which is exactly what legacy did.
 *
 * The pool sits strictly ABOVE the adapters and BELOW nothing: it is not a
 * second admission path and not a second scheduler — it holds no budget, no
 * throttle, and no retry loop.
 */
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";
import type { ProviderCapabilityId } from "../../../rules/identity/ids.js";
import {
  ProviderAdapterOutcomeSchema,
  type ProviderRequestEnvelope,
} from "../../../models/providers/providers.js";

/** The exhaustion family — the codes that advance the rotation cursor. */
const ROTATING_CODES = new Set([
  "concurrency-exhausted",
  "rate-exhausted",
  "daily-request-exhausted",
  "daily-cost-exhausted",
]);

export interface ProviderPoolChild<C extends ProviderCapabilityId> {
  /** Names the key/model pairing in evidence, e.g. `gemini-key1/gemini-3-flash-preview`. */
  readonly label: string;
  readonly adapter: ProviderAdapter<C>;
}

export function createProviderPool<C extends ProviderCapabilityId>(
  capability: C,
  children: readonly ProviderPoolChild<C>[],
): ProviderAdapter<C> {
  if (children.length === 0) {
    throw new Error(`${capability} pool composed with zero children; an empty pool cannot answer`);
  }
  let cursor = 0;
  const current = (): ProviderPoolChild<C> => {
    const child = children[cursor % children.length];
    if (child === undefined) throw new Error(`${capability} pool cursor resolved no child`);
    return child;
  };
  return Object.freeze({
    capability,
    estimate: (request: ProviderRequestEnvelope) => current().adapter.estimate(request),
    async invoke(request: ProviderRequestEnvelope, options: ProviderCallOptions) {
      const child = current();
      const outcome = ProviderAdapterOutcomeSchema.parse(await child.adapter.invoke(request, options));
      if (outcome.response.state === "unavailable" && ROTATING_CODES.has(outcome.response.reason.code)) {
        cursor = (cursor + 1) % children.length;
      }
      // The evidence names WHICH child answered — key/model provenance
      // without a second envelope field.
      return ProviderAdapterOutcomeSchema.parse({
        ...outcome,
        evidence: { ...outcome.evidence, summary: `${child.label}: ${outcome.evidence.summary}` },
      });
    },
  });
}
