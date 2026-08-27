/**
 * The T2 world for the `separations` dashboard feature (ref guards-and-tests
 * §10.12): the REAL run/queue projection and the REAL dashboard command service
 * over a REAL authority database, with no browser and no component.
 *
 * ## What is real here, and why each half has to be
 *
 * Doc 03b's "Dashboard · wire separations" sub-task landed nine squares, and
 * every one of them is a DECLARATION on one side and a served value on the
 * other. A unit test can pin either side; only a scenario can pin that the two
 * are joined, because the join is made by the composition — the descriptor
 * resolver the projection is handed, the checkpoint read the subject title
 * walks, the authority row the gate command CASes against. So this world is
 * `src/server/dashboard/compose.ts` minus exactly three things a test must own:
 * the clock, the id factory, and the process edges (worker supervisor, write
 * sequencer, intake parser) that a dashboard feature never reaches. Each of
 * those three is wired to THROW rather than to no-op — a seam that quietly
 * answered would let a test claim a path it never walked.
 *
 * The §9.22 Track C proof (`docs/migrations/separations.md`, D256–D259) is the
 * LIVE evidence of what these squares do against a real UCPath day. This world
 * re-states the same claims over a recorded run so they are checked on every
 * commit rather than on the day somebody boots a BFF.
 *
 * ## What this world does NOT fake
 *
 * - the authority database (a real SQLite file, real migrations, real CAS)
 * - the span stream (real JSONL on disk, folded back through `ingestFromDisk`)
 * - the descriptor (the REGISTERED `separations` descriptor, never a fixture:
 *   the nine squares ARE its declarations, so a fixture would prove a graph the
 *   product does not have)
 * - the command kernel and the dashboard command service around it
 * - the start planner, so a run is born the way the run modal births one
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyWorkflowDescriptor } from "../../../../src/base/workflow.js";
import { descriptorRuntimeNodes } from "../../../../src/base/workflow.js";
import { createCommandKernel } from "../../../../src/core/command-kernel.js";
import { manualClock } from "../../../../src/domain/clock.js";
import { MatchIdentityOutputSchema } from "../../../../src/domain/contracts/separations/match-identity.js";
import { UcpathReadJobSummary } from "../../../../src/domain/contracts/ucpath/read-job-summary.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/domain/ids.js";
import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../../src/domain/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../../src/domain/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../../src/domain/separations/write-plan.js";
import { RunCheckpointRecordSchema } from "../../../../src/domain/workflow/checkpoint.js";
import { parseInputRunText, toRawSubmission } from "../../../../src/domain/workflow/ingress.js";
import { createSpanJsonlWriter } from "../../../../src/infra/events/span-jsonl-writer.js";
import { createLedgerReadThrough } from "../../../../src/infra/ledger/ledger-read-through.js";
import { AuthorityDatabase } from "../../../../src/infra/sqlite/index.js";
import { createDashboardCommandService } from "../../../../src/server/dashboard/commands/command-service.js";
import { createStartPlanService } from "../../../../src/server/dashboard/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../../src/server/dashboard/compose.js";
import { createRunQueueProjection } from "../../../../src/server/dashboard/projectors/run-queue-projection.js";
import type { RunDetailQueryDeps } from "../../../../src/server/dashboard/queries/run-detail.js";
import { createReceiptService } from "../../../../src/server/trust/receipt-service.js";
import { createNotificationInbox } from "../../../../src/services/notifications/inbox.js";
import { separationsDescriptor } from "../../../../src/workflows/separations/descriptor.js";
import { archiveSnapshots } from "../../../fixtures/archive-seams.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../fixtures/intake-kernel-seams.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1 } from "../../../unit/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../unit/fixtures/phase1f-run-fixtures.js";

export const APP_VERSION = "0.1.0";
/** The document §9.22 ran all three of its live runs against. */
export const DOCUMENT_NUMBER = "4502";
export const WORKER_ID = "separations-worker-1";
export const GATE_ID = "identity-approval";
/** The node the identity gate waits on — read off the graph, never spelled here. */
export const COMPARISON_NODE = "comparison";
export const JOB_SUMMARY_NODE = "job-summary";

