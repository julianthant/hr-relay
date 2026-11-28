/**
 * Runs a seeded-server run through the real executor on a script the test holds. Each step that reaches a system
 * waits for the script, a declared gate parks the run, and a transaction's commit is recorded, never sent:
 * no system is contacted. Lifecycle rows, spans and write intents are the ones production writes.
 * The workflows it can run, and their system fakes, are in `scripted-workflows.ts`.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { z } from "zod";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import { I9_CHECK_REFERENCE } from "../../../../../src/models/workflows/i9-check/start.js";
import { WorkbookReferenceReadRequestSchema } from "../../../../../src/models/processing/workbooks/read-reference.js";
import { createWorkbookLibraryAdapter } from "../../../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createOcrReviewAdapter } from "../../../../../src/backend/processing/providers/ocr-review-adapter.js";
import { createOcrApprovedSnapshotAdapter } from "../../../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import { createOcrSourceService } from "../../../../../src/backend/runs/commands/ocr-source-service.js";
import { createApprovedOcrRecordReader } from "../../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { createOcrCheckpointPublication } from "../../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { createServerVerifiedArtifactReader } from "../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createRunWorkbookService } from "../../../../../src/backend/runs/workbooks.js";
import { createDurableChildRunExecutor } from "../../../../../src/backend/runtime/execution/durable-child-executor.js";
import { executeClaimedRun } from "../../../../../src/backend/runtime/execution/run-executor.js";
import type { ChatGptOcrAdapter } from "../../../../../src/backend/processing/providers/provider-client.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest, ocrSnapshotDigest } from "../../../../../src/models/ocr/review.js";
import { OcrApprovalReferenceSchema } from "../../../../../src/models/workflows/ocr/result.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { WorkerActivitySchema, type WorkerActivity } from "../../../../../src/backend/runtime/workers/worker-messages.js";
import { WorkerSessionManager, withBoundRunConfigFingerprint } from "../../../../../src/backend/runtime/workers/worker-sessions.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createArtifactSinkProjector } from "../../../../../src/backend/storage/artifacts/artifact-sink-projector.js";
import { createXlsxRetentionSink } from "../../../../../src/backend/storage/artifacts/xlsx-retention-sink.js";
import { i9CheckTrackerTable } from "../../../../../src/rules/i9-check/workbook.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { createNamedFileOutputSink } from "../../../../../src/backend/storage/artifacts/named-file-output-sink.js";
import { createWriteSequencer } from "../../../../../src/backend/runtime/writes/write-sequencer.js";
import { requireLifecycleApplied, workerRunLifecyclePort, type RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import type { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import type { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import type { WorkbookLibraryService } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import type { WorkbookActiveSelectionSchema } from "../../../../../src/models/dashboard/workbook-library.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../../../../src/models/workflows/crm-doc-download/documents.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_TYPE_ID } from "../../../../../src/models/workflows/onboarding/roster.js";
import { OCR_ROSTER_FIELDS, OCR_ROSTER_TYPE_ID } from "../../../../../src/models/workflows/ocr/roster.js";
import { REFERENCE_CHECK_ID } from "../../../../../src/models/processing/workbooks/reference-fields.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../../src/rules/time/clock.js";
import { defineTaskStoreRegistry } from "../../../../../src/workflow-kit/task-registry.js";
import { workflowProjections } from "../../../../../src/workflow-kit/workflow.js";
import { appliedRunIds } from "../../../fixtures/operator-command-fixtures.js";
import { sequentialIdFactory } from "../../../fixtures/phase1f-run-fixtures.js";
import { testAdmittedWorker } from "../../../fixtures/run-lifecycle-fixtures.js";
import { syntheticStateRoot } from "../../synthetic-storage-admission.js";
import { duoCeremonyGatesOver } from "../../duo-ceremony-fixtures.js";
import { ManualScheduler, recordingLogger, sessionFactoryHarness } from "../../phase1f-executor-harness.js";
import { I9_PEOPLE, scriptedDescriptorOf, scriptedWorkflow, WORK_STUDY_SCRIPT, type RecordedWrite, type ScriptWorld, type ScriptedWorkflow } from "./scripted-workflows.js";

export type { RecordedWrite } from "./scripted-workflows.js";

export type ScriptedOutcome = Awaited<ReturnType<typeof executeClaimedRun>>;
export type ScriptedReference = z.infer<typeof WorkbookActiveSelectionSchema>;

/** Where a driven run stands: held at a declared step, or settled (parked at the gate, parked on a write, or ended). */
export type ScriptedPosition =
  | Readonly<{ at: "step"; nodeId: string }>
  | Readonly<{ at: "settled"; outcome: ScriptedOutcome }>;

