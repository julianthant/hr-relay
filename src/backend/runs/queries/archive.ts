import { authenticatedVersionApplyRequest, publicVersionReviewFingerprint } from "../commands/version-review-binding.js";
import type { VersionChange } from "../../../models/archive/change-record.js";
import { SavedArchiveDeletionStatusWireSchema, SavedArchiveFileWireSchema } from "../../../models/dashboard/archive.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { SavedVersionIndexWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../../models/dashboard/archive.js";
import type { createRunLifecycleStorage } from "../../storage/sqlite/lifecycle-storage.js";
import { readArchiveReport, queryArchiveReports } from "./archive-reports.js";
import { SavedArchiveDetailWireSchema, SavedArchiveIndexWireSchema, SavedArchiveGroupsWireSchema, type SavedArchiveQuery } from "../../../models/dashboard/archive.js";
import type { ArchiveGroupQuery } from "../../../models/archive/report.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { listCanonicalRuns } from "./canonical-runs.js";
import { deriveRunStatus } from "../lifecycle/run-status.js";
import { archivedRunReferenceFingerprint, authenticArchivedRunContent } from "../../../models/archive/model.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
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
 */
import { z } from "zod";
import {
  ArchiveIndexWireSchema,
  ArchivedCaptureResourceWireSchema,
  ArchivedRunDetailWireSchema,
  type ArchiveIndexWire,
  type ArchivedCaptureResourceWire,
  type ArchivedRunDetailWire,
} from "../../../models/dashboard/archive.js";
import type { Clock } from "../../../rules/time/clock.js";
import { VersionScopeSchema } from "../../../rules/commands/commands.js";
import type { WorkflowVersionIdentity } from "../../../models/archive/model.js";
import {
  ArchivedRunRecordSchema,
  CURRENT_ARCHIVE_SCHEMA_GENERATION,
  type ArchivedRunRecord,
  versionBumpPlanFingerprint,
} from "../../../models/archive/model.js";
import { archiveRetention } from "../../../models/archive/retention.js";

