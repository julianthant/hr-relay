import { ProfileDatabaseBindingSchema } from "../../../models/profiles/profile.js";







import { WorkerLifecycleBindingSchema } from "../../../models/run/worker-control.js";

import { ParkedWriteResolutionBindingSchema } from "../../../rules/write-safety/write-safety.js";

import { z } from "zod";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
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
  WriteAttemptIdSchema,
} from "../../../rules/identity/ids.js";
import { StartPlanRecordSchema } from "../../../models/run/start-plan.js";
import {
  WorkerControlSchema,
  WorkerClaimLifetimeSchema,
  WorkerBrowserSystemsSchema,
  WorkerLeaseRecordSchema,
  WorkerLifecycleSchema,
} from "../../../models/run/worker.js";
import { WorkerPoolRecordSchema } from "../../../models/run/worker-pool.js";
import { RunDisplayNameSchema } from "../../../rules/commands/commands.js";
import { CheckpointPatchSchema } from "../../../models/workflow/checkpoint.js";
import { RuntimeConfigClaimTokenSchema } from "../../../models/config/runtime-generation.js";
import { RunEnvelopeSchema } from "../../../models/run/envelope.js";
import {
  RequeueCauseSchema,
  RunLifecycleSchema,
  RunInputStorageSchema,
  RunRecordSchema,
  RunStateSchema,
} from "../../../models/run/record.js";
import { RunExistenceSchema, RunRecordRefusalSchema } from "../../../models/config/authority.js";
import { DeletedRunRecordSchema } from "../../../models/run/deleted-run.js";
import {
  FailureTerminalizationRequestSchema,
  SuccessTerminalizationRequestSchema,
} from "./run-terminal-contracts.js";

/** Proof that the caller still owns the row it is about to change. */
export const RunClaimTokenSchema = z.strictObject({
  workerId: WorkerIdSchema,
  claimGeneration: PositiveIntSchema,
});
export type RunClaimToken = z.infer<typeof RunClaimTokenSchema>;

export { WorkerClaimLifetimeSchema } from "../../../models/run/worker.js";

export const RunClaimRequestSchema = z.strictObject({
  workerLifetime: WorkerClaimLifetimeSchema.optional(),
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


export const RunResumeRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  startAt: NodeIdSchema,
  now: IsoInstantSchema,
});


export const RunPriorityBumpRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  now: IsoInstantSchema,
});


export const RunInjectPatchesRequestSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  patches: z.array(CheckpointPatchSchema).min(1),
  now: IsoInstantSchema,
});

// Presentation requires a display name; it changes no execution authority.
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
  disposition: z.literal("live"),
  limit: PositiveIntSchema.max(1000),
  cursor: z.strictObject({
    generation: NonNegativeIntSchema,
    offset: NonNegativeIntSchema,
    workflow: WorkflowIdSchema.optional(),
    disposition: z.literal("live"),
  }).optional(),
});

export const CanonicalClaimNextRequestSchema = z.strictObject({
  workerLifetime: WorkerClaimLifetimeSchema.optional(),
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
  writeResolution: z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("operator"),binding:ParkedWriteResolutionBindingSchema}),
    z.strictObject({ kind: z.literal("recheck"), commandId: CommandIdSchema,
      writeIntentId: WriteIntentIdSchema, generation: PositiveIntSchema,
      writeAttemptId: WriteAttemptIdSchema, bindingProofDigest: FingerprintSchema }),
    z.strictObject({kind:z.literal("recovery"),writeIntentId:WriteIntentIdSchema,generation:PositiveIntSchema,
      writeAttemptId:WriteAttemptIdSchema,bindingProofDigest:FingerprintSchema,decision:z.enum(["present","absent"])}),
  ]),
  evidenceFingerprint: FingerprintSchema.optional(),
  startAt: NodeIdSchema,
});

export const CancellationSourceSchema = z.union([
  z.strictObject({ commandId: CommandIdSchema, rootRunId: RunIdSchema }),
  z.strictObject({ kind: z.literal("worker-reset"), commandId: CommandIdSchema, rootRunId: RunIdSchema }),
]);

