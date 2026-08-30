import { z } from "zod";
import { SettingsOverrideSchema } from "./config/schema.js";
import { deepFreeze } from "./immutability.js";
import {
  ActorIdSchema,
  BrowserSessionIdSchema,
  CapturePhotoIdSchema,
  CaptureSessionIdSchema,
  CommandAuditIdSchema,
  CommandIdSchema,
  DependencyIdSchema,
  FingerprintSchema,
  GateIdSchema,
  IntakeSessionIdSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  NotificationIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  SourceColumnIdSchema,
  SourceSurfaceIdSchema,
  StartPlanIdSchema,
  VersionPlanIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "./ids.js";
import { ArtifactRefSchema } from "./artifacts.js";
import { VersionBumpChangeRecordSchema } from "./archive/change-record.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";
import { CheckpointPatchSchema } from "./workflow/checkpoint.js";
import { ExplorerEditApplyRequestSchema } from "./dashboard/explorer.js";

export const CommandFamilySchema = z.enum([
  "start",
  "intake",
  "worker-browser",
  "settings",
  "version-archive",
  "run",
  "gate",
  "notification",
  "capture",
  "explorer",
]);

export const CommandActionSchema = z.enum([
  "start-run",
  "inspect-intake",
  "confirm-intake-mapping",
  "correct-intake-row",
  "exclude-intake-row",
  "validate-intake",
  "enqueue-intake-manifest",
  "plan-worker-count",
  "spawn-worker",
  "stop-worker",
  "pause-worker",
  "resume-worker",
  "refresh-browser",
  "reopen-browser",
  "apply-settings",
  "plan-version-bump",
  "apply-version-bump",
  "relaunch-archived-run",
  "retry",
  "cancel",
  "bump",
  "rename",
  "edit-checkpoint",
  "resolve-write-present",
  "resolve-write-absent",
  "resolve-gate",
  "notification-read",
  "notification-unread",
  "notification-snooze",
  "capture-upload",
  "capture-replace",
  "capture-reorder",
  "capture-delete",
  "capture-finalize",
  "capture-retry-finalize",
  "capture-discard",
  "apply-explorer-edit",
]);

export const OperatorReasonSchema = z.string().min(1).max(500).refine(
  (value) => value.trim() === value,
  "operator reason must already be trimmed",
);

export const RunDisplayNameSchema = z.string().superRefine((value, context) => {
  if (value.trim() !== value) {
    context.addIssue({ code: "custom", message: "run display name must already be trimmed" });
  }
  if (value.normalize("NFC") !== value) {
    context.addIssue({ code: "custom", message: "run display name must be NFC-normalized" });
  }
  const codePoints = [...value].length;
  if (codePoints < 1 || codePoints > 120) {
    context.addIssue({ code: "custom", message: "run display name must contain 1 to 120 Unicode code points" });
  }
  if (/\p{Cc}/u.test(value)) {
    context.addIssue({ code: "custom", message: "run display name cannot contain control characters" });
  }
});

export const SemverSchema = z.string().regex(
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "version must be semantic version text",
);

const CommandEnvelopeFields = {
  commandId: CommandIdSchema,
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema,
  reason: OperatorReasonSchema.optional(),
} as const;

export const CommandEnvelopeSchema = z.strictObject(CommandEnvelopeFields);

const RunVersionTargetSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
});

const IntakeVersionTargetSchema = z.strictObject({
  intakeSessionId: IntakeSessionIdSchema,
  expectedVersion: PositiveIntSchema,
});

/**
 * D269 (ref execution-and-sessions §11.5): the worker POOL target. `expectedVersion`
 * is the pool row's version — `worker_pools.version` — and **0 when the
 * workflow has no row yet**: nothing seeds a pool, so 0 is the honest basis
 * for the first plan rather than a placeholder, and the kernel answers a stale
 * basis with `conflict` naming the current one (0 included). It is NOT a
 * worker lease's version (`WorkerVersionTargetSchema`, one worker's row) and
 * never `WorkerCardWire.revision` (a patch cursor).
 */
const WorkerPoolVersionTargetSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  expectedVersion: NonNegativeIntSchema,
});

const WorkerVersionTargetSchema = z.strictObject({
  workerId: WorkerIdSchema,
  expectedVersion: PositiveIntSchema,
});

const CaptureVersionTargetSchema = z.strictObject({
  captureSessionId: CaptureSessionIdSchema,
  expectedVersion: PositiveIntSchema,
});

