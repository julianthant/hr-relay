import type { ProviderCapabilityId } from "../rules/identity/ids.js";
import type { ProviderAdapterOutcome, ProviderRequestEnvelope, ProviderResponseEnvelope } from "../models/providers/providers.js";
import type { SchemaBoundCanonicalValue } from "../models/validation/schema-bound-value.js";

export interface ProviderCallOptions {
  readonly signal: AbortSignal;
  readonly deadlineMonotonicMs: number;
  readonly requestId: string;
}
export interface ProviderAdapter<C extends ProviderCapabilityId> {
  readonly capability: C;
  invoke(request: ProviderRequestEnvelope, options: ProviderCallOptions): Promise<ProviderAdapterOutcome>;
}
export interface ProviderClient<C extends ProviderCapabilityId> {
  readonly capability: C;
  call(payload: SchemaBoundCanonicalValue): Promise<ProviderResponseEnvelope>;
}
export type ProviderClientSubset<C extends ProviderCapabilityId> = Readonly<{ [Capability in C]: ProviderClient<Capability> }>;