export const CanonicalTransitionRequestSchema = z.union([
  CanonicalWriteResolutionTransitionRequestSchema,
  z.strictObject({ ...CanonicalVersionIdentityFields, lifecycle: RunLifecycleSchema,
    cancellationSource: CancellationSourceSchema.optional() }),
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
  terminal: SuccessTerminalizationRequestSchema,
});

export const CanonicalCancellationTerminalizeRequestSchema = z.strictObject({
  cancellationSource: CancellationSourceSchema.optional(),
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
    terminal: SuccessTerminalizationRequestSchema,
  }),
]);

export const CanonicalRequeueRequestSchema = z.strictObject({
  ...CanonicalVersionIdentityFields,
  claim: RunClaimTokenSchema.optional(),
  cause: RequeueCauseSchema,
  notBefore: IsoInstantSchema.optional(),
});

export const CanonicalRetrySourceRequestSchema = z.strictObject({
  sourceCommandId: CommandIdSchema.optional(),
  ...CanonicalVersionIdentityFields,
  runtimeConfig: RuntimeConfigClaimTokenSchema,
  appVersion: RunRecordSchema.shape.appVersion,
});

export const CanonicalDeleteRequestSchema = z.strictObject(CanonicalVersionIdentityFields);

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

/* ── start plans (ref frontend-backend-integration ) ───────────────────────────────────────────── */

export const StartPlanConsumeRequestSchema = z.strictObject({
  startPlanId: StartPlanIdSchema,
  // A consume increments storage once but its public proof retains the reviewed pre-consume revision.
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

/* ── worker leases (ref execution-and-sessions ) ───────────────────────────────────────────── */

export const WorkerStandingRecoveryRequestSchema = z.strictObject({
  commandId: CommandIdSchema, binding: WorkerLifecycleBindingSchema,
  previous: z.strictObject({ state: z.enum(["idle", "paused"]), directive: z.enum(["run", "pause"]), observedAt: IsoInstantSchema }),
  now: IsoInstantSchema,
}).refine(value => value.commandId === value.binding.commandId
  && value.binding.operation.kind === "retry" && value.binding.operation.mode === "browserless", "worker-standing-recovery-binding-invalid");

export const CanonicalCrashRecoveryRequestSchema = z.strictObject({
  commandId: CommandIdSchema, runId: RunIdSchema, expectedVersion: PositiveIntSchema, claim: RunClaimTokenSchema,
  workerLifetime: WorkerClaimLifetimeSchema,
  now: IsoInstantSchema,
});

export const WorkerStartRequestSchema = z.strictObject({
  commandId: CommandIdSchema.optional(),
  workerId: WorkerIdSchema,
  workflow: WorkflowIdSchema,
  browserSystems: WorkerBrowserSystemsSchema,
  processId: PositiveIntSchema,
  requestedBy: ActorIdSchema,
  now: IsoInstantSchema,
});

export const WorkerStartOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("started"), lease: WorkerLeaseRecordSchema }),

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



// Pool version 0 means no declaration row; it is a legitimate CAS basis, not a missing version.
export const WorkerPoolPlanRequestSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  expectedVersion: NonNegativeIntSchema,
  desiredWorkers: z.number().int().min(0),
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

export const CanonicalWorkerAdmissionRequestSchema = z.strictObject({
  commandId: CommandIdSchema, workflow: WorkflowIdSchema, poolIndex: z.number().int().min(1),
  expectedPoolVersion: NonNegativeIntSchema, processId: PositiveIntSchema, now: IsoInstantSchema,
});

export const WorkerVerificationAdmissionRequestSchema = ProfileDatabaseBindingSchema.extend({
  commandId: CommandIdSchema, workflow: WorkflowIdSchema, expectedPoolVersion: NonNegativeIntSchema,
  lockPort: z.number().int().positive().max(65535), profileRunId: z.uuid(), system: BrowserSystemIdSchema, credentialKey: FingerprintSchema,
  leaseGeneration: z.literal(1), now: IsoInstantSchema,
});

export const WorkerVerificationRetirementRequestSchema = ProfileDatabaseBindingSchema.extend({
  commandId: CommandIdSchema, grantCommandId: CommandIdSchema, workerId: WorkerIdSchema,
  expectedRevision: PositiveIntSchema, expectedPoolVersion: NonNegativeIntSchema, now: IsoInstantSchema,
  cleanup: z.enum(["closed", "interrupted"]),
});