export interface ScriptedRun {
  readonly runId: string;
  readonly position: ScriptedPosition;
  /** Lets the held step succeed after it has taken `delayMs` on the clock; resolves at the next held step or when the run settles. */
  advance(delayMs?: number): Promise<ScriptedPosition>;
  /** Makes the held step throw, which fails the run. */
  fail(): Promise<ScriptedPosition>;
  /** Held at the transaction: lets it fence and commit, then loses the commit's answer, which parks the write. */
  parkWrite(): Promise<ScriptedPosition>;
  /** Lets every remaining step succeed until the run settles. */
  finish(): Promise<ScriptedOutcome>;
}

export interface ScriptedExecutor {
  /** Claims the oldest queued run of the workflow, which must be `runId`, and executes it up to its first held step. */
  drive(runId: string): Promise<ScriptedRun>;
  /** Every commit a run asked for, in order. */
  writes(): readonly RecordedWrite[];
  /** A library spreadsheet that does not hold any scripted employee: a Work-Study run started with it stops at the gate. */
  reviewReference(): ScriptedReference;
  /** A library spreadsheet typed as the onboarding roster, holding one row per `[email, first name, last name]`. */
  rosterReference(rows: readonly (readonly [string, string, string])[]): ScriptedReference;
  /** A library spreadsheet typed as the onboarding roster (ONBOARDING_ROSTER_FIELDS), one row per `[email, full name]`. */
  onboardingRosterReference(rows: readonly (readonly [string, string])[]): ScriptedReference;
  /** The start-plan submission for one subject; a workflow that reads a PDF uploads its document first. */
  submission(script: ScriptedWorkflow, subject: string): Promise<Record<string, unknown>>;
  /** The command that approves every record of a run's OCR review, which releases the records to the members; the OCR run is parked at its gate. */
  ocrApproval(rootRunId: string): Record<string, unknown>;
  /** Corrects and approves every OCR review parked under a run, asserting the employee ID the script names for each record, through the commands the Logs review sends. */
  approveOcrReviews(request: SeededRequest, now: string, rootRunId: string): Promise<void>;
  /** A library spreadsheet typed as the I-9 Check action history, holding a row for each scripted I-9 person. */
  i9Reference(): ScriptedReference;
  /** A library spreadsheet typed as the OCR roster with no people, which an Emergency Contact run needs to match the people it reads. */
  ocrRosterReference(): ScriptedReference;
  /** Where a run's published documents land. */
  documentsDirectory(): string;
  close(): Promise<void>;
}

type Verdict = "pass" | "fail";
interface Driven {
  readonly runId: string;
  readonly script: ScriptedWorkflow;
  /** The run in the tree being executed: the root, or a child it delegated to. */
  execId: string;
  release?: (verdict: Verdict) => void;
  arrive: (position: ScriptedPosition) => void;
  abort: (error: unknown) => void;
  /** Settles, never rejects, when the run's execution ends. */
  ended?: Promise<void>;
  releaseAll: boolean;
  failing: boolean;
  loseAnswer: boolean;
}

