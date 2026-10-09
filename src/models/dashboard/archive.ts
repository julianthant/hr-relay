import { ArchiveDeleteCommandRequestSchema, VersionArchiveCommandRequestSchema } from "../../rules/commands/commands.js";
import { ArchiveReportSectionSchema, ArchiveFileReferenceSchema, ArchiveQuerySchema, ArchiveRuntimeVersionAttributionSchema } from "../archive/report.js";
import { RuntimeVersionSchema, RuntimeVersionScopeSchema, RuntimeVersionStateSchema } from "../archive/runtime-version.js";
import { RuntimeVersionMemberSchema } from "../archive/runtime-version-review.js";
import { VersionChangeReviewSchema } from "../archive/change-record.js";
import { DeletedRunRecordSchema } from "../run/deleted-run.js";
/** The Archive + version-bump wire; an archived run is read with no descriptor, no old-version code and no version fallback. */
import { z } from "zod";
import {
  ArchivedAppVersionSchema,
  ArchivedEvidencePointersSchema,
  ArchiveSchemaGenerationSchema,
  VersionBumpBlockerSchema,
  VersionBumpCandidateSchema,
  VersionDriftReasonSchema,
  WorkflowVersionIdentitySchema,
} from "../archive/model.js";
import { VersionBumpChangeRecordSchema } from "../archive/change-record.js";
import { ArchiveRetentionWireSchema } from "../archive/retention.js";
import { ArchivedRunSectionsSchema } from "../archive/sections.js";
import { ResolvedLedgerLineWireSchema } from "../archive/ledger-resolution.js";
import { SemverSchema, VersionScopeSchema } from "../../rules/commands/commands.js";
import { WorkflowCodeSchema } from "../workflow/presentation.js";

import {
  ActorIdSchema,
  ArtifactIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
  TraceIdSchema,
  VersionBumpApplicationIdSchema,
  VersionPlanIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { AppVersionSchema, DashboardWireVersionSchema } from "./primitives.js";
import {
  QueueStatusSchema,
  QueueSurfaceWireSchema,
  ResolvedInstanceSchema,
  RunWarningsWireSchema,
} from "./projection.js";
import { FailureDetailWireSchema, RunDetailWireSchema } from "./run-detail.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";

/** The archived run's FROZEN short code, as a listing surface reads it — an absence union, because a retired workflow has none. */
const ArchivedWorkflowCodeWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: WorkflowCodeSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

/** One row of the Archive index — enough to list and filter, never to act. */
export const ArchiveEntryWireSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  workflowLabel: z.string().min(1),
  workflowCode: ArchivedWorkflowCodeWireSchema,
  title: z.string().min(1),
  status: QueueStatusSchema,
  archivedIdentity: WorkflowVersionIdentitySchema,
  appVersion: ArchivedAppVersionSchema,
  drift: z.array(VersionDriftReasonSchema).min(1),
  startedAt: IsoInstantSchema,
  endedAt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  archivedAt: IsoInstantSchema,
  applicationId: VersionBumpApplicationIdSchema,
    /* The systems this run resolved and which INSTANCE of each it touched, copied verbatim off the frozen queue row; not new authority data. */
  resolvedInstances: z.array(ResolvedInstanceSchema),
    /* Whether this archived run was a REHEARSAL, copied verbatim off the frozen row exactly as `resolvedInstances` is. */
  dryRun: z.boolean(),
    /* Frozen warning facts distinguish none recorded from not yet derived. */
  warnings: RunWarningsWireSchema,
  /** ref frontend-backend-integration §5's "integrity" — what a relaunch must cite back. */
  archiveFingerprint: FingerprintSchema,
});
export type ArchiveEntryWire = z.infer<typeof ArchiveEntryWireSchema>;

/** One applied bump, as the Archive groups its rows. */
export const ArchiveSweepWireSchema = z.strictObject({
  applicationId: VersionBumpApplicationIdSchema,
  versionPlanId: VersionPlanIdSchema,
  scope: VersionScopeSchema,
  targetVersion: SemverSchema,
  appliedAppVersion: AppVersionSchema,
  appliedIdentities: z.array(WorkflowVersionIdentitySchema).min(1),
  appliedBy: ActorIdSchema,
  appliedAt: IsoInstantSchema,
  archivedCount: z.number().int().nonnegative(),
    /* Charter §25's change record — what moved and WHY; absent for a sweep applied before generation 2, because a bump nobody wrote a reason for and a bump that predates the field are different facts. */
  changeRecord: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: VersionBumpChangeRecordSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
    /* The descriptor versions the runs THIS sweep archived were carrying — derived from the archived records' own frozen identities, not from the plan. */
  fromVersions: z.array(z.number().int().positive()),
}).superRefine((sweep, context) => {
    // Minor bumps archive nothing; reject nonzero archived counts.
  if (sweep.changeRecord.state === "present" && sweep.changeRecord.value.kind === "minor" && sweep.archivedCount > 0) {
    context.addIssue({
      code: "custom",
      path: ["archivedCount"],
      message: "a minor bump archives nothing; a minor sweep may not record an archived count",
    });
  }
});
export type ArchiveSweepWire = z.infer<typeof ArchiveSweepWireSchema>;

