import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ProviderAdapter,
  ProviderAdmissionRepository,
  ProviderClient,
} from "../base/providers.js";
import { canonicalJsonStringify } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import { providerBudget } from "../domain/config/schema.js";
import { ConfigSnapshotRecordSchema } from "../domain/config/snapshot.js";
import {
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  ProviderAdmissionIdSchema,
  ProviderCapabilityIdSchema,
  type ProviderAdmissionId,
  type ProviderCapabilityId,
} from "../domain/ids.js";
import {
  ProviderAdmissionDenyRequestSchema,
  ProviderAdmissionReserveRequestSchema,
  ProviderCostEstimateSchema,
  ProviderExecutionIdentitySchema,
  ProviderUnavailableReasonSchema,
  type ProviderUnavailableReason,
} from "../domain/provider-admission.js";
import {
  ProviderAdapterOutcomeSchema,
  ProviderRequestEnvelopeSchema,
  ProviderResponseEnvelopeSchema,
} from "../domain/providers.js";
import type { SchemaBoundCanonicalValue } from "../domain/schema-bound-value.js";
import { RunRequeueRequestSchema } from "../infra/sqlite/run-store-contracts.js";

export type ProviderAdapterRegistry = Readonly<{
  "ocr.extract"?: ProviderAdapter<"ocr.extract">;
  "geocode.census"?: ProviderAdapter<"geocode.census">;
  "geocode.nominatim"?: ProviderAdapter<"geocode.nominatim">;
  "ai.advisory"?: ProviderAdapter<"ai.advisory">;
}>;

export interface ProviderAdmissionIdFactory {
  next(): ProviderAdmissionId;
}

export interface MonotonicDeadlineHandle {
  cancel(): void;
}

export interface MonotonicDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): MonotonicDeadlineHandle;
}

export class ProviderOutcomeUncertainError extends Error {
  readonly admissionId: ProviderAdmissionId;

  constructor(admissionId: ProviderAdmissionId, message: string, options?: ErrorOptions) {
    super(`provider admission ${admissionId} has an uncertain outcome: ${message}`, options);
    this.name = "ProviderOutcomeUncertainError";
    this.admissionId = admissionId;
  }
}

export interface ProviderAdmissionClientDependencies {
  readonly execution: z.input<typeof ProviderExecutionIdentitySchema>;
  readonly configSnapshotId: unknown;
  readonly configFingerprint: unknown;
  readonly configSnapshot: unknown;
  readonly runSignal: AbortSignal;
  readonly adapters: ProviderAdapterRegistry;
  readonly repository: ProviderAdmissionRepository;
  readonly clock: Clock;
  readonly idFactory: ProviderAdmissionIdFactory;
  readonly deadlineScheduler: MonotonicDeadlineScheduler;
}

