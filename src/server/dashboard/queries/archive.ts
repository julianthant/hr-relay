import type { RunRecordService } from "../../../core/run-record-service.js";
import { canonicalRunChildren, listCanonicalRuns } from "./canonical-runs.js";
import { requireCanonicalRun } from "./run-read.js";
import { deriveRunStatus } from "../run-status.js";
import { hasProtectedTransactionInput } from "../../../domain/protected-input.js";
import { archivedRunReferenceFingerprint, authenticArchivedRunContent } from "../../../domain/archive/model.js";
/**
 * The Archive read model and the version-bump state (D179; ref dashboard-surfaces §10.2, doc
 * ref frontend-backend-integration §5 "Archive + version bump", §3.6 `GET /api/v1/archive`).
 *
 * **Two halves with opposite rules, in one file so the difference is visible.**
 *
 * `buildArchivedRunDetail` reads ONE archived run and resolves NOTHING. No
 * descriptor or projection. Canonical read admits archive membership; the
 * stored record already holds the row, the detail, the receipt, the failure
 * and the evidence pointers, which is what "self-contained" means. Ref frontend-backend-integration §8
 * guard #11 checks it the only way that proves anything: by reading a record
 * back with the workflow registry emptied.
 *
 * `buildArchiveIndex` is the opposite by necessity — the version STATE a bump
 * would act on is a fact about the registry NOW, so it re-derives current
 * identities, candidates and blockers per request rather than reading them out
 * of a plan. A plan goes stale the moment a run is enqueued, and a surface
 * that showed the plan's copy would invite an operator to apply a sweep whose
 * blocker list they had already been shown as empty.
 *
 * `createArchiveSnapshotSource` is the kernel's seam: the final projected row,
 * detail and failure section for a run about to be archived, built by the SAME
 * production projections the live surfaces render, so the frozen bytes are the
 * bytes the operator last saw.
 */
