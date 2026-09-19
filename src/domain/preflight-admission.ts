import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { Clock } from "./clock.js";
import { ConfigSnapshotIdSchema, FingerprintSchema } from "./ids.js";
import { PreflightReportWireSchema, RuntimeCapabilitySchema } from "./preflight-contract.js";
import { createPreflightAuthority, type PreflightDeadlineScheduler, type PreflightRunner } from "./preflight.js";

export const PreflightAdmissionScopeSchema = z.strictObject({
  configSnapshotId: ConfigSnapshotIdSchema,
  configFingerprint: FingerprintSchema,
  descriptorFingerprint: FingerprintSchema,
  requestedCapabilities: z.array(RuntimeCapabilitySchema).min(1),
});
export type PreflightAdmissionScope = z.infer<typeof PreflightAdmissionScopeSchema>;
export type PreflightReport = z.infer<typeof PreflightReportWireSchema>;
export class PreflightAdmissionRefusal extends Error {
  constructor(readonly reason: "unavailable" | "stale" | "blocked" | "scope-mismatch", message: string, options?: ErrorOptions) {
    super(message, options); this.name = "PreflightAdmissionRefusal";
  }
}
export interface PreflightAdmission {
  prepare(scope: PreflightAdmissionScope, signal: AbortSignal): Promise<PreflightReport>;
  assertReady(scope: PreflightAdmissionScope): void;
  read(scope: PreflightAdmissionScope): PreflightReport;
}

/** Detector settlement happens outside transactions. Admission reads only exact, recent evidence. */
export function createPreflightAdmission(input: Readonly<{
  clock: Clock;
  scheduler: PreflightDeadlineScheduler;
  runners(scope: PreflightAdmissionScope): readonly PreflightRunner[];
  validate(scope: PreflightAdmissionScope): void;
  observationIdentity?(scope: PreflightAdmissionScope): string;
  freshnessMs?: number;
}>): PreflightAdmission {
  const freshnessMs = z.number().positive().parse(input.freshnessMs ?? 60_000);
  const entries = new Map<string, { report?: PreflightReport; completedAt?: number; observationIdentity?: string; pending: number; authority: ReturnType<typeof createPreflightAuthority> }>();
  const key = (scope: PreflightAdmissionScope): string => canonicalJsonStringify(PreflightAdmissionScopeSchema.parse(scope));
  const read = (scope: PreflightAdmissionScope): PreflightReport => {
    input.validate(scope);
    const entry = entries.get(key(scope));
    if (entry === undefined || entry.pending > 0 || entry.report === undefined || entry.completedAt === undefined) {
      throw new PreflightAdmissionRefusal("unavailable", "Preflight evidence is unavailable for this exact scope; re-check readiness.");
    }
    if (entry.observationIdentity !== input.observationIdentity?.(scope)) throw new PreflightAdmissionRefusal("stale", "Protected settings changed; re-check readiness.");
    const age = input.clock.monotonicMs() - entry.completedAt;
    if (age < 0 || age >= freshnessMs) throw new PreflightAdmissionRefusal("stale", "Preflight evidence expired; re-check readiness.");
    return PreflightReportWireSchema.parse(entry.report);
  };
  return Object.freeze({
    async prepare(scope: PreflightAdmissionScope, signal: AbortSignal): Promise<PreflightReport> {
      input.validate(scope);
      const scopeKey = key(scope);
      let entry = entries.get(scopeKey);
      if (entry === undefined) {
        if (entries.size >= 256) throw new PreflightAdmissionRefusal("unavailable", "Preflight scope capacity reached; restart the runtime.");
        entry = { pending: 0, authority: createPreflightAuthority({ ...scope, runners: input.runners(scope), clock: input.clock, scheduler: input.scheduler }) };
        entries.set(scopeKey, entry);
      }
      const observationIdentity = input.observationIdentity?.(scope);
      entry.pending += 1;
      delete entry.report; delete entry.completedAt;
      try {
        const report = await entry.authority.refresh(signal);
        input.validate(scope);
        if (input.observationIdentity?.(scope) !== observationIdentity) throw new PreflightAdmissionRefusal("stale", "Protected settings changed during preflight; re-check readiness.");
        entry.observationIdentity = observationIdentity;
        entry.report = report;
        entry.completedAt = input.clock.monotonicMs();
        return PreflightReportWireSchema.parse(report);
      } catch (error) {
        delete entry.report; delete entry.completedAt;
        if (error instanceof PreflightAdmissionRefusal) throw error;
        throw new PreflightAdmissionRefusal("unavailable", "Preflight detectors could not verify readiness.", { cause: error });
      } finally { entry.pending -= 1; }
    },
    read,
    assertReady(scope: PreflightAdmissionScope): void {
      const report = read(scope);
      const blocked = report.results.filter(result => result.status === "fail");
      if (blocked.length > 0) throw new PreflightAdmissionRefusal("blocked", `Preflight blocks this scope: ${blocked.map(result => result.check).join(", ")}.`);
    },
  });
}