/** The live version state a bump would act on, re-derived per request; NOT read from a plan, because a plan goes stale the moment a run is enqueued. */
export const WorkflowVersionStateWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  workflowLabel: z.string().min(1),
    /* The registry's CURRENT code; plain, not an absence union, because this row is re-derived per request from a registered descriptor. */
  workflowCode: WorkflowCodeSchema,
  current: WorkflowVersionIdentitySchema,
  /** Terminal prior-version runs — the ones a bump would archive. */
  archivable: z.number().int().nonnegative(),
  /** Non-terminal prior-version runs — the ones that REFUSE the bump. */
  blockers: z.array(VersionBumpBlockerSchema),
});
export type WorkflowVersionStateWire = z.infer<typeof WorkflowVersionStateWireSchema>;

/** A plan the operator minted and has not applied yet. */
export const VersionBumpPlanWireSchema = z.strictObject({
  versionPlanId: VersionPlanIdSchema,
  expectedVersion: z.number().int().positive(),
  planFingerprint: FingerprintSchema,
  scope: VersionScopeSchema,
  targetVersion: SemverSchema,
  changeFingerprint: FingerprintSchema,
  observedAppVersion: AppVersionSchema,
  observedIdentities: z.array(WorkflowVersionIdentitySchema).min(1),
  candidates: z.array(VersionBumpCandidateSchema),
  blockers: z.array(VersionBumpBlockerSchema),
  changeRecord: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: VersionBumpChangeRecordSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  plannedBy: ActorIdSchema,
  plannedAt: IsoInstantSchema,
  state: z.enum(["planned", "applied"]),
}).superRefine((plan, context) => {
    // Minor plans have neither archive candidates nor blockers.
  const kind = plan.changeRecord.state === "present" ? plan.changeRecord.value.kind : undefined;
  if (kind === "minor" && plan.candidates.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["candidates"],
      message: "a minor bump archives nothing; a minor plan may not list archive candidates",
    });
  }
  if (kind === "minor" && plan.blockers.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["blockers"],
      message: "a minor bump cannot be blocked; a minor plan may not list blockers",
    });
  }
});
export type VersionBumpPlanWire = z.infer<typeof VersionBumpPlanWireSchema>;

export const ArchiveIndexWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  generatedAt: IsoInstantSchema,
  currentAppVersion: AppVersionSchema,
  entries: z.array(ArchiveEntryWireSchema),
  sweeps: z.array(ArchiveSweepWireSchema),
  versionState: z.array(WorkflowVersionStateWireSchema),
  plans: z.array(VersionBumpPlanWireSchema),
}).superRefine((wire, context) => {
  const sweeps = new Set(wire.sweeps.map((sweep) => sweep.applicationId));
  for (const entry of wire.entries) {
    if (!sweeps.has(entry.applicationId)) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: `archived run ${entry.runId} names sweep ${entry.applicationId}, which the index does not carry`,
      });
    }
  }
});
export type ArchiveIndexWire = z.infer<typeof ArchiveIndexWireSchema>;

