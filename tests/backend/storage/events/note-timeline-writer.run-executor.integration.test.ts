import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { plan1Parent,plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../src/backend/logs/span-emitter.js";
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
import { recordBrowserAction,runDeclaredAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { ObservedOperationStructureWireSchema } from "../../../../src/models/dashboard/operation-structure.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { RunParentSchema,type RunParent } from "../../../../src/models/run/envelope.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_4,UUID_5,UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
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

function actionBindingSessions(options: Readonly<{
  typedTarget?: string;
  typedValue?: string;
  clicks?: number;
  openedTarget?: string;
  failBeforeGesture?: boolean;
  lifecycle?: boolean;
}> = {}): SessionFactoryHarness {
  return sessionFactoryHarness({
    ucpath: () => {
      const driver = healthyUcpathDriver();
      return Object.freeze({
        ...driver,
        async searchPersonOrg(...args: Parameters<typeof driver.searchPersonOrg>) {
          const [input] = args;
          if (input.kind !== "by-eid") throw new Error("action binding fixture requires an EID search");
          if (options.failBeforeGesture === true) {
            throw new TaskError(SearchPersonOrg.id, "search-unavailable", "synthetic pre-gesture failure");
          }
          if (options.openedTarget !== undefined) recordBrowserAction("opened", options.openedTarget);
          if (options.lifecycle === true) {
            await runDeclaredAction({ id: "fill-eid", kind: "typed", targetId: "ucpath.person-org.eid-input" }, async () => {
              recordBrowserAction("typed", "ucpath.person-org.eid-input", input.emplId);
            }, () => input.emplId);
            await runDeclaredAction({ id: "run-search", kind: "clicked", targetId: "ucpath.person-org.search-button" }, async () => {});
            return await runDeclaredAction({ id: "read-selection", kind: "read", targetId: "ucpath.person-org.results-grid" },
              () => driver.searchPersonOrg(...args), (output) => output.selection.status);
          }
          recordBrowserAction("typed", options.typedTarget ?? "ucpath.person-org.eid-input", options.typedValue ?? input.emplId);
          for (let count = 0; count < (options.clicks ?? 1); count += 1) {
            recordBrowserAction("clicked", "ucpath.person-org.search-button");
          }
          return await driver.searchPersonOrg(...args);
        },
      });
    },
    crm: () => healthyCrmDriver(),
  });
}

function actionBindingRetrySessions(): SessionFactoryHarness {
  return sessionFactoryHarness({
    ucpath: (openIndex) => {
      const driver = healthyUcpathDriver();
      return Object.freeze({
        ...driver,
        async searchPersonOrg(...args: Parameters<typeof driver.searchPersonOrg>) {
          const [input] = args;
          if (input.kind !== "by-eid") throw new Error("action binding retry fixture requires an EID search");
          recordBrowserAction("typed", "ucpath.person-org.eid-input", input.emplId);
          recordBrowserAction("clicked", "ucpath.person-org.search-button");
          if (openIndex === 1) {
            throw new TaskError(SearchPersonOrg.id, "search-unavailable", "synthetic retry", { transient: true });
          }
          return await driver.searchPersonOrg(...args);
        },
      });
    },
    crm: () => healthyCrmDriver(),
  });
}

describe("complete operation display action binding", () => {
  it("binds completed synthetic driver gestures in append order and redacts protected input before native durability", async () => {
    const sessions = actionBindingSessions({ clicks: 2 });
    const harness = executorHarness({ sessions, descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: UUID_5 });

    const noteLines = readPersistedNotes(database);
    const notes = noteLines.map((note) => NoteWireSchema.parse(note));
    const actions = notes.filter((note) => note.action !== undefined);
    assert.deepEqual(noteLines.map((note) => note.message), ["Typed into ucpath person org eid input", "Clicked ucpath person org search button", "Clicked ucpath person org search button"]);
    assert.equal(actions.length, 3);
    assert.deepEqual(actions.map((note) => note.action?.operation?.logicalActionId), ["fill-eid", "run-search", "run-search"]);
    assert.deepEqual(actions.map((note) => note.action?.operation?.occurrence), [1, 1, 2]);
    assert.equal(actions[0]?.action?.value, undefined, "protected raw browser value is removed before persistence");
    assert.deepEqual(actions[0]?.action?.operation?.value, {
      slot: "empl-id",
      fieldPath: "emplId",
      producer: { kind: "run-input", path: "emplId" },
      consumed: {
        state: "redacted",
        binding: {
          kind: "test-data-local", sourceId: UUID_4,
          inputPath: "emplId",
          name: "personLookupCanaryEid",
        },
      },
    });
    assert.equal(actions[0]?.action?.operation?.runId, UUID_5);
    assert.equal(actions[0]?.action?.operation?.definitionFingerprint, actionBindingCompiled.descriptor.contractFingerprint);
    assert.equal(actions[0]?.action?.operation?.nodeId, "search");
    assert.equal(actions[0]?.action?.operation?.taskId, SearchPersonOrg.id);
    assert.equal(actions[0]?.action?.operation?.attempt, 1);
    assert.equal(actions[0]?.action?.operation?.claimGeneration, 1);
    assert.equal(actions[0]?.action?.operation?.taskAttempt, 1);
    assert.equal(actions[0]?.action?.operation?.invocationId, "search-operation");
    assert.deepEqual(actions[0]?.action?.operation?.occurrencePath, ["search"]);
    assert.equal(actions[0]?.action?.operation?.logicalSessionId, "ucpath-worker");
    assert.equal(actions[0]?.action?.operation?.physicalSessionId, "00000000-0000-4000-8000-000000000001");
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("10873698")), false);

    const terminal = database.authority.runs.get(UUID_5);
    assert.ok(terminal);
    const page = buildRunLogsSection({
      timeline: database.authority.timelineEvents,
      stateRoot: _stateRoot,
      projection: { runLogSnapshot: () => ({ entries: [] }) },
      // Logs resolve the retained envelope snapshot for unregistered workflows.
      descriptors: { resolve: () => undefined },
    } as unknown as RunDetailQueryDeps, UUID_5, undefined, terminal);
    if (page.section !== "logs") throw new Error("expected action log page");
    assert.deepEqual(page.payload.rows?.map((row) => row.sequence), [0, 1, 2]);
    assert.deepEqual(page.payload.notes?.map((note) => note.message), [
      "Typed into ucpath person org eid input",
      "Clicked ucpath person org search button",
      "Clicked ucpath person org search button",
    ]);
    if (page.payload.operationStructure?.state !== "observed") {
      throw new Error("complete action run did not retain an observed operation structure");
    }
    assert.equal(
      page.payload.operationStructure.definition.contentDigest,
      terminal.envelope.operationDisplaySnapshot?.contentDigest,
    );
    assert.deepEqual(
      page.payload.operationStructure.observations.map(({ occurrence }) => [
        occurrence.invocationId,
        occurrence.logicalActionId,
        occurrence.occurrence,
      ]),
      [
        ["search-operation", "fill-eid", 1],
        ["search-operation", "run-search", 1],
        ["search-operation", "run-search", 2],
      ],
    );
    assert.equal(
      page.payload.operationStructure.observations[0]?.occurrence.value?.state,
      "redacted",
    );
    const firstObservation = page.payload.operationStructure.observations[0];
    assert.ok(firstObservation);
    assert.equal(ObservedOperationStructureWireSchema.safeParse({
      ...page.payload.operationStructure,
      observations: [{
        ...firstObservation,
        occurrence: { ...firstObservation.occurrence, logicalActionId: "missing-action" },
      }],
    }).success, false, "a new-format unknown action must not be assigned a nearby frozen action");
    assert.equal(ObservedOperationStructureWireSchema.safeParse({
      ...page.payload.operationStructure,
      observations: [{
        ...firstObservation,
        occurrence: { ...firstObservation.occurrence, definitionFingerprint: "0".repeat(64) },
      }],
    }).success, false, "a mismatched snapshot fingerprint must refuse");
  });

  it("keeps retry attempts distinct while retaining completed-gesture append order", async () => {
    const harness = executorHarness({
      sessions: actionBindingRetrySessions(),
      descriptor: actionBindingCompiled.descriptor,
      autoFireAtOrBelowMs: 2_500,
    });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: UUID_5 });
    const lines = readPersistedNotes(database);
    const actions = lines.map((note) => NoteWireSchema.parse(note)).filter((note) => note.action !== undefined);
    assert.equal(lines.length, 4);
    assert.deepEqual(actions.map((note) => note.action?.operation?.logicalActionId), [
      "fill-eid", "run-search", "fill-eid", "run-search",
    ]);
    assert.deepEqual(actions.map((note) => note.action?.operation?.taskAttempt), [1, 1, 2, 2]);
    assert.deepEqual(actions.map((note) => note.action?.operation?.physicalSessionId), [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("binds child invocation identity from the immutable child envelope", async () => {
    const harness = executorHarness({ sessions: actionBindingSessions(), descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    database.authority.runs.enqueue(personLookupQueuedRun());
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString(), {
        parent: RunParentSchema.parse({
          runId: "22222222-2222-4222-8222-222222222222",
          tracePrefix: "pl-170000-2222",
          edgeId: "child-search",
        }),
      }),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    assert.deepEqual(
      await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL }),
      { state: "done", runId: UUID_5 },
    );
    const firstAction = readPersistedNotes(database)
      .map((note) => NoteWireSchema.parse(note))
      .find((note) => note.action !== undefined);
    assert.deepEqual(firstAction?.action?.operation?.childInvocation, {
      parentRunId: "22222222-2222-4222-8222-222222222222",
      edgeId: "child-search",
    });
  });

  it("binds a declared operation-level page open to its completed driver gesture", async () => {
    const harness = executorHarness({
      sessions: actionBindingSessions({ openedTarget: "ucpath.person-org.search" }),
      descriptor: actionBindingCompiled.descriptor,
    });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    assert.deepEqual(
      await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL }),
      { state: "done", runId: UUID_5 },
    );
    const firstAction = readPersistedNotes(database)
      .map((note) => NoteWireSchema.parse(note))
      .find((note) => note.action !== undefined);
    assert.equal(firstAction?.action?.operation?.logicalActionId, "open-search");
  });

  it("does not manufacture an action occurrence when a task fails before a completed driver gesture", async () => {
    const harness = executorHarness({
      sessions: actionBindingSessions({ failBeforeGesture: true }),
      descriptor: actionBindingCompiled.descriptor,
    });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    assert.deepEqual(readPersistedNotes(database), []);
  });
});