/**
 * The local day the world's clock sits on, named by the SAME function the
 * projection buckets rows with, so a day-wire read is asking for the bucket the
 * fold actually wrote rather than for a hard-coded string.
 */
export { localDatePart } from "../../../../src/domain/clock.js";

const disposers: (() => void)[] = [];

/** Every world this file opened, torn down by the suite's own `afterEach`. */
export function disposeWorlds(): void {
  for (const dispose of disposers.splice(0)) dispose();
}

export interface SeparationsDashboardWorld {
  readonly root: string;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly database: AuthorityDatabase;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly commands: ReturnType<typeof createDashboardCommandService>;
  readonly startPlans: ReturnType<typeof createStartPlanService>;
  readonly runDetail: RunDetailQueryDeps;
  readonly inbox: ReturnType<typeof createNotificationInbox>;
  readonly ledger: ReturnType<typeof createLedgerReadThrough>;
  readonly descriptor: AnyWorkflowDescriptor;
}

/**
 * The gate node view `compose.ts` derives for the identity-gate section,
 * re-derived here from the REAL registered graph by the same two calls it
 * makes. Spelling `dependsOn` or the result-schema hash out as a literal would
 * make this suite agree with itself instead of with the descriptor.
 */
function gateNodeViews(descriptor: AnyWorkflowDescriptor): readonly Readonly<{
  nodeId: string;
  label: string;
  dependsOn: readonly string[];
  resultSchemaHash: string;
}>[] {
  return descriptorRuntimeNodes(descriptor).flatMap((node) => (
    node.kind === "gate"
      ? [{
        nodeId: String(node.id),
        label: node.label,
        dependsOn: node.dependsOn.map(String),
        resultSchemaHash: deriveSchemaHash(node.result, "output"),
      }]
      : []
  ));
}

export function createSeparationsWorld(): SeparationsDashboardWorld {
  const root = mkdtempSync(join(tmpdir(), "hrauto-sep-dash-"));
  const stateRoot = join(root, ".tracker-rebuild");
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "separations-dashboard-scenario" },
    clock,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  // A fan-out stamps a config identity that must name a snapshot authority
  // holds; the start planner reads the same pair back on every plan.
  database.withAuthorityTransaction((repositories) => repositories.configSnapshots.insert(CONFIG_SNAPSHOT));

  const descriptor = separationsDescriptor as unknown as AnyWorkflowDescriptor;
  const descriptorResolver = {
    resolve: (workflowId: string): AnyWorkflowDescriptor | undefined =>
      (workflowId === String(descriptor.id) ? descriptor : undefined),
  };

  const ledger = createLedgerReadThrough(stateRoot);
  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion: APP_VERSION,
    descriptorSetHash: descriptorSetHash([descriptor.contractFingerprint]),
    ledger,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      isArchived: (runId) => database.authority.archivedRuns.isArchived(runId),
      getFailure: (failureId) => database.authority.failures.get(failureId),
      getReceipt: (runId) => database.authority.evidenceReceipts.findByRun(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors: descriptorResolver,
    projectionStore: database,
  });

  const jsonlWriter = createSpanJsonlWriter({ stateRoot, clock, pid: 4242 });
  // D218: the projection's one live feed is the disk tail. Every append is
  // followed by the same read-back-from-disk ingest production ticks, so no
  // event reaches the fold by a path the product does not have.
  const spans = Object.freeze({
    emit: (event: unknown): void => {
      jsonlWriter.emit(event);
      projection.ingestFromDisk();
    },
  });

  const receipts = createReceiptService({ database, descriptors: [descriptor] });
  const runDetail: RunDetailQueryDeps = {
    stateRoot,
    projection,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      getWriteIntent: (writeIntentId) => database.authority.writeIntents.get(writeIntentId),
      listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {
      // The composition's own shape: the descriptor PLUS the gate view the
      // identity-gate section reads. `writeContracts` and `dataOrigins` are
      // deliberately absent — this feature reaches neither, and an absent
      // block is served as a named reason rather than a half panel.
      resolve: (workflowId: string) =>
        (workflowId === String(descriptor.id)
          ? { ...descriptor, gateNodes: gateNodeViews(descriptor) }
          : undefined),
    },
    trust: receipts,
  };

  const kernel = createCommandKernel({
    appVersion: APP_VERSION,
    archiveSnapshots: archiveSnapshots(runDetail),
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("b"),
    configIdentity: { configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: UUID_1 },
    descriptors: descriptorResolver,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: {
      resolvePresent: () => { throw new Error("this dashboard scenario resolves no write"); },
      resolveAbsent: () => { throw new Error("this dashboard scenario resolves no write"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("this dashboard scenario runs no worker supervisor"); },
      spawnWorker: () => { throw new Error("this dashboard scenario runs no worker supervisor"); },
      refreshBrowser: () => { throw new Error("this dashboard scenario runs no browser"); },
      reopenBrowser: () => { throw new Error("this dashboard scenario runs no browser"); },
    },
  });

  const commands = createDashboardCommandService({
    kernel,
    clock,
    spans,
    projection,
    descriptors: descriptorResolver,
    authorityRead: {
      getRun: (runId) => database.authority.runs.get(runId),
      getStartPlan: (startPlanId) => database.authority.startPlans.get(startPlanId),
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
    },
  });

  const startPlans = createStartPlanService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors: descriptorResolver,
    clock,
    ids: sequentialIdFactory("c"),
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: UUID_1,
    plannedBy: LOCAL_OPERATOR_ACTOR_ID,
  });

  const inbox = createNotificationInbox({
    authority: {
      authority: database.authority,
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
    },
    clock,
    ids: sequentialIdFactory("f"),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });

  return Object.freeze({
    root,
    stateRoot,
    clock,
    database,
    projection,
    commands,
    startPlans,
    runDetail,
    inbox,
    ledger,
    descriptor,
  });
}

