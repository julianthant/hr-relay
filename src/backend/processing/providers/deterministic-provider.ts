import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";
import type { ProviderCapabilityId } from "../../../rules/identity/ids.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import {
  ProviderAdapterOutcomeSchema,
  ProviderRequestEnvelopeSchema,
  type ProviderAdapterOutcome,
  type ProviderRequestEnvelope,
} from "../../../models/providers/providers.js";

export type DeterministicProviderScript =
  | Readonly<{ kind: "return"; outcome: ProviderAdapterOutcome }>
  | Readonly<{ kind: "throw"; message: string }>
  | Readonly<{ kind: "wait-for-abort" }>;

export interface DeterministicProviderObservation {
  readonly request: ProviderRequestEnvelope;
  readonly options: ProviderCallOptions;
}

export interface DeterministicProviderHarness<C extends ProviderCapabilityId> {
  readonly adapter: ProviderAdapter<C>;
  readonly calls: () => readonly DeterministicProviderObservation[];
}

export function createDeterministicProviderHarness<C extends ProviderCapabilityId>(
  capability: C,
  scripts: readonly DeterministicProviderScript[],
): DeterministicProviderHarness<C> {
  const queue = [...scripts];
  const calls: DeterministicProviderObservation[] = [];
  const adapter: ProviderAdapter<C> = Object.freeze({
    capability,
    async invoke(requestInput: ProviderRequestEnvelope, options: ProviderCallOptions) {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== capability) {
        throw new Error(`${capability} adapter cannot invoke capability ${request.capability}`);
      }
      const script = queue.shift();
      if (script === undefined) throw new Error(`${capability} deterministic provider has no queued script`);
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
    calls: () => deepFreeze(calls.map(({ request, options }) => ({ request, options }))),
  });
}
