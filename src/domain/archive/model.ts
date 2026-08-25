/**
 * The archive model — charter §25 / ref dashboard-surfaces §10.2 (D80), as-built by D179.
 *
 * **No archive folders; the archive is durable, self-contained DATA.** A
 * descriptor carries a version plus a build-derived `contractFingerprint`, and
 * every run permanently stamps the workflow version, that fingerprint, and the
 * app build it was enqueued under. When any of the three moves, the runs that
 * carry the old triple are no longer interpretable against current code, so
 * they leave every active surface and move to a read-only Archive.
 *
 * The rule that makes this pay for itself is that an archived run is stored as
 * its FINAL PROJECTED ROW plus its detail, receipt, failure and evidence
 * POINTERS. Rendering one therefore needs no descriptor, no old-version code,
 * no shim and no version fallback — which is why `archive-invariants` reads a
 * stored record back with the workflow registry emptied. An archive that
 * needed the old code to read would recreate the exact coupling the rebuild
 * exists to remove.
 *
 * Three things are deliberately NOT here:
 *
 * - **The ledger.** What was filed in a real HR system stays in
 *   `.tracker-rebuild/ledger/` forever, byte-identical, independent of run
 *   archival. Archiving is a *display* lifecycle; the ledger is an *audit*
 *   one, and nothing in this module can name a ledger file.
 * - **A resume path.** Relaunch mints a FRESH run on the CURRENT version from
 *   the archived immutable RAW input, re-parsed through today's schemas. A
 *   resume across a fingerprint change is what D35 forbids.
 * - **Any way to archive a non-terminal run.** Blockers are computed inside
 *   the same authority transaction that would archive, and a single one
 *   refuses the whole bump — an unresolved possible-submit is never buried.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { SemverSchema, VersionScopeSchema } from "../commands.js";
import { AppVersionSchema, RunAppVersionSchema } from "../dashboard/primitives.js";
import { ArchivedQueueSurfaceStorageSchema } from "../dashboard/projection.js";
import { FailureDetailWireSchema, RunDetailWireSchema } from "../dashboard/run-detail.js";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  VersionBumpApplicationIdSchema,
  VersionPlanIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../ids.js";
import { RunInputStorageSchema, RunStateSchema } from "../run/record.js";
import { VersionBumpChangeRecordSchema } from "./change-record.js";
import { ArchivedRunSectionsSchema } from "./sections.js";
import { sha256Hex } from "../sha256.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";
import { WorkflowCodeSchema } from "../workflow/presentation.js";

/**
 * The archive record's OWN schema generation. It is bound into every stored
 * record and checked on read: a reader that met a generation it does not
 * implement refuses by name instead of parsing an older shape through a newer
 * schema and reporting the difference as data.
 */
export const ArchiveSchemaGenerationSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type ArchiveSchemaGeneration = z.infer<typeof ArchiveSchemaGenerationSchema>;

/**
 * Generation 2 is D223: the archived record FREEZES its section payloads
 * (`sections` below) beside the row it already froze.
 *
 * The bump is read-forward in D133's exact sense and NOT a migration. Nothing
 * on disk moves: `archived_runs` stores the record as JSON, generation-1 rows
 * keep parsing (the new block is optional and the union admits their
 * generation), and their `contentDigest` stays byte-identical because
 * canonical JSON omits an absent key. What the generation buys is the thing an
 * optional field alone cannot say — a WRITER may not adopt the read-forward
 * shape (§`refineSectionGeneration`), so a record that names no sections is
 * unambiguously one written before they existed rather than one this build
 * failed to freeze.
 *
 * Generation 3 is D242: the record freezes the workflow's SHORT CODE beside the
 * label it already froze, for the same reason and by the same rules. The
 * archive index prints `sd v1` where it printed `Separation Documents v1`, and
 * resolving that code from the live registry when the Archive renders would be
 * a descriptor read on the archived path — the exact coupling charter §25
 * forbids, and the one the frozen label exists to avoid. Read-forward again:
 * a generation-1 or -2 record carries no `workflowCode` key, keeps parsing, and
 * keeps its byte-identical `contentDigest`; a WRITER may not produce one,
 * because a new record that named no code would be indistinguishable from a
 * record written before codes were frozen.
 *
 * Generation 4 is D269: the frozen QueueSurface requires its `session` arm.
 * Generation-1/2/3 rows may omit that key or carry it because generation 3 was
 * the current writer when the live QueueSurface wire first required the arm.
 * Readers add an honest absence only when the stored row omits it, never
 * changing the stored record or its digest. A generation-4 writer must freeze
 * the live row's required arm.
 */