/* ── commands ────────────────────────────────────────────────────────────── */

let commandSequence = 0;

/** A fresh command envelope; the id is the kernel's replay key, so it must vary. */
export function commandEnvelope(): Readonly<{
  commandId: string;
  requestedAt: string;
  requestedBy: string;
  source: string;
}> {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return {
    commandId: `dddddddd-${tail}-4000-8000-${tail}00000000`,
    requestedAt: NOW,
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  };
}

export interface StartedRun {
  readonly runId: string;
  readonly title: string;
  readonly traceId: string;
}

/**
 * Start runs the way the run modal does: the operator's TYPED TEXT through the
 * descriptor's own `inputRun` parser, one submission per entry, one start plan,
 * one `start-run` command through the real service.
 *
 * Nothing here composes a submission by hand — that is the point. `inputRun` is
 * one of the nine wired squares, and the only honest way to observe it is to
 * let it be the thing that turns typed characters into runs.
 */
export function startFromTypedText(
  world: SeparationsDashboardWorld,
  text: string,
  options: Readonly<{ dryRun?: boolean }> = {},
): readonly StartedRun[] {
  const surface = world.descriptor.surfaces.inputRun;
  if (surface === undefined) {
    throw new Error("separations declares no inputRun surface; D261's one-box door is gone");
  }
  const submissions = parseInputRunText(surface.parser, text).map((entry) => toRawSubmission(entry));
  const plan = world.startPlans.plan({
    workflowId: String(world.descriptor.id),
    submissions,
    dryRun: options.dryRun ?? true,
  });
  if (plan.refused.length > 0) {
    throw new Error(`the start plan refused ${String(plan.refused.length)} of ${String(submissions.length)} entries`);
  }
  const result = world.commands.execute({
    ...commandEnvelope(),
    source: "start-run",
    family: "start",
    type: "start-run",
    target: {
      workflowId: String(world.descriptor.id),
      startPlanId: plan.startPlanId,
      expectedVersion: plan.expectedVersion,
    },
    payload: {
      descriptorFingerprint: plan.fingerprints.descriptorFingerprint,
      configFingerprint: plan.fingerprints.configFingerprint,
      ingressSchemaHash: plan.fingerprints.ingressSchemaHash,
      canonicalInputSchemaHash: plan.fingerprints.canonicalInputSchemaHash,
      inputFingerprint: plan.fingerprints.inputFingerprint,
    },
  });
  if (result.state !== "applied") {
    throw new Error(`the start command answered ${result.state}, not applied`);
  }
  return plan.planned.map((planned) => ({
    runId: planned.runId,
    title: planned.title,
    traceId: planned.traceId,
  }));
}