export const StartCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("start"),
  type: z.literal("start-run"),
  target: z.strictObject({
    workflowId: WorkflowIdSchema,
    startPlanId: StartPlanIdSchema,
    expectedVersion: PositiveIntSchema,
  }),
  payload: z.strictObject({
    descriptorFingerprint: FingerprintSchema,
    configFingerprint: FingerprintSchema,
    ingressSchemaHash: FingerprintSchema,
    canonicalInputSchemaHash: FingerprintSchema,
    inputFingerprint: FingerprintSchema,
  }),
});

// D170: the five non-enqueue intake payloads carry what ref data-intake-and-edit-data §2.2's flow
// actually sends. The old shapes named an artifact and two fingerprints the
// session itself now holds, and a `rowId` for something that has no item
// identity until it validates — they were deferred-arm placeholders no producer
// ever sent, so they are amended rather than migrated (D161/D167's rule).
// The artifact rides the SESSION, which the upload route creates.
//
// D171 amends the sixth the same way: `enqueue-intake-manifest` targeted an
// `intakeManifestId` that CANNOT exist when the command is issued — the command
// is what mints it — so it targets the session under the same version CAS as
// its five siblings. `dryRun` is explicit rather than defaulted, exactly as
// `StartPlanIngressSchema` requires it: a fan-out that silently chose one is a
// fan-out that silently chose whether to touch a real HR system.
export const IntakeCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("inspect-intake"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sheet: z.string().min(1).optional(), headerRowIndex: z.number().int().nonnegative().optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("confirm-intake-mapping"), target: IntakeVersionTargetSchema, payload: z.strictObject({ targetFieldId: IntakeTargetFieldIdSchema, sourceColumnId: SourceColumnIdSchema, headerFingerprint: FingerprintSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("correct-intake-row"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sourceRow: PositiveIntSchema, field: IntakeTargetFieldIdSchema, correctedValue: z.string() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("exclude-intake-row"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sourceRow: PositiveIntSchema, reason: OperatorReasonSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("validate-intake"), target: IntakeVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("enqueue-intake-manifest"), target: IntakeVersionTargetSchema, payload: z.strictObject({ dryRun: z.boolean() }) }),
]);

export const WorkerBrowserCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("plan-worker-count"), target: WorkerPoolVersionTargetSchema, payload: z.strictObject({ desiredWorkers: PositiveIntSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("spawn-worker"), target: WorkerPoolVersionTargetSchema, payload: z.strictObject({ workerId: WorkerIdSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["stop-worker", "pause-worker", "resume-worker"]), target: WorkerVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["refresh-browser", "reopen-browser"]), target: z.strictObject({ workerId: WorkerIdSchema, browserSessionId: BrowserSessionIdSchema, expectedVersion: PositiveIntSchema }) }),
]);

export const SettingsCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("settings"),
  type: z.literal("apply-settings"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema }),
  payload: z.strictObject({
    settingsSchemaHash: FingerprintSchema,
    patchFingerprint: FingerprintSchema,
    patch: SettingsOverrideSchema,
  }),
});

/**
 * Charter §25's declared bump scope. `workflows` names an exact set whose
 * descriptors moved; `application` is the dashboard update that bumps the
 * effective version of EVERY workflow, because old runs may not be
 * interpretable against new dashboard state. Exported because the durable
 * archive model (D179) binds the same scope a command declared — a plan that
 * recorded a looser copy of its own scope could apply to runs the operator
 * never named.
 */
export const VersionScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflows"), workflowIds: z.array(WorkflowIdSchema).min(1) }),
  z.strictObject({ kind: z.literal("application"), applicationVersion: SemverSchema }),
]);
export type VersionScope = z.infer<typeof VersionScopeSchema>;

export const VersionArchiveCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("version-archive"),
    type: z.literal("plan-version-bump"),
    target: z.strictObject({ scope: VersionScopeSchema }),
    /**
     * Charter §25 / ref dashboard-surfaces §10.2: a bump's scope is declared by whoever makes
     * the change AND recorded in that update's change record. `changeRecord`
     * is required here — the plan is where the author is, and asking the
     * question later would mean asking somebody who did not make the change.
     */
    payload: z.strictObject({
      targetVersion: SemverSchema,
      changeFingerprint: FingerprintSchema,
      changeRecord: VersionBumpChangeRecordSchema,
    }),
  }),
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("version-archive"),
    type: z.literal("apply-version-bump"),
    target: z.strictObject({ versionPlanId: VersionPlanIdSchema, expectedVersion: PositiveIntSchema }),
    payload: z.strictObject({ planFingerprint: FingerprintSchema }),
  }),
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("version-archive"),
    type: z.literal("relaunch-archived-run"),
    target: z.strictObject({ archivedRunId: RunIdSchema, archiveFingerprint: FingerprintSchema }),
  }),
]);