export const CURRENT_ARCHIVE_SCHEMA_GENERATION = 4;

/** What "the current version of this workflow" means, as a value. */
export const WorkflowVersionIdentitySchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
});
export type WorkflowVersionIdentity = z.infer<typeof WorkflowVersionIdentitySchema>;

/**
 * The app build a run carries, read forward — the SAME union the live queue
 * row serves, so an archived row and a live one cannot describe the same fact
 * two ways.
 */
export const ArchivedAppVersionSchema = RunAppVersionSchema;
export type ArchivedAppVersion = z.infer<typeof ArchivedAppVersionSchema>;

/**
 * Why a run is prior-version. A bump that could not say which of the three
 * facts moved would leave the operator guessing whether they changed a
 * descriptor or shipped a dashboard.
 */
export const VersionDriftReasonSchema = z.enum([
  "descriptor-version",
  "contract-fingerprint",
  "app-version",
  "app-version-unstamped",
]);
export type VersionDriftReason = z.infer<typeof VersionDriftReasonSchema>;

/**
 * A non-terminal prior-version run. This is the list charter §25 requires the
 * bump flow to SHOW: "an unresolved possible-submit is never buried in an
 * archive". `runState` is the authority fact, not a queue status, because what
 * the operator must do differs per state — cancel a queued run, resolve a
 * `parked-write`.
 */
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

/**
 * The change record and the generation are one fact stated twice, exactly as
 * the archived record's sections are — and for the same reason. A reader must
 * admit a generation-1 plan (it is on disk and nothing may invent a `why` for
 * it); a writer may not produce one, or "nobody wrote a reason" and "this plan
 * predates reasons" would be the same row.
 */
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

/**
 * The immutable, reviewable plan (D95: `plan-version-bump`). It records what
 * the registry looked like when it was made; `apply` re-derives candidates and
 * blockers from authority at apply time and refuses if the registry has since
 * DRIFTED from what this plan observed. The run sets below are the operator's
 * review copy, never the apply-time authority.
 */
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
  /**
   * Charter §25's change record, authored by whoever made the change. Optional
   * and bound to the generation for the same read-forward reason the archived
   * record's sections are: a plan minted before generation 2 carries none and
   * says so, and a plan minted NOW may not omit it.
   */
  changeRecord: VersionBumpChangeRecordSchema.optional(),
  plannedBy: ActorIdSchema,
  plannedAt: IsoInstantSchema,
}).superRefine((plan, context) => {
  refineChangeRecordGeneration(plan, context);
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

/**
 * The applied bump — charter §25's "change record": what moved, when, by whom,
 * and exactly which runs left the active surfaces because of it.
 */
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
}).superRefine(refineChangeRecordGeneration);
export type VersionBumpApplication = z.infer<typeof VersionBumpApplicationSchema>;

/**
 * Evidence POINTERS, never copies. The content-addressed bytes, the ledger
 * lines and the checkpoint rows all stay exactly where they are; the archive
 * names them so an archived receipt can still be walked, and so a retention
 * sweep can see that an archived run still holds a reference.
 */
export const ArchivedEvidencePointersSchema = z.strictObject({
  artifactIds: z.array(ArtifactIdSchema),
  checkpointNodeIds: z.array(NodeIdSchema),
  writeIntentIds: z.array(WriteIntentIdSchema),
  /**
   * The ledger is NEVER archived; these name lines that stay in place.
   *
   * `sequence` is the ledger's own `seq`, which is ZERO-based per partition —
   * the first line a system files on a day is sequence 0. It was declared
   * positive while nothing populated the field, so no stored record carries a
   * pointer under the old bound; a first line would simply have been refused.
   */
  ledgerPartitions: z.array(z.strictObject({
    system: z.string().min(1),
    date: z.iso.date(),
    sequence: NonNegativeIntSchema,
  })),
});
export type ArchivedEvidencePointers = z.infer<typeof ArchivedEvidencePointersSchema>;

