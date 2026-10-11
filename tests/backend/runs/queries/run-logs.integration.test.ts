import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { plan1Parent,plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema,taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { ucpathSession } from "../../../../src/backend/systems/ucpath/session-provider.js";
import { ucpathStore } from "../../../../src/backend/systems/ucpath/task-registry.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { type RunParent } from "../../../../src/models/run/envelope.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema,NodeIdSchema,TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { defineBrowserStore,defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_4,UUID_5,UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../../support/fixtures/workflow-definition-fixtures.js";
import {
happySessionHarness,
healthyCrmDriver,
healthyUcpathDriver,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
sessionManagerFor,
type AuthorityHarness,
type SessionFactoryHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

function readPersistedNotes(database: AuthorityDatabase) {
  return readTimelineRecords(database.authority.timelineEvents).records.flatMap(record => record.payload.kind === "note" ? [NoteWireSchema.parse(record.payload.note)] : []);
}

const authorityHarnesses = new WeakMap<AuthorityDatabase, AuthorityHarness>();

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface ExecutorHarness {
  readonly authority: AuthorityHarness;
  readonly sessions: SessionFactoryHarness;
  readonly manager: WorkerSessionManager;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly deps: RunExecutorDependencies;
}

function executorHarness(options: Readonly<{
  sessions?: SessionFactoryHarness;
  autoFireAtOrBelowMs?: number;
  taskDeadlineMs?: number;
  stores?: RunExecutorDependencies["stores"];
  descriptor?: AnyWorkflowDescriptor;
}> = {}): ExecutorHarness {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  authorityHarnesses.set(authority.database, authority);
  const sessions = options.sessions ?? happySessionHarness();
  const manager = sessionManagerFor(sessions, authority.clock);
  const scheduler = new ManualScheduler(authority.clock, options.autoFireAtOrBelowMs ?? 0);
  const emitter = {
    emitter: createTimelineEmitter({ repository: authority.database.authority.timelineEvents, clock: authority.clock }),
    events: () => authority.database.authority.timelineEvents.page({}).flatMap((record) => {
      if (record.payload.kind !== "span" || record.payload.event.t === "run.queued") return [];
      const { pid: _pid, ...event } = record.payload.event;
      return [ExecutorSpanEventSchema.parse(event)];
    }),
  };
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: options.descriptor ?? personLookupDescriptor,
    stores: options.stores ?? taskStoreRegistry,
    authority: authority.database,
    sessions: manager,
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("b"),
    scheduler,
    taskDeadlineMs: options.taskDeadlineMs ?? 60_000,
    log: recordingLogger().log,
  };
  return { authority, sessions, manager, scheduler, emitter, deps };
}

function enqueueAndClaim(
  database: AuthorityDatabase,
  run: Record<string, unknown>,
  now: string,
  workflow = WORKFLOW_ID,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const harness = authorityHarnesses.get(database);
  if (harness === undefined) throw new Error("executor-authority-harness-missing");
  const descriptor = [personLookupDescriptor, actionBindingCompiled.descriptor, plan1Parent.descriptor, ...plan1Workflows.map(compiled => compiled.descriptor)].find(candidate => candidate.id === workflow);
  if (descriptor === undefined) throw new Error("executor-fixture-descriptor-missing");
  testWorkerPorts(database, harness.clock, { path: harness.path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(workflow).find(slot => slot.poolIndex === 1 && slot.retiredAt === null);
  if (slot === undefined) throw new Error("executor-fixture-worker-missing");
  database.authority.runs.enqueue(run);
  const claimed = database.authority.runs.claimNext({ workflow, workerId: slot.workerId, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration },
  };
}

const SIGNAL = new AbortController().signal;

const ACTION_BINDING_WORKFLOW_ID = "fixture-operation-action-binding";
const ActionBindingInput = z.strictObject({ emplId: EidSchema });
const ActionBindingCanonicalInput = defineCanonicalInput(
  ActionBindingInput,
  z.strictObject({ emplId: EidSchema }),
  [{ emplId: "10873698" }],
);
const actionBindingWorkflow = defineWorkflow({
  id: ACTION_BINDING_WORKFLOW_ID,
  version: 1,
  code: "fab",
  label: "Operation action binding fixture",
  icon: "Search",
  category: "operations",
  input: ActionBindingInput,
  canonicalInput: ActionBindingCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `fixture:${input.emplId}` },
  presentation: { title: (input) => `EID ${input.emplId}` },
  scenarios: ["fixture-operation-action-binding/happy"],
  role: defineWorkflowRole({ kind: "standalone" }),
  operationDisplay: {
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    invocations: [{
      id: "search-operation",
      entryId: "search",
      contractRole: "task",
      occurrencePath: ["search"],
      bindings: [
        { slot: "search-kind", value: { kind: "constant", value: "by-eid" } },
        { slot: "empl-id", value: { kind: "run-input", path: "emplId" } },
        { slot: "name", value: { kind: "constant", value: "unused" } },
      ],
    }],
    presentation: [{ id: "search-operation-node", kind: "operation", invocationId: "search-operation" }],
  } satisfies WorkflowOperationDisplayDeclaration,
  steps: ({ task, result }) => {
    const search = task({
      id: "search",
      contract: SearchPersonOrg,
      label: "Search",
      replay: "checkpoint",
    }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }));
    return {
      steps: [[{ key: "search", label: "Search" }, [search]]],
      result: result(SearchPersonOrgOutputSchema, [search], ({ outputs }) => outputs.search, [{ path: "selection.status", source: { kind: "task-output", entryId: "search", path: "selection.status" } },
        { path: "results", source: { kind: "derived", inputs: [
          { id: "selection", source: { kind: "task-output", entryId: "search", path: "selection.status" } },
          { id: "query", source: { kind: "task-output", entryId: "search", path: "selection.candidateEids" } },
        ] } }]),
    };
  },
});
const actionBindingCompiled = compileWorkflow(actionBindingWorkflow, {
  manifest: fixtureBuildManifest([ACTION_BINDING_WORKFLOW_ID]),
});

function actionBindingQueuedRun(
  now: string,
  options: Readonly<{ protectedValue?: boolean; parent?: RunParent }> = {},
): RunRecord {
  return buildQueuedRun({
    descriptor: actionBindingCompiled.descriptor,
    appVersion: "0.1.0",
    runId: UUID_5,
    itemId: UUID_6,
    traceId: "fa-170000-5555",
    rawInput: { emplId: "10873698" },
    canonicalInput: {
      schemaHash: deriveSchemaHash(ActionBindingCanonicalInput, "output"),
      value: { emplId: "10873698" },
      ...(options.protectedValue !== false ? {
        protectedBindings: [{
          kind: "test-data-local" as const, sourceId: UUID_4,
          inputPath: "emplId" as const,
          name: "personLookupCanaryEid" as const,
        }],
      } : { protectedBindings: [] }),
    },
    ingressSchemaHash: deriveSchemaHash(ActionBindingInput, "input"),
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
    resolvedInstance: { ucpath: "prod" },
    ...(options.parent === undefined ? {} : { parent: options.parent }),
    shape: options.parent === undefined ? "single" : "operation-member",
    priority: "bulk",
    dryRun: false,
    attempt: 1,
    runNumber: 1,
    now,
  });
}

describe("complete operation display action binding", () => {

  it("refuses missing complete snapshots at record admission and corrupt snapshots before a driver opens", async () => {
    const missingHarness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const missingQueued = actionBindingQueuedRun(missingHarness.authority.clock.now().toISOString());
    const { operationDisplaySnapshot: _snapshot, ...missingEnvelope } = missingQueued.envelope;
    assert.throws(
      () => RunRecordSchema.parse({ ...missingQueued, envelope: missingEnvelope }),
      /complete run fixture-operation-action-binding is missing its frozen operation display snapshot/u,
    );
    assert.equal(missingHarness.sessions.opens(), 0);

    assert.throws(
      () => buildRunLogsSection({
        stateRoot: missingHarness.authority.stateRoot,
        timeline: missingHarness.authority.database.authority.timelineEvents,
        projection: { runLogSnapshot: () => ({ entries: [] }) },
        descriptors: { resolve: () => undefined },
      } as unknown as RunDetailQueryDeps, UUID_5, undefined, {
        ...missingQueued,
        envelope: missingEnvelope,
      }),
      /complete run fixture-operation-action-binding is missing its frozen operation display snapshot/u,
    );

    const corruptHarness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const corruptClaim = enqueueAndClaim(
      corruptHarness.authority.database,
      actionBindingQueuedRun(corruptHarness.authority.clock.now().toISOString()),
      corruptHarness.authority.clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );
    const snapshot = corruptClaim.run.envelope.operationDisplaySnapshot;
    assert.ok(snapshot);
    const corrupt = {
      ...corruptClaim.run,
      envelope: {
        ...corruptClaim.run.envelope,
        operationDisplaySnapshot: { ...snapshot, contentDigest: "0".repeat(64) },
      },
    } as RunRecord;
    await assert.rejects(
      () => executeClaimedRun(corruptHarness.deps, { ...corruptClaim, run: corrupt, signal: SIGNAL }),
      /corrupt frozen operation display snapshot digest/u,
    );
    assert.equal(corruptHarness.sessions.opens(), 0);
  });
});

describe("person-lookup full walk", () => {

  it("writes every ordinary task log and its fields through the run query cursor", async () => {
    let searchCalls = 0;
    const sessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return Object.freeze({
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            searchCalls += 1;
            if (searchCalls === 1) {
              return Promise.reject(new TaskError(
                SearchPersonOrg.id,
                "search-unavailable",
                "transient search failure",
                { transient: true },
              ));
            }
            return driver.searchPersonOrg(...args);
          },
        });
      },
      crm: () => healthyCrmDriver(),
    });
    const harness = executorHarness({ sessions, autoFireAtOrBelowMs: 2_500 });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const logs = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const stdout = recordingLogger();
    const searchWithLogs = defineTask(ucpathDriver, SearchPersonOrg, {
      sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
      retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
      async run({ input, ctx }) {
        if (searchCalls === 0) {
          ctx.log.info(`UNCLASSIFIED_MESSAGE_CANARY protected EID ${"10873698"}; ${"x".repeat(3_000)}`, {
            unclassifiedEid: "10873698",
            unclassifiedSecret: "UNCLASSIFIED_NOTE_CANARY",
          });
          ctx.log.info("roster match completed", { unclassifiedSecret: "UNCLASSIFIED_NOTE_CANARY" });
        }
        const output = SearchPersonOrgOutputSchema.parse(await ctx.driver.searchPersonOrg(input));
        for (let index = 0; index < 260; index += 1) {
          ctx.log.info("roster match completed", { unclassifiedSecret: "UNCLASSIFIED_NOTE_CANARY" });
        }
        ctx.recordData([
          { direction: "read", field: "results", value: output.results },
          { direction: "read", field: "selection", value: output.selection },
        ]);
        return output;
      },
    });
    const ucpath = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, {
      ...ucpathStore.tasks,
      searchPersonOrg: searchWithLogs,
    });
    const stores = defineTaskStoreRegistry(
      taskStoreRegistry.stores.map((store) => store.namespace === "ucpath" ? ucpath : store),
      taskStoreRegistry.corpus,
    );
    const claimed = enqueueAndClaim(database, personLookupQueuedRun({
      protectedBindings: [{
        kind: "test-data-local", sourceId: UUID_4,
        inputPath: "emplId",
        name: "personLookupCanaryEid",
      }],
    }), clock.now().toISOString());
    const outcome = await executeClaimedRun({ ...harness.deps, stores, log: stdout.log, taskNotes: logs }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    assert.equal(searchCalls, 2, "a transient task failure retries once");
    assert.equal(stdout.entries().length, 262, "all task log lines still reach stdout");
    assert.match(stdout.entries()[0] ?? "", /UNCLASSIFIED_MESSAGE_CANARY/u);
    assert.equal(stdout.entries()[0]?.includes("10873698"), true);

    const noteLines = readPersistedNotes(database);
    assert.equal(noteLines.length, 262, "all task messages persist");
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("UNCLASSIFIED_MESSAGE_CANARY")), true);
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("10873698")), true);
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("UNCLASSIFIED_NOTE_CANARY")), true);
    const firstLine = noteLines[0];
    assert.ok(firstLine);
    const firstNote = NoteWireSchema.parse(firstLine);
    assert.match(firstNote.message, /UNCLASSIFIED_MESSAGE_CANARY protected EID 10873698/u);
    assert.ok("runId" in firstNote);
    assert.equal(firstNote.runId, RUN_ID);
    assert.equal(firstNote.attempt, 1);
    assert.equal(firstNote.traceId, claimed.run.envelope.traceId);
    assert.equal(firstNote.spanPath, taskSpanPath(
      TraceIdSchema.parse(claimed.run.envelope.traceId),
      NodeIdSchema.parse("searching"),
      1,
      claimed.claim.claimGeneration,
    ));
    const retriedNote = NoteWireSchema.parse(noteLines[2]);
    assert.ok("runId" in retriedNote);
    assert.equal(retriedNote.runId, RUN_ID);
    assert.equal(retriedNote.attempt, 1);
    assert.equal(retriedNote.traceId, claimed.run.envelope.traceId);
    assert.equal(retriedNote.spanPath, taskSpanPath(
      TraceIdSchema.parse(claimed.run.envelope.traceId),
      NodeIdSchema.parse("searching"),
      2,
      claimed.claim.claimGeneration,
    ));
    assert.deepEqual(firstNote.fields, [
      { key: "unclassifiedEid", kind: "text", value: "10873698" },
      { key: "unclassifiedSecret", kind: "text", value: "UNCLASSIFIED_NOTE_CANARY" },
    ]);
    const lastNote = NoteWireSchema.parse(noteLines.at(-1));
    assert.equal(lastNote.message, "roster match completed");

    const terminal = database.authority.runs.get(RUN_ID);
    assert.ok(terminal);
    const queryDeps = {
      timeline: database.authority.timelineEvents,
      stateRoot: _stateRoot,
      projection: { runLogSnapshot: () => ({ entries: [] }) },
      descriptors: { resolve: () => undefined },
    } as unknown as RunDetailQueryDeps;
    const firstPage = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal);
    if (firstPage.section !== "logs") throw new Error("expected bounded log page");
    assert.equal(firstPage.payload.rows?.length, 200);
    assert.equal(firstPage.payload.nextCursor.state, "present");
    if (firstPage.payload.nextCursor.state !== "present") throw new Error("expected log continuation");

    logs.emitNote({
      workflow: "person-lookup",
      address: { runId: RUN_ID, attempt: 1, traceId: terminal.envelope.traceId, spanPath: terminal.envelope.traceId },
      level: "step",
      message: "arrived after page one",
    });
    const oldContinuation = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal, firstPage.payload.nextCursor.value);
    if (oldContinuation.section !== "logs") throw new Error("expected old snapshot continuation");
    assert.equal(oldContinuation.payload.rows?.length, 62);
    assert.equal(oldContinuation.payload.rows?.some((row) => row.kind === "note" && row.note.message === "arrived after page one"), false);

    const freshFirst = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal);
    if (freshFirst.section !== "logs" || freshFirst.payload.nextCursor.state !== "present") {
      throw new Error("expected a new snapshot after an appended note");
    }
    assert.notEqual(freshFirst.payload.nextCursor.value, firstPage.payload.nextCursor.value);
    const freshContinuation = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal, freshFirst.payload.nextCursor.value);
    if (freshContinuation.section !== "logs") throw new Error("expected refreshed continuation");
    assert.equal(freshContinuation.payload.rows?.length, 63);
    assert.equal(freshContinuation.payload.rows?.at(-1)?.sequence, 262);
  });
});
