import type { ProviderAdapter, ProviderCallOptions } from "../../../base/providers.js";
import type { ProviderCapabilityId } from "../../../domain/ids.js";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  ProviderCostEstimateSchema,
  type ProviderCostEstimate,
} from "../../../domain/provider-admission.js";
import {
  ProviderAdapterOutcomeSchema,
  ProviderRequestEnvelopeSchema,
  type ProviderAdapterOutcome,
  type ProviderRequestEnvelope,
} from "../../../domain/providers.js";

export type DeterministicProviderScript =
  | Readonly<{ kind: "return"; estimate: ProviderCostEstimate; outcome: ProviderAdapterOutcome }>
  | Readonly<{ kind: "throw"; estimate: ProviderCostEstimate; message: string }>
  | Readonly<{ kind: "wait-for-abort"; estimate: ProviderCostEstimate }>;

export interface DeterministicProviderObservation {
  readonly request: ProviderRequestEnvelope;
  readonly options: ProviderCallOptions;
}

export interface DeterministicProviderHarness<C extends ProviderCapabilityId> {
  readonly adapter: ProviderAdapter<C>;
  readonly estimates: () => readonly ProviderRequestEnvelope[];
  readonly calls: () => readonly DeterministicProviderObservation[];
}

export function createDeterministicProviderHarness<C extends ProviderCapabilityId>(
  capability: C,
  scripts: readonly DeterministicProviderScript[],
): DeterministicProviderHarness<C> {
  const queue = [...scripts];
  const estimates: ProviderRequestEnvelope[] = [];
  const calls: DeterministicProviderObservation[] = [];
  let estimatedScript: DeterministicProviderScript | undefined;
  const adapter: ProviderAdapter<C> = Object.freeze({
    capability,
    estimate(requestInput: ProviderRequestEnvelope) {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== capability) {
        throw new Error(`${capability} adapter cannot estimate capability ${request.capability}`);
      }
      if (estimatedScript !== undefined) {
        throw new Error(`${capability} deterministic provider estimate was called twice without invocation`);
      }
      const script = queue.shift();
      if (script === undefined) throw new Error(`${capability} deterministic provider has no queued script`);
      estimatedScript = script;
      estimates.push(deepFreeze(request));
      return deepFreeze(ProviderCostEstimateSchema.parse(script.estimate));
    },
    async invoke(requestInput: ProviderRequestEnvelope, options: ProviderCallOptions) {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== capability) {
        throw new Error(`${capability} adapter cannot invoke capability ${request.capability}`);
      }
      const script = estimatedScript;
      if (script === undefined) {
        throw new Error(`${capability} deterministic provider invocation has no matching estimate`);
      }
      estimatedScript = undefined;
      calls.push(deepFreeze({ request, options }));
      if (options.signal.aborted) throw new Error(`${capability} provider call was aborted before invocation`);
      if (script.kind === "throw") throw new Error(script.message);
      if (script.kind === "return") return deepFreeze(ProviderAdapterOutcomeSchema.parse(script.outcome));
      return new Promise<ProviderAdapterOutcome>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new Error(`${capability} deterministic provider observed abort`));
        }, { once: true });
      });
    },
  });
  return Object.freeze({
    adapter,
    estimates: () => deepFreeze(estimates.map((request) => ProviderRequestEnvelopeSchema.parse(request))),
    calls: () => deepFreeze(calls.map(({ request, options }) => ({ request, options }))),
  });
}
