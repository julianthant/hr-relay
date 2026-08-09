/**
 * The archive derivation (D179, charter §25 / doc 03 §10.2).
 *
 * Two pure-ish functions over authority, both called INSIDE the caller's
 * transaction so a refusal leaves nothing behind:
 *
 * - `assessVersionBump` answers "which runs are prior-version, and which of
 *   them are non-terminal" for one declared scope. It is called TWICE — once
 *   when the operator plans, and again inside the applying transaction — and
 *   the second answer is the one that decides, because a run enqueued between
 *   the two would otherwise be archived without ever having been reviewed.
 * - `deriveArchivedRunRecord` builds the self-contained record.
 *
 * The ledger appears here only as POINTERS. Nothing in this module reads,
 * writes, prunes or renumbers `.tracker-rebuild/ledger/` — archiving is a
 * display lifecycle and what was filed in a real HR system is an audit one.
 */
import {
  archivedRunContentDigest,
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  CURRENT_ARCHIVE_SCHEMA_GENERATION,
  versionDrift,
  VersionBumpBlockerSchema,
  VersionBumpCandidateSchema,
  type ArchivedRunRecord,
  type VersionBumpBlocker,
  type VersionBumpCandidate,
  type VersionDriftReason,
  type WorkflowVersionIdentity,
} from "../../domain/archive/model.js";
import type { VersionScope } from "../../domain/commands.js";
import type { QueueSurfaceWire } from "../../domain/dashboard/projection.js";
import type { FailureDetailWire, RunDetailWire } from "../../domain/dashboard/run-detail.js";
import { isTerminalRunState, type RunRecord } from "../../domain/run/record.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";

/**
 * The final projected row and detail for a run about to be archived. The
 * kernel cannot build these — the projection is a server read model, not
 * authority — so it takes them through a seam and the server supplies the
 * SAME payloads the live surfaces were rendering a moment earlier.
 */
export interface ArchiveRunSnapshot {
  readonly row: QueueSurfaceWire;
  readonly detail: RunDetailWire;
  /**
   * The failure section as the LIVE surface renders it, not a second
   * derivation of the same failure record. `FailureDetailWire` carries facts
   * the raw row does not — the same-fingerprint count, the diagnostic bundle
   * ref, the redacted page/action — and an archive that re-derived them here
   * would be a second projection of a fact D81 says has exactly one.
   */
  readonly failure: FailureSection;
}

export type FailureSection =
  | Readonly<{ state: "present"; value: FailureDetailWire }>
  | Readonly<{ state: "absent"; reason: string }>;

export interface ArchiveSnapshotSource {
  /**
   * Throws, loudly, when the run has no projected fold. An archive built from
   * a run the projection cannot render would be an archive of nothing, and
   * inventing an empty row would be worse than refusing the bump.
   */
  snapshot(runId: string): ArchiveRunSnapshot;
}

export interface VersionBumpAssessment {
  readonly identities: readonly WorkflowVersionIdentity[];
  readonly candidates: readonly VersionBumpCandidate[];
  readonly blockers: readonly VersionBumpBlocker[];
  /** Kept beside the candidate list so the archive record can retain it. */
  readonly driftByRunId: ReadonlyMap<string, readonly VersionDriftReason[]>;
}

export interface VersionBumpAssessmentDeps {
  readonly repositories: AuthorityRepositories;
  /** The registry's current identity for a workflow, or `undefined` if retired. */
  readonly currentIdentity: (workflowId: string) => WorkflowVersionIdentity | undefined;
  /** The RUNNING app build — never the version the command claimed. */
  readonly appVersion: string;
}

/**
 * `workflows` scope reaches exactly the named workflows. `application` scope
 * reaches every workflow that has runs at all — including RETIRED ones, whose
 * runs are prior-version by definition and would otherwise be the only rows a
 * dashboard update could never sweep.
 */
function scopedWorkflowIds(deps: VersionBumpAssessmentDeps, scope: VersionScope): readonly string[] {
  if (scope.kind === "workflows") return [...new Set(scope.workflowIds)].sort();
  return [...new Set(deps.repositories.runs.listWorkflows())].sort();
}

export function assessVersionBump(
  deps: VersionBumpAssessmentDeps,
  scope: VersionScope,
): VersionBumpAssessment {
  const identities: WorkflowVersionIdentity[] = [];
  const candidates: VersionBumpCandidate[] = [];
  const blockers: VersionBumpBlocker[] = [];
  const driftByRunId = new Map<string, readonly VersionDriftReason[]>();
  /**
   * An application-scope bump also moves the app build, so every run whose
   * stamp differs — or is missing — is prior-version. A workflow-scope bump
   * does NOT: rebuilding the dashboard is not a reason to archive a run whose
   * descriptor never moved.
   */
  const expectedAppVersion = scope.kind === "application" ? deps.appVersion : undefined;

  for (const workflowId of scopedWorkflowIds(deps, scope)) {
    const current = deps.currentIdentity(workflowId);
    if (current === undefined) {
      if (scope.kind === "workflows") {
        throw new Error(
          `workflow ${workflowId} is not registered; a version bump names the workflows whose descriptors moved, `
          + "and an unregistered id has no current identity to bump TO",
        );
      }
      // Application scope: a retired workflow's runs are all prior-version.
      // There is no current identity to record, so the sweep archives them
      // under the identity they carry and the plan lists no identity row.
      for (const run of deps.repositories.runs.listByWorkflow(workflowId)) {
        record(run, ["app-version"], candidates, blockers, driftByRunId);
      }
      continue;
    }
    identities.push(current);
    for (const run of deps.repositories.runs.listByWorkflow(workflowId)) {
      const drift = versionDrift(
        {
          descriptorVersion: run.envelope.descriptorVersion,
          contractFingerprint: run.envelope.contractFingerprint,
          appVersion: run.appVersion,
        },
        current,
        expectedAppVersion,
      );
      if (drift.length === 0) continue;
      record(run, drift, candidates, blockers, driftByRunId);
    }
  }

  const byRunId = (a: { runId: string }, b: { runId: string }): number => a.runId.localeCompare(b.runId);
  return Object.freeze({
    identities: Object.freeze([...identities].sort((a, b) => a.workflowId.localeCompare(b.workflowId))),
    candidates: Object.freeze([...candidates].sort(byRunId)),
    blockers: Object.freeze([...blockers].sort(byRunId)),
    driftByRunId,
  });
}

