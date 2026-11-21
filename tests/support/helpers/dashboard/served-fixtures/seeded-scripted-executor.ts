/**
 * Runs a seeded-server run through the real executor on a script the test holds. Each step that reaches UCPath
 * waits for the script, the declared gate parks the run, and the transaction's commit is recorded, never sent:
 * no system is contacted. Lifecycle rows, spans and write intents are the ones production writes.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import { DASHBOARD_CATALOG_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createWorkbookLibraryAdapter } from "../../../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createRunWorkbookService } from "../../../../../src/backend/runs/workbooks.js";
import { createDurableChildRunExecutor } from "../../../../../src/backend/runtime/execution/durable-child-executor.js";
import { executeClaimedRun } from "../../../../../src/backend/runtime/execution/run-executor.js";
import { WorkerActivitySchema, type WorkerActivity } from "../../../../../src/backend/runtime/workers/worker-messages.js";
import { WorkerSessionManager, withBoundRunConfigFingerprint } from "../../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteSequencer } from "../../../../../src/backend/runtime/writes/write-sequencer.js";
import { requireLifecycleApplied, workerRunLifecyclePort, type RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import type { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import type { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/index.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import type { WorkbookLibraryService } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import type { WorkbookActiveSelectionSchema } from "../../../../../src/models/dashboard/workbook-library.js";
import { REFERENCE_CHECK_REVIEW_GATE } from "../../../../../src/models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK } from "../../../../../src/models/processing/workbooks/verify-person.js";
import { UcpathPayPathReadSchema, type UcpathPayPathDriver } from "../../../../../src/models/ui/ucpath-paypath.js";
import { WorkStudyInput } from "../../../../../src/models/workflows/work-study/input.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../../src/rules/time/clock.js";
import { workflowProjections } from "../../../../../src/workflow-kit/workflow.js";
import { appliedRunIds } from "../../../fixtures/operator-command-fixtures.js";
import { sequentialIdFactory } from "../../../fixtures/phase1f-run-fixtures.js";
import { testAdmittedWorker } from "../../../fixtures/run-lifecycle-fixtures.js";
import { duoCeremonyGatesOver } from "../../duo-ceremony-fixtures.js";
import { ManualScheduler, recordingLogger, sessionFactoryHarness } from "../../phase1f-executor-harness.js";

const workStudyModule = DASHBOARD_CATALOG_MODULES.find(module => module.descriptor.id === "work-study");
if (workStudyModule === undefined) throw new Error("the dashboard catalog serves no Work-Study workflow");
/**
 * Work-Study: a UCPath read, an operator gate that opens when a picked reference spreadsheet does not hold the employee,
 * then one transaction. The dashboard bundle renders only workflows the product declares, so the script drives a product one.
 */
export const SCRIPTED_MODULE = workStudyModule;
export const SCRIPTED_WORKFLOW = workStudyModule.descriptor;
export const SCRIPTED_GATE_ID = REFERENCE_CHECK_REVIEW_GATE;
/** The transaction's node; a script holds it before it stages, as it holds the PayPath read before it. */
const WRITE_NODE = "save-transaction";
const EFFECTIVE_DATE = "08/03/2026";

export type ScriptedOutcome = Awaited<ReturnType<typeof executeClaimedRun>>;
export type ScriptedReference = z.infer<typeof WorkbookActiveSelectionSchema>;

/** Where a driven run stands: held at a declared step, or settled (parked at the gate, parked on a write, or ended). */
export type ScriptedPosition =
  | Readonly<{ at: "step"; nodeId: string }>
  | Readonly<{ at: "settled"; outcome: ScriptedOutcome }>;

export interface RecordedWrite {
  readonly runId: string;
  readonly nodeId: string;
  readonly eid: string;
}

export interface ScriptedRun {
  readonly runId: string;
  readonly position: ScriptedPosition;
  /** Lets the held step succeed; resolves at the next held step or when the run settles. */
  advance(): Promise<ScriptedPosition>;
  /** Makes the held step throw, which fails the run. */
  fail(): Promise<ScriptedPosition>;
  /** Held at the transaction: lets it fence and commit, then loses the commit's answer, which parks the write. */
  parkWrite(): Promise<ScriptedPosition>;
  /** Lets every remaining step succeed until the run settles. */
  finish(): Promise<ScriptedOutcome>;
}

export interface ScriptedExecutor {
  /** Claims the oldest queued scripted run, which must be `runId`, and executes it up to its first held step. */
  drive(runId: string): Promise<ScriptedRun>;
  /** Every commit a run asked for, in order. */
  writes(): readonly RecordedWrite[];
  /** A library spreadsheet that does not hold any scripted employee: a run started with it stops at the gate. */
  reviewReference(): ScriptedReference;
  close(): Promise<void>;
}

