import { LedgerLinePointerSchema, ResolvedLedgerLineWireSchema } from "./ledger-resolution.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../write-safety/protected-input.js";
/** The archive model: durable self-contained data, read with no descriptor, no old-version code and no version fallback. */
import { z } from "zod";
import { canonicalJsonStringify, type JsonValue } from "../../rules/validation/canonical-json.js";
import { SemverSchema, VersionScopeSchema } from "../../rules/commands/commands.js";
import { AppVersionSchema, RunAppVersionSchema } from "../dashboard/primitives.js";
import { ArchivedQueueSurfaceStorageSchema } from "../dashboard/projection.js";
import { FailureDetailWireSchema, RunDetailWireSchema } from "../dashboard/run-detail.js";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  VersionBumpApplicationIdSchema,
  VersionPlanIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../../rules/identity/ids.js";
import { RunInputStorageSchema, RunStateSchema } from "../run/record.js";
import { VersionBumpChangeRecordSchema } from "./change-record.js";
import { ArchivedRunSectionsSchema } from "./sections.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { projectReceiptForOperator, RunEvidenceReceiptSchema } from "../trust/evidence.js";
import { WorkflowCodeSchema } from "../workflow/presentation.js";

/** The archive record's OWN schema generation, checked on read so an unknown one refuses by name. */
export const ArchiveSchemaGenerationSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type ArchiveSchemaGeneration = z.infer<typeof ArchiveSchemaGenerationSchema>;

/** The current archive generation: each generation freezes one more field and is read forward, never migrated. */
export const CURRENT_ARCHIVE_SCHEMA_GENERATION = 6;

/** What "the current version of this workflow" means, as a value. */
export const WorkflowVersionIdentitySchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
});
export type WorkflowVersionIdentity = z.infer<typeof WorkflowVersionIdentitySchema>;

/** The app build a run carries, read forward — the same union the live queue row serves. */
export const ArchivedAppVersionSchema = RunAppVersionSchema;
export type ArchivedAppVersion = z.infer<typeof ArchivedAppVersionSchema>;

/** Why a run is prior-version: which of the three stamped facts moved. */
export const VersionDriftReasonSchema = z.enum([
  "descriptor-version",
  "contract-fingerprint",
  "app-version",
  "app-version-unstamped",
]);
export type VersionDriftReason = z.infer<typeof VersionDriftReasonSchema>;

/** A non-terminal prior-version run the bump must show; `runState` is the authority fact, not a queue status. */
export const VersionBumpBlockerSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  runState: RunStateSchema,
  title: z.string().min(1),
  enqueuedAt: IsoInstantSchema,
  drift: z.array(VersionDriftReasonSchema).min(1),
}).superRefine((blocker, context) => {
  if (blocker.runState === "terminal") {
    context.addIssue({
      code: "custom",
      path: ["runState"],
      message: "a terminal run is archivable, not a blocker",
    });
  }
});
export type VersionBumpBlocker = z.infer<typeof VersionBumpBlockerSchema>;

/** A prior-version run the bump WOULD archive. */
export const VersionBumpCandidateSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  title: z.string().min(1),
  enqueuedAt: IsoInstantSchema,
  drift: z.array(VersionDriftReasonSchema).min(1),
});
export type VersionBumpCandidate = z.infer<typeof VersionBumpCandidateSchema>;

// Read older generations; never write them as current records.
function refineChangeRecordGeneration(
  record: Readonly<{ archiveSchemaGeneration: number; changeRecord?: unknown }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration >= 2 && record.changeRecord === undefined) {
    context.addIssue({
      code: "custom",
      path: ["changeRecord"],
      message: "a version bump at generation 2 or later must carry charter §25's change record "
        + "(what, why, kind, commit); an absent one means generation 1",
    });
  }
  if (record.archiveSchemaGeneration === 1 && record.changeRecord !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["archiveSchemaGeneration"],
      message: "a generation-1 version bump predates the change record and cannot carry one",
    });
  }
}

