import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { resolveOperationSource } from "../../../../../src/backend/runs/queries/operation-source.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerRunDetailRoutes } from "../../../../../src/backend/transports/http/routes/run-detail.js";
import { RunResultRecordSchema } from "../../../../../src/models/run/result.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { plan1Parent,plan1Workflows } from "../../../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testRunService,testWorkerPorts } from "../../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../../src/backend/logs/span-emitter.js";
import type { RunDetailQueryDeps } from "../../../../../src/backend/runs/queries/run-detail-types.js";
import { buildQueuedRun } from "../../../../../src/backend/runs/start/enqueue.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../../../src/backend/runtime/workers/worker-sessions.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { readTimelineRecords } from "../../../../../src/backend/storage/events/timeline-reader.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/index.js";
import { recordBrowserAction,runDeclaredAction } from "../../../../../src/backend/systems/browser-shared/action-notes.js";
import { ObservedOperationStructureWireSchema } from "../../../../../src/models/dashboard/operation-structure.js";
import { NoteWireSchema } from "../../../../../src/models/events/types.js";
import { type RunParent } from "../../../../../src/models/run/envelope.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../../src/workflow-kit/errors.js";
import { defineWorkflowRole } from "../../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { UUID_4,UUID_5,UUID_6 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory,WORKFLOW_ID } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../../../support/fixtures/workflow-definition-fixtures.js";
import {
happySessionHarness,
healthyCrmDriver,
healthyUcpathDriver,
ManualScheduler,
openAuthorityHarness,
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
sessionManagerFor,
type AuthorityHarness,
type SessionFactoryHarness
} from "../../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as SyntheticAuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

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