type Verdict = "pass" | "fail";
type PayPathWorld = ReturnType<typeof deterministicPayPathOperations>;
interface Driven {
  readonly runId: string;
  readonly paypath: PayPathWorld;
  release?: (verdict: Verdict) => void;
  arrive: (position: ScriptedPosition) => void;
  abort: (error: unknown) => void;
  /** Settles, never rejects, when the run's execution ends. */
  ended?: Promise<void>;
  releaseAll: boolean;
  failing: boolean;
  loseAnswer: boolean;
}

export function createScriptedExecutor(deps: Readonly<{
  database: AuthorityDatabase;
  clock: TestClock;
  lifecycle: RunRecordService;
  emitter: ReturnType<typeof createTimelineEmitter>;
  library: WorkbookLibraryService;
  /** The authority database path the worker slot is bound to. */
  profilePath: string;
  /** Tells the seeded pool what the scripted worker is doing, as a worker process reports its activity. */
  reportWorker: (workerId: string, activity: WorkerActivity) => void;
  /** Stands in for the dashboard's timeline poll: folds what the run just wrote and publishes it. */
  publish: () => void;
}>): ScriptedExecutor {
  const { database, clock, lifecycle, library } = deps;
  const descriptor = SCRIPTED_WORKFLOW;
  const recorded: RecordedWrite[] = [];
  /** One PayPath per employee, so a run resumed after its gate meets the transactions its employee already has. */
  const paypaths = new Map<string, PayPathWorld>();
  let driven: Driven | undefined;

  const active = (): Driven => {
    if (driven === undefined) throw new Error("the scripted UCPath was used outside a driven run");
    return driven;
  };
  const heldNode = (runId: string): string => {
    const run = database.authority.runs.get(runId);
    if (run?.lifecycle.state !== "running" || run.lifecycle.currentNodeId === undefined) {
      throw new Error(`scripted run ${runId} reached a step while ${run?.lifecycle.state ?? "absent"}`);
    }
    return run.lifecycle.currentNodeId;
  };
  /** Called where a step first touches UCPath: parks the step until the script answers. */
  const hold = async (): Promise<void> => {
    const current = active();
    if (current.failing) throw new Error("the script failed this step");
    if (current.releaseAll) return;
    const verdict = await new Promise<Verdict>((resolve) => {
      current.release = resolve;
      current.arrive({ at: "step", nodeId: heldNode(current.runId) });
    });
    if (verdict === "fail") {
      current.failing = true;
      throw new Error("the script failed this step");
    }
  };
  /** UCPath as the run's worker sees it: no page, the employee's deterministic PayPath, and a pause where the script holds. */
  const paypath: UcpathPayPathDriver & Pick<PayPathWorld, "readTransactionFindings" | "read"> = {
    readPayPathPosition: async (input) => { await hold(); return active().paypath.readPayPathPosition(input); },
    stagePayPathWorkStudy: async (target) => { await hold(); return active().paypath.stagePayPathWorkStudy(target); },
    readPayPathSubject: () => active().paypath.readPayPathSubject(),
    submitPayPathWorkStudy: async (input, capability) => {
      const current = active();
      // Recorded when asked, before the fake answers: a second Save for the same run shows as a second entry even if it is refused.
      recorded.push({ runId: current.runId, nodeId: heldNode(current.runId), eid: input.emplId });
      await current.paypath.submitPayPathWorkStudy(input, capability);
      if (current.loseAnswer) throw new Error("the Save and Submit answer was not observed");
    },
    readTransactionFindings: (input) => active().paypath.readTransactionFindings(input),
    read: (id) => active().paypath.read(id),
  };
  const paypathOf = (eid: string): PayPathWorld => {
    const known = paypaths.get(eid);
    if (known !== undefined) return known;
    const now = clock.now().toISOString();
    const created = deterministicPayPathOperations({ now, read: UcpathPayPathReadSchema.parse({
      pageStateId: "ucpath.paypath.position-data-ready", observedAt: now, emplId: eid, displayedName: "Lee, Jordan",
      position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
    }) });
    paypaths.set(eid, created);
    return created;
  };

  const ids = sequentialIdFactory("9");
  const runWorkbooks = createRunWorkbookService({ database, clock });
  let runtime: Promise<Readonly<{ execute: (runId: string) => Promise<ScriptedOutcome>; close: () => Promise<void> }>> | undefined;
  const start = async () => {
    const slot = testAdmittedWorker(database, clock, { path: deps.profilePath, workflow: descriptor.id, poolIndex: 1,
      browserSystems: workflowProjections(descriptor).systems }).member;
    deps.reportWorker(slot.workerId, WorkerActivitySchema.parse({ state: "idle" }));
    const scheduler = new ManualScheduler(clock);
    const manager = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(slot.workerId), workflowId: WorkflowIdSchema.parse(descriptor.id),
      stores: taskStoreRegistry, factory: sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath }) }).factory,
      browserScreenshotCapture: { capture: async () => undefined }, clock, scheduler, acquireDeadlineMs: 60_000,
      duoCeremony: duoCeremonyGatesOver(database, clock, scheduler) });
    manager.configureExecution(descriptor.id, taskStoreRegistry);
    const common = { lifecycle: workerRunLifecyclePort(lifecycle), stores: taskStoreRegistry, authority: database, sessions: manager, emitter: deps.emitter,
      childRuns: createDurableChildRunExecutor({ authority: database,
        admission: { admitAndRelease: (context, plan) => lifecycle.admitDelegation(context, plan) },
        resolveTarget: () => { throw new Error("the scripted workflow delegates to no child"); } }),
      taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }),
      clock, ids, scheduler, taskDeadlineMs: 60_000, log: recordingLogger().log };
    const writeSequencer = createWriteSequencer({ ...common, operator: "local-operator" });
    return { close: () => manager.closeAll("worker-stop"), execute: (runId: string): Promise<ScriptedOutcome> => {
      const config = database.authority.runtimeConfig.get();
      if (config === undefined) throw new Error("the seeded authority holds no runtime config");
      const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: ids.uuid(), workflow: descriptor.id, workerId: slot.workerId,
        runtimeConfig: { generation: config.generation, settingsRevision: config.settingsRevision,
          settingsFingerprint: config.settingsFingerprint, configFingerprint: config.configFingerprint } }));
      if (claimed.envelope.runId !== runId) {
        throw new Error(`the scripted worker claimed ${claimed.envelope.runId}; ${runId} is not the oldest queued scripted run`);
      }
      const providers = { configSnapshots: database.authority.configSnapshots, idFactory: { next: randomUUID },
        adapters: { "workbooks.library": createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId, clock,
          references: { runId, write: () => { throw new Error("the scripted workflow writes no reference"); },
            verifyPerson: command => runWorkbooks.verifyPerson(claimed, command) } }) } };
      deps.reportWorker(slot.workerId, WorkerActivitySchema.parse({ state: "busy", runId }));
      return withBoundRunConfigFingerprint(manager, claimed.envelope.configFingerprint, () => executeClaimedRun(
        { ...common, descriptor, writeSequencer, providers },
        { run: claimed, claim: { workerId: WorkerIdSchema.parse(slot.workerId), claimGeneration: claimed.claimGeneration }, signal: new AbortController().signal },
      ), claimed.envelope.browserMode, { runId: claimed.envelope.runId, descriptorFingerprint: claimed.envelope.contractFingerprint })
        .finally(() => { deps.reportWorker(slot.workerId, WorkerActivitySchema.parse({ state: "idle" })); });
    } };
  };

  async function drive(runId: string): Promise<ScriptedRun> {
    if (driven !== undefined) throw new Error(`scripted run ${driven.runId} is still being driven`);
    const { emplId } = WorkStudyInput.parse(database.authority.runs.get(runId)?.input.parsed.value);
    let position: ScriptedPosition | undefined;
    const current: Driven = { runId, paypath: paypathOf(emplId), releaseAll: false, failing: false, loseAnswer: false,
      arrive: () => undefined, abort: () => undefined };
    // Taken before the first await, so an overlapping drive is refused above.
    driven = current;
    runtime ??= start();
    const { execute } = await runtime.catch((error: unknown) => { driven = undefined; throw error; });
    const next = (): Promise<ScriptedPosition> => new Promise((resolve, reject) => {
      current.arrive = (reached) => { position = reached; deps.publish(); resolve(reached); };
      current.abort = reject;
    });
    const first = next();
    // The claim can throw before any step runs; inside the chain it rejects `first` and still releases `driven`.
    const outcome = Promise.resolve().then(() => execute(runId)).finally(() => { driven = undefined; });
    current.ended = outcome.then(() => undefined, () => undefined);
    outcome.then((settled) => current.arrive({ at: "settled", outcome: settled }), (error: unknown) => current.abort(error));
    const answer = async (verdict: Verdict): Promise<ScriptedPosition> => {
      const release = current.release;
      if (position?.at !== "step" || release === undefined) throw new Error(`scripted run ${runId} holds no step to answer`);
      delete current.release;
      const reached = next();
      release(verdict);
      return reached;
    };
    await first;
    return {
      runId,
      get position() {
        if (position === undefined) throw new Error(`scripted run ${runId} has not reached a position`);
        return position;
      },
      advance: () => answer("pass"),
      fail: () => answer("fail"),
      parkWrite: () => {
        if (position?.at !== "step" || position.nodeId !== WRITE_NODE) throw new Error("only the held transaction can park its write");
        current.loseAnswer = true;
        return answer("pass");
      },
      finish: async () => {
        current.releaseAll = true;
        current.release?.("pass");
        delete current.release;
        const settled = await outcome;
        deps.publish();
        return settled;
      },
    };
  }

  let referenceLibraryId: string | undefined;
  const reviewReference = (): ScriptedReference => {
    referenceLibraryId ??= library.create({ name: "Award roster.xlsx", themes: [], hasFormulas: false, sheets: [{
      id: "sheet", name: "Awards", width: 1, hidden: [], headerRow: 1,
      columnBindings: [{ id: "column-0", sourceColumn: 0, sourceHeader: "eid", fieldId: "eid", basis: "manual" }],
      rows: [{ id: "header", cells: [{ value: "eid" }] }, { id: "row-0", cells: [{ value: "10000009" }] }] }] }).libraryId;
    return { entry: 1, typeId: REFERENCE_CHECK.id, libraryId: referenceLibraryId, versionId: library.libraryVersion(referenceLibraryId).version.id,
      sheetId: "sheet", expectedVersion: library.read(referenceLibraryId).version };
  };

  return {
    drive,
    writes: () => Object.freeze([...recorded]),
    reviewReference,
    close: async () => {
      // A run left held is a test fault: fail its step so the execution ends and the sessions close, then say so.
      const held = driven;
      if (held !== undefined) {
        held.failing = true;
        held.release?.("fail");
        await held.ended;
      }
      await (await runtime)?.close();
      if (held !== undefined) throw new Error(`scripted run ${held.runId} was left held at a step`);
    },
  };
}

