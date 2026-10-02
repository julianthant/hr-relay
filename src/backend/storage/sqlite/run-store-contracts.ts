/**
 * The run/claim store's request and outcome shapes (ref execution-and-sessions §3, ref workflow-model §4).
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
  DiagnosticBundleIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  StartPlanIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../../../domain/ids.js";
import { StartPlanRecordSchema } from "../../../domain/run/start-plan.js";
import {
  WorkerControlSchema,
  WorkerBrowserSystemsSchema,
  WorkerLeaseRecordSchema,
  WorkerLifecycleSchema,
} from "../../../domain/run/worker.js";
import { WorkerPoolRecordSchema } from "../../../domain/run/worker-pool.js";
import { RunDisplayNameSchema, VersionArchiveCommandRequestSchema } from "../../../domain/commands.js";
import { CheckpointPatchSchema } from "../../../domain/workflow/checkpoint.js";
import { RuntimeConfigClaimTokenSchema } from "../../../domain/config/runtime-generation.js";
import { RunEnvelopeSchema } from "../../../domain/run/envelope.js";
import {
  RequeueCauseSchema,
  RunLifecycleSchema,
  RunInputStorageSchema,
  RunRecordSchema,
  RunStateSchema,
} from "../../../domain/run/record.js";
import { ArchivedRunRecordSchema } from "../../../domain/archive/model.js";
import { RunExistenceSchema, RunRecordRefusalSchema } from "../../../domain/authority.js";
import { DeletedRunRecordSchema } from "../../../domain/run/deleted-run.js";
import {
  FailureTerminalizationRequestSchema,
  SuccessTerminalizationReplayInputSchema,
} from "./run-terminal-contracts.js";

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
  /** Production workers bind the claim to the config they resolved at boot. */
  configFingerprint: FingerprintSchema.optional(),
  /** Dashboard-activated generation observed by this worker at boot. */
  runtimeConfig: RuntimeConfigClaimTokenSchema.optional(),
}).superRefine((request, context) => {
  const hasFingerprint = request.configFingerprint !== undefined;
  const hasRuntimeConfig = request.runtimeConfig !== undefined;
  if (hasFingerprint !== hasRuntimeConfig) {
    context.addIssue({
      code: "custom",
      path: [hasFingerprint ? "runtimeConfig" : "configFingerprint"],
      message: "production claims bind both boot config fingerprint and active runtime generation",
    });
  }
  if (request.configFingerprint !== undefined
    && request.runtimeConfig !== undefined
    && request.configFingerprint !== request.runtimeConfig.configFingerprint) {
    context.addIssue({
      code: "custom",
      path: ["runtimeConfig", "configFingerprint"],
      message: "runtime generation config fingerprint must equal the worker boot fingerprint",
    });
  }
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
 * Ref data-intake-and-edit-data §6.4 (D166): the Edit-Data save. The version CAS is the whole race
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

/**
 * D234 retired `hidden`, so the display name is the whole of presentation and
 * is REQUIRED — the pair used to be two optional fields with a refinement
 * forbidding the empty update, and an optional lone field would re-admit
 * exactly that no-op.
 */
export const RunPresentationRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  displayName: RunDisplayNameSchema,
  now: IsoInstantSchema,
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
 * D118 (ref execution-and-sessions §3): an expired claim is NOT ordinary requeue authority. The
 * sweeper checks the authoritative write-intent set for the run's logical
 * item first; any unfinished `attempting` intent routes the run to ref write-safety
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

/* ── canonical D330 run-record service boundary ─────────────────────────── */

export const CanonicalCreateRunRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  code: z.string().min(1),
  matchKey: z.string(),
  workflow: WorkflowIdSchema,
  descriptorVersion: RunEnvelopeSchema.shape.descriptorVersion,
  contractFingerprint: RunEnvelopeSchema.shape.contractFingerprint,
  operationDisplayCapability: RunEnvelopeSchema.shape.operationDisplayCapability,
  operationDisplaySnapshot: RunEnvelopeSchema.shape.operationDisplaySnapshot,
  configFingerprint: RunEnvelopeSchema.shape.configFingerprint,
  configSnapshotId: RunEnvelopeSchema.shape.configSnapshotId,
  resolvedInstance: RunEnvelopeSchema.shape.resolvedInstance,
  requestedInstance: RunEnvelopeSchema.shape.requestedInstance,
  priority: RunEnvelopeSchema.shape.priority,
  shape: RunEnvelopeSchema.shape.shape,
  dryRun: RunEnvelopeSchema.shape.dryRun,
  browserMode: RunEnvelopeSchema.shape.browserMode,
  captureBrowserScreenshots: RunEnvelopeSchema.shape.captureBrowserScreenshots,
  stepOmissions: RunEnvelopeSchema.shape.stepOmissions,
  parent: RunEnvelopeSchema.shape.parent,
  retryOf: RunEnvelopeSchema.shape.retryOf,
  recovery: RunEnvelopeSchema.shape.recovery,
  sourceBound: RunEnvelopeSchema.shape.sourceBound,
  input: RunInputStorageSchema,
  sessionId: RunRecordSchema.shape.sessionId,
  appVersion: RunRecordSchema.shape.appVersion,
  runtimeConfig: RuntimeConfigClaimTokenSchema,
});