type Runtime = Readonly<{ execute: (runId: string) => Promise<ScriptedOutcome>; close: () => Promise<void> }>;

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
}>): ScriptedExecutor {
  const { database, clock, lifecycle, library } = deps;
  const recorded: RecordedWrite[] = [];
  let driven: Driven | undefined;

  const active = (): Driven => {
    if (driven === undefined) throw new Error("the scripted system was used outside a driven run");
    return driven;
  };
  const heldNode = (runId: string): string => {
    const run = database.authority.runs.get(runId);
    if (run?.lifecycle.state !== "running" || run.lifecycle.currentNodeId === undefined) {
      throw new Error(`scripted run ${runId} reached a step while ${run?.lifecycle.state ?? "absent"}`);
    }
    return run.lifecycle.currentNodeId;
  };
  /** Called where a step first touches a system: parks the step until the script answers. */
  const hold = async (): Promise<void> => {
    const current = active();
    await nextTurn();
    if (current.failing) throw new Error("the script failed this step");
    if (current.releaseAll) return;
    const verdict = await new Promise<Verdict>((resolve) => {
      current.release = resolve;
      current.arrive({ at: "step", nodeId: heldNode(current.execId) });
    });
    if (verdict === "fail") {
      current.failing = true;
      throw new Error("the script failed this step");
    }
  };
  const world: ScriptWorld = { clock, hold, record: write => { recorded.push(write); },
    uploadPdf: async bytes => (await sources.upload({ actorId: "local-operator", fileName: "source.pdf", mediaType: "application/pdf", bytes })).artifact,
    putImage: bytes => artifacts.put(bytes, { mediaType: "image/png" }),
    run: () => {
      const current = active();
      const executing = database.authority.runs.get(current.execId);
      if (executing === undefined) throw new Error(`scripted run ${current.execId} does not exist`);
      return { runId: current.execId, subject: current.script.subjectOf(executing.input.parsed.value, executing.envelope.workflow),
        heldNode: () => heldNode(current.execId), loseAnswer: () => current.loseAnswer };
    } };

  const stateRoot = dirname(deps.profilePath);
  const documentsDirectory = join(stateRoot, "published-documents");
  const admission = syntheticStateRoot(stateRoot);
  const artifacts = createContentAddressedArtifactWriter({ admission });
  const artifactProjector = createArtifactSinkProjector({ authority: database.authority, clock,
    withAuthorityTransaction: work => database.withAuthorityTransaction(work), lockDir: join(stateRoot, "scratch", "artifact-sinks"),
    sinks: { "documents-file": createNamedFileOutputSink({ artifacts, documentsDirectory: () => documentsDirectory }),
      "xlsx-retention": createXlsxRetentionSink({ artifacts, workbookPath: () => join(documentsDirectory, "i9-check-tracker.xlsx"), view: i9CheckTrackerTable }) } });
  const artifactReader = createServerVerifiedArtifactReader({ admission });
  const ids = sequentialIdFactory("9");
  const runWorkbooks = createRunWorkbookService({ database, clock, resolveDescriptor: scriptedDescriptorOf });
  const sources = createOcrSourceService({ database, reader: lifecycle, clock, artifacts, artifactReader, assertCurrent: () => admission.assertProfileRuntime() });
  /** A results workbook published to the library from the script's write node is that workflow's write: recorded when asked. */
  const recordingPublishes = (run: RunRecord, script: ScriptedWorkflow, adapter: ReturnType<typeof createWorkbookLibraryAdapter>) => ({ ...adapter,
    invoke: (...args: Parameters<typeof adapter.invoke>) => {
      const nodeId = heldNode(run.envelope.runId);
      if (nodeId === script.writeNode && args[0].payload.schemaHash !== deriveSchemaHash(WorkbookReferenceReadRequestSchema, "output")) recorded.push({ runId: run.envelope.runId, nodeId, eid: "" });
      return adapter.invoke(...args);
    } });
  const runtimes = new Map<string, Promise<Runtime>>();
  const resolveDescriptor = (workflowId: string) => scriptedDescriptorOf(workflowId);
  /** True when `runId` is `rootId` or a run it delegated to, at any depth. */
  const inTree = (runId: string, rootId: string): boolean => {
    for (let id: string | undefined = runId; id !== undefined; id = database.authority.runs.get(id)?.envelope.parent?.runId) if (id === rootId) return true;
    return false;
  };
  const refuseOcr: ChatGptOcrAdapter = { capability: "ocr.extract", policy: { kind: "chatgpt-subscription-only", timeoutMs: 120_000 },
    invoke: () => { throw new Error("the scripted workflow reads no page with the OCR provider"); } };
  const start = async (script: ScriptedWorkflow): Promise<Runtime> => {
    const descriptor = script.module.descriptor;
    const tree = [script.module, ...(script.children ?? [])].map(module => module.descriptor);
    // The next free slot, so a workflow the seed already runs workers for keeps its own.
    const poolIndex = Math.max(0, ...database.authority.workerSlots.active(descriptor.id).map(slot => slot.poolIndex)) + 1;
    const slot = testAdmittedWorker(database, clock, { path: deps.profilePath, workflow: descriptor.id, poolIndex,
      browserSystems: [...new Set(tree.flatMap(member => workflowProjections(member).systems))] }).member;
    deps.reportWorker(slot.workerId, WorkerActivitySchema.parse({ state: "idle" }));
    const scheduler = new ManualScheduler(clock);
    const overrides = script.stores?.(world) ?? [];
    const entries = [...taskStoreRegistry.stores.filter(store => !overrides.some(override => override.namespace === store.namespace)), ...overrides];
    const tasks = entries.flatMap(store => Object.values(store.tasks));
    const stores = overrides.length === 0 ? taskStoreRegistry : defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))],
      tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
    const manager = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(slot.workerId), workflowId: WorkflowIdSchema.parse(descriptor.id),
      stores, factory: sessionFactoryHarness(script.drivers(world)).factory,
      browserScreenshotCapture: { capture: async () => undefined }, clock, scheduler, acquireDeadlineMs: 60_000,
      duoCeremony: duoCeremonyGatesOver(database, clock, scheduler) });
    const common = { lifecycle: workerRunLifecyclePort(lifecycle), stores, authority: database, sessions: manager, emitter: deps.emitter,
      childRuns: createDurableChildRunExecutor({ authority: database,
        admission: { admitAndRelease: (context, plan) => lifecycle.admitDelegation(context, plan) },
        resolveTarget: (workflowId) => {
          const target = tree.find(member => member.id === workflowId);
          if (target === undefined) throw new Error(`the scripted ${descriptor.id} workflow delegates to no ${workflowId} child`);
          return target;
        } }),
      taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }),
      clock, ids, scheduler, taskDeadlineMs: 60_000, log: recordingLogger().log };
    const writeSequencer = createWriteSequencer({ ...common, operator: "local-operator" });
    const executeOne = (rootId: string): Promise<Readonly<{ run: RunRecord; outcome: ScriptedOutcome }>> => {
      const config = database.authority.runtimeConfig.get();
      if (config === undefined) throw new Error("the seeded authority holds no runtime config");
      const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: ids.uuid(), workflow: descriptor.id, workerId: slot.workerId,
        runtimeConfig: { generation: config.generation, settingsRevision: config.settingsRevision,
          settingsFingerprint: config.settingsFingerprint, configFingerprint: config.configFingerprint } },
        // Refused inside the claim's transaction, before the claim is written: a queued run outside this tree stays queued for its own drive.
        (candidate) => {
          if (!inTree(candidate.envelope.runId, rootId)) {
            throw new Error(`the scripted worker would claim ${candidate.envelope.runId}; ${rootId} is not the oldest queued ${descriptor.id} run`);
          }
        }));
      const target = tree.find(member => member.id === claimed.envelope.workflow);
      if (target === undefined) throw new Error(`the scripted ${descriptor.id} workflow claimed a ${claimed.envelope.workflow} run it has no descriptor for`);
      active().execId = claimed.envelope.runId;
      manager.configureExecution(target.id, stores);
      const providers = { configSnapshots: database.authority.configSnapshots, idFactory: { next: randomUUID },
        adapters: { "ocr.extract": refuseOcr,
          "ocr.review": createOcrReviewAdapter({ clock, reader: createApprovedOcrRecordReader({ database, run: claimed, reader: lifecycle,
            resolveDescriptor, assertCurrent: () => admission.assertProfileRuntime() }) }),
          "ocr.approved-snapshot": createOcrApprovedSnapshotAdapter({ clock, reader: createApprovedOcrRecordReader({ database, run: claimed, reader: lifecycle,
            resolveDescriptor, assertCurrent: () => admission.assertProfileRuntime() }) }),
          "workbooks.library": recordingPublishes(claimed, script, createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId: claimed.envelope.runId, clock,
            publicationSource: () => ({ workflowId: target.id, workflowLabel: target.label, partitionDay: searchPartitionDay(new Date(claimed.envelope.enqueuedAt)) }),
            references: { runId: claimed.envelope.runId, write: command => { if (target.id !== "onboarding") throw new Error("the scripted workflow writes no reference"); return runWorkbooks.write(claimed, command); }, read: command => runWorkbooks.read(claimed, command),
              readFields: command => runWorkbooks.readReferenceFields(claimed, command) } })) } };
      deps.reportWorker(slot.workerId, WorkerActivitySchema.parse({ state: "busy", runId: claimed.envelope.runId }));
      return withBoundRunConfigFingerprint(manager, claimed.envelope.configFingerprint, () => executeClaimedRun(
        { ...common, descriptor: target, writeSequencer, providers, artifacts, artifactProjector,
          publishCheckpoint: createOcrCheckpointPublication(lifecycle, claimed, resolveDescriptor) },
        { run: claimed, claim: { workerId: WorkerIdSchema.parse(slot.workerId), claimGeneration: claimed.claimGeneration }, signal: new AbortController().signal },
      ), claimed.envelope.browserMode, { runId: claimed.envelope.runId, descriptorFingerprint: claimed.envelope.contractFingerprint })
        .then(outcome => ({ run: claimed, outcome }))
        .finally(() => { deps.reportWorker(slot.workerId, WorkerActivitySchema.parse({ state: "idle" })); });
    };
    return { close: () => manager.closeAll("worker-stop"), execute: async (rootId: string): Promise<ScriptedOutcome> => {
      // This worker shares the seeded server's process: each claim and hold yields a turn so the server answers the page between steps.
      await nextTurn();
      let executed = await executeOne(rootId);
      // A run that delegates runs its children on this worker, then itself again; a failed child leaves the parent queued to account for it.
      for (;;) {
        const root = database.authority.runs.get(rootId);
        const continues = executed.outcome.state === "done" || executed.outcome.state === "yielded-delegation"
          || executed.outcome.state === "failed" && executed.run.envelope.runId !== rootId && root?.lifecycle.state === "queued";
        if (root?.lifecycle.state === "terminal" || !continues) return executed.outcome;
        await manager.closeAll("parked");
        await nextTurn();
        executed = await executeOne(rootId);
      }
    } };
  };

  async function drive(runId: string): Promise<ScriptedRun> {
    if (driven !== undefined) throw new Error(`scripted run ${driven.runId} is still being driven`);
    const stored = database.authority.runs.get(runId);
    if (stored === undefined) throw new Error(`scripted run ${runId} does not exist`);
    const script = scriptedWorkflow(stored.envelope.workflow);
    let position: ScriptedPosition | undefined;
    const current: Driven = { runId, script, execId: runId, releaseAll: false, failing: false, loseAnswer: false,
      arrive: () => undefined, abort: () => undefined };
    // Taken before the first await, so an overlapping drive is refused above.
    driven = current;
    const runtime = runtimes.get(script.module.descriptor.id) ?? start(script);
    runtimes.set(script.module.descriptor.id, runtime);
    const { execute } = await runtime.catch((error: unknown) => { driven = undefined; throw error; });
    const next = (): Promise<ScriptedPosition> => new Promise((resolve, reject) => {
      current.arrive = (reached) => { position = reached; resolve(reached); };
      current.abort = reject;
    });
    const first = next();
    // The claim can throw before any step runs; inside the chain it rejects `first` and still releases `driven`.
    const outcome = Promise.resolve().then(() => execute(runId)).finally(() => { driven = undefined; });
    current.ended = outcome.then(() => undefined, () => undefined);
    outcome.then((settled) => current.arrive({ at: "settled", outcome: settled }), (error: unknown) => current.abort(error));
    /** Answers the live hold. `decide` runs only once the hold is proven, so a refused answer changes nothing about the run. */
    const answer = async (verdict: Verdict, heldAt?: string, decide?: () => void): Promise<ScriptedPosition> => {
      const release = current.release;
      if (position?.at !== "step" || release === undefined) throw new Error(`scripted run ${runId} holds no step to answer`);
      if (heldAt !== undefined && position.nodeId !== heldAt) throw new Error(`scripted run ${runId} is held at ${position.nodeId}, not ${heldAt}`);
      delete current.release;
      decide?.();
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
      advance: (delayMs = 0) => answer("pass", undefined, () => { if (delayMs > 0) { clock.advanceWall(delayMs); clock.advanceMonotonic(delayMs); } }),
      fail: () => answer("fail"),
      parkWrite: () => answer("pass", script.writeNode, () => { current.loseAnswer = true; }),
      finish: async () => {
        current.releaseAll = true;
        current.release?.("pass");
        delete current.release;
        return outcome;
      },
    };
  }

  let referenceLibraryId: string | undefined;
  const reviewReference = (): ScriptedReference => {
    referenceLibraryId ??= library.create({ name: "Award roster.xlsx", themes: [], hasFormulas: false, sheets: [{
      id: "sheet", name: "Awards", width: 2, hidden: [], headerRow: 1,
      columnBindings: [{ id: "column-0", sourceColumn: 0, sourceHeader: "eid", fieldId: "eid", basis: "manual" },
        { id: "column-1", sourceColumn: 1, sourceHeader: "fullName", fieldId: "fullName", basis: "manual" }],
      rows: [{ id: "header", cells: [{ value: "eid" }, { value: "fullName" }] },
        { id: "row-0", cells: [{ value: "10812345" }, { value: "Fictional Different Person" }] }] }] }).libraryId;
    return { entry: 1, typeId: REFERENCE_CHECK_ID, libraryId: referenceLibraryId, versionId: library.libraryVersion(referenceLibraryId).version.id,
      sheetId: "sheet", expectedVersion: library.read(referenceLibraryId).version };
  };

  const rosterLibraries = new Map<string, string>();
  const rosterReference = (rows: readonly (readonly [string, string, string])[]): ScriptedReference => {
    const key = JSON.stringify(rows);
    let libraryId = rosterLibraries.get(key);
    if (libraryId === undefined) {
      const fields = [...CRM_DOCUMENT_ROSTER_FIELDS];
      const saved = library.create({ name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [{
        id: "sheet", name: "July 6", width: fields.length, hidden: [], headerRow: 1,
        columnBindings: fields.map((fieldId, index) => ({ id: `column-${String(index)}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
        rows: [{ id: "header", cells: fields.map(value => ({ value })) },
          ...rows.map(([email, first, last], index) => ({ id: `row-${String(index)}`,
            cells: fields.map(field => ({ value: field === "email" ? email : field === "firstName" ? first : field === "lastName" ? last : field === "middleName" ? "" : null })) }))] }] });
      library.putType({ id: ONBOARDING_ROSTER_TYPE_ID, name: "Onboarding roster", keyFieldId: "email", fields, defaultWorkbookId: null });
      library.operatorOperation(saved.libraryId, "type", { kind: "metadata", expectedVersion: saved.version, metadata: { typeId: ONBOARDING_ROSTER_TYPE_ID, sharePoint: null } });
      libraryId = saved.libraryId;
      rosterLibraries.set(key, libraryId);
    }
    return { entry: 1, typeId: ONBOARDING_ROSTER_TYPE_ID, libraryId, versionId: "original", sheetId: "sheet", expectedVersion: library.read(libraryId).version };
  };

  let ocrRosterLibraryId: string | undefined;
  const ocrRosterReference = (): ScriptedReference => {
    if (ocrRosterLibraryId === undefined) {
      const saved = library.create({ name: "OCR roster", themes: [], hasFormulas: false, sheets: [{
        id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
        columnBindings: OCR_ROSTER_FIELDS.map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
        rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }] }] }] });
      library.putType({ id: OCR_ROSTER_TYPE_ID, name: "OCR roster", keyFieldId: "eid", fields: [...OCR_ROSTER_FIELDS], defaultWorkbookId: null });
      library.operatorOperation(saved.libraryId, "set-roster-type", { kind: "metadata", expectedVersion: saved.version, metadata: { typeId: OCR_ROSTER_TYPE_ID, sharePoint: null } });
      ocrRosterLibraryId = saved.libraryId;
    }
    return { entry: 1, typeId: OCR_ROSTER_TYPE_ID, libraryId: ocrRosterLibraryId, versionId: library.libraryVersion(ocrRosterLibraryId).version.id,
      sheetId: "people", expectedVersion: library.read(ocrRosterLibraryId).version };
  };

  let i9LibraryId: string | undefined;
  const i9Reference = (): ScriptedReference => {
    if (i9LibraryId === undefined) {
      const columns = [...I9_CHECK_REFERENCE.fields];
      const saved = library.create({ name: "Action History", themes: [], hasFormulas: false, sheets: [{ id: "history", name: "Action History", width: columns.length, hidden: [], headerRow: 1,
        columnBindings: columns.map((fieldId, index) => ({ id: `column-${String(index)}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
        rows: [{ id: "header", cells: columns.map(value => ({ value })) }, ...I9_PEOPLE.map((person, index) => ({ id: `person-${String(index)}`,
          cells: [person.eid, "000012345", "2024-01-01", "TER"].map(value => ({ value })) }))] }] });
      library.putType({ id: I9_CHECK_REFERENCE.typeId, name: "Action History", keyFieldId: "eid", fields: columns, defaultWorkbookId: null });
      library.operatorOperation(saved.libraryId, "i9-reference-type", { kind: "metadata", expectedVersion: saved.version, metadata: { typeId: I9_CHECK_REFERENCE.typeId, sharePoint: null } });
      i9LibraryId = saved.libraryId;
    }
    return { entry: 1, typeId: I9_CHECK_REFERENCE.typeId, libraryId: i9LibraryId, versionId: "original", sheetId: "history", expectedVersion: library.read(i9LibraryId).version };
  };

  const ocrApproval = (rootRunId: string, ocrRunId?: string): Record<string, unknown> => {
    const ocr = database.authority.runs.listChildren(rootRunId).find(child => child.envelope.workflow === "ocr" && (ocrRunId === undefined || child.envelope.runId === ocrRunId));
    const review = ocr === undefined ? undefined : database.authority.ocrReviews.latest(ocr.envelope.runId);
    if (ocr === undefined || review === undefined) throw new Error(`scripted run ${rootRunId} has no OCR review to approve`);
    const commandId = randomUUID();
    const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: ocr.envelope.runId, revision: review.revision,
      reviewDigest: ocrReviewDigest(review), selectedRecordIds: review.records.map(record => record.recordId), records: review.records,
      approvedBy: "local-operator", approvedAt: clock.now().toISOString() });
    return { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
      target: { runId: ocr.envelope.runId, gateId: "approve-records", expectedVersion: ocr.version },
      payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: { snapshotId: commandId, sourceRunId: ocr.envelope.runId,
        revision: review.revision, digest: ocrSnapshotDigest(snapshot) } },
      ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: snapshot.selectedRecordIds } } };
  };

  const approveOcrReviews = async (request: SeededRequest, now: string, rootRunId: string): Promise<void> => {
    const root = database.authority.runs.get(rootRunId);
    if (root === undefined) throw new Error(`scripted run ${rootRunId} does not exist`);
    const script = scriptedWorkflow(root.envelope.workflow);
    const parked = database.authority.runs.listChildren(rootRunId).filter(child => child.envelope.workflow === "ocr" && child.lifecycle.state === "parked-gate");
    if (parked.length === 0) throw new Error(`scripted run ${rootRunId} has no OCR review parked at its gate`);
    for (const ocr of parked) {
      const ocrRunId = ocr.envelope.runId;
      for (const { recordId } of database.authority.ocrReviews.latest(ocrRunId)?.records ?? []) {
        const review = database.authority.ocrReviews.latest(ocrRunId);
        const record = review?.records.find(candidate => candidate.recordId === recordId);
        if (review === undefined || record === undefined) throw new Error(`scripted OCR record ${recordId} is gone`);
        const eid = script.assertedEid?.(Object.fromEntries(record.fields.answers.map(answer => [answer.path, answer.state === "read" ? answer.raw : undefined])));
        if (eid === undefined) throw new Error(`the script asserts no employee ID for OCR record ${recordId}`);
        const result = CommandResultSchema.parse(await request("/api/v1/commands", { ...operatorCommand(now), family: "ocr-review", type: "correct-ocr-record",
          target: { runId: ocrRunId, expectedRevision: review.revision }, payload: { recordId, fields: record.fields, assertedEid: eid } }));
        if (result.state !== "applied") throw new Error(`the scripted OCR correction was ${result.state}: ${JSON.stringify(result)}`);
      }
      const result = CommandResultSchema.parse(await request("/api/v1/commands", ocrApproval(rootRunId, ocrRunId)));
      if (result.state !== "applied") throw new Error(`the scripted OCR approval was ${result.state}: ${JSON.stringify(result)}`);
    }
  };

  const onboardingRosterReference = (rows: readonly (readonly [string, string])[]): ScriptedReference => {
    const fields = [...ONBOARDING_ROSTER_FIELDS];
    const saved = library.create({ name: "Onboarding roster.xlsx", themes: [], hasFormulas: false, sheets: [{
      id: "sheet", name: "Hires", width: fields.length, hidden: [], headerRow: 1,
      columnBindings: fields.map((fieldId, index) => ({ id: `column-${String(index)}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
      rows: [{ id: "header", cells: fields.map(value => ({ value })) },
        ...rows.map(([email, fullName], index) => ({ id: `row-${String(index)}`, cells: fields.map(field => ({ value: field === "email" ? email : field === "fullName" ? fullName : null })) }))] }] });
    library.putType({ id: ONBOARDING_ROSTER_TYPE_ID, name: "Onboarding roster", keyFieldId: "email", fields, defaultWorkbookId: null });
    library.operatorOperation(saved.libraryId, "type", { kind: "metadata", expectedVersion: saved.version, metadata: { typeId: ONBOARDING_ROSTER_TYPE_ID, sharePoint: null } });
    return { entry: 1, typeId: ONBOARDING_ROSTER_TYPE_ID, libraryId: saved.libraryId, versionId: "original", sheetId: "sheet", expectedVersion: library.read(saved.libraryId).version };
  };

  return {
    drive,
    onboardingRosterReference,
    approveOcrReviews,
    i9Reference,
    rosterReference,
    ocrRosterReference,
    submission: async (script, subject) => script.prepare === undefined ? script.submission(subject) : script.prepare(world, subject),
    ocrApproval,
    documentsDirectory: () => documentsDirectory,
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
      for (const runtime of runtimes.values()) await (await runtime).close();
      if (held !== undefined) throw new Error(`scripted run ${held.runId} was left held at a step`);
    },
  };
}

/** Sends one JSON request to the seeded server's API and answers its parsed body. */
export type SeededRequest = (path: string, body?: unknown) => Promise<unknown>;

/** A request port over the served origin, with the Origin the operator-mutation guard admits. */
export function seededRequestOver(baseUrl: string): SeededRequest {
  return async (path, body) => {
    // A fresh connection per request: a drive can outlast the server's keep-alive, which resets a pooled connection.
    const response = await fetch(new URL(path, baseUrl), body === undefined ? { headers: { connection: "close" } } : {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json", connection: "close" }, body: JSON.stringify(body) });
    const parsed: unknown = await response.json();
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}: ${JSON.stringify(parsed)}`);
    return parsed;
  };
}

const operatorCommand = (now: string) => ({ commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard" });

/** Starts one scripted run the way the Run dialog does: a start plan, then its start-run command. A `reference` makes the run stop at the gate. */
export async function startScriptedRun(request: SeededRequest, now: string, eid: string, reference?: ScriptedReference, script: ScriptedWorkflow = WORK_STUDY_SCRIPT, submission: Record<string, unknown> = script.submission(eid)): Promise<string> {
  const descriptor = script.module.descriptor;
  const plan = StartPlanWireSchema.parse(await request("/api/v1/start-plans", { workflowId: descriptor.id,
    submissions: [submission], dryRun: false, selectedStepKeys: descriptor.timeline.map(step => step.key),
    ...(reference === undefined ? {} : { workbookReferences: [reference] }) }));
  if (plan.planned.length !== 1) throw new Error(`the scripted start plan was refused: ${JSON.stringify(plan.refused)}`);
  const result = CommandResultSchema.parse(await request("/api/v1/commands", { ...operatorCommand(now), family: "start", type: "start-run",
    target: { workflowId: descriptor.id, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }));
  const runIds = appliedRunIds(result);
  const runId = runIds[0];
  if (runIds.length !== 1 || runId === undefined) throw new Error(`the scripted start applied ${String(runIds.length)} runs: ${JSON.stringify(result)}`);
  return runId;
}

/** Answers a parked gate with a result the gate's schema accepts, the command a gate control would send; the run returns to the queue. */
export async function answerScriptedGate(request: SeededRequest, now: string, runId: string, gateId: string, schema: z.ZodType, value: unknown): Promise<void> {
  const detail = RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`));
  const result = CommandResultSchema.parse(await request("/api/v1/commands", { ...operatorCommand(now), family: "gate", type: "resolve-gate",
    target: { runId, gateId, expectedVersion: detail.rowRevision }, payload: { result: { schemaHash: deriveSchemaHash(schema, "output"), value: schema.parse(value) } } }));
  if (result.state !== "applied") throw new Error(`the scripted gate answer was ${result.state}: ${JSON.stringify(result)}`);
}