// Apply rechecks authority and registry; reviewed plans cannot authorize drift.
export const VersionBumpPlanSchema = z.strictObject({
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  versionPlanId: VersionPlanIdSchema,
  scope: VersionScopeSchema,
  targetVersion: SemverSchema,
  changeFingerprint: FingerprintSchema,
  /** The running app build at planning time — never the operator's claim. */
  observedAppVersion: AppVersionSchema,
  /** Every workflow the scope reaches, with the identity it currently has. */
  observedIdentities: z.array(WorkflowVersionIdentitySchema).min(1),
  candidates: z.array(VersionBumpCandidateSchema),
  blockers: z.array(VersionBumpBlockerSchema),
    /** Charter §25's change record, bound to the generation: a plan minted before generation 2 carries none. */
  changeRecord: VersionBumpChangeRecordSchema.optional(),
  plannedBy: ActorIdSchema,
  plannedAt: IsoInstantSchema,
}).superRefine((plan, context) => {
  refineChangeRecordGeneration(plan, context);
    // A minor bump archives nothing and cannot be blocked: a minor plan listing either is a
    // stored contradiction — refused at the boundary, not merely ignored later.
  if (plan.changeRecord?.kind === "minor" && plan.candidates.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["candidates"],
      message: "a minor bump archives nothing; a minor plan may not list archive candidates",
    });
  }
  if (plan.changeRecord?.kind === "minor" && plan.blockers.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["blockers"],
      message: "a minor bump cannot be blocked; a minor plan may not list blockers",
    });
  }
  const ids = plan.observedIdentities.map((identity) => identity.workflowId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["observedIdentities"], message: "a workflow appears twice in one plan" });
  }
  const overlap = new Set(plan.candidates.map((candidate) => candidate.runId));
  for (const blocker of plan.blockers) {
    if (overlap.has(blocker.runId)) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: `run ${blocker.runId} is listed as both an archivable candidate and a blocker`,
      });
    }
  }
});
export type VersionBumpPlan = z.infer<typeof VersionBumpPlanSchema>;

/** The applied bump — what moved, when, by whom, and which runs left the active surfaces. */
export const VersionBumpApplicationSchema = z.strictObject({
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  applicationId: VersionBumpApplicationIdSchema,
  versionPlanId: VersionPlanIdSchema,
  scope: VersionScopeSchema,
  targetVersion: SemverSchema,
  changeFingerprint: FingerprintSchema,
  appliedAppVersion: AppVersionSchema,
  /** Re-derived inside the applying transaction, never copied from the plan. */
  appliedIdentities: z.array(WorkflowVersionIdentitySchema).min(1),
  archivedRunIds: z.array(RunIdSchema),
  /** Copied from the reviewed plan VERBATIM — never re-authored at apply. */
  changeRecord: VersionBumpChangeRecordSchema.optional(),
  appliedBy: ActorIdSchema,
  appliedAt: IsoInstantSchema,
}).superRefine((application, context) => {
  refineChangeRecordGeneration(application, context);
    // A minor application that swept runs is a recorded contradiction: the archive's own record
    // would say a minor bump did the one thing a minor bump cannot do.
  if (application.changeRecord?.kind === "minor" && application.archivedRunIds.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["archivedRunIds"],
      message: "a minor bump archives nothing; a minor application may not record archived runs",
    });
  }
});
export type VersionBumpApplication = z.infer<typeof VersionBumpApplicationSchema>;

/** Evidence pointers, never copies: the archive names the bytes so a receipt can still be walked. */
export const ArchivedEvidencePointersSchema = z.strictObject({
  artifactIds: z.array(ArtifactIdSchema),
  checkpointNodeIds: z.array(NodeIdSchema),
  writeIntentIds: z.array(WriteIntentIdSchema),
    /* The ledger is never archived; these name lines that stay in place, and `sequence` is the ledger's own zero-based per-partition `seq`. */
  ledgerPartitions: z.array(LedgerLinePointerSchema),
});
export type ArchivedEvidencePointers = z.infer<typeof ArchivedEvidencePointersSchema>;

