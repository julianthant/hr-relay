import type { ProviderCapabilityId } from "../domain/ids.js";
import type {
  ProviderRequestEnvelope,
  ProviderResponseEnvelope,
} from "../domain/providers.js";
import type { SchemaBoundCanonicalValue } from "../domain/schema-bound-value.js";

export interface ProviderCallOptions {
  readonly signal: AbortSignal;
}

export interface ProviderAdapter<C extends ProviderCapabilityId> {
  readonly capability: C;
  invoke(request: ProviderRequestEnvelope, options: ProviderCallOptions): Promise<ProviderResponseEnvelope>;
}

export interface ProviderClient<C extends ProviderCapabilityId> {
  readonly capability: C;
  call(payload: SchemaBoundCanonicalValue, options: ProviderCallOptions): Promise<ProviderResponseEnvelope>;
}

export type ProviderClientSubset<C extends ProviderCapabilityId> = Readonly<{
  [Capability in C]: ProviderClient<Capability>;
}>;