export const CanonicalListRunsRequestSchema = z.strictObject({
  workflow: WorkflowIdSchema.optional(),
  disposition: z.enum(["live", "archived"]),
  limit: PositiveIntSchema.max(1000),
  cursor: z.strictObject({
    generation: NonNegativeIntSchema,
    offset: NonNegativeIntSchema,
    workflow: WorkflowIdSchema.optional(),
    disposition: z.enum(["live", "archived"]),
  }).optional(),
});

export const CanonicalClaimNextRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  workflow: WorkflowIdSchema,
  workerId: WorkerIdSchema,
  runtimeConfig: RuntimeConfigClaimTokenSchema,
});

const CanonicalVersionIdentityFields = {
  commandId: CommandIdSchema,
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
} as const;

export const CanonicalWriteResolutionTransitionRequestSchema = z.strictObject({
  ...CanonicalVersionIdentityFields,
  lifecycle: z.strictObject({ state: z.literal("queued") }),
  writeResolution: z.enum(["resolve-write-present", "resolve-write-absent"]),
  evidenceFingerprint: FingerprintSchema.optional(),
  startAt: NodeIdSchema,
});

export const CanonicalTransitionRequestSchema = z.union([
  CanonicalWriteResolutionTransitionRequestSchema,
  z.strictObject({ ...CanonicalVersionIdentityFields, lifecycle: RunLifecycleSchema }),
  z.strictObject({ ...CanonicalVersionIdentityFields, displayName: RunDisplayNameSchema }),
  z.strictObject({ ...CanonicalVersionIdentityFields, priority: z.literal("interactive") }),
]);

export const CanonicalRenewClaimRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  runId: RunIdSchema,
  claim: RunClaimTokenSchema,
});

export const CanonicalWorkerTransitionRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  expectedVersion: PositiveIntSchema.optional(),
  evidenceFingerprint: FingerprintSchema.optional(),
  runId: RunIdSchema,
  claim: RunClaimTokenSchema,
  lifecycle: RunLifecycleSchema,
});

export const CanonicalFailureTerminalizeRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  terminal: FailureTerminalizationRequestSchema,
});

export const CanonicalSuccessTerminalizeRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  terminal: SuccessTerminalizationReplayInputSchema,
});

export const CanonicalCancellationTerminalizeRequestSchema = z.strictObject({
  kind: z.literal("cancelled"),
  commandId: CommandIdSchema,
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  claim: RunClaimTokenSchema,
  endedAt: IsoInstantSchema,
});

export const CanonicalTerminalizeRequestSchema = z.discriminatedUnion("kind", [
  CanonicalCancellationTerminalizeRequestSchema,
  z.strictObject({
    kind: z.literal("failure"),
    commandId: CommandIdSchema,
    terminal: FailureTerminalizationRequestSchema,
  }),
  z.strictObject({
    kind: z.literal("success"),
    commandId: CommandIdSchema,
    terminal: SuccessTerminalizationReplayInputSchema,
  }),
]);

export const CanonicalRequeueRequestSchema = z.strictObject({
  ...CanonicalVersionIdentityFields,
  claim: RunClaimTokenSchema.optional(),
  cause: RequeueCauseSchema,
  notBefore: IsoInstantSchema.optional(),
  staleBefore: IsoInstantSchema.optional(),
});

export const CanonicalRetrySourceRequestSchema = z.strictObject({
  ...CanonicalVersionIdentityFields,
  runtimeConfig: RuntimeConfigClaimTokenSchema,
  appVersion: RunRecordSchema.shape.appVersion,
});

export const CanonicalRelaunchCreateRequestSchema = CanonicalCreateRunRequestSchema.omit({
  commandId: true,
  parent: true,
  retryOf: true,
});

export const CanonicalRelaunchRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  archivedRunId: RunIdSchema,
  archiveFingerprint: FingerprintSchema,
  relaunchedBy: ActorIdSchema,
  create: CanonicalRelaunchCreateRequestSchema,
});

export const CanonicalArchiveRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  expectedVersion: PositiveIntSchema,
  archive: ArchivedRunRecordSchema,
});