function adapterFor(
  registry: ProviderAdapterRegistry,
  capability: ProviderCapabilityId,
): ProviderAdapter<ProviderCapabilityId> | undefined {
  switch (capability) {
    case "ocr.extract": return registry[capability];
    case "geocode.census": return registry[capability];
    case "geocode.nominatim": return registry[capability];
    case "ai.advisory": return registry[capability];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestFingerprint(request: z.output<typeof ProviderRequestEnvelopeSchema>) {
  return FingerprintSchema.parse(createHash("sha256").update(canonicalJsonStringify(request)).digest("hex"));
}

function unavailable(reason: ProviderUnavailableReason) {
  return ProviderResponseEnvelopeSchema.parse({ state: "unavailable", reason });
}

function denialRequest(base: unknown): z.output<typeof ProviderAdmissionDenyRequestSchema> {
  return ProviderAdmissionDenyRequestSchema.parse(base);
}

export function createAdmittedProviderClient(
  capability: "ocr.extract",
  dependencies: ProviderAdmissionClientDependencies,
): ProviderClient<"ocr.extract">;
export function createAdmittedProviderClient(
  capability: "geocode.census",
  dependencies: ProviderAdmissionClientDependencies,
): ProviderClient<"geocode.census">;
export function createAdmittedProviderClient(
  capability: "geocode.nominatim",
  dependencies: ProviderAdmissionClientDependencies,
): ProviderClient<"geocode.nominatim">;
export function createAdmittedProviderClient(
  capability: "ai.advisory",
  dependencies: ProviderAdmissionClientDependencies,
): ProviderClient<"ai.advisory">;
export function createAdmittedProviderClient(
  capabilityInput: ProviderCapabilityId,
  dependencies: ProviderAdmissionClientDependencies,
): ProviderClient<ProviderCapabilityId> {
  const capability = ProviderCapabilityIdSchema.parse(capabilityInput);
  const execution = ProviderExecutionIdentitySchema.parse(dependencies.execution);
  const snapshot = ConfigSnapshotRecordSchema.parse(dependencies.configSnapshot);
  const configSnapshotId = ConfigSnapshotIdSchema.parse(dependencies.configSnapshotId);
  const configFingerprint = FingerprintSchema.parse(dependencies.configFingerprint);
  if (snapshot.configSnapshotId !== configSnapshotId
    || snapshot.fingerprint !== configFingerprint) {
    throw new Error(`provider client ${capability} received an internally inconsistent config snapshot`);
  }
  const budget = providerBudget(snapshot.config, capability);

  return Object.freeze({
    capability,
    async call(payload: SchemaBoundCanonicalValue) {
      const admissionId = ProviderAdmissionIdSchema.parse(dependencies.idFactory.next());
      const request = ProviderRequestEnvelopeSchema.parse({ capability, payload });
      const fingerprint = requestFingerprint(request);
      const adapter = adapterFor(dependencies.adapters, capability);
      const now = dependencies.clock.now().toISOString();
      if (adapter === undefined) {
        const reason = ProviderUnavailableReasonSchema.parse({
          code: "adapter-unavailable",
          message: `${capability} has no configured adapter`,
        });
        dependencies.repository.deny(denialRequest({
          admissionId,
          execution,
          capability,
          configSnapshotId: snapshot.configSnapshotId,
          configFingerprint: snapshot.fingerprint,
          requestFingerprint: fingerprint,
          estimate: { maximumCostUsdMicros: 0 },
          reason,
          now,
        }));
        return unavailable(reason);
      }
      if (adapter.capability !== capability) {
        throw new Error(`provider adapter registry key ${capability} contains ${adapter.capability}`);
      }

      const estimate = ProviderCostEstimateSchema.parse(adapter.estimate(request));
      if (dependencies.runSignal.aborted) {
        const reason = ProviderUnavailableReasonSchema.parse({
          code: "aborted",
          message: `${capability} call was aborted before admission`,
        });
        dependencies.repository.deny(denialRequest({
          admissionId,
          execution,
          capability,
          configSnapshotId: snapshot.configSnapshotId,
          configFingerprint: snapshot.fingerprint,
          requestFingerprint: fingerprint,
          estimate,
          reason,
          now,
        }));
        return unavailable(reason);
      }

      const deadlineMonotonicMs = dependencies.clock.monotonicMs() + budget.timeoutMs;
      const deadlineAt = new Date(dependencies.clock.nowMs() + budget.timeoutMs).toISOString();
      const leaseExpiresAt = new Date(dependencies.clock.nowMs() + budget.timeoutMs + 30_000).toISOString();
      const reservation = dependencies.repository.reserve(ProviderAdmissionReserveRequestSchema.parse({
        admissionId,
        execution,
        capability,
        configSnapshotId: snapshot.configSnapshotId,
        configFingerprint: snapshot.fingerprint,
        requestFingerprint: fingerprint,
        estimate,
        leaseExpiresAt,
        deadlineAt,
        now,
      }));
      if (reservation.state === "existing") {
        throw new ProviderOutcomeUncertainError(
          admissionId,
          `the admission id was already ${reservation.admission.lifecycle.state}; refusing duplicate remote I/O`,
        );
      }
      if (reservation.state === "denied") {
        if (reservation.admission.lifecycle.state !== "denied") {
          throw new Error(`provider admission ${admissionId} denial has a non-denied lifecycle`);
        }
        return unavailable(reservation.admission.lifecycle.reason);
      }

      const controller = new AbortController();
      type InvocationRace =
        | Readonly<{ state: "completed"; value: unknown }>
        | Readonly<{ state: "threw"; error: unknown }>
        | Readonly<{ state: "interrupted"; code: "aborted" | "timeout" }>;
      let publishInterruption: ((outcome: InvocationRace) => void) | undefined;
      const interruptionPromise = new Promise<InvocationRace>((resolve) => {
        publishInterruption = resolve;
      });
      const interruptInvocation = (code: "aborted" | "timeout", reason: unknown) => {
        controller.abort(reason);
        const publish = publishInterruption;
        if (publish === undefined) throw new Error(`provider ${capability} interruption channel was not initialized`);
        publish({ state: "interrupted", code });
      };
      const onRunAbort = () => {
        interruptInvocation("aborted", dependencies.runSignal.reason);
      };
      dependencies.runSignal.addEventListener("abort", onRunAbort, { once: true });
      if (dependencies.runSignal.aborted) onRunAbort();
      const deadline = dependencies.deadlineScheduler.schedule(deadlineMonotonicMs, () => {
        interruptInvocation("timeout", new Error(`${capability} provider deadline elapsed`));
      });

      try {
        const invocation = Promise.resolve().then(() => adapter.invoke(request, {
          signal: controller.signal,
          deadlineMonotonicMs,
          admissionId,
        }));
        const invocationOutcome = invocation.then<InvocationRace, InvocationRace>(
          (value) => ({ state: "completed", value }),
          (error: unknown) => ({ state: "threw", error }),
        );
        const raced = await Promise.race([invocationOutcome, interruptionPromise]);
        if (raced.state === "interrupted" || raced.state === "threw") {
          const code = raced.state === "interrupted" ? raced.code : "adapter-error";
          const unavailableCode = code === "adapter-error" ? "adapter-unavailable" : code;
          const message = raced.state === "threw"
            ? errorMessage(raced.error)
            : `${capability} provider call ${raced.code}`;
          try {
            dependencies.repository.interrupt({
              admissionId,
              expectedVersion: reservation.admission.version,
              code,
              message,
              now: dependencies.clock.now().toISOString(),
            });
          } catch (settlementError) {
            throw new ProviderOutcomeUncertainError(
              admissionId,
              `durable interruption failed after adapter invocation: ${errorMessage(settlementError)}`,
              { cause: settlementError },
            );
          }
          return unavailable(ProviderUnavailableReasonSchema.parse({
            code: unavailableCode,
            message: `${capability} provider call ${unavailableCode}`,
          }));
        }
        const rawOutcome = raced.value;

        const parsedOutcome = ProviderAdapterOutcomeSchema.safeParse(rawOutcome);
        if (!parsedOutcome.success) {
          try {
            dependencies.repository.interrupt({
              admissionId,
              expectedVersion: reservation.admission.version,
              code: "invalid-outcome",
              message: `${capability} adapter returned an invalid strict outcome`,
              now: dependencies.clock.now().toISOString(),
            });
          } catch (settlementError) {
            throw new ProviderOutcomeUncertainError(
              admissionId,
              `durable invalid-outcome settlement failed: ${errorMessage(settlementError)}`,
              { cause: settlementError },
            );
          }
          return ProviderResponseEnvelopeSchema.parse({
            state: "invalid-response",
            reason: `${capability} adapter returned an invalid strict outcome`,
          });
        }
        const outcome = parsedOutcome.data;
        if (outcome.usage.costUsdMicros > estimate.maximumCostUsdMicros) {
          try {
            dependencies.repository.interrupt({
              admissionId,
              expectedVersion: reservation.admission.version,
              code: "cost-estimate-breach",
              message: `${capability} actual cost ${String(outcome.usage.costUsdMicros)} exceeds maximum estimate ${String(estimate.maximumCostUsdMicros)}`,
              evidence: outcome.evidence,
              now: dependencies.clock.now().toISOString(),
            });
          } catch (settlementError) {
            throw new ProviderOutcomeUncertainError(
              admissionId,
              `durable cost-breach settlement failed: ${errorMessage(settlementError)}`,
              { cause: settlementError },
            );
          }
          throw new Error(`provider adapter ${capability} breached its conservative maximum cost estimate`);
        }
        try {
          dependencies.repository.settle({
            admissionId,
            expectedVersion: reservation.admission.version,
            actualUsage: outcome.usage,
            adapterDisposition: outcome.response.state,
            evidence: outcome.evidence,
            now: dependencies.clock.now().toISOString(),
          });
        } catch (settlementError) {
          throw new ProviderOutcomeUncertainError(
            admissionId,
            `durable settlement failed after remote I/O: ${errorMessage(settlementError)}`,
            { cause: settlementError },
          );
        }
        return ProviderResponseEnvelopeSchema.parse(outcome.response);
      } finally {
        deadline.cancel();
        dependencies.runSignal.removeEventListener("abort", onRunAbort);
      }
    },
  });
}

export const ProviderDenialRunContextSchema = RunRequeueRequestSchema.omit({
  cause: true,
  notBefore: true,
});

export const ProviderDenialDispositionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("requeue"), request: RunRequeueRequestSchema }),
  z.strictObject({
    state: z.literal("stop"),
    code: z.enum(["aborted", "timeout", "adapter-unavailable"]),
  }),
]);

export function providerDenialDisposition(reasonInput: unknown, contextInput: unknown) {
  const reason = ProviderUnavailableReasonSchema.parse(reasonInput);
  if (reason.retryAt === undefined) {
    return ProviderDenialDispositionSchema.parse({ state: "stop", code: reason.code });
  }
  const context = ProviderDenialRunContextSchema.parse(contextInput);
  return ProviderDenialDispositionSchema.parse({
    state: "requeue",
    request: { ...context, cause: "provider-capacity", notBefore: reason.retryAt },
  });
}
