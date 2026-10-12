/** The Duo ceremony lease — one ceremony at a time per CREDENTIAL, keyed on the credential's IDENTITY and never on a worker, a system, a profile, or the secret itself. */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkerIdSchema,
} from "../identity/ids.js";

export const DuoCeremonyLeaseHolderSchema = z.strictObject({
  workerId: WorkerIdSchema,
  system: BrowserSystemIdSchema,
});
export type DuoCeremonyLeaseHolder = z.infer<typeof DuoCeremonyLeaseHolderSchema>;

export const DuoCeremonyLeaseStateSchema = z.enum(["held", "released"]);

export const DuoCeremonyLeaseRecordSchema = z.strictObject({
  /** The credential identity digest (ref execution-and-sessions ). */
  credentialKey: FingerprintSchema,
  /** +1 per acquisition of this credential; never reset. */
  generation: PositiveIntSchema,
  holder: DuoCeremonyLeaseHolderSchema,
  state: DuoCeremonyLeaseStateSchema,
  acquiredAt: IsoInstantSchema,
  /** `acquiredAt + ttl`; a `held` row at or past this instant is takeable at the next generation. */
  expiresAt: IsoInstantSchema,
  releasedAt: IsoInstantSchema.optional(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.state === "released" && record.releasedAt === undefined) {
    context.addIssue({ code: "custom", message: "a released Duo ceremony lease records releasedAt" });
  }
  if (record.state === "held" && record.releasedAt !== undefined) {
    context.addIssue({ code: "custom", message: "a held Duo ceremony lease carries no releasedAt" });
  }
});
export type DuoCeremonyLeaseRecord = z.infer<typeof DuoCeremonyLeaseRecordSchema>;

export const DuoCeremonyLeaseAcquireRequestSchema = z.strictObject({
  credentialKey: FingerprintSchema,
  workerId: WorkerIdSchema,
  system: BrowserSystemIdSchema,
  now: IsoInstantSchema,
  /** `timeouts.sessionAcquireMs + timeouts.duoCeremonyLeaseGraceMs` (§10.3). */
  ttlMs: PositiveIntSchema,
});
export type DuoCeremonyLeaseAcquireRequest = z.infer<typeof DuoCeremonyLeaseAcquireRequestSchema>;

/** Who an expired lease was taken from, recorded on the takeover outcome. */
export const DuoCeremonyLeaseTakeoverSchema = z.strictObject({
  generation: PositiveIntSchema,
  holder: DuoCeremonyLeaseHolderSchema,
});

export const DuoCeremonyLeaseReleaseOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("released"), lease: DuoCeremonyLeaseRecordSchema }),
  /** The row moved on to a later generation while this holder was inside its ceremony. */
  z.strictObject({ state: z.literal("superseded"), current: DuoCeremonyLeaseRecordSchema }),
]);
export type DuoCeremonyLeaseReleaseOutcome = z.infer<typeof DuoCeremonyLeaseReleaseOutcomeSchema>;

/** A lease is live while it is `held` and `now` is strictly before `expiresAt`. */
export function isDuoCeremonyLeaseLive(lease: DuoCeremonyLeaseRecord, nowMs: number): boolean {
  return lease.state === "held" && nowMs < Date.parse(lease.expiresAt);
}