/**
 * ONE archived run, self-contained.
 *
 * `row` and `detail` are the exact wire payloads the live surfaces last
 * rendered, frozen. That is deliberate and it is what ref dashboard-surfaces §10.2 asks for
 * ("its final projected row"): the Archive renders them through the SAME
 * components, so there is exactly one rendering path and no branch anywhere
 * asks which version a run was.
 */
const ArchivedRunContentFields = {
  archiveSchemaGeneration: ArchiveSchemaGenerationSchema,
  runId: RunIdSchema,
  applicationId: VersionBumpApplicationIdSchema,
  workflowId: WorkflowIdSchema,
  /**
   * The workflow's operator-facing label, FROZEN at archive time. Resolving it
   * from the live registry when the Archive renders would be a descriptor read
   * on the archived path — the exact coupling "zero old-version code paths"
   * forbids — and falling back to the id would substitute a plausible value
   * for one nobody recorded. A workflow already retired when the sweep ran has
   * no label, and says so.
   */
  workflowLabel: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  /**
   * The workflow's SHORT CODE, FROZEN at archive time beside the label
   * (ref workflow-model §1.1.1, D242). The index prints `<code> v<N>` as the row's leading
   * token, and every argument the frozen label makes applies unchanged: a
   * resolve at render time would be a descriptor read on the archived path,
   * and `traceId.slice(0, indexOf("-"))` would be a plausible-looking
   * derivation that is wrong for exactly the case this field exists for — a
   * run planned under a code the workflow has since changed.
   *
   * OPTIONAL for reading only. A record written before generation 3 carries no
   * key at all and says so through its generation; `refineCodeGeneration`
   * refuses a WRITER that tries to adopt the same shape.
   */
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
  /**
   * D223's frozen section payloads — the log lines, the data points with their
   * provenance, the member outcome rows, the described captures and the
   * per-attempt history. OPTIONAL, and bound to `archiveSchemaGeneration` by
   * `refineSectionGeneration`: absent means generation 1, which predates the
   * block. See `./sections.ts` for why every section is an absence union.
   */
  sections: ArchivedRunSectionsSchema.optional(),
  /**
   * The archived immutable input. Relaunch replans from `raw` through TODAY's
   * ingress and canonical schemas — never from `parsed`, which was validated
   * by a schema that has since moved.
   */
  input: RunInputStorageSchema,
} as const;

/**
 * The generation and the frozen sections are ONE fact stated twice, so they
 * are checked against each other in both directions.
 *
 * A reader may meet a generation-1 record and must read it forward. A WRITER
 * may not produce one: a new record that named no sections would be
 * indistinguishable from a historical one, and "this build could not freeze
 * the logs" would then be recorded as "this record predates logs" — a silent
 * downgrade on the record whose whole job is to be complete. The other
 * direction matters just as much: a record claiming generation 1 while
 * carrying sections would be describing bytes it does not hold.
 */
function refineSectionGeneration(
  record: Readonly<{ archiveSchemaGeneration: number; sections?: unknown }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration >= 2 && record.sections === undefined) {
    context.addIssue({
      code: "custom",
      path: ["sections"],
      message: "an archive record at generation 2 or later must carry its frozen sections (D223); "
        + "an absent block means generation 1, and a record that could not freeze them must refuse, not shrink",
    });
  }
  if (record.archiveSchemaGeneration === 1 && record.sections !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["archiveSchemaGeneration"],
      message: "a generation-1 archive record predates D223's frozen sections and cannot carry them",
    });
  }
}