/** ONE archived run, self-contained; `row` and `detail` are the exact wire payloads the live surfaces last rendered, frozen. */
const ArchivedRunContentFields = {
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  runId: RunIdSchema,
  applicationId: VersionBumpApplicationIdSchema,
  workflowId: WorkflowIdSchema,
    /* The workflow's operator-facing label, frozen at archive time; a retired workflow has none, and says so. */
  workflowLabel: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
    /* The workflow's SHORT CODE, frozen beside the label; optional for reading only, and bound to the generation for writers. */
  workflowCode: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: WorkflowCodeSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]).optional(),
  traceId: TraceIdSchema,
  /** The identity that made it prior-version, retained verbatim. */
  archivedIdentity: WorkflowVersionIdentitySchema,
  appVersion: ArchivedAppVersionSchema,
  drift: z.array(VersionDriftReasonSchema).min(1),
  archivedAt: IsoInstantSchema,
  archivedBy: ActorIdSchema,
  row: ArchivedQueueSurfaceStorageSchema,
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
    /* The frozen section payloads, bound to `archiveSchemaGeneration`: absent means generation 1, which predates the block. */
  sections: ArchivedRunSectionsSchema.optional(),
    /* The archived immutable input; relaunch replans from `raw` through today's schemas, never from `parsed`. */
  input: RunInputStorageSchema,
} as const;

// Read generations forward; reject section payloads inconsistent with their generation.
function refineSectionGeneration(
  record: Readonly<{ archiveSchemaGeneration: number; sections?: unknown }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration >= 2 && record.sections === undefined) {
    context.addIssue({
      code: "custom",
      path: ["sections"],
      message: "an archive record at generation 2 or later must carry its frozen sections; "
        + "an absent block means generation 1, and a record that could not freeze them must refuse, not shrink",
    });
  }
  if (record.archiveSchemaGeneration === 1 && record.sections !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["archiveSchemaGeneration"],
      message: "a generation-1 archive record predates the frozen sections and cannot carry them",
    });
  }
}

// Resolve code and label together; their presence states must agree.
function refineCodeGeneration(
  record: Readonly<{
    archiveSchemaGeneration: number;
    workflowLabel: { state: string };
    workflowCode?: { state: string };
  }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration >= 3 && record.workflowCode === undefined) {
    context.addIssue({
      code: "custom",
      path: ["workflowCode"],
      message: "an archive record at generation 3 or later must carry the workflow's frozen short code; "
        + "an absent field means generation 1 or 2, and a record that could not resolve one says so with a reason",
    });
    return;
  }
  if (record.archiveSchemaGeneration < 3 && record.workflowCode !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["archiveSchemaGeneration"],
      message: "a pre-generation-3 archive record predates the frozen short code and cannot carry one",
    });
    return;
  }
  if (record.workflowCode !== undefined && record.workflowCode.state !== record.workflowLabel.state) {
    context.addIssue({
      code: "custom",
      path: ["workflowCode"],
      message: "the frozen short code and the frozen label come from ONE registry lookup, so they must be "
        + `present or absent together; label is ${record.workflowLabel.state} and code is ${record.workflowCode.state}`,
    });
  }
}

/** Every generation-4-or-later record must freeze the session arm. */
function refineSessionGeneration(
  record: Readonly<{ archiveSchemaGeneration: number; row: { session?: unknown } }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration >= 4 && record.row.session === undefined) {
    context.addIssue({
      code: "custom",
      path: ["row", "session"],
      message: "an archive record at generation 4 or later must carry the frozen QueueSurface session arm; "
        + "an absent key means the row predates the frozen session arm",
    });
  }
}

