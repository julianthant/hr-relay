/**
 * The Archive + version-bump wire (doc 03 §10.2 D80, doc 13 §5 "Archive +
 * version bump", D179).
 *
 * Two facts and no more: the paged archive index with the version state a bump
 * would act on, and one archived run's self-contained detail. The detail
 * carries no live handle of any kind — no action descriptors, no sections to
 * fetch, no descriptor id to resolve — because an archived run is READ-ONLY by
 * construction, not by a disabled button.
 *
 * The archived run's stored INPUT is deliberately absent from the wire. It
 * exists in authority for exactly one purpose — replanning a relaunch on the
 * current version — and that happens server-side inside the command
 * transaction, so shipping it to the browser would widen what an archive
 * exposes for no surface that reads it.
 */
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
import { SemverSchema, VersionScopeSchema } from "../commands.js";
import {
  ActorIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
  TraceIdSchema,
  VersionBumpApplicationIdSchema,
  VersionPlanIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { AppVersionSchema, DashboardWireVersionSchema } from "./primitives.js";
import { QueueStatusSchema, QueueSurfaceWireSchema, ResolvedInstanceSchema } from "./projection.js";
import { FailureDetailWireSchema, RunDetailWireSchema } from "./run-detail.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";

/** One row of the Archive index — enough to list and filter, never to act. */
export const ArchiveEntryWireSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  workflowLabel: z.string().min(1),
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
  /**
   * The systems this run resolved and which INSTANCE of each it touched,
   * copied verbatim off the frozen queue row when the index projects. It is
   * not new authority data — `archived_runs` already holds it inside `row` —
   * and it is on the index because a hazard an operator can only see after
   * opening a run is a hazard the list is free to hide. The detail reads the
   * same fact off `row.resolvedInstances`, so the two can never disagree.
   */
  resolvedInstances: z.array(ResolvedInstanceSchema),
  /** doc 13 §5's "integrity" — what a relaunch must cite back. */
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
  /**
   * Charter §25's change record — what moved and WHY. Absent for a sweep
   * applied before generation 2, with the reason: a bump nobody wrote a reason
   * for and a bump that predates the field are different facts.
   */
  changeRecord: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: VersionBumpChangeRecordSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  /**
   * The descriptor versions the runs THIS sweep archived were carrying —
   * derived from the archived records' own frozen identities, not from the
   * plan. A sweep that archived nothing has no from-version and says so; a
   * multi-workflow sweep can legitimately have several.
   */
  fromVersions: z.array(z.number().int().positive()),
});
export type ArchiveSweepWire = z.infer<typeof ArchiveSweepWireSchema>;

/**
 * The live version state a bump would act on, re-derived per request. It is
 * NOT read from a plan: a plan is a review copy that goes stale the moment a
 * run is enqueued, and the surface must show what is true now.
 */
export const WorkflowVersionStateWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  workflowLabel: z.string().min(1),
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

/**
 * One archived run, whole. Everything a reader needs is IN this payload —
 * which is exactly what makes "zero old-version code paths" checkable: the
 * guard reads one back with the workflow registry emptied.
 */
export const ArchivedRunDetailWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  runId: RunIdSchema,
  applicationId: VersionBumpApplicationIdSchema,
  workflowId: WorkflowIdSchema,
  workflowLabel: z.string().min(1),
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
  /**
   * D223's five tabs. The archived record froze the section payloads beside the
   * row, and this serves them verbatim — no re-derivation, no fetch, no
   * descriptor. A record written before generation 2 has none, and the wire
   * says which of the two absences it is: the tab renders the sentence rather
   * than an empty panel, because "this run logged nothing" and "this record
   * predates frozen logs" are different facts and the operator acts on them
   * differently.
   */
  sections: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: ArchivedRunSectionsSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  /**
   * The evidence pointers' ledger half, RESOLVED against the live ledger at
   * read time. The pointers above stay pointers — the ledger is never archived
   * — and this is what lets the Write-ledger card name what was filed instead
   * of listing three ids. A pointer that resolves to nothing appears here as a
   * named refusal rather than being dropped: the list of what a run filed is
   * the one list an operator must never see silently short.
   */
  ledger: z.array(ResolvedLedgerLineWireSchema),
  /**
   * When each class of this run's data is purged, COMPUTED per record (doc 03
   * §10.4). It is not a restatement of the policy: a surface handed the rules
   * is a surface free to apply them wrong, and the two halves that have no
   * instant say which kind of "no instant" they are — nothing purges the
   * archived row, while an operator act can take the capture bytes.
   */
  retention: ArchiveRetentionWireSchema,
  /** Every fresh run this archived one was relaunched into, newest first. */
  relaunches: z.array(z.strictObject({
    runId: RunIdSchema,
    relaunchedIdentity: WorkflowVersionIdentitySchema,
    relaunchedBy: ActorIdSchema,
    relaunchedAt: IsoInstantSchema,
  })),
  /**
   * Whether a relaunch is possible AT ALL, and why not when it is not — an
   * archived workflow whose descriptor has since been retired cannot be
   * relaunched, and the surface must say so rather than offer a button that
   * fails.
   */
  relaunch: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), current: WorkflowVersionIdentitySchema }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  ]),
});
export type ArchivedRunDetailWire = z.infer<typeof ArchivedRunDetailWireSchema>;