export const RunCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.enum(["retry", "cancel", "bump"]), target: RunVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("rename"), target: RunVersionTargetSchema, payload: z.strictObject({ displayName: RunDisplayNameSchema }) }),
  // D166: ref data-intake-and-edit-data §6.3's field-level patch model. The earlier whole-checkpoint
  // blob payload was a deferred-arm placeholder no producer ever sent.
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("edit-checkpoint"), target: RunVersionTargetSchema, payload: z.strictObject({ patches: z.array(CheckpointPatchSchema).min(1) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-write-present"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema }), payload: z.strictObject({ proof: SchemaBoundCanonicalValueSchema, evidenceNote: OperatorReasonSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-write-absent"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema }), payload: z.strictObject({ evidenceNote: OperatorReasonSchema }) }),
]);

export const GateCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("gate"),
  type: z.literal("resolve-gate"),
  target: z.strictObject({ runId: RunIdSchema, gateId: GateIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ result: SchemaBoundCanonicalValueSchema }),
});

export const NotificationCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.enum(["notification-read", "notification-unread"]), target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.literal("notification-snooze"), target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }), payload: z.strictObject({ until: IsoInstantSchema }) }),
]);

// D167: the WHOLE ArtifactRef, not an id+fingerprint pair — D161 recorded
// why: a reduced identity names bytes nobody can resolve. This was a
// deferred-arm placeholder; no producer ever sent the old shape.
const CapturePhotoPayloadSchema = z.strictObject({
  photoId: CapturePhotoIdSchema,
  artifact: ArtifactRefSchema,
  originalMediaType: z.string().min(1),
});

export const CaptureCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.enum(["capture-upload", "capture-replace"]), target: CaptureVersionTargetSchema, payload: CapturePhotoPayloadSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.literal("capture-reorder"), target: CaptureVersionTargetSchema, payload: z.strictObject({ orderedPhotoIds: z.array(CapturePhotoIdSchema).min(1) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.literal("capture-delete"), target: CaptureVersionTargetSchema, payload: z.strictObject({ photoId: CapturePhotoIdSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.enum(["capture-finalize", "capture-retry-finalize", "capture-discard"]), target: CaptureVersionTargetSchema }),
]);

/** D283: the sole durable Explorer edit door; validation remains a read-only route. */
export const ExplorerCommandRequestSchema = ExplorerEditApplyRequestSchema;

export const CommandRequestSchema = z.union([
  StartCommandRequestSchema,
  IntakeCommandRequestSchema,
  WorkerBrowserCommandRequestSchema,
  SettingsCommandRequestSchema,
  VersionArchiveCommandRequestSchema,
  RunCommandRequestSchema,
  GateCommandRequestSchema,
  NotificationCommandRequestSchema,
  CaptureCommandRequestSchema,
  ExplorerCommandRequestSchema,
]);

export const CommandTargetReferenceSchema = z.discriminatedUnion("family", [
  z.strictObject({
    family: z.literal("start"),
    workflowId: WorkflowIdSchema,
    startPlanId: StartPlanIdSchema,
    expectedVersion: PositiveIntSchema,
  }),
  z.strictObject({ family: z.literal("intake"), intakeSessionId: IntakeSessionIdSchema }),
  z.strictObject({ family: z.literal("worker-browser"), workerId: WorkerIdSchema }),
  /** D269: the per-workflow pool row `plan-worker-count` advanced. */
  z.strictObject({ family: z.literal("worker-pool"), workflowId: WorkflowIdSchema }),
  z.strictObject({ family: z.literal("settings"), revision: PositiveIntSchema }),
  z.strictObject({ family: z.literal("version-archive"), versionPlanId: VersionPlanIdSchema }),
  z.strictObject({ family: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ family: z.literal("gate"), runId: RunIdSchema, gateId: GateIdSchema }),
  z.strictObject({ family: z.literal("notification"), notificationId: NotificationIdSchema }),
  z.strictObject({ family: z.literal("capture"), captureSessionId: CaptureSessionIdSchema }),
  z.strictObject({ family: z.literal("explorer"), workflowId: WorkflowIdSchema, revision: PositiveIntSchema }),
]);