/**
 * The frozen short code and the generation, checked against each other in both
 * directions — the same shape `refineSectionGeneration` uses, for the same
 * reason (D242).
 *
 * The second half also pins the code to the LABEL's own state. Both are
 * resolved from the ONE registry lookup the sweep performs, so a record
 * claiming a label and no code (or the reverse) would be describing a
 * half-resolved descriptor that cannot exist — and the surface reading it
 * would then print a code beside "workflow no longer registered", or a label
 * beside a blank token, either of which is a sentence nobody wrote.
 */
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
      message: "an archive record at generation 3 or later must carry the workflow's frozen short code (D242); "
        + "an absent field means generation 1 or 2, and a record that could not resolve one says so with a reason",
    });
    return;
  }
  if (record.archiveSchemaGeneration < 3 && record.workflowCode !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["archiveSchemaGeneration"],
      message: "a pre-generation-3 archive record predates D242's frozen short code and cannot carry one",
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

/** D269 requires every generation-4-or-later record to freeze the session arm. */
function refineSessionGeneration(
  record: Readonly<{ archiveSchemaGeneration: number; row: { session?: unknown } }>,
  context: z.RefinementCtx,
): void {
  if (record.archiveSchemaGeneration >= 4 && record.row.session === undefined) {
    context.addIssue({
      code: "custom",
      path: ["row", "session"],
      message: "an archive record at generation 4 or later must carry the frozen QueueSurface session arm (D269); "
        + "an absent key means the row was archived before D269",
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
  }>,
  context: z.RefinementCtx,
): void {
  refineSectionGeneration(record, context);
  refineCodeGeneration(record, context);
  refineSessionGeneration(record, context);
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

/**
 * The archived record MINUS its own digest — a fixed point, exactly like the
 * build manifest excluding its own generated module.
 */
export const ArchivedRunContentSchema = z.strictObject(ArchivedRunContentFields).superRefine(refineArchivedIdentity);
export type ArchivedRunContent = z.infer<typeof ArchivedRunContentSchema>;

/**
 * ONE archived run, self-contained.
 *
 * `row` and `detail` are the exact wire payloads the live surfaces last
 * rendered, frozen. That is deliberate and it is what ref dashboard-surfaces §10.2 asks for
 * ("its final projected row"): the Archive renders them through the SAME
 * components, so there is exactly one rendering path and no branch anywhere
 * asks which version a run was.
 */
export const ArchivedRunRecordSchema = z.strictObject({
  ...ArchivedRunContentFields,
  /** SHA-256 over every field above; the `archiveFingerprint` a relaunch cites. */
  contentDigest: FingerprintSchema,
}).superRefine(refineArchivedIdentity);
export type ArchivedRunRecord = z.infer<typeof ArchivedRunRecordSchema>;

/**
 * Relaunch provenance — insert-only, keyed by the FRESH run. An archived run
 * may be relaunched more than once, and neither the archived record nor the
 * new run's envelope is rewritten to say so: the link is its own fact.
 */
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

/**
 * `archiveFingerprint` in ref frontend-backend-integration §5's "self-contained archived detail,
 * integrity". A relaunch cites it, and the kernel refuses a citation that does
 * not match the bytes it is about to read the input out of — a mismatched
 * digest means the operator is looking at a different record than the one
 * their command names.
 */
export function archivedRunContentDigest(content: ArchivedRunContent): string {
  return sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify(ArchivedRunContentSchema.parse(content))}`);
}

/**
 * `planFingerprint` — what `apply-version-bump` echoes back. The plan is
 * immutable, so this is a pure function of it; an apply that cites a different
 * fingerprint is applying a plan the operator did not review.
 */
export function versionBumpPlanFingerprint(plan: VersionBumpPlan): string {
  return sha256Hex(`hrauto:version-bump-plan:v1\0${canonicalJsonStringify(VersionBumpPlanSchema.parse(plan))}`);
}

/**
 * Whether `run`'s stamped identity is still the current one, and if not, which
 * of the three facts moved. An empty result means the run is current-version.
 *
 * `expectedAppVersion` is present only for a scope that bumps the app build;
 * a workflow-scope bump does not make a run prior-version merely because the
 * dashboard has been rebuilt since.
 */
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
