/**
 * The run/claim store's request and outcome shapes (doc 05 §3, doc 02 §4).
 *
 * Every outcome is a discriminated union rather than a nullable record. A
 * worker that asked for work and got `undefined` would be one `??` away from
 * treating "someone else owns this run" as "no work to do"; here it must branch
 * on `claimed | idle | deferred`, and a lost claim says so by name.
 */
import { z } from "zod";
import {
  ActorIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  StartPlanIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../../domain/ids.js";
import { StartPlanRecordSchema } from "../../domain/run/start-plan.js";
import {
  WorkerControlSchema,
  WorkerLeaseRecordSchema,
  WorkerLifecycleSchema,
} from "../../domain/run/worker.js";
import { RunDisplayNameSchema } from "../../domain/commands.js";
import { CheckpointPatchSchema } from "../../domain/workflow/checkpoint.js";
import {
  RequeueCauseSchema,
  RunLifecycleSchema,
  RunRecordSchema,
  RunStateSchema,
} from "../../domain/run/record.js";

/** Proof that the caller still owns the row it is about to change. */
export const RunClaimTokenSchema = z.strictObject({
  workerId: WorkerIdSchema,
  claimGeneration: PositiveIntSchema,
});
export type RunClaimToken = z.infer<typeof RunClaimTokenSchema>;

export const RunClaimRequestSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  workerId: WorkerIdSchema,
  now: IsoInstantSchema,
});

export const RunClaimOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("claimed"), run: RunRecordSchema }),
  z.strictObject({ state: z.literal("idle") }),
  /**
   * Eligible rows exist but every one is held back by `not_before`. The worker
   * sleeps exactly this long instead of busy-polling a queue it cannot serve.
   */
  z.strictObject({ state: z.literal("deferred"), nextEligibleAt: IsoInstantSchema }),
]);
export type RunClaimOutcome = z.infer<typeof RunClaimOutcomeSchema>;

export const RunHeartbeatRequestSchema = z.strictObject({
  runId: RunIdSchema,
  claim: RunClaimTokenSchema,
  now: IsoInstantSchema,
});

export const RunHeartbeatOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("renewed"), run: RunRecordSchema }),
  /** The claim is gone — recovered, reassigned, or terminalized by someone else. */
  z.strictObject({ state: z.literal("lost"), message: z.string().min(1) }),
]);
export type RunHeartbeatOutcome = z.infer<typeof RunHeartbeatOutcomeSchema>;

export const RunTransitionRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  /** Required for any transition a claim-holding worker drives. */
  claim: RunClaimTokenSchema.optional(),
  lifecycle: RunLifecycleSchema,
  now: IsoInstantSchema,
});

export const RunRequeueRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  claim: RunClaimTokenSchema.optional(),
  cause: RequeueCauseSchema,
  /** Retry backoff; the row stays unclaimable until this instant. */
  notBefore: IsoInstantSchema.optional(),
  now: IsoInstantSchema,
});

/**
 * A gate or write resolution putting a parked row back in the queue. `startAt`
 * is mandatory: a resume that did not say where to resume would silently
 * re-enter the graph at the top and re-run work the run already completed.
 */
export const RunResumeRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  startAt: NodeIdSchema,
  now: IsoInstantSchema,
});

/**
 * D95: `bump` is permanently run priority/claim order. It elevates one queued
 * row to the interactive claim class; it is not a requeue and it never touches
 * business input, attempt, or descriptor identity.
 */
export const RunPriorityBumpRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  now: IsoInstantSchema,
});

/**
 * Doc 06 §6.4 (D166): the Edit-Data save. The version CAS is the whole race
 * protocol — a resume claim bumps the row version, so a save loaded at
 * generation G cannot land on a run that has moved. Patches merge by
 * (nodeId, fieldPath), later wins; they become authority only when a resume
 * re-parses the patched output through the producing contract's schema.
 */
export const RunInjectPatchesRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  patches: z.array(CheckpointPatchSchema).min(1),
  now: IsoInstantSchema,
});

export const RunPresentationRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  displayName: RunDisplayNameSchema.optional(),
  hidden: z.boolean().optional(),
  now: IsoInstantSchema,
}).superRefine((request, context) => {
  if (request.displayName === undefined && request.hidden === undefined) {
    context.addIssue({ code: "custom", message: "a presentation update must change the display name or the hidden flag" });
  }
});

export const RunUpdateOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("applied"), run: RunRecordSchema }),
  z.strictObject({
    state: z.literal("conflict"),
    currentVersion: PositiveIntSchema,
    currentState: RunStateSchema,
    message: z.string().min(1),
  }),
]);
export type RunUpdateOutcome = z.infer<typeof RunUpdateOutcomeSchema>;

/**
 * A sweep names EXACTLY ONE proof that the claims it releases are dead, and
 * D200 is why there are two of them.
 *
 * - `staleBefore` — the heartbeat expired. The periodic sweep's evidence: it
 *   knows nothing about who owns a row, only that nobody has renewed it.
 * - `workerId` — the CALLER holds that worker id's lease, so every row still
 *   under that id belongs to a process that is gone, whatever its heartbeat
 *   says. Strictly stronger evidence, and available only about ONESELF.
 *
 * They are mutually exclusive on purpose. Merging them would mean either a
 * `staleBefore` the scoped scan quietly ignores (a lying field) or a startup
 * sweep that has to widen `staleBefore` globally to reach its own fresh row —
 * which would release every live sibling worker's claim at the same instant.
 */