export const CommandRejectionCodeSchema = z.enum([
  "invalid-state",
  "target-not-found",
  "authority-unavailable",
  "policy-refused",
  "schema-mismatch",
  "active-version-blockers",
  /**
   * D113: the arm is schema-recognized but its owning later milestone has not
   * activated it. This result is computed with ZERO authority side effects —
   * no journal row, no audit row, no generation advance.
   */
  "capability-unavailable",
]);

export const CommandResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.enum(["applied", "already-applied"]),
    commandId: CommandIdSchema,
    affectedTargets: z.array(CommandTargetReferenceSchema).min(1),
    restartRequired: z.literal(true).optional(),
  }),
  /**
   * `currentVersion` is non-negative rather than positive since D269: the worker
   * POOL is the one versioned target whose "no row yet" state is a legitimate
   * CAS basis (0), so a conflict against an unplanned pool must be able to say
   * so. Every other target is created at version 1 and never reports 0.
   */
  z.strictObject({ state: z.literal("conflict"), commandId: CommandIdSchema, currentVersion: NonNegativeIntSchema, message: z.string().min(1) }),
  z.strictObject({ state: z.literal("rejected"), commandId: CommandIdSchema, code: CommandRejectionCodeSchema, message: z.string().min(1) }),
]).superRefine((result, context) => {
  if (result.state !== "applied" && result.state !== "already-applied") return;
  const affectsSettings = result.affectedTargets.some((target) => target.family === "settings");
  if (affectsSettings !== (result.restartRequired === true)) {
    context.addIssue({
      code: "custom",
      path: ["restartRequired"],
      message: "restartRequired must be true exactly when an applied result affects settings",
    });
  }
});

export const CommandAuditRecordSchema = z.strictObject({
  auditId: CommandAuditIdSchema,
  request: CommandRequestSchema,
  result: CommandResultSchema,
  completedAt: IsoInstantSchema,
  /** `before` admits 0 for the same D269 reason `conflict.currentVersion` does: the first pool plan moves 0 → 1. */
  versionChanges: z.array(z.strictObject({ target: CommandTargetReferenceSchema, before: NonNegativeIntSchema, after: PositiveIntSchema })),
  affectedDependencyIds: z.array(DependencyIdSchema),
});

export const BulkRunCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("run"),
  type: z.enum(["retry", "cancel", "bump"]),
  bulkCommandId: CommandIdSchema,
  targets: z.array(RunVersionTargetSchema).min(1),
  mode: z.enum(["all-or-none", "best-effort"]),
});

/**
 * D235 — what ONE target's child command settled as. A bulk request is N real
 * CAS-bound transitions, so it answers with N outcomes and never with a count.
 *
 * The vocabulary is the single-command vocabulary, deliberately: `conflict`
 * carries the server's `currentVersion` because that is the only number that
 * tells an operator to refresh, and `refused` carries the SAME
 * `CommandRejectionCode` a single `POST /api/v1/commands` would have answered
 * with. A fourth arm, `errored`, exists because a child can raise a structured
 * error the kernel does not type (a broken journal, an inconsistent authority);
 * collapsing that into `refused` would put a code nobody computed onto a real
 * HR record, and dropping it would hide the fact that the targets after it were
 * never attempted.
 */
export const BulkRunCommandOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("applied"),
    runId: RunIdSchema,
    /** the CHILD command's own id — derived, so a re-delivered bulk replays it */
    commandId: CommandIdSchema,
    /** true when the child was already journaled and the kernel replayed it */
    replayed: z.boolean(),
    detail: z.string().min(1),
  }),
  z.strictObject({
    outcome: z.literal("conflict"),
    runId: RunIdSchema,
    commandId: CommandIdSchema,
    /** Mirrors `CommandResultSchema.conflict` — see the D269 note there. A run target never answers 0. */
    currentVersion: NonNegativeIntSchema,
    detail: z.string().min(1),
  }),
  z.strictObject({
    outcome: z.literal("refused"),
    runId: RunIdSchema,
    commandId: CommandIdSchema,
    code: CommandRejectionCodeSchema,
    detail: z.string().min(1),
  }),
  z.strictObject({
    outcome: z.literal("errored"),
    runId: RunIdSchema,
    commandId: CommandIdSchema,
    detail: z.string().min(1),
  }),
]);

