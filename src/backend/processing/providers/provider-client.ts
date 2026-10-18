import { z } from "zod";
import type { ProviderAdapter, ProviderClient } from "../../../workflow-kit/providers.js";
import type { ProviderCapabilityId } from "../../../rules/identity/ids.js";
import { ConfigSnapshotIdSchema, FingerprintSchema, ProviderCapabilityIdSchema } from "../../../rules/identity/ids.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { providerInvocationConfig } from "../../../models/config/schema.js";
import { ProviderAdapterOutcomeSchema, ProviderExecutionIdentitySchema, ProviderRequestEnvelopeSchema, ProviderResponseEnvelopeSchema } from "../../../models/providers/providers.js";
import type { Clock } from "../../../rules/time/clock.js";

export type ChatGptOcrAdapter = ProviderAdapter<"ocr.extract"> & Readonly<{
  policy: Readonly<{ kind: "chatgpt-subscription-only"; timeoutMs: number }>;
}>;
export type ProviderAdapterRegistry = Readonly<{ [C in Exclude<ProviderCapabilityId, "ocr.extract">]?: ProviderAdapter<C> } & { "ocr.extract"?: ChatGptOcrAdapter }>;
export interface ProviderRequestIdFactory { next(): string }
export interface ProviderClientDependencies {
  readonly execution: z.input<typeof ProviderExecutionIdentitySchema>;
  readonly configSnapshotId: unknown;
  readonly configFingerprint: unknown;
  readonly configSnapshot: unknown;
  readonly runSignal: AbortSignal;
  readonly adapters: ProviderAdapterRegistry;
  readonly clock: Clock;
  readonly idFactory: ProviderRequestIdFactory;
  readonly deadlineScheduler: { schedule(deadlineMonotonicMs: number, onDeadline: () => void): { cancel(): void } };
  readonly observe?: (event: Readonly<{ requestId: string; capability: ProviderCapabilityId; state: string }>) => void;
}

export function createProviderClient<C extends ProviderCapabilityId>(capabilityInput: C, deps: ProviderClientDependencies): ProviderClient<C> {
  const capability = ProviderCapabilityIdSchema.parse(capabilityInput);
  ProviderExecutionIdentitySchema.parse(deps.execution);
  const snapshot = ConfigSnapshotRecordSchema.parse(deps.configSnapshot);
  if (snapshot.configSnapshotId !== ConfigSnapshotIdSchema.parse(deps.configSnapshotId)
    || snapshot.fingerprint !== FingerprintSchema.parse(deps.configFingerprint)) {
    throw new Error(`provider client ${capability} received an internally inconsistent config snapshot`);
  }
  const ocrPolicy = deps.adapters["ocr.extract"]?.policy;
  if (capability === "ocr.extract" && deps.adapters["ocr.extract"] !== undefined) {
    const policy = z.strictObject({ kind: z.literal("chatgpt-subscription-only"), timeoutMs: z.number().int().positive().max(120_000) }).safeParse(ocrPolicy);
    if (!policy.success) throw new Error("OCR provider policy not connected");
  }
  const usedIds = new Set<string>();
  return Object.freeze({
    capability: capabilityInput,
    async call(payload: z.output<typeof ProviderRequestEnvelopeSchema>["payload"]) {
      const request = ProviderRequestEnvelopeSchema.parse({ capability, payload });
      const unavailable = (code: "aborted" | "timeout" | "adapter-unavailable", message: string) =>
        ProviderResponseEnvelopeSchema.parse({ state: "unavailable", reason: { code, message } });
      if (capability === "ocr.extract" && ocrPolicy === undefined) return unavailable("adapter-unavailable", "OCR provider not connected");
      const requestId = z.uuid().parse(deps.idFactory.next());
      if (usedIds.has(requestId)) throw new Error("provider-request-identity-reused");
      usedIds.add(requestId);
      const publish = (response: z.output<typeof ProviderResponseEnvelopeSchema>) => {
        deps.observe?.({ requestId, capability, state: response.state === "unavailable" ? response.reason.code : response.state });
        return response;
      };
      if (deps.runSignal.aborted) return publish(unavailable("aborted", "Provider call was cancelled before invocation."));
      const adapter = deps.adapters[capability];
      if (adapter === undefined) return publish(unavailable("adapter-unavailable", "Provider adapter is unavailable."));
      if (adapter.capability !== capability) throw new Error("provider-adapter-capability-mismatch");
      const deadlineMonotonicMs = deps.clock.monotonicMs() + (capability === "ocr.extract" ? z.number().int().positive().parse(ocrPolicy?.timeoutMs) : providerInvocationConfig(snapshot.config, capability).timeoutMs);
      const controller = new AbortController();
      let interrupt: (code: "aborted" | "timeout") => void = () => { throw new Error("provider-interruption-uninitialized"); };
      const interrupted = new Promise<z.output<typeof ProviderResponseEnvelopeSchema>>(resolve => {
        interrupt = code => { controller.abort(); resolve(unavailable(code, code === "timeout" ? "Provider deadline elapsed." : "Provider call was cancelled.")); };
      });
      const abort = () => interrupt("aborted");
      deps.runSignal.addEventListener("abort", abort, { once: true });
      const deadline = deps.deadlineScheduler.schedule(deadlineMonotonicMs, () => interrupt("timeout"));
      try {
        if (deps.runSignal.aborted) abort();
        const invocation = Promise.resolve().then(async () => {
          if (controller.signal.aborted) return unavailable(deps.runSignal.aborted ? "aborted" : "timeout", "Provider call ended before invocation.");
          try {
            const outcome = ProviderAdapterOutcomeSchema.safeParse(await adapter.invoke(request, { signal: controller.signal, deadlineMonotonicMs, requestId }));
            return outcome.success ? outcome.data.response : ProviderResponseEnvelopeSchema.parse({ state: "invalid-response", reason: "Provider adapter returned an invalid outcome." });
          } catch {
            return unavailable("adapter-unavailable", "Provider invocation failed; the request was not retried.");
          }
        });
        return publish(await Promise.race([invocation, interrupted]));
      } finally {
        deadline.cancel();
        deps.runSignal.removeEventListener("abort", abort);
      }
    },
  });
}