/** Current archive writes must freeze the combined log rows. */
function refineObservedLogGeneration(
  record: Readonly<{ archiveSchemaGeneration: number; sections?: unknown }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration < 5 || record.sections === undefined) return;
  const sections = ArchivedRunSectionsSchema.safeParse(record.sections);
  if (!sections.success) return;
  if (sections.data.logs.state !== "present") {
    context.addIssue({
      code: "custom",
      path: ["sections", "logs"],
      message: "an archive record at generation 5 or later must freeze the combined logs snapshot; "
        + "logs.state='absent' means no snapshot was frozen",
    });
    return;
  }
  if (sections.data.logs.value.rows === undefined) {
    context.addIssue({
      code: "custom",
      path: ["sections", "logs", "value", "rows"],
      message: "an archive record at generation 5 or later must freeze combined observed-log rows; an absent key means it predates combined observed-log rows",
    });
  }
}

/** Generation 6 may never freeze a pre-hardening receipt as present. */
function refineDiagnosticSafetyGeneration(
  record: Readonly<{
    archiveSchemaGeneration: number;
    receipt: { state: string; value?: { composition?: number } };
  }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration < 6 || record.receipt.state !== "present") return;
  if (record.receipt.value?.composition !== 3 && record.receipt.value?.composition !== 4 && record.receipt.value?.composition !== 5) {
    context.addIssue({
      code: "custom",
      path: ["receipt"],
      message: "an archive at generation 6 or later may present only receipt composition 3/4/5; "
        + "immutable composition 1/2 evidence must be stored through the named absent arm",
    });
  }
}

function refineArchivedIdentity(
  record: Readonly<{
    runId: string;
    traceId: string;
    archiveSchemaGeneration: number;
    sections?: unknown;
    workflowLabel: { state: string };
    workflowCode?: { state: string };
    row: { runId: string; traceId: string; session?: unknown };
    detail: { runId: string };
    receipt: { state: string; value?: { composition?: number } };
  }>,
  context: z.RefinementCtx,
): void {
  refineSectionGeneration(record, context);
  refineCodeGeneration(record, context);
  refineSessionGeneration(record, context);
  refineObservedLogGeneration(record, context);
  refineDiagnosticSafetyGeneration(record, context);
  if (record.row.runId !== record.runId) {
    context.addIssue({ code: "custom", path: ["row", "runId"], message: "archived row identity must match the record" });
  }
  if (record.detail.runId !== record.runId) {
    context.addIssue({ code: "custom", path: ["detail", "runId"], message: "archived detail identity must match the record" });
  }
  if (record.row.traceId !== record.traceId) {
    context.addIssue({ code: "custom", path: ["row", "traceId"], message: "archived row trace must match the record" });
  }
}

/** The archived record minus its own digest — a fixed point. */
export const ArchivedRunContentSchema = z.strictObject(ArchivedRunContentFields).superRefine(refineArchivedIdentity);
export type ArchivedRunContent = z.infer<typeof ArchivedRunContentSchema>;

/** ONE archived run, self-contained; the Archive renders `row` and `detail` through the same components as a live run. */
export const ArchivedRunRecordSchema = z.strictObject({
  ...ArchivedRunContentFields,
  /** SHA-256 over every field above; the `archiveFingerprint` a relaunch cites. */
  contentDigest: FingerprintSchema,
}).superRefine(refineArchivedIdentity);
export type ArchivedRunRecord = z.infer<typeof ArchivedRunRecordSchema>;

/** Relaunch provenance — insert-only and keyed by the FRESH run. */
export const ArchiveRelaunchRecordSchema = z.strictObject({
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  runId: RunIdSchema,
  archivedRunId: RunIdSchema,
  /** The identity the FRESH run was planned against — the current one. */
  relaunchedIdentity: WorkflowVersionIdentitySchema,
  relaunchedBy: ActorIdSchema,
  relaunchedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.runId === record.archivedRunId) {
    context.addIssue({
      code: "custom",
      path: ["runId"],
      message: "a relaunch is a fresh run; it can never carry the archived run's identity",
    });
  }
});
export type ArchiveRelaunchRecord = z.infer<typeof ArchiveRelaunchRecordSchema>;

/* ── content identity ────────────────────────────────────────────────────── */