export const RunClaimSweepRequestSchema = z.strictObject({
  /** All workflows when absent — recovery is not workflow-scoped by nature. */
  workflow: WorkflowIdSchema.optional(),
  /** D200: the startup self-sweep's scope. See the note above. */
  workerId: WorkerIdSchema.optional(),
  /** A claim whose heartbeat predates this instant is treated as dead. */
  staleBefore: IsoInstantSchema.optional(),
  now: IsoInstantSchema,
}).superRefine((request, context) => {
  if ((request.staleBefore === undefined) === (request.workerId === undefined)) {
    context.addIssue({
      code: "custom",
      message: "a claim sweep names exactly one proof that the claim is dead: `staleBefore` (the "
        + "heartbeat expired) or `workerId` (the caller holds that id's lease, so every row still "
        + "under it is orphaned)",
    });
  }
});

/**
 * D118 (doc 05 §3): an expired claim is NOT ordinary requeue authority. The
 * sweeper checks the authoritative write-intent set for the run's logical
 * item first; any unfinished `attempting` intent routes the run to doc 09
 * recovery — parked loudly when the row was `running`, and left unclaimable
 * under its expired claim otherwise — and NEVER back to `queued`. Only the
 * write sequencer's typed recovery resolutions may release it.
 */
export const RunClaimSweepOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("requeued"), run: RunRecordSchema }),
  z.strictObject({
    state: z.literal("recovery-required"),
    run: RunRecordSchema,
    writeIntentId: WriteIntentIdSchema,
    intentGeneration: PositiveIntSchema,
    /** `true` when the row transitioned to `parked-write`; `false` when it was
     * left under its expired claim (a claimed/validating row has no legal
     * parked-write edge — it stays unclaimable until recovery resolves). */
    parked: z.boolean(),
    message: z.string().min(1),
  }),
]);
export type RunClaimSweepOutcome = z.infer<typeof RunClaimSweepOutcomeSchema>;

export const RunItemQuerySchema = z.strictObject({
  workflow: WorkflowIdSchema,
  itemId: ItemIdSchema,
});

/* ── start plans (doc 13 §5.1) ───────────────────────────────────────────── */

export const StartPlanConsumeRequestSchema = z.strictObject({
  startPlanId: StartPlanIdSchema,
  /**
   * The plan revision the confirmation surface rendered. A successful consume
   * increments storage to retain that pre-consume revision for idempotent replay.
   */
  expectedVersion: PositiveIntSchema,
  commandId: CommandIdSchema,
  /** Re-checked against the stored plan; a changed descriptor/config/input refuses. */
  descriptorFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  ingressSchemaHash: FingerprintSchema,
  canonicalInputSchemaHash: FingerprintSchema,
  inputFingerprint: FingerprintSchema,
  now: IsoInstantSchema,
});

export const StartPlanConsumeOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("consumed"), plan: StartPlanRecordSchema }),
  /** The same command consuming the same plan again — idempotent, not a second start. */
  z.strictObject({ state: z.literal("already-consumed"), plan: StartPlanRecordSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: z.enum(["expired", "fingerprint-mismatch", "spent", "version-mismatch"]),
    message: z.string().min(1),
  }),
]);
export type StartPlanConsumeOutcome = z.infer<typeof StartPlanConsumeOutcomeSchema>;

/* ── worker leases (doc 05 §3) ───────────────────────────────────────────── */

export const WorkerStartRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  workflow: WorkflowIdSchema,
  processId: PositiveIntSchema,
  requestedBy: ActorIdSchema,
  now: IsoInstantSchema,
});

export const WorkerStartOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("started"), lease: WorkerLeaseRecordSchema }),
  /**
   * A live lease already holds this id. Two processes answering to one worker id
   * would both claim rows and both renew the same heartbeat, so the second one
   * is refused rather than allowed to shadow the first.
   */
  z.strictObject({ state: z.literal("conflict"), lease: WorkerLeaseRecordSchema, message: z.string().min(1) }),
]);
export type WorkerStartOutcome = z.infer<typeof WorkerStartOutcomeSchema>;

export const WorkerLifecycleRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  leaseGeneration: PositiveIntSchema,
  lifecycle: WorkerLifecycleSchema,
  now: IsoInstantSchema,
});

export const WorkerControlRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  expectedVersion: PositiveIntSchema,
  control: WorkerControlSchema,
  now: IsoInstantSchema,
});

export const WorkerUpdateOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("applied"), lease: WorkerLeaseRecordSchema }),
  z.strictObject({
    state: z.literal("conflict"),
    currentVersion: PositiveIntSchema,
    message: z.string().min(1),
  }),
]);
export type WorkerUpdateOutcome = z.infer<typeof WorkerUpdateOutcomeSchema>;

export const WorkerSweepRequestSchema = z.strictObject({
  staleBefore: IsoInstantSchema,
  now: IsoInstantSchema,
});

export type RunClaimRequest = z.infer<typeof RunClaimRequestSchema>;
export type RunHeartbeatRequest = z.infer<typeof RunHeartbeatRequestSchema>;
export type RunTransitionRequest = z.infer<typeof RunTransitionRequestSchema>;
export type RunRequeueRequest = z.infer<typeof RunRequeueRequestSchema>;
export type RunResumeRequest = z.infer<typeof RunResumeRequestSchema>;
export type RunPresentationRequest = z.infer<typeof RunPresentationRequestSchema>;
export type RunClaimSweepRequest = z.infer<typeof RunClaimSweepRequestSchema>;
