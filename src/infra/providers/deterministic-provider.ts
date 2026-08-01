import type { ProviderAdapter, ProviderCallOptions, ProviderClient } from "../../base/providers.js";
import type { ProviderCapabilityId } from "../../domain/ids.js";
import { deepFreeze } from "../../domain/immutability.js";
import {
  ProviderRequestEnvelopeSchema,
  ProviderResponseEnvelopeSchema,
} from "../../domain/providers.js";
import type {
  ProviderRequestEnvelope,
  ProviderResponseEnvelope,
} from "../../domain/providers.js";
import { SchemaBoundCanonicalValueSchema } from "../../domain/schema-bound-value.js";
import type { SchemaBoundCanonicalValue } from "../../domain/schema-bound-value.js";

export interface DeterministicProviderHarness<C extends ProviderCapabilityId> {
  readonly adapter: ProviderAdapter<C>;
  readonly client: ProviderClient<C>;
  readonly calls: () => readonly ProviderRequestEnvelope[];
}

export function createDeterministicProviderHarness<C extends ProviderCapabilityId>(
  capability: C,
  responses: readonly ProviderResponseEnvelope[],
): DeterministicProviderHarness<C> {
  const queue = responses.map((response) => deepFreeze(ProviderResponseEnvelopeSchema.parse(response)));
  const calls: ProviderRequestEnvelope[] = [];
  const adapter: ProviderAdapter<C> = Object.freeze({
    capability,
    async invoke(requestInput: ProviderRequestEnvelope, options: ProviderCallOptions) {
      if (options.signal.aborted) throw new Error(`${capability} provider call was aborted before invocation`);
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== capability) {
        throw new Error(`${capability} adapter cannot invoke capability ${request.capability}`);
      }
      calls.push(deepFreeze(request));
      const response = queue.shift();
      if (response === undefined) throw new Error(`${capability} deterministic provider has no queued response`);
      return response;
    },
  });
  const client: ProviderClient<C> = Object.freeze({
    capability,
    async call(payloadInput: SchemaBoundCanonicalValue, options: ProviderCallOptions) {
      const payload = SchemaBoundCanonicalValueSchema.parse(payloadInput);
      const response = await adapter.invoke({ capability, payload }, options);
      return ProviderResponseEnvelopeSchema.parse(response);
    },
  });
  return Object.freeze({
    adapter,
    client,
    calls: () => deepFreeze(calls.map((call) => ProviderRequestEnvelopeSchema.parse(call))),
  });
}