import { z } from "zod";
import {
  ArchiveIndexWireSchema,
  ArchivedCaptureResourceWireSchema,
  ArchivedRunDetailWireSchema,
  type ArchiveIndexWire,
  type ArchivedCaptureResourceWire,
  type ArchivedRunDetailWire,
} from "../../../domain/dashboard/archive.js";
import type { Clock } from "../../../domain/clock.js";
import { VersionScopeSchema } from "../../../domain/commands.js";
import type { WorkflowVersionIdentity } from "../../../domain/archive/model.js";
import {
  ArchivedRunRecordSchema,
  CURRENT_ARCHIVE_SCHEMA_GENERATION,
  versionBumpPlanFingerprint,
} from "../../../domain/archive/model.js";
import { archiveRetention } from "../../../domain/archive/retention.js";
import type { LedgerReadThrough } from "../../../infra/ledger/ledger-read-through.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import {
  assessVersionBumpFromRuns,
  type ArchiveRunSnapshot,
  type ArchiveSnapshotSource,
} from "../../../services/archive/archive-service.js";
import {
  ArchivedRunSectionsSchema,
  ArchivedProjectionSectionsSchema,
  ArchivedRunAttemptSchema,
  type ArchivedRunSections,
  type ArchivedProjectionSections,
  type ArchivedRunAttempt,
} from "../../../domain/archive/sections.js";
import {
  FailureDetailWireSchema,
  NotePageSchema,
  PeoplePageSchema,
  type ContextDataSectionWire,
} from "../../../domain/dashboard/run-detail.js";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../domain/dashboard/projection.js";
import { projectReceiptForOperator, type RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../domain/artifacts.js";
import { ArtifactIdSchema, RunIdSchema } from "../../../domain/ids.js";
import type {
  ServerVerifiedArtifactReader,
  VerifiedByteLease,
} from "../../../infra/artifacts/server-verified-artifact-reader.js";
import { VerifiedArtifactOperationalError } from "../../../infra/artifacts/server-verified-artifact-reader.js";
import {
  ArtifactBytesCorruptError,
  createArtifactVerificationPass,
  IndexedArtifactBytesMissingError,
  prepareVerifiedArtifactLease,
  verifyArtifactBytes,
} from "./artifact-bytes.js";

/** The frozen log page's own shape — one place, so the loop and the parse agree. */
type FrozenNotePage = z.infer<typeof NotePageSchema>;

/**
 * The archived run's frozen short code, for the index row and the detail
 * (D242). ONE implementation, because the two must never disagree about what
 * a record holds.
 *
 * Two absences reach here and they are DIFFERENT facts, so each keeps its own
 * sentence: the record predates generation 3 and holds no code at all, or the
 * sweep ran when the workflow was already unregistered and the record says so
 * itself. Neither is filled in — deriving one from the trace id's prefix would
 * look right and be wrong for a run planned under a code the workflow has
 * since changed, which is the only case a frozen field is for.
 */
function archivedWorkflowCode(
  record: Readonly<{
    archiveSchemaGeneration: number;
    workflowCode?: { state: "present"; value: string } | { state: "absent"; reason: string };
  }>,
): { state: "present"; value: string } | { state: "absent"; reason: string } {
  return record.workflowCode ?? {
    state: "absent",
    reason: `this record was archived at schema generation ${String(record.archiveSchemaGeneration)}, `
      + "which predates D242's frozen workflow short code; no code was recorded for this run",
  };
}

function legacyDiagnosticWithheldReason(archiveSchemaGeneration: number): string {
  return `archive schema generation ${String(archiveSchemaGeneration)} predates diagnostic safety v1; historical free text is withheld`;
}

function archivedWarningsForOperator(
  warnings: QueueSurfaceWire["warnings"],
  archiveSchemaGeneration: number,
  protectedInput = false,
): QueueSurfaceWire["warnings"] {
  if (protectedInput && archiveSchemaGeneration >= 6 && warnings.state === "present")
    return { state: "absent", reason: "protected archived detail withheld; private authority is unchanged" };
  return archiveSchemaGeneration >= 6
    ? warnings
    : { state: "absent", reason: legacyDiagnosticWithheldReason(archiveSchemaGeneration) };
}

function archivedQueueRow(
  row: Readonly<Record<string, unknown>> & { readonly session?: unknown },
  archiveSchemaGeneration: number,
): QueueSurfaceWire {
  const parsed = QueueSurfaceWireSchema.parse(row.session === undefined
    ? { ...row, session: { state: "absent", reason: "no session recorded (archived before D269)" } }
    : row);
  if (archiveSchemaGeneration >= 6) return parsed;
  const reason = legacyDiagnosticWithheldReason(archiveSchemaGeneration);
  return QueueSurfaceWireSchema.parse({
    ...parsed,
    facts: { state: "absent", reason },
    liveMessage: { state: "absent", reason },
    warnings: archivedWarningsForOperator(parsed.warnings, archiveSchemaGeneration),
  });
}

function archivedReceiptForOperator(
  receipt: Readonly<{ state: "present"; value: RunEvidenceReceipt } | { state: "absent"; reason: string }>,
): Readonly<{ state: "present"; value: RunEvidenceReceipt } | { state: "absent"; reason: string }> {
  if (receipt.state === "absent") return receipt;
  const projected = projectReceiptForOperator(receipt.value);
  return projected.state === "available"
    ? { state: "present", value: projected.value }
    : { state: "absent", reason: projected.reason };
}

function archivedFailureForOperator(
  failure: z.infer<typeof FailureDetailWireSchema>,
  archiveSchemaGeneration: number,
): z.infer<typeof FailureDetailWireSchema> {
  if (archiveSchemaGeneration >= 6) return failure;
  const page = failure.page === undefined
    ? undefined
    : {
      ...(failure.page.screen === undefined ? {} : { screen: failure.page.screen }),
      ...(failure.page.state === undefined ? {} : { state: failure.page.state }),
    };
  return FailureDetailWireSchema.parse({
    ...failure,
    summary: `${failure.code}: historical diagnostic text withheld (predates diagnostic safety v1)`,
    causeChain: failure.causeChain.map((cause) => ({
      ...cause,
      summary: `${cause.code}: historical ${cause.role} diagnostic text withheld`,
    })),
    remediation: failure.remediation.map((remediation) => ({
      ...remediation,
      message: `historical ${remediation.kind} text withheld; use the typed failure code and archived run state`,
    })),
    ...(page === undefined || Object.keys(page).length === 0 ? { page: undefined } : { page }),
  });
}

function archivedSectionsForOperator(
  sections: ArchivedRunSections,
  archiveSchemaGeneration: number,
): ArchivedRunSections {
  if (archiveSchemaGeneration >= 6 || sections.logs.state === "absent") return sections;
  const message = "historical note text withheld (predates diagnostic safety v1)";
  const page = sections.logs.value;
  const rows = page.rows?.map((row) => row.kind === "note"
    ? { ...row, note: { ...row.note, message } }
    : row);
  const notes = rows === undefined
    ? page.notes.map((note) => ({ ...note, message }))
    : rows.flatMap((row) => row.kind === "note" ? [row.note] : []);
  return ArchivedRunSectionsSchema.parse({
    ...sections,
    logs: {
      state: "present",
      value: NotePageSchema.parse({
        ...page,
        ...(rows === undefined ? {} : { rows }),
        notes,
      }),
    },
  });
}
import type { RunFoldRecord } from "../projectors/run-queue-projection.js";
import { buildRunDetail, buildRunSection, createRunNoteScanCache, type RunDetailQueryDeps } from "./run-detail.js";
import { TargetNotFoundError } from "../../failures.js";

export interface ArchiveQueryDeps {
  readonly reader: Pick<RunRecordService, "read" | "list">;
  readonly clock: Clock;
  readonly appVersion: string;
  /**
   * Read-only authority access. The Archive never mutates; a bump is a command
   * and goes through the one command path.
   */
  readonly authority: {
    withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  };
  /**
   * The registry, used ONLY for the version state — never on the archived
   * detail path. `list` is what an application-scope bump needs: charter §25's
   * "a dashboard update bumps the effective version of EVERY workflow".
   */
  readonly descriptors: {
    list(): readonly Readonly<{
      id: string;
      label: string;
      /** the SHORT CODE the version registry prints beside the label (D242) */
      code: string;
      version: number;
      contractFingerprint: string;
    }>[];
  };
  /**
   * Resolves an archived run's ledger pointers against the LIVE ledger. It is
   * a required dependency rather than an optional one on purpose: a reader
   * composed without it would serve an empty Write-ledger card on a run that
   * filed real HR transactions, which is the most dangerous empty state this
   * surface has.
   */
  readonly ledger: LedgerReadThrough;
}

function requireArchivedRun(reader: ArchiveQueryDeps["reader"], runId: string): void {
  const existence = reader.read(runId);
  if (existence.state !== "present" || existence.disposition !== "archived") {
    throw new TargetNotFoundError(`archived run ${runId} is ${existence.state === "present" ? existence.disposition : existence.state}`);
  }
}

/** The immutable archived capture reference, resolved without attachment or run lookups. */
export interface ArchivedCaptureLease {
  readonly ref: ArtifactRef;
  readonly lease: VerifiedByteLease;
}

/** Archive failures carry safe identity labels; never expose storage paths or raw schema values. */
export class ArchivedCaptureReadError extends Error {
  constructor(
    readonly code: "ARCHIVED_CAPTURE_CORRUPT" | "ARCHIVED_CAPTURE_BYTES_MISSING",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArchivedCaptureReadError";
  }
}

function frozenArchivedCaptureRef(
  deps: Pick<ArchiveQueryDeps, "authority" | "reader">,
  runIdInput: unknown,
  artifactIdInput: unknown,
): ArtifactRef {
  const runId = RunIdSchema.parse(runIdInput);
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  const corrupt = (detail: string, cause?: unknown): never => {
    throw new ArchivedCaptureReadError("ARCHIVED_CAPTURE_CORRUPT",
      `archived run ${runId} capture ${artifactId}: ${detail}`, { cause });
  };
  try {
    return deps.authority.withAuthorityTransaction((repositories) => {
      requireArchivedRun(deps.reader, runId);
      const input = repositories.archivedRuns.get(runId);
      if (input === undefined) throw new TargetNotFoundError(`archived run ${runId} does not exist`);
      const record = ArchivedRunRecordSchema.parse(input);
      if (record.runId !== runId) corrupt("foreign archived run identity");
      const { contentDigest, ...content } = record;
      if (!authenticArchivedRunContent(content, contentDigest)) corrupt("content digest mismatch");
      const captures = record.sections?.captures;
      if (captures?.state !== "present") {
        throw new TargetNotFoundError(`archived run ${runId} has no frozen capture metadata`);
      }
      const matches = captures.value.filter((candidate) => candidate.artifactId === artifactId);
      const tile = matches[0];
      if (tile === undefined) {
        throw new TargetNotFoundError(`archived run ${runId} has no frozen capture ${artifactId}`);
      }
      // A shared artifact may appear in several bundles, but its bytes cannot disagree.
      if (matches.some((candidate) => candidate.digest !== tile.digest
        || candidate.byteLength !== tile.byteLength || candidate.mediaType !== tile.mediaType)) {
        corrupt("conflicting frozen capture metadata");
      }
      /*
       * This is intentionally constructed only from the archived tile. Reading
       * the diagnostic attachment index (or a current run) could make an old
       * capture appear to be a newer object with the same id.
       */
      return Object.freeze(ArtifactRefSchema.parse({
        id: tile.artifactId,
        sha256: tile.digest,
        bytes: tile.byteLength,
        mediaType: tile.mediaType,
      }));
    });
  } catch (error: unknown) {
    if (error instanceof TargetNotFoundError || error instanceof ArchivedCaptureReadError) throw error;
    return corrupt("archived capture authority could not be verified", error);
  }
}

/**
 * Prepares one single-use verified-byte lease only after binding its ref to the
 * exact archived tile. The HTTP response owns disposal after this function returns.
 */
export async function prepareArchivedCaptureLease(
  deps: Pick<ArchiveQueryDeps, "authority" | "reader"> & {
    readonly artifactReader: ServerVerifiedArtifactReader;
  },
  runIdInput: unknown,
  artifactIdInput: unknown,
  signal?: AbortSignal,
): Promise<ArchivedCaptureLease> {
  const ref = frozenArchivedCaptureRef(deps, runIdInput, artifactIdInput);
  try {
    return Object.freeze({
      ref,
      lease: await prepareVerifiedArtifactLease(deps.artifactReader, ref, signal),
    });
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    if (error instanceof VerifiedArtifactOperationalError) throw error;
    if (error instanceof IndexedArtifactBytesMissingError) {
      throw new ArchivedCaptureReadError("ARCHIVED_CAPTURE_BYTES_MISSING",
        `archived run ${String(runIdInput)} capture ${ref.id}: stored bytes are missing`, { cause: error });
    }
    if (error instanceof ArtifactBytesCorruptError) {
      throw new ArchivedCaptureReadError("ARCHIVED_CAPTURE_CORRUPT",
        `archived run ${String(runIdInput)} capture ${ref.id}: stored bytes could not be verified`, { cause: error });
    }
    throw error;
  }
}

/**
 * The metadata is already frozen in the archive detail. This is a separate
 * read-time resource state so neither a deadline nor a policy can overwrite
 * what the archived capture was.
 */
export async function buildArchivedCaptureResource(
  deps: Pick<ArchiveQueryDeps, "authority" | "reader"> & {
    readonly artifactReader: ServerVerifiedArtifactReader;
  },
  runIdInput: unknown,
  artifactIdInput: unknown,
  signal?: AbortSignal,
): Promise<ArchivedCaptureResourceWire> {
  const runId = RunIdSchema.parse(runIdInput);
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  const ref = frozenArchivedCaptureRef(deps, runId, artifactId);
  try {
    await verifyArtifactBytes(
      deps.artifactReader,
      ref,
      createArtifactVerificationPass(deps.artifactReader, signal),
    );
    return ArchivedCaptureResourceWireSchema.parse({
      runId,
      artifactId,
      resource: {
        state: "available",
        downloadUrl: `/artifacts/v1/archive/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}`,
      },
    });
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    if (error instanceof VerifiedArtifactOperationalError) throw error;
    if (error instanceof IndexedArtifactBytesMissingError) {
      return ArchivedCaptureResourceWireSchema.parse({
        runId,
        artifactId,
        resource: { state: "missing", reason: "The archived capture's stored bytes are no longer present." },
      });
    }
    if (error instanceof ArtifactBytesCorruptError) {
      return ArchivedCaptureResourceWireSchema.parse({
        runId,
        artifactId,
        resource: { state: "error", message: "The archived capture bytes could not be verified." },
      });
    }
    throw error;
  }
}

export function buildArchiveIndex(deps: ArchiveQueryDeps): ArchiveIndexWire {
  const registered = deps.descriptors.list();
  return deps.authority.withAuthorityTransaction((repositories) => {
    const currentIdentity = (workflowId: string): WorkflowVersionIdentity | undefined => {
      const descriptor = registered.find((entry) => entry.id === workflowId);
      if (descriptor === undefined) return undefined;
      return {
        workflowId: descriptor.id,
        descriptorVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
      } as WorkflowVersionIdentity;
    };

    const liveRuns = listCanonicalRuns(deps.reader, "live");
    const versionState = registered.map((descriptor) => {
      const assessment = assessVersionBumpFromRuns(
        { runs: liveRuns, currentIdentity, appVersion: deps.appVersion },
        VersionScopeSchema.parse({ kind: "workflows", workflowIds: [descriptor.id] }),
      );
      return {
        workflowId: descriptor.id,
        workflowLabel: descriptor.label,
        workflowCode: descriptor.code,
        current: {
          workflowId: descriptor.id,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
        },
        archivable: assessment.candidates.length,
        blockers: assessment.blockers,
      };
    });

    const canonical = listCanonicalRuns(deps.reader, "archived");
    const archived = canonical.map((run) => {
      const frozen = repositories.archivedRuns.get(run.envelope.runId);
      if (frozen === undefined) throw new Error("canonical archived run has no frozen archive record");
      return { record: frozen, run };
    });
    return ArchiveIndexWireSchema.parse({
      wireVersion: 1,
      archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
      generatedAt: deps.clock.now().toISOString(),
      currentAppVersion: deps.appVersion,
      entries: archived.map(({ record, run }) => ({
        runId: record.runId,
        traceId: record.traceId,
        workflowId: record.workflowId,
        workflowLabel: record.workflowLabel.state === "present"
          ? record.workflowLabel.value
          : record.workflowId,
        workflowCode: archivedWorkflowCode(record),
        title: hasProtectedTransactionInput({ envelope: { workflow: record.workflowId }, input: record.input })
          ? "Protected test subject" : record.row.title,
        status: deriveRunStatus(run),
        archivedIdentity: record.archivedIdentity,
        appVersion: record.appVersion,
        drift: record.drift,
        startedAt: record.row.startedAt,
        endedAt: record.row.endedAt,
        archivedAt: record.archivedAt,
        applicationId: record.applicationId,
        // Copied off the FROZEN row, never re-derived: the index and the
        // detail must name the same instances, and the detail reads `row`.
        resolvedInstances: record.row.resolvedInstances,
        // The same copy, for the same reason. Both facts are already in this
        // record — the detail has drawn them since D179 — so serving them on
        // the index adds no authority read and cannot diverge from the run's
        // own page.
        dryRun: record.row.dryRun,
        warnings: archivedWarningsForOperator(record.row.warnings, record.archiveSchemaGeneration,
          hasProtectedTransactionInput({ envelope: { workflow: record.workflowId }, input: record.input })),
        archiveFingerprint: archivedRunReferenceFingerprint(record),
      })),
      sweeps: repositories.versionBumpApplications.list().map((application) => ({
        applicationId: application.applicationId,
        versionPlanId: application.versionPlanId,
        scope: application.scope,
        targetVersion: application.targetVersion,
        appliedAppVersion: application.appliedAppVersion,
        appliedIdentities: application.appliedIdentities,
        appliedBy: application.appliedBy,
        appliedAt: application.appliedAt,
        archivedCount: application.archivedRunIds.length,
        changeRecord: application.changeRecord === undefined
          ? {
            state: "absent",
            reason: "this sweep was applied before charter §25's change record was collected; nobody was "
              + "asked what moved or why, and neither is reconstructible",
          }
          : { state: "present", value: application.changeRecord },
        /*
         * Derived from the ARCHIVED RECORDS' own frozen identities rather than
         * from the plan: the plan's `observedIdentities` are the versions the
         * bump moves TO, and the question "from what" is answered by what the
         * swept runs were actually carrying. A sweep that archived nothing has
         * no from-version, and an empty list is that fact — there is no run to
         * read one off.
         */
        fromVersions: [...new Set(
          archived
            .filter(({ record }) => record.applicationId === application.applicationId)
            .map(({ record }) => record.archivedIdentity.descriptorVersion),
        )].sort((left, right) => left - right),
      })),
      versionState,
      plans: repositories.versionPlans.list().map((row) => ({
        versionPlanId: row.versionPlanId,
        expectedVersion: row.version,
        planFingerprint: versionBumpPlanFingerprint(row.plan),
        scope: row.plan.scope,
        targetVersion: row.plan.targetVersion,
        changeFingerprint: row.plan.changeFingerprint,
        observedAppVersion: row.plan.observedAppVersion,
        observedIdentities: row.plan.observedIdentities,
        candidates: row.plan.candidates,
        blockers: row.plan.blockers,
        changeRecord: row.plan.changeRecord === undefined
          ? {
            state: "absent",
            reason: "this plan was minted before charter §25's change record was collected",
          }
          : { state: "present", value: row.plan.changeRecord },
        plannedBy: row.plan.plannedBy,
        plannedAt: row.plan.plannedAt,
        state: row.state,
      })),
    });
  });
}

export function buildArchivedRunDetail(deps: ArchiveQueryDeps, runIdInput: string): ArchivedRunDetailWire {
  const registered = deps.descriptors.list();
  return deps.authority.withAuthorityTransaction((repositories) => {
    requireArchivedRun(deps.reader, runIdInput);
    const record = repositories.archivedRuns.get(runIdInput);
    if (record === undefined) {
      throw new TargetNotFoundError(`archived run ${runIdInput} does not exist`);
    }
    /**
     * The ONLY registry read on this path, and it decides an AFFORDANCE, not
     * content: a relaunch starts a fresh run on the CURRENT version, so it is
     * unavailable when there is no current version to start. Everything the
     * page renders comes out of `record`.
     */
    const current = registered.find((entry) => entry.id === record.workflowId);
    const protectedArchive = hasProtectedTransactionInput({ envelope: { workflow: record.workflowId }, input: record.input });
    const protectedAbsence = { state: "absent" as const, reason: "protected archived detail withheld; private authority is unchanged" };
    const projectedRow = archivedQueueRow(record.row, record.archiveSchemaGeneration);

    return ArchivedRunDetailWireSchema.parse({
      wireVersion: 1,
      archiveSchemaGeneration: record.archiveSchemaGeneration,
      runId: record.runId,
      applicationId: record.applicationId,
      workflowId: record.workflowId,
      workflowLabel: record.workflowLabel.state === "present"
        ? record.workflowLabel.value
        : record.workflowId,
      workflowCode: archivedWorkflowCode(record),
      archivedIdentity: record.archivedIdentity,
      appVersion: record.appVersion,
      drift: record.drift,
      archivedAt: record.archivedAt,
      archivedBy: record.archivedBy,
      archiveFingerprint: archivedRunReferenceFingerprint(record),
      row: protectedArchive ? { ...projectedRow, title: "Protected test subject", subtitle: protectedAbsence,
        facts: protectedAbsence, liveMessage: protectedAbsence, warnings: projectedRow.warnings.state === "absent" ? projectedRow.warnings : protectedAbsence } : projectedRow,
      detail: protectedArchive ? { ...record.detail, header: { ...record.detail.header, title: "Protected test subject" } } : record.detail,
      receipt: archivedReceiptForOperator(record.receipt),
      failure: protectedArchive ? protectedAbsence : record.failure.state === "absent"
        ? record.failure
        : {
          state: "present",
          value: archivedFailureForOperator(record.failure.value, record.archiveSchemaGeneration),
        },
      evidence: record.evidence,
      /*
       * The frozen sections, verbatim. A record written before generation 2
       * carries none, and the absence NAMES its generation rather than serving
       * empty panels — an archived run whose logs are simply blank and one
       * whose logs were never frozen are different facts, and the second one is
       * the only one an operator can do anything about.
       */
      sections: record.sections === undefined
        ? {
          state: "absent",
          reason: `this record was archived at schema generation ${String(record.archiveSchemaGeneration)}, `
            + "which predates D223's frozen section payloads; its log lines, data points, member rows, "
            + "capture descriptions and attempt history were never captured and are not reconstructible",
        }
        : protectedArchive ? protectedAbsence : {
          state: "present",
          value: archivedSectionsForOperator(record.sections, record.archiveSchemaGeneration),
        },
      /*
       * The read-through. The archived record keeps naming the lines and
       * copies none of them, so this is the one place the two meet — and it
       * happens on READ, per request, against whatever the live ledger holds
       * now. It is not a descriptor read and it resolves no old-version code:
       * the ledger is a flat append-only file whose entry schema is the same
       * one every reader in this tree uses.
       */
      ledger: deps.ledger.resolve(record.evidence.ledgerPartitions, hasProtectedTransactionInput({
        envelope: { workflow: record.workflowId }, input: record.input })),
      /*
       * Computed from the record's OWN fields, the D86 policy constants and
       * `now` — no store read, no descriptor. Reading the artifact bytes back
       * to confirm a retention state would break the property this whole path
       * exists to have (ref dashboard-surfaces §10.2: an archived run resolves nothing), so
       * the pointer count states its derivation rather than claiming an
       * observation.
       */
      retention: archiveRetention({
        now: deps.clock.now().toISOString(),
        endedAt: record.row.endedAt,
        pointerCounts: {
          artifacts: record.evidence.artifactIds.length,
          checkpoints: record.evidence.checkpointNodeIds.length,
          writeIntents: record.evidence.writeIntentIds.length,
          ledgerLines: record.evidence.ledgerPartitions.length,
        },
      }),
      relaunches: repositories.archiveRelaunches.listByArchivedRun(record.runId).map((relaunch) => ({
        runId: relaunch.runId,
        relaunchedIdentity: relaunch.relaunchedIdentity,
        relaunchedBy: relaunch.relaunchedBy,
        relaunchedAt: relaunch.relaunchedAt,
      })),
      relaunch: current === undefined
        ? {
          state: "unavailable",
          reason: `${record.workflowId} is no longer registered; a relaunch starts a fresh run on the current `
            + "version, and there is none",
        }
        : {
          state: "available",
          current: {
            workflowId: current.id,
            descriptorVersion: current.version,
            contractFingerprint: current.contractFingerprint,
          },
        },
    });
  });
}

/**
 * The kernel's snapshot seam. It runs while the run is still LIVE — the bump
 * transaction has not archived it yet — so the projection can still render it,
 * which is exactly why the archive freezes the projection's own bytes instead
 * of re-deriving them later from rows the projection has stopped serving.
 */
export function createArchiveSnapshotSource(deps: RunDetailQueryDeps): ArchiveSnapshotSource {
  const snapshotBatch = (runIds: readonly string[]): ReadonlyMap<string, ArchiveRunSnapshot> => {
    if (runIds.length === 0) return new Map();
    const captured = deps.projection.captureQueueSnapshot();
    const children = canonicalRunChildren(captured.runs);
    const memberIds = new Map(runIds.map((runId) => [runId,
      (children.get(runId) ?? []).filter((run) => run.envelope.shape === "operation-member")
        .map((run) => String(run.envelope.runId)),
    ]));
    const renderIds = [...new Set([...runIds, ...[...memberIds.values()].flat()])];
    const surfaces = new Map(captured.surfaces(renderIds).map((row) => [String(row.runId), row]));
    const snapshots = new Map<string, ArchiveRunSnapshot>();
    for (const runId of runIds) {
      const row = surfaces.get(runId);
      if (row === undefined) {
        throw new TargetNotFoundError(
          `run ${runId} has no live canonical row; refusing to archive a run the projection cannot render, `
          + "because an archived row that could not be built now can never be built later",
        );
      }
      const section = buildRunSection(deps, runId, "failure");
      if (section.section !== "failure") {
        throw new Error(`the failure section of run ${runId} came back as ${section.section}`);
      }
      const { payload } = section;
      const snapshot: ArchiveRunSnapshot = {
        row,
        detail: buildRunDetail(deps, runId),
        failure: payload.state === "available"
          ? { state: "present", value: payload.value }
          // `missing`, `purged` and `error` all carry their own reason, and the
          // archive keeps whichever one the live surface would have shown
          // rather than flattening three different facts into one absence.
          : { state: "absent", reason: payload.state === "error" ? payload.message : payload.reason },
        sections: freezeProjectionSections(deps, runId, memberIds.get(runId) ?? [], surfaces),
      };
      snapshots.set(runId, Object.freeze(snapshot));
    }
    return snapshots;
  };
  return Object.freeze({
    snapshotBatch,
    snapshot(runId: string): ArchiveRunSnapshot {
      const snapshot = snapshotBatch([runId]).get(runId);
      if (snapshot === undefined) throw new Error(`archive batch omitted candidate ${runId}`);
      return snapshot;
    },
  });
}

/**
 * The upper bound on `logs` paging. It is a REFUSAL bound, not a page size: the
 * loop below walks the section's own cursor to the end and throws if it has not
 * arrived, because a frozen log that silently stopped at N would be an archived
 * run whose story ends mid-sentence with nothing saying so.
 */
const FROZEN_LOG_PAGE_LIMIT = 500;

/**
 * D223's four projection-owned sections, frozen through the SAME production
 * queries the live surfaces call. Nothing here re-derives a payload the live
 * panel would have shown differently — that is the whole reason the freeze goes
 * through this seam instead of reading authority a second time.
 */
function freezeProjectionSections(
  deps: RunDetailQueryDeps,
  runId: string,
  memberRunIds: readonly string[],
  surfaces: ReadonlyMap<string, QueueSurfaceWire>,
): ArchivedProjectionSections {
  const { row: fold, authority } = requireCanonicalRun(deps, runId);
  return ArchivedProjectionSectionsSchema.parse({
    logs: { state: "present", value: freezeLogs(deps, runId) },
    data: { state: "present", value: freezeData(deps, runId) },
    people: freezePeople(runId, memberRunIds, surfaces),
    attempts: fold === undefined
      ? { state: "absent", reason: "no execution span evidence was recorded" }
      : { state: "present", value: foldAttempts(fold, authority.envelope.attempt) },
  });
}

/**
 * EVERY combined log row, walked through the section's own cursor over ONE scan.
 *
 * The archived page reports `end-of-page` because it genuinely is the end —
 * there is no archived section endpoint to fetch a second page from, so a
 * frozen `nextCursor: present` would name a request nothing serves. Refusing
 * past the bound is the only honest alternative to truncating.
 */
function freezeLogs(deps: RunDetailQueryDeps, runId: string): FrozenNotePage {
  const notes: FrozenNotePage["notes"][number][] = [];
  const rows: NonNullable<FrozenNotePage["rows"]> = [];
  let cursor: string | undefined;
  /**
   * D5/L3 (audit P3): ONE immutable combined-log snapshot for the whole page walk.
   *
   * Every page below is still served by the production `buildRunSection` — the
   * freeze does not re-derive a payload the live panel would have shown
   * differently, which is the whole reason it goes through this seam — but each
   * call used to re-open and re-parse the same partitions to slice a different
   * 200 lines out of the same list, up to `FROZEN_LOG_PAGE_LIMIT` times per
   * run, once per run in a version bump. The cache lives for exactly this
   * freeze, so nothing long-lived can serve a page from a corpus a worker has
   * since appended to.
   */
  const noteScan = createRunNoteScanCache();
  for (let page = 0; page < FROZEN_LOG_PAGE_LIMIT; page += 1) {
    const section = buildRunSection(deps, runId, "logs", cursor, noteScan);
    if (section.section !== "logs") {
      throw new Error(`the logs section of run ${runId} came back as ${section.section}`);
    }
    notes.push(...section.payload.notes);
    if (section.payload.rows === undefined) {
      throw new Error(`live logs for run ${runId} omitted combined rows; this build refuses to archive a pre-L3 shape`);
    }
    rows.push(...section.payload.rows);
    if (section.payload.nextCursor.state === "absent") {
      return NotePageSchema.parse({
        runId,
        rows,
        notes,
        nextCursor: { state: "absent", reason: "end-of-page" },
      });
    }
    cursor = section.payload.nextCursor.value;
  }
  throw new Error(
    `run ${runId} still reports more log pages after ${String(FROZEN_LOG_PAGE_LIMIT)} of them; refusing to `
    + "freeze a truncated log, because an archived run whose story stops mid-sentence says nothing about it",
  );
}

function freezeData(deps: RunDetailQueryDeps, runId: string): ContextDataSectionWire {
  const section = buildRunSection(deps, runId, "context-data");
  if (section.section !== "context-data") {
    throw new Error(`the data section of run ${runId} came back as ${section.section}`);
  }
  return section.payload;
}

/**
 * Member rows come from canonical parent/shape membership.
 *
 * There is no live `people` section in this composition (ref dashboard-surfaces D19's People
 * tab is a group-panel surface 2h left unbuilt), so this is not a freeze of a
 * served payload — it is the same projection the queue renders, one row per
 * member, which is exactly what the demo's member table shows. A run with no
 * members says so; a member the projection cannot render REFUSES the archive,
 * for the same reason an unrenderable row does.
 */
function freezePeople(
  runId: string,
  memberRunIds: readonly string[],
  byId: ReadonlyMap<string, QueueSurfaceWire>,
): ArchivedProjectionSections["people"] {
  if (memberRunIds.length === 0) {
    return { state: "absent", reason: "this run fanned out no member runs" };
  }
  const members = memberRunIds.map((memberRunId) => {
    const surface = byId.get(memberRunId);
    if (surface === undefined) {
      throw new Error(
        `run ${runId} names member ${memberRunId}, which the projection cannot render; refusing to archive a `
        + "run whose member rows would be permanently unreadable",
      );
    }
    return {
      runId: surface.runId,
      parentRunId: runId,
      rowRevision: surface.rowRevision,
      label: surface.displayName.state === "present" ? surface.displayName.value : surface.title,
      status: surface.status,
    };
  });
  return {
    state: "present",
    value: PeoplePageSchema.parse({
      parentRunId: runId,
      members,
      total: members.length,
      nextCursor: { state: "absent", reason: "end-of-page" },
    }),
  };
}

/**
 * The per-attempt history, folded from the run's own task spans.
 *
 * Span identity is `(runId, attempt, spanPath)`, so grouping by `attempt` is
 * reading the identity the fold already carries rather than inferring a
 * boundary from instants. Attempt 1 is always emitted even when it folded no
 * spans — a run that died before its first task still HAD a first attempt, and
 * an empty attempt list would say the run never started.
 */
function foldAttempts(fold: RunFoldRecord, currentAttempt: number): readonly ArchivedRunAttempt[] {
  const byAttempt = new Map<number, RunFoldRecord["taskSpans"][number][]>();
  for (let attempt = 1; attempt <= currentAttempt; attempt += 1) byAttempt.set(attempt, []);
  for (const span of fold.taskSpans) {
    const bucket = byAttempt.get(span.attempt);
    if (bucket === undefined) byAttempt.set(span.attempt, [span]);
    else bucket.push(span);
  }
  return [...byAttempt.entries()]
    .sort(([left], [right]) => left - right)
    .map(([attempt, spans]) => {
      const counts = new Map<string, number>();
      let unfinished = 0;
      for (const span of spans) {
        if (span.outcome === undefined) unfinished += 1;
        else counts.set(span.outcome, (counts.get(span.outcome) ?? 0) + 1);
      }
      const starts = spans.map((span) => span.startedAt).filter((at): at is string => at !== undefined).sort();
      const ends = spans.map((span) => span.endedAt).filter((at): at is string => at !== undefined).sort();
      return ArchivedRunAttemptSchema.parse({
        attempt,
        steps: spans.length,
        startedAt: starts[0] === undefined
          ? {
            state: "absent",
            reason: spans.length === 0
              ? "this attempt folded no task span at all"
              : "no span.started was folded for any step of this attempt",
          }
          : { state: "present", value: starts[0] },
        endedAt: ends.at(-1) === undefined
          ? {
            state: "absent",
            reason: spans.length === 0
              ? "this attempt folded no task span at all"
              : "no step of this attempt folded a span.ended",
          }
          : { state: "present", value: ends.at(-1) },
        outcomes: [...counts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([outcome, count]) => ({ outcome, count })),
        unfinished,
      });
    });
}