import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import {
  assessVersionBumpFromRuns,
} from "../archive/archive-service.js";
import {
  ArchivedRunSectionsSchema,
  type ArchivedRunSections,
} from "../../../models/archive/sections.js";
import {
  NotePageSchema,
} from "../../../models/dashboard/run-detail.js";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import { projectReceiptForOperator, type RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { ArtifactIdSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import type {
  ServerVerifiedArtifactReader,
  VerifiedByteLease,
} from "../../storage/artifacts/server-verified-artifact-reader.js";
import { VerifiedArtifactOperationalError } from "../../storage/artifacts/server-verified-artifact-reader.js";
import {
  ArtifactBytesCorruptError,
  createArtifactVerificationPass,
  IndexedArtifactBytesMissingError,
  prepareVerifiedArtifactLease,
  verifyArtifactBytes,
} from "./artifact-bytes.js";

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

function archivedQueueRow(
  row: Readonly<Record<string, unknown>> & { readonly session?: unknown },
): QueueSurfaceWire {
  return QueueSurfaceWireSchema.parse(row.session === undefined
    ? { ...row, session: { state: "absent", reason: "no session recorded (archived before D269)" } }
    : row);
}

function archivedDiagnosticWithholding(record: ArchivedRunRecord): string | null {
  if (record.archiveSchemaGeneration < 6) {
    return `archive schema generation ${String(record.archiveSchemaGeneration)} predates diagnostic safety v1; historical free text is withheld`;
  }
  const bindings = retainedRunProtectedBindings({ envelope: { workflow: record.workflowId }, input: record.input });
  return bindings.some(binding => binding.inputPath !== "timekeeperName")
    ? "protected archived detail withheld; private authority is unchanged"
    : null;
}

function archivedPublicRow(record: ArchivedRunRecord): QueueSurfaceWire {
  const row = archivedQueueRow(record.row);
  const reason = archivedDiagnosticWithholding(record);
  return reason === null ? row : QueueSurfaceWireSchema.parse({
    ...row,
    title: "Protected archived run",
    subtitle: { state: "absent", reason },
    facts: { state: "absent", reason },
    liveMessage: { state: "absent", reason },
    warnings: { state: "absent", reason },
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

export function archivedSectionsForOperator(
  sections: ArchivedRunSections,
  _archiveSchemaGeneration: number,
): ArchivedRunSections {
  if (sections.logs.state === "absent") return sections;
  const page = sections.logs.value;
  const observed = page.rows?.filter((row) => row.kind === "observed") ?? [];
  if (observed.length === 0) return sections;
  const rows = page.rows?.filter((row) => row.kind !== "observed");
  const notes = rows === undefined
    ? page.notes
    : rows.flatMap((row) => row.kind === "note" ? [row.note] : []);
  const priorData = sections.data.state === "present"
    ? sections.data.value
    : { runId: page.runId, state: "archived" as const, entries: [] };
  const mergedObservations = [...(priorData.observations ?? [])];
  const seen = new Set(mergedObservations.map((row) => row.logId));
  for (const row of observed) {
    if (seen.has(row.logId)) continue;
    mergedObservations.push(row);
    seen.add(row.logId);
  }
  return ArchivedRunSectionsSchema.parse({
    ...sections,
    ...(observed.length === 0 ? {} : { data: {
      state: "present",
      value: { ...priorData, observations: mergedObservations },
    } }),
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
import { TargetNotFoundError } from "../commands/refusals.js";

export interface ArchiveQueryDeps {
  readonly storage?: ReturnType<typeof createRunLifecycleStorage>;
  readonly ledger: unknown;
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
        title: archivedPublicRow(record).title,
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
        warnings: archivedPublicRow(record).warnings,
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
    const projectedRow = archivedPublicRow(record);
    const diagnosticWithholding = archivedDiagnosticWithholding(record);

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
      row: projectedRow,
      detail: diagnosticWithholding === null ? record.detail
        : { ...record.detail, header: { ...record.detail.header, title: "Protected archived run" } },
      receipt: diagnosticWithholding === null ? archivedReceiptForOperator(record.receipt)
        : { state: "absent", reason: diagnosticWithholding },
      failure: diagnosticWithholding === null ? record.failure
        : { state: "absent", reason: diagnosticWithholding },
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
        : diagnosticWithholding !== null
        ? { state: "absent", reason: diagnosticWithholding }
        : {
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
      ledger: repositories.archivedRuns.transactions(record.runId).lines,
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
      relaunches: [],
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

function savedArchiveRead<T>(read: () => T): T {
  try { return read(); }
  catch (error: unknown) {
    if (error instanceof z.ZodError) throw new Error("saved-archive-report-integrity-failed", { cause: error });
    throw error;
  }
}

/** Current saved-report reads use only the generic report and canonical disposition. */
export function savedArchiveDetail(deps: ArchiveQueryDeps, runIdInput: string) {
  const runId = RunIdSchema.parse(runIdInput);
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  const storage = deps.storage;
  const existence = savedArchiveRead(() => storage.reportOwner(runId));
  if (existence.state === "deleted") {
    const deletion = storage.readArchiveDeletion(runId);
    if (deletion === undefined) throw new Error("archive-deletion-readback-missing");
    const command = deletion.command.state === "pending"
      ? {
          state: "pending" as const,
          reason: "Canonical deletion is recorded, but the final operator command audit is still pending.",
          ...(deletion.command.request.source === "dashboard"
            && deletion.command.request.requestedBy === LOCAL_OPERATOR_ACTOR_ID
            && deletion.command.request.target.archivedRunId === runId
            ? { resumeRequest: deletion.command.request }
            : {}),
        }
      : deletion.command;
    const status = SavedArchiveDeletionStatusWireSchema.parse({
      state: "deleted",
      runId,
      deletedAt: deletion.receipt.deletedAt,
      removed: deletion.receipt.removed,
      cleanup: deletion.cleanup,
      command,
    });
    return SavedArchiveDetailWireSchema.parse({ state: "deleted", runId, reason: "This run was explicitly deleted.", deletion: status });
  }
  if (existence.state === "missing") return SavedArchiveDetailWireSchema.parse({ state: "missing", runId, reason: "No retained run has this identity." });
  if (existence.state !== "archived") return SavedArchiveDetailWireSchema.parse({ state: "unavailable", runId, reason: "This run has no published saved report." });
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  const report = savedArchiveRead(() => readArchiveReport(storage, runId));
  if (report.state !== "available") throw new Error("saved-archive-report-unavailable");
  return SavedArchiveDetailWireSchema.parse(report);
}
export function savedArchiveIndex(deps: ArchiveQueryDeps, query: SavedArchiveQuery) {
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  const storage = deps.storage;
  return savedArchiveRead(() => SavedArchiveIndexWireSchema.parse(queryArchiveReports(storage, query)));
}

export function savedArchiveGroups(deps: ArchiveQueryDeps, query: ArchiveGroupQuery) {
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  const storage = deps.storage;
  return savedArchiveRead(() => SavedArchiveGroupsWireSchema.parse({groups:storage.archiveGroups(query)}));
}

function savedAttachment(deps: ArchiveQueryDeps, runId: string, artifactId: string, byDigest: boolean) {
  const report = savedArchiveDetail(deps, runId);
  if (report.state !== "available") throw new TargetNotFoundError(report.reason);
  const matches = report.files.filter(file => byDigest ? file.digest === artifactId : file.artifactIds?.includes(artifactId));
  if (matches.length !== 1) throw new TargetNotFoundError("The saved report does not name this exact attachment.");
  return matches[0];
}
export async function prepareSavedCaptureLease(deps: ArchiveQueryDeps, runId: string, artifactId: string, signal?: AbortSignal, byDigest = false): Promise<ArchivedCaptureLease> {
  signal?.throwIfAborted();
  const file = savedAttachment(deps, RunIdSchema.parse(runId), byDigest ? FingerprintSchema.parse(artifactId) : ArtifactIdSchema.parse(artifactId), byDigest);
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  let bytes: Uint8Array;
  try { bytes = deps.storage.readFile(runId, file.digest).bytes; }
  catch (error: unknown) {
    if (error instanceof Error && error.message === "archive-file-unavailable") throw new ArchivedCaptureReadError("ARCHIVED_CAPTURE_BYTES_MISSING", "The retained attachment bytes are missing.", { cause: error });
    if (error instanceof Error && error.message === "archive-file-integrity-mismatch") throw new ArchivedCaptureReadError("ARCHIVED_CAPTURE_CORRUPT", "The retained attachment bytes failed integrity verification.", { cause: error });
    throw error;
  }
  const ref = ArtifactRefSchema.parse({ id: byDigest ? (file.artifactIds?.[0] ?? runId) : artifactId, sha256: file.digest, bytes: file.byteLength, mediaType: file.mediaType });
  let available = true;
  const lease: VerifiedByteLease = {
    ref,
    takeBody: () => {
      signal?.throwIfAborted();
      if (!available) return Promise.reject(new Error("saved-attachment-lease-consumed"));
      available = false;
      return Promise.resolve(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }));
    },
    dispose: () => { available = false; bytes = new Uint8Array(); return Promise.resolve(); },
  };
  return { ref, lease };
}
export async function savedCaptureResource(deps: ArchiveQueryDeps, runId: string, artifactId: string, signal?: AbortSignal) {
  try {
    const { lease } = await prepareSavedCaptureLease(deps, runId, artifactId, signal);
    await lease.dispose();
    return ArchivedCaptureResourceWireSchema.parse({ runId, artifactId, resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}` } });
  } catch (error: unknown) {
    if (!(error instanceof ArchivedCaptureReadError)) throw error;
    return ArchivedCaptureResourceWireSchema.parse({ runId, artifactId, resource: error.code === "ARCHIVED_CAPTURE_BYTES_MISSING"
      ? { state: "missing", reason: error.message } : { state: "error", message: error.message } });
  }
}

export function savedArchiveVersions(deps: ArchiveQueryDeps) {
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  const retained = deps.storage.historicalVersionChanges();
  const current = retained.filter(row => "schemaVersion" in row && row.schemaVersion === 2);
  return SavedVersionIndexWireSchema.parse({ appVersion: deps.appVersion,
    workflows: deps.descriptors.list().map(row => ({ workflow: row.id, label: row.label, version: row.version, fingerprint: row.contractFingerprint })),
    changes: current.map(row => {
      if (!("reviewFingerprint" in row)) throw new Error("version-change-current-contract-invalid");
      return { changeId: row.changeId, state: row.state, targetVersion: row.targetVersion, change: row.change,
        reviewFingerprint: publicVersionReviewFingerprint(row), scope: row.scope, memberRunIds: row.members.map(member => member.runId),
        blockerRunIds: row.blockers, completedRunIds: row.completedRunIds,
        ...(versionApplyResumeRequest(row) === undefined ? {} : { resumeRequest: versionApplyResumeRequest(row) }) };
    }), historicalChanges: retained.length - current.length });
}

export function savedArchiveRuntimeVersions(deps: Pick<ArchiveQueryDeps, "storage" | "descriptors">) {
  if (deps.storage === undefined) throw new Error("saved-archive-storage-unavailable");
  const { authority, changes } = deps.storage.runtimeVersionIndex();
  const labels = new Map(deps.descriptors.list().map(row => [row.id, row.label]));
  return SavedRuntimeVersionIndexWireSchema.parse({
    revision: authority.revision,
    dashboard: authority.state.dashboard,
    workflows: authority.state.workflows.map(row => ({ ...row, label: labels.get(row.workflowId) ?? row.workflowId })),
    ...(authority.claim === undefined ? {} : { applyingChangeId: authority.claim.changeId }),
    changes: changes.map(({ changeId, actorId, reviewedAt, reviewFingerprint, scope, before, after, state, members, completedRunIds, applicationRequest }) =>
      ({ changeId, actorId, reviewedAt, reviewFingerprint, scope, before, after, state, members, completedRunIds,
        ...(state === "applying" && applicationRequest !== undefined ? { resumeRequest: applicationRequest } : {}) })),
  });
}

export async function savedFileResource(deps: ArchiveQueryDeps, runId: string, digest: string, signal?: AbortSignal) {
  try {
    const { lease } = await prepareSavedCaptureLease(deps, runId, digest, signal, true);
    await lease.dispose();
    return SavedArchiveFileWireSchema.parse({ runId, digest, resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${runId}/files/${digest}` } });
  } catch (error: unknown) {
    if (!(error instanceof ArchivedCaptureReadError)) throw error;
    return SavedArchiveFileWireSchema.parse({ runId, digest, resource: error.code === "ARCHIVED_CAPTURE_BYTES_MISSING"
      ? { state: "missing", reason: error.message } : { state: "error", message: error.message } });
  }
}

/** Recover the dashboard's exact envelope only when the durable claim authenticates it.
 * Other command producers retain their own original request; never invent its optional fields.
 */
export function versionApplyResumeRequest(row: VersionChange) {
  if (row.state !== "applying") return undefined;
  const request = authenticatedVersionApplyRequest(row);
  return request === undefined ? undefined : { ...request, payload: { planFingerprint: publicVersionReviewFingerprint(row) } };
}