/** One archived run, whole: everything a reader needs is IN this payload, which is exactly what makes "zero old-version code paths" checkable. */
export const ArchivedRunDetailWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  runId: RunIdSchema,
  applicationId: VersionBumpApplicationIdSchema,
  workflowId: WorkflowIdSchema,
  workflowLabel: z.string().min(1),
  workflowCode: ArchivedWorkflowCodeWireSchema,
  archivedIdentity: WorkflowVersionIdentitySchema,
  appVersion: ArchivedAppVersionSchema,
  drift: z.array(VersionDriftReasonSchema).min(1),
  archivedAt: IsoInstantSchema,
  archivedBy: ActorIdSchema,
  archiveFingerprint: FingerprintSchema,
  row: QueueSurfaceWireSchema,
  detail: RunDetailWireSchema,
  receipt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: RunEvidenceReceiptSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  failure: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: FailureDetailWireSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  evidence: ArchivedEvidencePointersSchema,
    /* The five frozen section tabs, served verbatim from the archived record — no re-derivation, no fetch, no descriptor; a record written before generation 2 has none. */
  sections: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: ArchivedRunSectionsSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
    /* The evidence pointers' ledger half, RESOLVED against the live ledger at read time; the pointers stay pointers, and this names what was filed. */
  ledger: z.array(ResolvedLedgerLineWireSchema),
    /* When each class of this run's data is purged, COMPUTED per record; a surface handed the rules is a surface free to apply them wrong. */
  retention: ArchiveRetentionWireSchema,
  /** Every fresh run this archived one was relaunched into, newest first. */
  relaunches: z.array(z.strictObject({
    runId: RunIdSchema,
    relaunchedIdentity: WorkflowVersionIdentitySchema,
    relaunchedBy: ActorIdSchema,
    relaunchedAt: IsoInstantSchema,
  })),
    /* Whether a relaunch is possible AT ALL, and why not when it is not; the surface must say so rather than offer a button that cannot work. */
  relaunch: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), current: WorkflowVersionIdentitySchema }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  ]),
});
export type ArchivedRunDetailWire = z.infer<typeof ArchivedRunDetailWireSchema>;

/** Availability verifies exact bytes now; archived detail remains capture authority. */
export const ArchivedCaptureResourceWireSchema = z.strictObject({
  runId: RunIdSchema,
  artifactId: ArtifactIdSchema,
  resource: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("available"),
      /** The byte route is scoped to this archived run and this frozen capture. */
      downloadUrl: z.string().min(1),
    }),
    z.strictObject({ state: z.literal("missing"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("error"), message: z.string().min(1) }),
  ]),
}).superRefine((capture, context) => {
  if (capture.resource.state === "available" && capture.resource.downloadUrl !==
    `/artifacts/v1/archive/${encodeURIComponent(capture.runId)}/${encodeURIComponent(capture.artifactId)}`) {
    context.addIssue({
      code: "custom",
      path: ["resource", "downloadUrl"],
      message: "an archived capture download must name its exact runId and artifactId",
    });
  }
});
export type ArchivedCaptureResourceWire = z.infer<typeof ArchivedCaptureResourceWireSchema>;

/** Saved display documents: no live run/detail parser participates in these schemas. */
export const SavedArchiveReportWireSchema = z.strictObject({
  state: z.literal("available"), runId: RunIdSchema, title: z.string(), workflow: z.string(), descriptorVersion: z.string(),
  transferId: z.string().uuid().optional(), itemId: z.string().min(1).optional(),
  attempt: z.number().int().positive().optional(), runNumber: z.number().int().positive().nullable().optional(),
  publicationState: z.literal("published").optional(), reportIntegrity: z.literal("verified").optional(),
  outcome: z.enum(["done", "failed", "cancelled", "discarded", "interrupted", "superseded"]),
  completedAt: IsoInstantSchema, capturedAt: IsoInstantSchema,
  sections: z.array(ArchiveReportSectionSchema), files: z.array(ArchiveFileReferenceSchema),
  runtimeVersion: ArchiveRuntimeVersionAttributionSchema.optional(),
  archiveFingerprint: FingerprintSchema,
  versionChange: z.strictObject({ changeId: z.string().uuid(), change: VersionBumpChangeRecordSchema,
    scope: VersionChangeReviewSchema.shape.scope, targetVersion: z.string(), reviewedAt: IsoInstantSchema,
    appliedBy: z.string(), startedAt: IsoInstantSchema }).optional(),
});
export type SavedArchiveReportWire = z.infer<typeof SavedArchiveReportWireSchema>;

export const SavedArchiveDeletionStatusWireSchema = z.strictObject({
  state: z.literal("deleted"),
  runId: RunIdSchema,
  deletedAt: IsoInstantSchema,
  removed: DeletedRunRecordSchema.shape.removed,
  cleanup: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending"), fileCount: z.number().int().nonnegative() }),
    z.strictObject({ state: z.literal("complete"), fileCount: z.number().int().nonnegative() }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  ]),
  command: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("pending"),
      reason: z.string().min(1),
      resumeRequest: ArchiveDeleteCommandRequestSchema.optional(),
    }),
    z.strictObject({ state: z.literal("complete"), commandId: CommandIdSchema, completedAt: IsoInstantSchema }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  ]),
});
export type SavedArchiveDeletionStatusWire = z.infer<typeof SavedArchiveDeletionStatusWireSchema>;

