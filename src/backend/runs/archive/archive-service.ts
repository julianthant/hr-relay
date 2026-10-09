
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
} from "../../../models/archive/model.js";
import type { VersionScope } from "../../../rules/commands/commands.js";
import {
  ArchivedCaptureTileSchema,
  ArchivedRunSectionsSchema,
  type ArchivedCaptureTile,
  type ArchivedProjectionSections,
  type ArchivedRunSections,
} from "../../../models/archive/sections.js";
import type { QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import type { FailureDetailWire, RunDetailWire } from "../../../models/dashboard/run-detail.js";
import { isTerminalRunState, type RunRecord } from "../../../models/run/record.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { projectReceiptForOperator } from "../../../models/trust/evidence.js";


export interface ArchiveRunSnapshot {
  readonly row: QueueSurfaceWire;
  readonly detail: RunDetailWire;

  readonly failure: FailureSection;
  // Freeze the live projection payload; the kernel cannot independently derive section read models.
  readonly sections: ArchivedProjectionSections;
}

export type FailureSection =
  | Readonly<{ state: "present"; value: FailureDetailWire }>
  | Readonly<{ state: "absent"; reason: string }>;

export interface ArchiveSnapshotSource {

  snapshot(runId: string): ArchiveRunSnapshot;
  /** Freeze every candidate before any archival changes live membership. */
  snapshotBatch(runIds: readonly string[]): ReadonlyMap<string, ArchiveRunSnapshot>;
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

  readonly currentIdentity: (workflowId: string) => WorkflowVersionIdentity | undefined;
  /** The RUNNING app build — never the version the command claimed. */
  readonly appVersion: string;
}

/** Mutation callers assess their transaction-local repository state. */
export function assessVersionBump(
  deps: VersionBumpAssessmentDeps,
  scope: VersionScope,
): VersionBumpAssessment {
  const workflows = scope.kind === "workflows" ? scope.workflowIds : deps.repositories.runs.listWorkflows();
  return assessVersionBumpFromRuns({
    currentIdentity: deps.currentIdentity, appVersion: deps.appVersion,
    runs: [...new Set(workflows)].flatMap((workflow) => deps.repositories.runs.listByWorkflow(workflow)),
  }, scope);
}

/** The same assessment over an admitted canonical read snapshot. */
export function assessVersionBumpFromRuns(
  deps: Omit<VersionBumpAssessmentDeps, "repositories"> & { readonly runs: readonly RunRecord[] },
  scope: VersionScope,
): VersionBumpAssessment {
  const byWorkflow = new Map<string, RunRecord[]>();
  for (const run of deps.runs) {
    const rows = byWorkflow.get(run.envelope.workflow) ?? [];
    rows.push(run);
    byWorkflow.set(run.envelope.workflow, rows);
  }
  const workflowIds = [...new Set(scope.kind === "workflows" ? scope.workflowIds : byWorkflow.keys())].sort();
  const identities: WorkflowVersionIdentity[] = [];
  const candidates: VersionBumpCandidate[] = [];
  const blockers: VersionBumpBlocker[] = [];
  const driftByRunId = new Map<string, readonly VersionDriftReason[]>();

  const expectedAppVersion = scope.kind === "application" ? deps.appVersion : undefined;

  for (const workflowId of workflowIds) {
    const current = deps.currentIdentity(workflowId);
    if (current === undefined) {
      if (scope.kind === "workflows") {
        throw new Error(
          `workflow ${workflowId} is not registered; a version bump names the workflows whose descriptors moved, `
          + "and an unregistered id has no current identity to bump TO",
        );
      }

      for (const run of byWorkflow.get(workflowId) ?? []) {
        record(run, ["app-version"], candidates, blockers, driftByRunId);
      }
      continue;
    }
    identities.push(current);
    for (const run of byWorkflow.get(workflowId) ?? []) {
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

  blockers.push(VersionBumpBlockerSchema.parse({ ...common, runState: run.lifecycle.state }));
}

/** The one legible sentence a refusal prints, per blocking run. */
export function describeBlocker(blocker: VersionBumpBlocker): string {
  return `${blocker.traceId} (${blocker.workflowId}, ${blocker.runState})`;
}


export function resolveBumpEffect(
  kind: "major" | "minor",
  assessment: VersionBumpAssessment,
): Pick<VersionBumpAssessment, "candidates" | "blockers"> {
  switch (kind) {
    case "major":
      return { candidates: assessment.candidates, blockers: assessment.blockers };
    case "minor":
      return { candidates: Object.freeze([]), blockers: Object.freeze([]) };
  }
}

export interface ArchivedRunDerivationInput {
  readonly repositories: AuthorityRepositories;
  readonly run: RunRecord;
  readonly snapshot: ArchiveRunSnapshot;
  readonly applicationId: string;
  readonly drift: readonly VersionDriftReason[];
  readonly archivedBy: string;
  readonly archivedAt: string;

  readonly workflowLabel: string | undefined;
  readonly workflowCode: string | undefined;
}

export function deriveArchivedRunRecord(input: ArchivedRunDerivationInput): ArchivedRunRecord {
  const { repositories, run } = input;
  const runId = run.envelope.runId;
  const { lifecycle } = run;
  if (lifecycle.state !== "terminal") {
    throw new Error(`run ${runId} is ${lifecycle.state}; a non-terminal run is a bump BLOCKER, never an archive candidate`);
  }
  const receipt = repositories.evidenceReceipts.findByRun(runId);
  const projectedReceipt = receipt === undefined ? undefined : projectReceiptForOperator(receipt);
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
    workflowCode: input.workflowCode === undefined
      ? { state: "absent", reason: `${run.envelope.workflow} was already unregistered when this run was archived` }
      : { state: "present", value: input.workflowCode },
    traceId: run.envelope.traceId,
    archivedIdentity: {
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    },
    appVersion: run.appVersion === undefined
      ? { state: "absent", reason: "app build was not recorded at enqueue" }
      : { state: "present", value: run.appVersion },
    drift: input.drift,
    archivedAt: input.archivedAt,
    archivedBy: input.archivedBy,
    row: input.snapshot.row,
    detail: input.snapshot.detail,
    receipt: projectedReceipt === undefined
      ? { state: "absent", reason: "this run settled without a derived evidence receipt" }
      : projectedReceipt.state === "withheld"
        ? { state: "absent", reason: projectedReceipt.reason }
        : { state: "present", value: projectedReceipt.value },
    failure: input.snapshot.failure,
    evidence: {
      artifactIds,
      checkpointNodeIds,
      writeIntentIds: [...intents.map((intent) => intent.writeIntentId)].sort(),

      ledgerPartitions: repositories.historicalOperationSources.list()
        .filter((source) => intents.some((intent) => intent.writeIntentId === source.operationId))
        .flatMap((source) => source.projection === null ? [] : [{ system: source.projection.system, date: source.projection.date, sequence: source.projection.seq }]),
    },
    sections: ArchivedRunSectionsSchema.parse({
      ...input.snapshot.sections,
      captures: deriveCaptureTiles(input),
    } satisfies ArchivedRunSections),
    input: run.input,
  });

  return ArchivedRunRecordSchema.parse({ ...content, contentDigest: archivedRunContentDigest(content) });
}

// Evidence tiles describe artifacts without reading their bytes; archived metadata stays self-contained.
function deriveCaptureTiles(input: ArchivedRunDerivationInput): ArchivedRunSections["captures"] {
  const { repositories, run } = input;
  const tiles: ArchivedCaptureTile[] = [];
  for (const bundle of repositories.diagnosticBundles.listByRun(run.envelope.runId)) {
    const failure = bundle.origin.kind === "operator-request"
      ? undefined
      : repositories.failures.get(bundle.origin.failureId);
    const step: ArchivedCaptureTile["step"] = failure === undefined
      ? {
        state: "absent",
        reason: bundle.origin.kind === "operator-request"
          ? "an operator-requested capture names no failure, and a diagnostic bundle records no step of its own"
          : `this bundle names failure ${bundle.origin.failureId}, which authority no longer holds`,
      }
      : failure.nodeId === undefined
        ? { state: "absent", reason: "the failure this capture was taken for names no workflow node" }
        : { state: "present", nodeId: failure.nodeId };
    for (const row of repositories.diagnosticBundles.listAttachments(bundle.bundleId)) {
      const { attachment } = row;
      tiles.push(ArchivedCaptureTileSchema.parse({
        artifactId: attachment.artifactId,
        bundleId: bundle.bundleId,
        kind: attachment.kind,
        mediaType: attachment.mediaType,
        byteLength: attachment.byteLength,
        digest: attachment.digest,
        sensitivity: attachment.sensitivity,
        capturedAt: bundle.createdAt,
        origin: bundle.origin.kind,
        ...(attachment.kind === "screenshot"
          ? { dimensions: { width: attachment.width, height: attachment.height } }
          : {}),
        step,
        system: systemOfCapture(failure?.taskId),
        retention: bundle.retention,
      }));
    }
  }
  if (tiles.length === 0) {
    return { state: "absent", reason: "this run captured no diagnostic artifact" };
  }
  return {
    state: "present",
    value: [...tiles].sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  };
}


function systemOfCapture(taskIdValue: string | undefined): ArchivedCaptureTile["system"] {
  if (taskIdValue === undefined) {
    return { state: "absent", reason: "no failing task is recorded for this capture, so it names no system" };
  }
  const store = taskIdValue.slice(0, taskIdValue.indexOf("/"));
  if (store === "" || store.startsWith("workflow:")) {
    return { state: "absent", reason: `${taskIdValue} is a workflow-service task and touches no external system` };
  }
  return { state: "present", value: store };
}