/**
 * D235 — the bulk response. `vector` is the complete per-run result; `refused`
 * is a whole-request refusal that reached no target at all (a malformed
 * request, an empty target set, a mode this runtime does not execute).
 *
 * `requestedCount` is on the wire rather than derived from `results.length`
 * precisely so a stopped run — an `errored` child ends the pass — is legible:
 * `results.length < requestedCount` means the remainder was NOT attempted, and
 * the surface says so instead of implying the vector is whole.
 */
export const BulkRunCommandResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("vector"),
    bulkCommandId: CommandIdSchema,
    type: z.enum(["retry", "cancel", "bump"]),
    requestedCount: PositiveIntSchema,
    results: z.array(BulkRunCommandOutcomeSchema).min(1),
  }),
  z.strictObject({
    state: z.literal("refused"),
    code: CommandRejectionCodeSchema,
    message: z.string().min(1),
  }),
]);

export const CommandFamilySpecSchema = z.strictObject({
  family: CommandFamilySchema,
  actions: z.array(CommandActionSchema).min(1),
});

const COMMAND_ACTIONS_BY_FAMILY = {
  start: ["start-run"],
  intake: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"],
  "worker-browser": ["plan-worker-count", "spawn-worker", "stop-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser"],
  settings: ["apply-settings"],
  "version-archive": ["plan-version-bump", "apply-version-bump", "relaunch-archived-run"],
  run: ["retry", "cancel", "bump", "rename", "edit-checkpoint", "resolve-write-present", "resolve-write-absent"],
  gate: ["resolve-gate"],
  notification: ["notification-read", "notification-unread", "notification-snooze"],
  capture: ["capture-upload", "capture-replace", "capture-reorder", "capture-delete", "capture-finalize", "capture-retry-finalize", "capture-discard"],
  explorer: ["apply-explorer-edit"],
} as const satisfies Record<z.infer<typeof CommandFamilySchema>, readonly z.infer<typeof CommandActionSchema>[]>;

export const CommandFamilyRegistrySchema = z.array(CommandFamilySpecSchema).superRefine((entries, context) => {
  const families = entries.map(({ family }) => family);
  if (new Set(families).size !== families.length) {
    context.addIssue({ code: "custom", message: "command family registry families must be unique" });
  }
  for (const family of CommandFamilySchema.options) {
    const entry = entries.find((candidate) => candidate.family === family);
    if (entry === undefined) {
      context.addIssue({ code: "custom", message: `command family registry omits ${family}` });
      continue;
    }
    const expected = COMMAND_ACTIONS_BY_FAMILY[family];
    if (entry.actions.length !== expected.length || expected.some((action) => !entry.actions.includes(action))) {
      context.addIssue({ code: "custom", path: [entries.indexOf(entry), "actions"], message: `${family} command actions do not match D95` });
    }
  }
});

export const COMMAND_FAMILY_REGISTRY = deepFreeze(CommandFamilyRegistrySchema.parse([
  { family: "start", actions: ["start-run"] },
  { family: "intake", actions: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"] },
  { family: "worker-browser", actions: ["plan-worker-count", "spawn-worker", "stop-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser"] },
  { family: "settings", actions: ["apply-settings"] },
  { family: "version-archive", actions: ["plan-version-bump", "apply-version-bump", "relaunch-archived-run"] },
  { family: "run", actions: ["retry", "cancel", "bump", "rename", "edit-checkpoint", "resolve-write-present", "resolve-write-absent"] },
  { family: "gate", actions: ["resolve-gate"] },
  { family: "notification", actions: ["notification-read", "notification-unread", "notification-snooze"] },
  { family: "capture", actions: ["capture-upload", "capture-replace", "capture-reorder", "capture-delete", "capture-finalize", "capture-retry-finalize", "capture-discard"] },
  { family: "explorer", actions: ["apply-explorer-edit"] },
]));

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type CommandAuditRecord = z.infer<typeof CommandAuditRecordSchema>;
export type RunDisplayName = z.infer<typeof RunDisplayNameSchema>;
export type BulkRunCommandRequest = z.infer<typeof BulkRunCommandRequestSchema>;
export type BulkRunCommandOutcome = z.infer<typeof BulkRunCommandOutcomeSchema>;
export type BulkRunCommandResponse = z.infer<typeof BulkRunCommandResponseSchema>;