export const SavedArchiveDetailWireSchema = z.discriminatedUnion("state", [SavedArchiveReportWireSchema,
  z.strictObject({ state: z.literal("missing"), runId: RunIdSchema, reason: z.string() }),
  z.strictObject({ state: z.literal("deleted"), runId: RunIdSchema, reason: z.string(), deletion: SavedArchiveDeletionStatusWireSchema }),
  z.strictObject({ state: z.literal("unavailable"), runId: RunIdSchema, reason: z.string() }),
]);
export type SavedArchiveDetailWire = z.infer<typeof SavedArchiveDetailWireSchema>;
export const SavedArchiveQuerySchema = ArchiveQuerySchema.extend({ workflow: z.string().min(1).optional() });
export type SavedArchiveQuery = z.infer<typeof SavedArchiveQuerySchema>;
export const SavedArchiveIndexWireSchema = z.strictObject({
  items: z.array(SavedArchiveReportWireSchema),
  next: z.strictObject({ completedAt: IsoInstantSchema, runId: RunIdSchema }).nullable(),
});
export type SavedArchiveIndexWire = z.infer<typeof SavedArchiveIndexWireSchema>;

export const SavedArchiveGroupsWireSchema = z.strictObject({ groups: z.array(z.strictObject({
  dashboardVersion: RuntimeVersionSchema.nullable(), workflow: z.string().min(1),
  workflowVersion: RuntimeVersionSchema.nullable(), reportCount: z.number().int().positive(),
  latestCompletedAt: IsoInstantSchema, latestCapturedAt: IsoInstantSchema.optional(),
})) });
export type SavedArchiveGroupsWire = z.infer<typeof SavedArchiveGroupsWireSchema>;

export const SavedVersionIndexWireSchema = z.strictObject({
  appVersion: z.string(), workflows: z.array(z.strictObject({ workflow: z.string(), label: z.string(), version: z.number(), fingerprint: FingerprintSchema })),
  changes: z.array(z.strictObject({ changeId: z.string().uuid(), state: z.enum(["planned", "applying", "applied", "superseded"]),
    targetVersion: z.string(), change: VersionBumpChangeRecordSchema, reviewFingerprint: FingerprintSchema,
    resumeRequest: VersionArchiveCommandRequestSchema.options[1].omit({ reason: true }).optional(),
    scope: VersionChangeReviewSchema.shape.scope, memberRunIds: z.array(RunIdSchema), blockerRunIds: z.array(RunIdSchema), completedRunIds: z.array(RunIdSchema) })),
  historicalChanges: z.number().int().nonnegative(),
});
export type SavedVersionIndexWire = z.infer<typeof SavedVersionIndexWireSchema>;

export const SavedRuntimeVersionIndexWireSchema = z.strictObject({
  revision: z.number().int().positive(),
  dashboard: RuntimeVersionSchema,
  workflows: z.array(z.strictObject({ workflowId: WorkflowIdSchema, label: z.string().min(1), version: RuntimeVersionSchema })),
  applyingChangeId: z.string().uuid().optional(),
  changes: z.array(z.strictObject({
    changeId: z.string().uuid(), actorId: z.string().min(1), reviewedAt: IsoInstantSchema,
    reviewFingerprint: FingerprintSchema,
    scope: RuntimeVersionScopeSchema, before: RuntimeVersionStateSchema, after: RuntimeVersionStateSchema,
    state: z.enum(["planned", "applying", "applied"]), members: z.array(RuntimeVersionMemberSchema),
    completedRunIds: z.array(RunIdSchema),
    resumeRequest: VersionArchiveCommandRequestSchema.options[3].optional(),
  })),
});
export type SavedRuntimeVersionIndexWire = z.infer<typeof SavedRuntimeVersionIndexWireSchema>;

/** Membership-scoped access also covers historical files without an issued artifact UUID. */
export const SavedArchiveFileWireSchema = z.strictObject({ runId: RunIdSchema, digest: FingerprintSchema,
  resource: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), downloadUrl: z.string() }),
    z.strictObject({ state: z.literal("missing"), reason: z.string() }),
    z.strictObject({ state: z.literal("error"), message: z.string() }),
  ]),
}).refine(file => file.resource.state !== "available" || file.resource.downloadUrl === `/artifacts/v1/archive/${file.runId}/files/${file.digest}`, "saved-file-download-identity-mismatch");
export type SavedArchiveFileWire = z.infer<typeof SavedArchiveFileWireSchema>;