/** Sends one JSON request to the seeded server's API and answers its parsed body. */
export type SeededRequest = (path: string, body?: unknown) => Promise<unknown>;

/** A request port over the served origin, with the Origin the operator-mutation guard admits. */
export function seededRequestOver(baseUrl: string): SeededRequest {
  return async (path, body) => {
    const response = await fetch(new URL(path, baseUrl), body === undefined ? {} : {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: JSON.stringify(body) });
    const parsed: unknown = await response.json();
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}: ${JSON.stringify(parsed)}`);
    return parsed;
  };
}

const operatorCommand = (now: string) => ({ commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard" });

/** Starts one scripted run the way the Run dialog does: a start plan, then its start-run command. A `reference` makes the run stop at the gate. */
export async function startScriptedRun(request: SeededRequest, now: string, eid: string, reference?: ScriptedReference): Promise<string> {
  const plan = StartPlanWireSchema.parse(await request("/api/v1/start-plans", { workflowId: SCRIPTED_WORKFLOW.id,
    submissions: [{ emplId: eid, effectiveDate: EFFECTIVE_DATE }], dryRun: false, selectedStepKeys: SCRIPTED_WORKFLOW.timeline.map(step => step.key),
    ...(reference === undefined ? {} : { workbookReferences: [reference] }) }));
  if (plan.planned.length !== 1) throw new Error(`the scripted start plan was refused: ${JSON.stringify(plan.refused)}`);
  const result = CommandResultSchema.parse(await request("/api/v1/commands", { ...operatorCommand(now), family: "start", type: "start-run",
    target: { workflowId: SCRIPTED_WORKFLOW.id, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }));
  const runIds = appliedRunIds(result);
  const runId = runIds[0];
  if (runIds.length !== 1 || runId === undefined) throw new Error(`the scripted start applied ${String(runIds.length)} runs: ${JSON.stringify(result)}`);
  return runId;
}

/** Answers the open gate's "Continue anyway" arm with the command its Logs card sends; the run returns to the queue. */
export async function approveScriptedGate(request: SeededRequest, now: string, runId: string): Promise<void> {
  const detail = RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`));
  const result = CommandResultSchema.parse(await request("/api/v1/commands", { ...operatorCommand(now), family: "gate", type: "answer-gate-arm",
    target: { runId, gateId: SCRIPTED_GATE_ID, expectedVersion: detail.rowRevision }, payload: { arm: "continue" } }));
  if (result.state !== "applied") throw new Error(`the scripted gate approval was ${result.state}: ${JSON.stringify(result)}`);
}