describe("complete operation display action binding", () => {

  it("serves explicit executor lifecycle and safely classified values through the exact bounded source route", async () => {
    const harness = executorHarness({ sessions: actionBindingSessions({ lifecycle: true }), descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(database, actionBindingQueuedRun(clock.now().toISOString(), { protectedValue: false }), clock.now().toISOString(), ACTION_BINDING_WORKFLOW_ID);
    for (let index = 0; index < 205; index += 1) writer.emitRunLog({ workflow: ACTION_BINDING_WORKFLOW_ID,
      address: { runId: UUID_5, attempt: 1, traceId: "fa-170000-5555", spanPath: "fixture" },
      level: "step", message: "Before the action" }, claimed.run);
    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const notes = readPersistedNotes(database).map((note) => NoteWireSchema.parse(note));
    const actions = notes.flatMap((note) => note.action === undefined ? [] : [note.action]);
    assert.deepEqual(actions.map((action) => action.operation?.state), ["started", "completed", "started", "completed", "started", "completed"]);
    assert.deepEqual(actions.map((action) => action.operation?.occurrence), [1, 1, 1, 1, 1, 1]);
    const checkpoint = database.authority.runCheckpoints.latest(ACTION_BINDING_WORKFLOW_ID, UUID_6, "search");
    assert.ok(checkpoint);
    assert.equal(checkpoint.operationSources?.[0]?.identity.logicalActionId, "read-selection");
    const result = database.authority.runResults.get(UUID_5);
    assert.ok(result);
    assert.equal(result.operationSources?.[0]?.path, "selection.status");
    assert.equal(result.operationSources?.[0]?.identity.logicalActionId, "read-selection");
    const sourceDependency = result.dependencies.find((dependency) => dependency.state === "resolved" && dependency.nodeId === "search");
    assert.ok(sourceDependency?.state === "resolved");
    assert.deepEqual(sourceDependency.operationSources, checkpoint.operationSources);
    const forgedSources = result.operationSources?.map((source) => ({ ...source, identity: { ...source.identity, logicalActionId: "forged-read" } }));
    assert.equal(RunResultRecordSchema.safeParse({ ...result, operationSources: forgedSources,
      operationSourceDigest: sha256Hex(`hrauto:result-operation-sources:v1\0${canonicalJsonStringify(forgedSources)}`) }).success, false, "rehashing a foreign occurrence cannot bypass retained dependency binding");
    assert.deepEqual(result.operationLineage?.[0]?.inputs.map((input) => [input.inputId, input.state]), [["selection", "retained"], ["query", "unavailable"]]);
    assert.equal(result.operationLineage?.[0]?.inputs[0]?.identity?.logicalActionId, "read-selection");
    const forgedLineage = result.operationLineage?.map((lineage) => ({ ...lineage, inputs: lineage.inputs.map((input) => input.identity === undefined ? input : { ...input, identity: { ...input.identity, logicalActionId: "equal-value-other-read" } }) }));
    assert.equal(RunResultRecordSchema.safeParse({ ...result, operationLineage: forgedLineage,
      operationLineageDigest: sha256Hex(`hrauto:result-operation-lineage:v1\0${canonicalJsonStringify(forgedLineage)}`) }).success, false, "equal values cannot substitute another input occurrence");
    const completed = actions[1]?.operation;
    assert.ok(completed);
    const { value: _value, ...identity } = completed;
    const deps = { timeline: database.authority.timelineEvents, stateRoot: _stateRoot, runReader: testRunService(database, clock), descriptors: { resolve: () => undefined },
      projection: { runLogSnapshot: () => ({ entries: [] }) } } as unknown as RunDetailQueryDeps;
    const app: DashboardApp = new Hono();
    registerRunDetailRoutes(app, { runDetail: deps });
    const request = { identity };
    const url = (input: unknown) => `/api/v1/runs/${UUID_5}/operation-source?request=${encodeURIComponent(JSON.stringify(input))}`;
    const first = await app.request(url(request));
    assert.equal(first.status, 200);
    const continuation = await first.json() as { state: string; cursor: string };
    assert.equal(continuation.state, "continue");
    const second = await app.request(url({ ...request, cursor: continuation.cursor }));
    assert.equal(second.status, 200);
    const source = await second.json() as { state: string; structure: z.infer<typeof ObservedOperationStructureWireSchema> };
    assert.equal(source.state, "found");
    assert.equal(source.structure.observations.length, 1);
    assert.deepEqual(source.structure.observations[0]?.occurrence.value, {
      slot: "empl-id", fieldPath: "emplId", producer: { kind: "run-input", path: "emplId" },
      state: "observed", classification: "local-operator", value: "10873698",
    });
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, occurrence: 2 }, cursor: continuation.cursor }), /cursor-unavailable-or-identity-mismatch/u);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, definitionFingerprint: "0".repeat(64) } }), /run-identity-mismatch/u);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, logicalActionId: "unknown-action" } }), /unknown-frozen-action/u);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, invocationId: "unknown-invocation" } }), /unknown-frozen-invocation/u);
    for (let index = 0; index < 129; index += 1) resolveOperationSource(deps, UUID_5, request);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { ...request, cursor: continuation.cursor }), /cursor-unavailable-or-identity-mismatch/u);
    const abort = new AbortController(); abort.abort(new Error("cancelled lookup"));
    assert.throws(() => resolveOperationSource(deps, UUID_5, request, abort.signal), /cancelled lookup/u);
  });

  it("retains and reopens the exact frozen complete snapshot from authority storage", () => {
    const harness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    const queued = actionBindingQueuedRun(clock.now().toISOString());
    const snapshot = queued.envelope.operationDisplaySnapshot;
    assert.ok(snapshot);
    database.authority.runs.enqueue(queued);
    const authorityGeneration = database.getMeta().authorityGeneration;
    database.close();

    const reopened = SyntheticAuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "operation-display-snapshot-reopen-test" },
      clock,
    );
    try {
      const stored = reopened.authority.runs.get(UUID_5);
      assert.ok(stored);
      assert.deepEqual(stored.envelope.operationDisplaySnapshot, snapshot);
      assert.equal(reopened.getMeta().authorityGeneration, authorityGeneration);
    } finally {
      reopened.close();
    }
  });

  it("refuses a corrupt stored complete snapshot after close and reopen", () => {
    const harness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    database.authority.runs.enqueue(actionBindingQueuedRun(clock.now().toISOString()));
    database.close();

    const raw = new DatabaseSync(path);
    try {
      const stored = z.object({ envelope_json: z.string() }).parse(
        raw.prepare("SELECT envelope_json FROM runs WHERE id = ?").get(UUID_5),
      );
      const record = JSON.parse(stored.envelope_json) as { operationDisplaySnapshot: { contentDigest: string } };
      record.operationDisplaySnapshot.contentDigest = "0".repeat(64);
      raw.prepare("UPDATE runs SET envelope_json = ? WHERE id = ?").run(JSON.stringify(record), UUID_5);
    } finally {
      raw.close();
    }

    assert.throws(
      () => SyntheticAuthorityDatabase.open(
        { path, busyTimeoutMs: 250, migrationOwner: "operation-display-snapshot-corrupt-test" },
        clock,
      ),
      /corrupt frozen operation display snapshot digest/u,
    );
  });
});
