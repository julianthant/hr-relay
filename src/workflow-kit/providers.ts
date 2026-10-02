import type { ProviderCapabilityId } from "../rules/identity/ids.js";
import type {
  ProviderAdapterOutcome,
  ProviderRequestEnvelope,
  ProviderResponseEnvelope,
} from "../models/providers/providers.js";
import type {
  ProviderAdmissionMutationOutcome,
  ProviderAdmissionRecord,
  ProviderAdmissionReserveOutcome,
  ProviderAdmissionSweepOutcome,
  ProviderBudgetCounter,
  ProviderCostEstimate,
} from "../rules/providers/provider-admission.js";
import type { ProviderAdmissionId } from "../rules/identity/ids.js";
import type { SchemaBoundCanonicalValue } from "../models/validation/schema-bound-value.js";

export interface ProviderCallOptions {
  readonly signal: AbortSignal;
  readonly deadlineMonotonicMs: number;
  readonly admissionId: ProviderAdmissionId;
}

export interface ProviderAdapter<C extends ProviderCapabilityId> {
  readonly capability: C;
  estimate(request: ProviderRequestEnvelope): ProviderCostEstimate;
  invoke(request: ProviderRequestEnvelope, options: ProviderCallOptions): Promise<ProviderAdapterOutcome>;
}

export interface ProviderClient<C extends ProviderCapabilityId> {
  readonly capability: C;
  call(payload: SchemaBoundCanonicalValue): Promise<ProviderResponseEnvelope>;
}

export type ProviderClientSubset<C extends ProviderCapabilityId> = Readonly<{
  [Capability in C]: ProviderClient<Capability>;
}>;

export type ProviderAdmissionRepository = Readonly<{
  reserve(input: unknown): ProviderAdmissionReserveOutcome;
  deny(input: unknown): ProviderAdmissionReserveOutcome;
  settle(input: unknown): ProviderAdmissionMutationOutcome;
  interrupt(input: unknown): ProviderAdmissionMutationOutcome;
  sweepExpired(input: unknown): ProviderAdmissionSweepOutcome;
  get(admissionId: string): ProviderAdmissionRecord | undefined;
  getCounter(capability: string): ProviderBudgetCounter | undefined;
}>;
