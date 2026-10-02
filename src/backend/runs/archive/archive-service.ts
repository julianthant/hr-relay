/**
 * The archive derivation (D179, charter §25 / ref dashboard-surfaces §10.2).
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
 * writes, prunes or renumbers `.tracker/ledger/` — archiving is a
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
} from "../../../domain/archive/model.js";
import type { VersionScope } from "../../../domain/commands.js";
import {
  ArchivedCaptureTileSchema,
  ArchivedRunSectionsSchema,
  type ArchivedCaptureTile,
  type ArchivedProjectionSections,
  type ArchivedRunSections,
} from "../../../domain/archive/sections.js";
import type { QueueSurfaceWire } from "../../../domain/dashboard/projection.js";
import type { FailureDetailWire, RunDetailWire } from "../../../domain/dashboard/run-detail.js";
import { isTerminalRunState, type RunRecord } from "../../../domain/run/record.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { projectReceiptForOperator } from "../../../domain/trust/evidence.js";

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
  /**
   * D223's frozen section payloads, PROJECTION half. The kernel cannot build
   * these either — a note stream and a member row are read-model facts — so
   * they ride the same seam as the row and the detail, and the archive record
   * completes them with the capture tiles it derives from authority.
   */
  readonly sections: ArchivedProjectionSections;
}

export type FailureSection =
  | Readonly<{ state: "present"; value: FailureDetailWire }>
  | Readonly<{ state: "absent"; reason: string }>;

export interface ArchiveSnapshotSource {
  /**
   * Requires a live canonical row. Missing spans remain explicit missing
   * evidence in the frozen snapshot; they do not erase the run's existence.
   */
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
  /** The registry's current identity for a workflow, or `undefined` if retired. */
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
  /**
   * An application-scope bump also moves the app build, so every run whose
   * stamp differs — or is missing — is prior-version. A workflow-scope bump
   * does NOT: rebuilding the dashboard is not a reason to archive a run whose
   * descriptor never moved.
   */
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
      // Application scope: a retired workflow's runs are all prior-version.
      // There is no current identity to record, so the sweep archives them
      // under the identity they carry and the plan lists no identity row.
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
  // Charter §25's non-negotiable: a queued or parked run must be terminalized
  // first, and the bump flow LISTS it. An unresolved possible-submit is never
  // buried in an archive.
  blockers.push(VersionBumpBlockerSchema.parse({ ...common, runState: run.lifecycle.state }));
}

/** The one legible sentence a refusal prints, per blocking run. */
export function describeBlocker(blocker: VersionBumpBlocker): string {
  return `${blocker.traceId} (${blocker.workflowId}, ${blocker.runState})`;
}

/**
 * What a bump of this KIND does with the assessment's facts (D274,
 * ref dashboard-surfaces §9.5.1). The assessment answers a factual question —
 * which runs are prior-version, and which of those are non-terminal — and the
 * KIND decides what the bump does about them:
 *
 * - `major` moved the run's shape, so it ARCHIVES every prior-version terminal
 *   run and every non-terminal one BLOCKS it (charter §25's non-negotiable —
 *   an unresolved possible-submit is never buried in an archive).
 * - `minor` archives NOTHING and CANNOT be blocked: it records the new version
 *   without moving prior-version runs, so it has no candidates and no
 *   blockers, by definition rather than by circumstance.
 *
 * Plan and apply both resolve the effect through THIS function so the reviewed
 * plan's run sets and the applying transaction's decision cannot diverge on
 * what a kind means.
 */
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
  /**
   * The workflow's label and SHORT CODE as the registry serves them NOW, frozen
   * into the record (D179, D242).
   *
   * They are ONE lookup's two answers and the caller must pass them that way:
   * `undefined` on both means the descriptor is no longer registered, and the
   * record's own refinement refuses a half-resolved pair rather than freezing a
   * label beside a blank code.
   */
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
      ? { state: "absent", reason: "enqueued before runs stamped their app build (D179)" }
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
      /*
       * The ledger is NEVER archived. These name lines that stay exactly where
       * they are, so an archived receipt can still be walked to what was
       * filed. The pointer is derived, never copied: the run's write intents
       * name their ledger outbox rows, and each projected row already carries
       * the `(system, date, seq)` the projector assigned it. An outbox row
       * with NO projection row has no sequence at all — the projector has not
       * reached it — so there is nothing to point AT and it is left out. An
       * `assigned`-but-not-yet-appended row is the opposite case and IS
       * pointed at: its sequence is durable and its exact line is
       * reconstructible from the outbox payload, so dropping it would leave
       * the archive permanently silent about a line the projector is about to
       * write. Until that append lands the read-through answers
       * `sequence-missing`, which is the true statement in that window.
       */
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

/**
 * The Evidence tab's tiles — every captured artifact, DESCRIBED.
 *
 * D179's "evidence is pointers only" is about the bytes and it stands: nothing
 * here reads the content store. What it adds is the description authority
 * already holds beside the pointer, because a chip carrying `9f2c…` and
 * nothing else cannot tell an operator what the capture was OF, when it was
 * taken, or whether its bytes are pinned.
 *
 * `step` and `system` are joined off the bundle's ORIGIN failure — the only
 * place either is recorded — and both stay named absences when the origin
 * names no failure or the failure names no node. Borrowing the run's last node
 * would attach a capture to a step it may not belong to, which on an evidence
 * surface is a fabricated provenance.
 */
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

/**
 * The system a capture belongs to, read off the failing task's id.
 *
 * `TaskIdSchema`'s grammar is literally `<registered-store>/<kebab-case-
 * operation>`, so the prefix is a DECLARED component of the identifier rather
 * than a substring somebody hopes means something — which is the difference
 * D204 draws between a mapping and a sniff. A `workflow:<id>/…` service task
 * names no external system and says so.
 */
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