/* ── authority states a worker would have written ────────────────────────── */

/**
 * Walk a queued run to `parked-gate` through the SAME authority transitions the
 * executor makes (claim → running → parked-gate). Constructing the parked row
 * directly would skip the legality checks that make the park a state production
 * can actually reach — `claimed → parked-gate` is refused, and this is how a
 * test finds that out rather than inventing a row around it.
 */
export function parkAtIdentityGate(
  world: SeparationsDashboardWorld,
  runId: string,
): { readonly version: number } {
  const claim = world.database.authority.runs.claimNext({
    workflow: String(world.descriptor.id),
    workerId: WORKER_ID,
    now: world.clock.now().toISOString(),
  });
  if (claim.state !== "claimed") throw new Error(`expected a claim for ${runId}, got ${claim.state}`);
  if (claim.run.envelope.runId !== runId) {
    throw new Error(`the queue handed out ${claim.run.envelope.runId}, not ${runId}`);
  }
  const claimIdentity = { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration };
  const now = world.clock.now().toISOString();
  const running = world.database.authority.runs.transition({
    runId,
    expectedVersion: claim.run.version,
    claim: claimIdentity,
    lifecycle: {
      state: "running",
      workerId: WORKER_ID,
      claimedAt: now,
      heartbeatAt: now,
      currentNodeId: GATE_ID,
    },
    now,
  });
  if (running.state !== "applied") throw new Error(`could not run ${runId}: ${running.state}`);
  const parked = world.database.authority.runs.transition({
    runId,
    expectedVersion: running.run.version,
    claim: claimIdentity,
    lifecycle: { state: "parked-gate", gateId: GATE_ID, parkedAt: now, resumeAt: "approval" },
    now,
  });
  if (parked.state !== "applied") throw new Error(`could not park ${runId}: ${parked.state}`);
  return { version: parked.run.version };
}

/**
 * The `job-summary` checkpoint a run writes once UCPath has answered — the
 * fact ref dashboard-surfaces §1.2's subject projection reads. The VALUE is the
 * contract's own example, so a contract that renamed `displayedName` moves this
 * fixture with it instead of leaving a stale literal behind.
 */
export function seedJobSummaryCheckpoint(world: SeparationsDashboardWorld, runId: string): string {
  const run = world.database.authority.runs.get(runId);
  if (run === undefined) throw new Error(`run ${runId} is not in authority`);
  const example = UcpathReadJobSummary.example;
  world.database.withAuthorityTransaction((repositories) => repositories.runCheckpoints.insert(
    RunCheckpointRecordSchema.parse({
      workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId,
      nodeId: JOB_SUMMARY_NODE,
      attempt: run.envelope.attempt,
      claimGeneration: 1,
      runId,
      output: {
        schemaHash: deriveSchemaHash(UcpathReadJobSummary.output, "output"),
        value: UcpathReadJobSummary.output.parse(example),
      },
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      implFingerprint: run.envelope.contractFingerprint,
      provenance: [],
      writtenAt: world.clock.now().toISOString(),
    }),
  ));
  return example.displayedName;
}

/**
 * The identity evidence packet §9.22 approved, built by the PRODUCTION builder
 * from real reads rather than hand-assembled: `approvalShape` and the
 * comparison set are the builder's own conclusions, which is exactly what the
 * ceremony square is about — the SERVER decides the shape.
 */