export const CanonicalDeleteRequestSchema = z.strictObject(CanonicalVersionIdentityFields);

export const CanonicalDeleteArchivedRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  runId: RunIdSchema,
  archiveFingerprint: FingerprintSchema.optional(),
  operatorRequest: VersionArchiveCommandRequestSchema.optional(),
}).refine(request => request.archiveFingerprint !== undefined || request.operatorRequest !== undefined, "archive-delete-reference-required")
.refine(request => request.operatorRequest === undefined || (request.operatorRequest.type === "delete-archived-run"
  && request.operatorRequest.target.archivedRunId === request.runId), "archive-operator-request-binding-mismatch");

export const CanonicalPurgeRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  evidenceClass: z.literal("diagnostic-bundle"),
  bundleId: DiagnosticBundleIdSchema,
});

export const CanonicalRunMutationOutcomeSchema = z.union([
  z.strictObject({ state: z.literal("applied"), run: RunRecordSchema }),
  z.strictObject({ state: z.literal("applied-already"), run: RunRecordSchema }),
  z.strictObject({
    state: z.literal("applied-already"),
    tombstone: DeletedRunRecordSchema,
    appliedVersion: PositiveIntSchema,
  }),
  z.strictObject({ state: z.literal("refused"), refusal: RunRecordRefusalSchema }),
]);

export const CanonicalRunListOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("listed"),
    rows: z.array(RunRecordSchema),
    cursor: CanonicalListRunsRequestSchema.shape.cursor.unwrap().optional(),
  }),
  z.strictObject({
    state: z.literal("refused"),
    refusal: z.strictObject({ reason: z.literal("cursor-stale") }),
  }),
]);

export const CanonicalRunDeletionOutcomeSchema = z.union([
  z.strictObject({
    state: z.enum(["deleted", "applied-already"]),
    tombstones: z.array(DeletedRunRecordSchema),
  }),
  z.strictObject({ state: z.literal("refused"), refusal: RunRecordRefusalSchema }),
  RunExistenceSchema,
]);

export const CanonicalRunPurgeOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.enum(["purged", "applied-already"]),
    evidenceClass: z.literal("diagnostic-bundle"),
    purged: NonNegativeIntSchema,
  }),
  z.strictObject({ state: z.literal("refused"), refusal: RunRecordRefusalSchema }),
]);

export const RunItemQuerySchema = z.strictObject({
  workflow: WorkflowIdSchema,
  itemId: ItemIdSchema,
});

/* ── start plans (ref frontend-backend-integration §5.1) ───────────────────────────────────────────── */

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

/* ── worker leases (ref execution-and-sessions §3) ───────────────────────────────────────────── */

export const WorkerStartRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  workflow: WorkflowIdSchema,
  browserSystems: WorkerBrowserSystemsSchema,
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
  commandId: z.uuid().optional(),
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

/* ── worker pools (ref execution-and-sessions §11.5, D269) ───────────────── */

/**
 * `expectedVersion` is the POOL's version — the row's, or **0 when no row
 * exists yet** (`workerPoolVersion`). Zero is a legitimate basis rather than a
 * placeholder: the first plan creates the row at version 1, and a caller that
 * cites 0 against an existing row is told the current version by name.
 */
export const WorkerPoolPlanRequestSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  expectedVersion: NonNegativeIntSchema,
  desiredWorkers: PositiveIntSchema,
  requestedBy: ActorIdSchema,
  now: IsoInstantSchema,
});
export type WorkerPoolPlanRequest = z.infer<typeof WorkerPoolPlanRequestSchema>;

export const WorkerPoolPlanOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("applied"), pool: WorkerPoolRecordSchema }),
  z.strictObject({
    state: z.literal("conflict"),
    /** 0 when the workflow has no pool row — the basis the caller should have cited. */
    currentVersion: NonNegativeIntSchema,
    message: z.string().min(1),
  }),
]);
export type WorkerPoolPlanOutcome = z.infer<typeof WorkerPoolPlanOutcomeSchema>;

export type RunClaimRequest = z.infer<typeof RunClaimRequestSchema>;
export type RunHeartbeatRequest = z.infer<typeof RunHeartbeatRequestSchema>;
export type RunTransitionRequest = z.infer<typeof RunTransitionRequestSchema>;
export type RunRequeueRequest = z.infer<typeof RunRequeueRequestSchema>;
export type RunResumeRequest = z.infer<typeof RunResumeRequestSchema>;
export type RunPresentationRequest = z.infer<typeof RunPresentationRequestSchema>;
export type RunClaimSweepRequest = z.infer<typeof RunClaimSweepRequestSchema>;