function record(
  run: RunRecord,
  drift: readonly VersionDriftReason[],
  candidates: VersionBumpCandidate[],
  blockers: VersionBumpBlocker[],
  driftByRunId: Map<string, readonly VersionDriftReason[]>,
): void {
  driftByRunId.set(run.envelope.runId, drift);
  const common = {
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    workflowId: run.envelope.workflow,
    title: run.displayName ?? run.envelope.traceId,
    enqueuedAt: run.envelope.enqueuedAt,
    drift,
  };
  if (isTerminalRunState(run.lifecycle)) {
    candidates.push(VersionBumpCandidateSchema.parse(common));
    return;
  }
  // Charter §25's non-negotiable: a queued or parked run must be terminalized
  // first, and the bump flow LISTS it. An unresolved possible-submit is never
  // buried in an archive.
  blockers.push(VersionBumpBlockerSchema.parse({ ...common, runState: run.lifecycle.state }));
}

/** The one legible sentence a refusal prints, per blocking run. */
export function describeBlocker(blocker: VersionBumpBlocker): string {
  return `${blocker.traceId} (${blocker.workflowId}, ${blocker.runState})`;
}

export interface ArchivedRunDerivationInput {
  readonly repositories: AuthorityRepositories;
  readonly run: RunRecord;
  readonly snapshot: ArchiveRunSnapshot;
  readonly applicationId: string;
  readonly drift: readonly VersionDriftReason[];
  readonly archivedBy: string;
  readonly archivedAt: string;
  /** The workflow's label as the registry serves it NOW, frozen into the record. */
  readonly workflowLabel: string | undefined;
}

export function deriveArchivedRunRecord(input: ArchivedRunDerivationInput): ArchivedRunRecord {
  const { repositories, run } = input;
  const runId = run.envelope.runId;
  const { lifecycle } = run;
  if (lifecycle.state !== "terminal") {
    throw new Error(`run ${runId} is ${lifecycle.state}; a non-terminal run is a bump BLOCKER, never an archive candidate`);
  }
  const receipt = repositories.evidenceReceipts.findByRun(runId);
  // A failed run whose failure section the live surface could not render is a
  // run whose evidence is already broken; archiving it would freeze the hole.
  if (lifecycle.failureId !== undefined && input.snapshot.failure.state !== "present") {
    throw new Error(
      `run ${runId} settled failed against failure ${lifecycle.failureId}, but its failure section is `
      + `${input.snapshot.failure.reason}; refusing to archive a run whose failure evidence is missing`,
    );
  }

  const intents = repositories.writeIntents.listByRun(runId);
  const bundles = repositories.diagnosticBundles.listByRun(runId);
  const artifactIds = [...new Set(bundles.flatMap((bundle) =>
    repositories.diagnosticBundles.listAttachments(bundle.bundleId).map((row) => row.attachment.artifactId)))].sort();
  const checkpointNodeIds = [...new Set(
    repositories.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)
      .filter((checkpoint) => checkpoint.runId === runId)
      .map((checkpoint) => checkpoint.nodeId),
  )].sort();

  const content = ArchivedRunContentSchema.parse({
    archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
    runId,
    applicationId: input.applicationId,
    workflowId: run.envelope.workflow,
    workflowLabel: input.workflowLabel === undefined
      ? { state: "absent", reason: `${run.envelope.workflow} was already unregistered when this run was archived` }
      : { state: "present", value: input.workflowLabel },
    traceId: run.envelope.traceId,
    archivedIdentity: {
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    },
    appVersion: run.appVersion === undefined
      ? { state: "absent", reason: "enqueued before runs stamped their app build (D179)" }
      : { state: "present", value: run.appVersion },
    drift: input.drift,
    archivedAt: input.archivedAt,
    archivedBy: input.archivedBy,
    row: input.snapshot.row,
    detail: input.snapshot.detail,
    receipt: receipt === undefined
      ? { state: "absent", reason: "this run settled without a derived evidence receipt" }
      : { state: "present", value: receipt },
    failure: input.snapshot.failure,
    evidence: {
      artifactIds,
      checkpointNodeIds,
      writeIntentIds: [...intents.map((intent) => intent.writeIntentId)].sort(),
      // The ledger is NEVER archived. These name lines that stay exactly where
      // they are, so an archived receipt can still be walked to what was filed.
      ledgerPartitions: [],
    },
    input: run.input,
  });

  return ArchivedRunRecordSchema.parse({ ...content, contentDigest: archivedRunContentDigest(content) });
}