export function separationsIdentityPacket(
  overrides: Readonly<{ documentName?: string; candidateEids?: readonly string[] }> = {},
): IdentityEvidencePacket {
  const eid = "10001754";
  const documentName = overrides.documentName ?? "Cramia, Dreitho";
  return buildIdentityEvidencePacket({
    documentNumber: DOCUMENT_NUMBER,
    documentName,
    documentEidText: eid,
    emplIdSource: "document-eid",
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: eid as never,
      displayedName: "Cramia, Dreitho",
      jobRows: [{
        rowIndex: 0,
        emplRecord: "0",
        hrStatus: "Active",
        businessUnit: "SDCMP",
        effectiveDate: { state: "present", value: "07/01/2025" },
        positionNumber: { state: "present", value: "40012345" },
        deptId: { state: "present", value: "000412" },
        department: { state: "present", value: "Housing Dining Hospitality" },
        jobCode: { state: "present", value: "004920" },
        jobTitle: { state: "present", value: "STDT 3" },
        expectedJobEndDate: { state: "absent", reason: "the grid rendered this cell empty" },
        fte: { state: "present", value: "0.500000" },
        emplClass: { state: "present", value: "Student" },
      }],
      rowCount: 1,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: NOW as never,
    },
    nameSelection: {
      status: "resolved",
      selected: {
        emplId: eid as never,
        name: "Cramia, Dreitho",
        department: "Housing Dining Hospitality",
        jobTitle: "STDT 3",
        employeeStatus: "active",
        hdh: true,
      },
      candidateEids: (overrides.candidateEids ?? [eid]) as never,
    },
    plan: SeparationWritePlanSchema.parse({
      state: "planned",
      termination: {
        terminationType: "Graduated/No longer a Student",
        classification: "involuntary",
        template: "UC_INVOL_TERM",
        reasonCode: "No Longer Student",
        emplRecord: "0",
        effectiveDate: "04/01/2026",
        lastDateWorked: "03/31/2026",
        initiatorComments: "Termination eff 04/01/2026. Last Day Worked 03/31/2026. Kuali form #4502.",
      },
      document: {
        documentNumber: DOCUMENT_NUMBER,
        department: "000412 - Housing/Dining/Hospitality",
        departmentCode: "000412",
        ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
        payrollTitleCode: "004920",
        payrollTitle: "STDT 3",
        terminationEffectiveDate: "04/01/2026",
        timekeeperName: "Julian Zaw",
      },
      dates: {
        kualiLastDayWorked: "03/31/2026",
        lastDayWorked: "03/31/2026",
        lastDayWorkedChanged: false,
        kualiSeparationDate: "03/31/2026",
        separationDate: "03/31/2026",
        separationDateChanged: false,
        separationDeterminingLeave: "none",
        unclassifiedPayCodes: ["Farmworkers Day"],
      },
    }),
  });
}

/**
 * The `comparison` checkpoint the gate waits on, stored under the run's own
 * item so the identity-gate section can locate it through `dependsOn`.
 */
export function seedIdentityPacketCheckpoint(
  world: SeparationsDashboardWorld,
  runId: string,
  packet: IdentityEvidencePacket,
): { readonly evidenceDigest: string } {
  const run = world.database.authority.runs.get(runId);
  if (run === undefined) throw new Error(`run ${runId} is not in authority`);
  const evidenceDigest = deriveIdentityEvidenceDigest(packet);
  world.database.withAuthorityTransaction((repositories) => repositories.runCheckpoints.insert(
    RunCheckpointRecordSchema.parse({
      workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId,
      nodeId: COMPARISON_NODE,
      attempt: run.envelope.attempt,
      claimGeneration: 1,
      runId,
      output: {
        schemaHash: deriveSchemaHash(MatchIdentityOutputSchema, "output"),
        value: MatchIdentityOutputSchema.parse({ packet, evidenceDigest }),
      },
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      implFingerprint: run.envelope.contractFingerprint,
      provenance: [],
      writtenAt: world.clock.now().toISOString(),
    }),
  ));
  return { evidenceDigest };
}

/** The descriptor's own gate result schema hash — the value the kernel demands. */
export function gateResultSchemaHash(world: SeparationsDashboardWorld): string {
  const view = gateNodeViews(world.descriptor).find(({ nodeId }) => nodeId === GATE_ID);
  if (view === undefined) throw new Error(`separations declares no gate "${GATE_ID}"`);
  return view.resultSchemaHash;
}