/** `archiveFingerprint` — a relaunch cites it, and the kernel refuses a citation that does not match the bytes it reads. */
export function archivedRunContentDigest(content: ArchivedRunContent): string {
  const parsed = ArchivedRunContentSchema.parse(content);
  return sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify(archivedReferenceContent(parsed))}`);
}

/** Bind the complete permitted projection; historical diagnostic blobs have no safe provenance. */
function archivedReferenceContent(content: ArchivedRunContent): JsonValue {
  const bindings = retainedRunProtectedBindings({ envelope: { workflow: content.workflowId }, input: content.input });
  if (!bindings.some(({ inputPath }) => inputPath !== "timekeeperName")) return valueFreeProtectedData(content, bindings);
  const withheld = { state: "withheld-protected-input" };
  const receipt = content.receipt.state === "present" ? projectReceiptForOperator(content.receipt.value) : content.receipt;
  return valueFreeProtectedData({ ...content,
    row: { ...content.row, title: withheld, subtitle: withheld, facts: withheld, liveMessage: withheld,
      warnings: withheld },
    detail: { ...content.detail, header: { ...content.detail.header, title: withheld } },
    receipt, failure: withheld, ...(content.sections === undefined ? {} : { sections: withheld }),
  }, bindings);
}

/** Check the content seal before citation; repository reads separately authenticate new private input. */
export function archivedRunReferenceFingerprint(record: ArchivedRunRecord): z.infer<typeof FingerprintSchema> {
  const { contentDigest, ...content } = ArchivedRunRecordSchema.parse(record);
  if (!authenticArchivedRunContent(content, contentDigest)) throw new Error("archive content integrity mismatch");
  const bindings = retainedRunProtectedBindings({ envelope: { workflow: record.workflowId }, input: record.input });
  if (bindings.length === 0) return record.contentDigest;
  return FingerprintSchema.parse(sha256Hex(`hrauto:archived-run-reference:v1\0${canonicalJsonStringify(archivedReferenceContent(content))}`));
}

/** Verify the safe seal or historical raw seal; new private input also requires repository comparison. */
export function authenticArchivedRunContent(content: ArchivedRunContent, digest: string): boolean {
  return archivedRunContentDigest(content) === digest
    || sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify(ArchivedRunContentSchema.parse(content))}`) === digest;
}

// Apply must cite the exact plan the operator reviewed.
export function versionBumpPlanFingerprint(plan: VersionBumpPlan): string {
  return sha256Hex(`hrauto:version-bump-plan:v1\0${canonicalJsonStringify(VersionBumpPlanSchema.parse(plan))}`);
}

/** Which of the stamped facts moved, if any; an empty result means the run is current-version. */
export function versionDrift(
  run: Readonly<{
    descriptorVersion: number;
    contractFingerprint: string;
    appVersion: string | undefined;
  }>,
  current: WorkflowVersionIdentity,
  expectedAppVersion: string | undefined,
): readonly VersionDriftReason[] {
  const reasons: VersionDriftReason[] = [];
  if (run.descriptorVersion !== current.descriptorVersion) reasons.push("descriptor-version");
  if (run.contractFingerprint !== current.contractFingerprint) reasons.push("contract-fingerprint");
  if (expectedAppVersion !== undefined) {
    if (run.appVersion === undefined) reasons.push("app-version-unstamped");
    else if (run.appVersion !== expectedAppVersion) reasons.push("app-version");
  }
  return Object.freeze(reasons);
}

/** Separately bound enrichment; never part of the released archive content digest. */
export const ArchivedTransactionsSchema = z.strictObject({
  version: z.literal(1), runId: RunIdSchema, contentDigest: FingerprintSchema,
  capturedAt: IsoInstantSchema,
  lines: z.array(ResolvedLedgerLineWireSchema),
  eventIds: z.array(z.uuid()),
  sourceDigests: z.array(FingerprintSchema),
});
export type ArchivedTransactions = z.infer<typeof ArchivedTransactionsSchema>;
