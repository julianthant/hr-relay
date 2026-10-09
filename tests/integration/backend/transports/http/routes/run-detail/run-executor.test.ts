import { plan1Parent, plan1Workflows, plan1Stores, Plan1CanonicalInput, Plan1Input, Plan1Output } from "../../../../../../support/fixtures/plan1-operation-workflows.js";
import { CONFIG_SNAPSHOT } from "../../../../../../support/fixtures/phase1c-contract-fixtures.js";
const PLAN1_CONFIG_ID = "00000000-0000-4000-8000-000000000c01";
import { canonicalJsonStringify } from "../../../../../../../src/rules/validation/canonical-json.js";
import { RunResultRecordSchema } from "../../../../../../../src/models/run/result.js";
import { sha256Hex } from "../../../../../../../src/rules/validation/sha256.js";
import { Hono } from "hono";
import type { DashboardApp } from "../../../../../../../src/backend/transports/http/routes/api-types.js";
import { JsonValueSchema } from "../../../../../../../src/rules/validation/canonical-json.js";
import { registerRunDetailRoutes } from "../../../../../../../src/backend/transports/http/routes/run-detail.js";
import { resolveOperationSource } from "../../../../../../../src/backend/runs/queries/operation-source.js";
import { DatabaseSync } from "node:sqlite";
import { createTimelineEmitter } from "../../../../../../../src/backend/storage/events/timeline-emitter.js";
import { DiagnosticBundleSchema } from "../../../../../../../src/models/trust/diagnostic.js";
import { RunRecordSchema } from "../../../../../../../src/models/run/record.js";
import { testRunLifecycle, testRunService } from "../../../../../../support/fixtures/run-lifecycle-fixtures.js";
/**
 * Phase-1f interpreter behavior over the REAL person-lookup descriptor,
 * stores, claim authority, and worker session manager — only the process
 * edges (browser factory, clock, ids, timers, span sink) are recording fakes.
 */
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../../../../src/workflow-kit/task.js";
import { compileWorkflow, defineWorkflow } from "../../../../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../../../../../src/workflow-kit/workflow.js";
import { TaskError } from "../../../../../../../src/workflow-kit/errors.js";
import {
  executeClaimedRun,
  type RunExecutorDependencies,
} from "../../../../../../../src/backend/runtime/execution/run-executor.js";
import { taskSpanPath, ExecutorSpanEventSchema } from "../../../../../../../src/backend/logs/span-emitter.js";
import type { WorkerSessionManager } from "../../../../../../../src/backend/runtime/workers/worker-sessions.js";
import { CrmReadOnboardingRecord } from "../../../../../../../src/models/systems/crm/read-onboarding-record.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../../../../../../src/workflow-kit/validation/scenario-execution.js";
import { EidSchema, NodeIdSchema, TraceIdSchema } from "../../../../../../../src/rules/identity/ids.js";
import { RunParentSchema, type RunParent } from "../../../../../../../src/models/run/envelope.js";
import type { RunRecord } from "../../../../../../../src/models/run/record.js";
import { SearchPersonOrg, SearchPersonOrgOutputSchema } from "../../../../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../../../../src/models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../../../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../../src/models/workflow/presentation.js";
import {
  OPERATION_DISPLAY_FORMAT_VERSION,
  type WorkflowOperationDisplayDeclaration,
} from "../../../../../../../src/models/workflow/operation-display.js";
import { buildQueuedRun } from "../../../../../../../src/backend/runs/start/enqueue.js";
import { buildRunLogsSection } from "../../../../../../../src/backend/runs/queries/run-logs.js";
import type { RunDetailQueryDeps } from "../../../../../../../src/backend/runs/queries/run-detail-types.js";
import { ObservedOperationStructureWireSchema } from "../../../../../../../src/models/dashboard/operation-structure.js";
import { AuthorityDatabase } from "../../../../../../../src/backend/storage/sqlite/index.js";
import { AuthorityDatabase as SyntheticAuthorityDatabase } from "../../../../../../support/helpers/synthetic-storage-admission.js";
import { readEventStreamLines } from "../../../../../../../src/backend/storage/events/jsonl-streams.js";
import { createNoteJsonlWriter } from "../../../../../../../src/backend/storage/events/note-jsonl-writer.js";
import { recordBrowserAction, runDeclaredAction } from "../../../../../../../src/backend/systems/browser-shared/action-notes.js";
import { NoteWireSchema } from "../../../../../../../src/models/events/types.js";
import { ucpathStore } from "../../../../../../../src/backend/systems/ucpath/task-registry.js";
import { ucpathDriver } from "../../../../../../../src/backend/systems/ucpath/driver-declaration.js";
import { ucpathSession } from "../../../../../../../src/backend/systems/ucpath/session-provider.js";
import { crmSession } from "../../../../../../../src/backend/systems/crm/session-provider.js";
import { crmDriver } from "../../../../../../../src/backend/systems/crm/driver-declaration.js";
import { readOnboardingDatesTask } from "../../../../../../../src/backend/systems/crm/tasks/read-onboarding-dates.js";
import { taskStoreRegistry } from "../../../../../../../src/backend/app/registries/task-registry.js";
import { PersonLookupResultSchema } from "../../../../../../../src/workflows/person-lookup/workflow.js";
import { sequentialIdFactory, RUN_ID, WORKER_ID, WORKFLOW_ID } from "../../../../../../support/fixtures/phase1f-run-fixtures.js";
import { HASH_B, UUID_4, UUID_5, UUID_6 } from "../../../../../../support/fixtures/phase1c-contract-fixtures.js";
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
} from "../../../../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../../../../support/helpers/registered-workflows.js";
import { fixtureBuildManifest } from "../../../../../../support/fixtures/workflow-definition-fixtures.js";

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
  database.authority.runs.enqueue(run);
  const claimed = database.authority.runs.claimNext({ workflow, workerId: WORKER_ID, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
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
          kind: "legacy-protected-input" as const,
          inputPath: "emplId" as const,
          name: "personLookupCanaryEid" as const,
        }],
      } : {}),
    },
    ingressSchemaHash: deriveSchemaHash(ActionBindingInput, "input"),
    configFingerprint: HASH_B,
    configSnapshotId: UUID_4,
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
  it("binds completed synthetic driver gestures in append order and redacts protected input before JSONL durability", async () => {
    const sessions = actionBindingSessions({ clicks: 2 });
    const harness = executorHarness({ sessions, descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: UUID_5 });

    const noteLines = readEventStreamLines(stateRoot, "notes");
    const notes = noteLines.map(({ text }) => NoteWireSchema.parse(JSON.parse(text)));
    const actions = notes.filter((note) => note.action !== undefined);
    assert.deepEqual(noteLines.map(({ lineNumber }) => lineNumber), [1, 2, 3]);
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
          kind: "legacy-protected-input",
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
    assert.equal(noteLines.some(({ text }) => text.includes("10873698")), false);

    const terminal = database.authority.runs.get(UUID_5);
    assert.ok(terminal);
    const page = buildRunLogsSection({
      stateRoot,
      projection: { runLogSnapshot: () => ({ entries: [] }) },
      // Historical Logs must use the envelope snapshot, not a current
      // registry lookup for this now-unregistered synthetic workflow.
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

  it("serves explicit executor lifecycle and safely classified values through the exact bounded source route", async () => {
    const harness = executorHarness({ sessions: actionBindingSessions({ lifecycle: true }), descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
    const claimed = enqueueAndClaim(database, actionBindingQueuedRun(clock.now().toISOString(), { protectedValue: false }), clock.now().toISOString(), ACTION_BINDING_WORKFLOW_ID);
    for (let index = 0; index < 205; index += 1) writer.emitRunLog({ workflow: ACTION_BINDING_WORKFLOW_ID,
      address: { runId: UUID_5, attempt: 1, traceId: "fa-170000-5555", spanPath: "fixture" },
      level: "step", message: "Before the action" }, claimed.run);
    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const notes = readEventStreamLines(stateRoot, "notes").map(({ text }) => NoteWireSchema.parse(JSON.parse(text)));
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
    const deps = { stateRoot, runReader: testRunService(database, clock), descriptors: { resolve: () => undefined },
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

  it("keeps retry attempts distinct while retaining completed-gesture append order", async () => {
    const harness = executorHarness({
      sessions: actionBindingRetrySessions(),
      descriptor: actionBindingCompiled.descriptor,
      autoFireAtOrBelowMs: 2_500,
    });
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: UUID_5 });
    const lines = readEventStreamLines(stateRoot, "notes");
    const actions = lines.map(({ text }) => NoteWireSchema.parse(JSON.parse(text))).filter((note) => note.action !== undefined);
    assert.deepEqual(lines.map(({ lineNumber }) => lineNumber), [1, 2, 3, 4]);
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
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
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
    const firstAction = readEventStreamLines(stateRoot, "notes")
      .map(({ text }) => NoteWireSchema.parse(JSON.parse(text)))
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
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
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
    const firstAction = readEventStreamLines(stateRoot, "notes")
      .map(({ text }) => NoteWireSchema.parse(JSON.parse(text)))
      .find((note) => note.action !== undefined);
    assert.equal(firstAction?.action?.operation?.logicalActionId, "open-search");
  });

  it("does not manufacture an action occurrence when a task fails before a completed driver gesture", async () => {
    const harness = executorHarness({
      sessions: actionBindingSessions({ failBeforeGesture: true }),
      descriptor: actionBindingCompiled.descriptor,
    });
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    assert.deepEqual(readEventStreamLines(stateRoot, "notes"), []);
  });

  for (const refusal of [
    {
      name: "unmapped target",
      sessions: actionBindingSessions({ typedTarget: "ucpath.person-org.unmapped-eid-input" }),
      expected: /is not declared/u,
    },
    {
      name: "mismatched field value",
      sessions: actionBindingSessions({ typedValue: "10870000" }),
      expected: /does not match declared field path emplId/u,
    },
    {
      name: "unmapped page open",
      sessions: actionBindingSessions({ openedTarget: "ucpath.person-org.unmapped-screen" }),
      expected: /browser action opened ucpath\.person-org\.unmapped-screen is not declared/u,
    },
  ]) {
    it(`refuses ${refusal.name} even when no note sink is configured`, async () => {
      const harness = executorHarness({ sessions: refusal.sessions, descriptor: actionBindingCompiled.descriptor });
      const { database, clock } = harness.authority;
      const claimed = enqueueAndClaim(
        database,
        actionBindingQueuedRun(clock.now().toISOString(), { protectedValue: false }),
        clock.now().toISOString(),
        ACTION_BINDING_WORKFLOW_ID,
      );

      const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
      assert.equal(outcome.state, "failed");
      const failure = database.authority.failures.listByRun(UUID_5)[0];
      assert.ok(failure);
      assert.match(failure.summary, refusal.expected);
      assert.equal(database.authority.runCheckpoints.latest(ACTION_BINDING_WORKFLOW_ID, UUID_6, "search"), undefined);
    });
  }

  it("rejects a complete snapshot paired with a legacy descriptor before opening a driver", async () => {
    const { operationDisplay: _operationDisplay, ...legacyDescriptor } = actionBindingCompiled.descriptor;
    const harness = executorHarness({ descriptor: legacyDescriptor });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    await assert.rejects(
      () => executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL }),
      /legacy run fixture-operation-action-binding cannot carry a complete operation display snapshot/u,
    );
    assert.equal(harness.sessions.opens(), 0);
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

  it("refuses a corrupt stored complete snapshot after close and reopen", () => {
    const harness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    database.authority.runs.enqueue(actionBindingQueuedRun(clock.now().toISOString()));
    database.close();

    const raw = new DatabaseSync(path);
    try {
      const stored = z.object({ record_json: z.string() }).parse(
        raw.prepare("SELECT record_json FROM workflow_runs WHERE record_key = ?").get(UUID_5),
      );
      const record = JSON.parse(stored.record_json) as { envelope: { operationDisplaySnapshot: { contentDigest: string } } };
      record.envelope.operationDisplaySnapshot.contentDigest = "0".repeat(64);
      raw.prepare("UPDATE workflow_runs SET record_json = ? WHERE record_key = ?").run(JSON.stringify(record), UUID_5);
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

describe("person-lookup full walk", () => {
  it("records every completed browser gesture on the task span", async () => {
    const sessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return Object.freeze({ ...driver,
          async searchPersonOrg(...args: Parameters<typeof driver.searchPersonOrg>) {
            const result = await driver.searchPersonOrg(...args);
            for (let index = 0; index < 258; index += 1) {
              recordBrowserAction("clicked", "ucpath.person-org.search-button");
            }
            return result;
          },
        });
      },
      crm: () => healthyCrmDriver(),
    });
    const harness = executorHarness({ sessions });
    const { database, clock, stateRoot } = harness.authority;
    const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    const notes = readEventStreamLines(stateRoot, "notes")
      .map(({ text }) => NoteWireSchema.parse(JSON.parse(text)));
    const actions = notes.filter((note) => note.action !== undefined);
    assert.equal(actions.length, 258);
    assert.equal(actions.every((note) => note.message === "Clicked ucpath person org search button"), true);
    assert.equal(actions.every((note) => note.spanPath.includes("searching")), true);
    assert.equal(notes.some((note) => note.message === "Further browser actions were omitted after the 256-action operation limit."), false);
  });

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
    const { database, clock, stateRoot } = harness.authority;
    const logs = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
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
        kind: "legacy-protected-input",
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

    const noteLines = readEventStreamLines(stateRoot, "notes");
    assert.equal(noteLines.length, 262, "all task messages persist");
    assert.equal(noteLines.some(({ text }) => text.includes("UNCLASSIFIED_MESSAGE_CANARY")), true);
    assert.equal(noteLines.some(({ text }) => text.includes("10873698")), true);
    assert.equal(noteLines.some(({ text }) => text.includes("UNCLASSIFIED_NOTE_CANARY")), true);
    const firstLine = noteLines[0];
    assert.ok(firstLine);
    const firstNote = NoteWireSchema.parse(JSON.parse(firstLine.text));
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
    const retriedNote = NoteWireSchema.parse(JSON.parse(noteLines[2]?.text ?? "{}"));
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
    const lastNote = NoteWireSchema.parse(JSON.parse(noteLines.at(-1)?.text ?? "{}"));
    assert.equal(lastNote.message, "roster match completed");

    const terminal = database.authority.runs.get(RUN_ID);
    assert.ok(terminal);
    const queryDeps = {
      stateRoot,
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

  it("walks all four nodes to sealed terminal success, skipping crm-dates by condition", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "terminal");
    assert.equal(run.lifecycle.state === "terminal" && run.lifecycle.outcome, "done");

    // Durable terminal authority: result + authorization + pending outbox.
    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    assert.deepEqual(
      result.dependencies.map((dependency) => [dependency.nodeId, dependency.state]),
      [["active-status", "resolved"], ["crm-dates", "not-run"]],
    );
    const crmDates = result.dependencies.find((dependency) => dependency.nodeId === "crm-dates");
    assert.ok(crmDates?.state === "not-run" && crmDates.reason === "condition-false");
    assert.ok(database.authority.runs.get(RUN_ID)?.completion);
    assert.ok(database.authority.runs.get(RUN_ID)?.completion);

    // Checkpoints: three executed nodes have rows; the skipped node has none.
    const itemId = run.envelope.itemId;
    for (const nodeId of ["searching", "cross-verify", "active-status"]) {
      assert.ok(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, nodeId), nodeId);
    }
    assert.equal(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, "crm-dates"), undefined);

    // One warm session per browser system, one login each; nothing poisoned.
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.equal(harness.sessions.opens("crm"), 1);
    assert.equal(harness.sessions.logins(), 2);
    assert.deepEqual(harness.sessions.closeReasons(), []);

    // Exact span sequence (ref workflow-model §6 / ref dashboard-surfaces §1.1 identities).
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const spans = harness.emitter.events().map((event) => [
      event.t,
      event.spanPath,
      "outcome" in event ? event.outcome : "",
    ]);
    // D270 — every executed task publishes its recorded observations on its own
    // span, BETWEEN the open and the close. The skipped node has none, because
    // a node that did not run observed nothing.
    assert.deepEqual(spans, [
      ["span.started", taskSpanPath(trace, node("searching"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("searching"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("searching"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("active-status"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("active-status"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("active-status"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("crm-dates"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-dates"), 1, 1), "skipped"],
      ["span.ended", trace, "done"],
    ]);

    // D123: the skip span carries the SAME closed reason the durable result
    // records, so the timeline can say why the node did not run instead of
    // presenting it as an act somebody took.
    const skipSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && "outcome" in event && event.outcome === "skipped");
    assert.ok(skipSpan);
    assert.equal(
      skipSpan.t === "span.ended" && "notRunReason" in skipSpan ? skipSpan.notRunReason : undefined,
      crmDates.reason,
    );
  });

  it("includes crm-dates when the operator asked for it", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      personLookupQueuedRun({ includeCrmDates: true }),
      clock.now().toISOString(),
    );

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");

    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    const crmDates = result.dependencies.find((dependency) => dependency.nodeId === "crm-dates");
    assert.ok(crmDates?.state === "resolved");
    const value = PersonLookupResultSchema.parse(result.result.value);
    assert.equal(value.crmDates.state, "included");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.ok(database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "crm-dates"));
  });
});

describe("failure, retry, and resume", () => {
  it("keeps arbitrary task failure detail unstamped in authority and out of the admitted task span", async () => {
    const rawDiagnostic = "ucpath:termination|10812345|2026-08-29";
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: (): Promise<never> => Promise.reject(new Error(rawDiagnostic)),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      }),
    });
    const harness = executorHarness({ sessions });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run?.lifecycle.state === "terminal");
    const failureId = run.lifecycle.failureId;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);

    assert.equal(failure.summary.includes(rawDiagnostic), true, "authority must retain the opaque source detail");
    assert.equal(failure.diagnosticSafetyVersion, undefined);
    assert.equal(run.lifecycle.errorSummary, failure.summary);
    assert.equal(run.lifecycle.diagnosticSafetyVersion, undefined);

    const failedTaskSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && event.kind === "task" && event.outcome === "failed");
    assert.ok(failedTaskSpan?.t === "span.ended" && failedTaskSpan.kind === "task");
    assert.equal(failedTaskSpan.diagnosticSafetyVersion, 1);
    assert.equal(
      failedTaskSpan.errorSummary,
      "task crm/read-onboarding-record failed; inspect its structured failure record",
    );
    assert.equal(JSON.stringify(failedTaskSpan).includes(rawDiagnostic), false);
  });

  it("terminalizes a node failure with the exact structured record and authorization consequence", async () => {
    // CRM is down: a non-transient task error must land the run failed,
    // naming the exact node and task.
    const mismatched = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: () => Promise.reject(new TaskError(
          CrmReadOnboardingRecord.id,
          "crm-unavailable",
          "CRM returned an unexpected page",
        )),
        readOnboardingDates: () => Promise.reject(new Error("unused")),
      }),
    });
    const harness = executorHarness({ sessions: mismatched });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.equal(failure.nodeId, "cross-verify");
    assert.equal(failure.taskId, "crm/read-onboarding-record");
    assert.equal(failure.code, "CRM_UNAVAILABLE");
    // The authorization retained the pre-terminal CAS and claim.
    const authorization = database.authority.runs.get(RUN_ID)?.completion;
    assert.ok(authorization && authorization.kind === "failed");
    assert.equal(run.version, authorization.expectedVersion + 1);
    assert.equal(run.claimGeneration, authorization.claim.claimGeneration);
    // The failing CRM session poison-closed; UCPath's stayed healthy.
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
  });

  it("retries a transient task failure in-run with attempt-suffixed spans and a fresh session", async () => {
    let crmCalls = 0;
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: (openIndex) => {
        if (openIndex === 1) {
          return Object.freeze({
            system: "crm" as const,
            readOnboardingRecord: (): Promise<never> => {
              crmCalls += 1;
              return Promise.reject(new TaskError(
                CrmReadOnboardingRecord.id,
                "crm-unavailable",
                "CRM 502",
                { transient: true },
              ));
            },
            readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
          });
        }
        return healthyCrmDriver();
      },
    });
    // Auto-fire the 2s retry backoff; the 60s task deadline stays pending.
    const harness = executorHarness({ sessions, autoFireAtOrBelowMs: 2_500 });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    assert.equal(crmCalls, 1);
    // First CRM session poison-closed after the failure; a fresh one served #2.
    assert.equal(harness.sessions.opens("crm"), 2);
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const crossVerifySpans = harness.emitter.events()
      .filter((event) => event.spanPath.includes("/cross-verify#"))
      .map((event) => [event.t, event.spanPath, "outcome" in event ? event.outcome : ""]);
    // The failed attempt read nothing before it threw, so it publishes no
    // observation; the successful one does, on ITS OWN span path (D123/D214).
    assert.deepEqual(crossVerifySpans, [
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "failed"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 2, 1), "done"],
    ]);
  });

  it("rolls back an ordinary checkpoint when its required timeline event cannot persist", async () => {
    const h = executorHarness();
    const { database, clock, path } = h.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const raw = new DatabaseSync(path);
    try {
      raw.exec("CREATE TRIGGER injected_checkpoint_event BEFORE INSERT ON timeline_events WHEN json_extract(NEW.record_json, '$.payload.kind') = 'checkpoint-recorded' BEGIN SELECT RAISE(ABORT, 'injected checkpoint event'); END");
      const outcome = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
      assert.equal(outcome.state, "failed");
      assert.equal(database.authority.runCheckpoints.latest(WORKFLOW_ID, claimed.run.envelope.itemId, "searching"), undefined);
      assert.equal(database.authority.timelineEvents.page({ runId: RUN_ID }).some((row) => row.payload.kind === "checkpoint-recorded"), false);
      assert.equal(h.emitter.events().some((event) => event.t === "span.ended" && event.kind === "task"
        && event.spanPath.includes("/searching#") && event.outcome === "done"), false);
      assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run"
        && event.outcome === "failed").length, 1);
    } finally { raw.close(); }
  });

  it("replays compatible checkpoints on a cross-run retry and re-executes always-rerun nodes", async () => {
    let ucpathSearches = 0;
    const failingCrm = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            ucpathSearches += 1;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: (): Promise<never> => Promise.reject(new Error("CRM exploded")),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      }),
    });
    const first = executorHarness({ sessions: failingCrm });
    const { database, clock } = first.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const failed = await executeClaimedRun(first.deps, { ...claimed, signal: SIGNAL });
    assert.equal(failed.state, "failed");
    assert.equal(ucpathSearches, 1);

    // Cross-run retry: a NEW run on the same logical item (ref workflow-model §6).
    // D221 — a retry is the ITEM's next attempt, not a second attempt 1.
    const retryRun = personLookupQueuedRun({ runId: UUID_5, attempt: 2 });
    const retryEnvelope = retryRun.envelope as Record<string, unknown>;
    retryEnvelope.runId = UUID_5;
    retryEnvelope.retryOf = RUN_ID;
    database.authority.runs.enqueue(retryRun);
    const reclaimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(reclaimed.state, "claimed");
    if (reclaimed.state !== "claimed") return;

    let ucpathSearchesRetry = 0;
    const healthySessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            ucpathSearchesRetry += 1;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => healthyCrmDriver(),
    });
    const second = executorHarness({ sessions: healthySessions });
    // Reuse the FIRST authority database — the checkpoints live there.
    const secondDeps: RunExecutorDependencies = {
      ...second.deps,
      lifecycle: testRunLifecycle(database, clock),
      authority: database,
      emitter: createTimelineEmitter({ repository: database.authority.timelineEvents, clock }),
      clock,
    };
    const outcome = await executeClaimedRun(secondDeps, {
      run: reclaimed.run,
      claim: { workerId: WORKER_ID, claimGeneration: reclaimed.run.claimGeneration },
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "done");
    // `searching` replayed from its checkpoint — zero new UCPath searches —
    // while `active-status` (always-rerun) executed fresh.
    assert.equal(ucpathSearchesRetry, 0);
    assert.equal(healthySessions.opens("ucpath"), 0);
    assert.equal(healthySessions.opens("crm"), 1);

    const result = database.authority.runResults.get(UUID_5);
    assert.ok(result);
    const active = result.dependencies.find((dependency) => dependency.nodeId === "active-status");
    assert.ok(active?.state === "resolved");
    // The always-rerun dependency was produced by THIS run, not replayed from
    // the failed one: the interpreter never consults loadCheckpoint for it.
    assert.equal(active.checkpoint.runId, UUID_5);
    const replay = database.authority.timelineEvents.page({ runId: UUID_5 }).filter((event) => event.payload.kind === "checkpoint-replayed");
    assert.ok(replay.some((event) => event.payload.kind === "checkpoint-replayed"
      && event.payload.checkpoint.nodeId === "searching" && event.payload.checkpoint.runId === RUN_ID
      && event.payload.runId === UUID_5 && event.payload.attempt === 2));
    const spans = database.authority.timelineEvents.page({ runId: UUID_5 }).flatMap((record) =>
      record.payload.kind === "span" ? [record.payload.event.spanPath] : []);
    assert.ok(spans.every((path) => !path.includes("/searching#")), "replayed searching must not re-span");
  });

  it("refuses an explicit startAt resume whose ancestors have no checkpoints, before any browser", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      personLookupQueuedRun({ startAt: "active-status" }),
      clock.now().toISOString(),
    );

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    // §5.4: before any browser launches — zero sessions were opened.
    assert.equal(harness.sessions.opens(), 0);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    // Entry validation names EVERY missing ancestor in ONE failure, no node id.
    assert.equal(failure.nodeId, undefined);
    assert.equal(failure.code, "RESUME_VALIDATION_FAILED");
    assert.match(failure.summary, /start at "active-status"/);
    assert.match(failure.summary, /missing context "searching"/);
    assert.match(failure.summary, /ucpath\/search-person-org/);
    assert.match(failure.summary, /missing context "cross-verify"/);
  });

  it("emits every recorded point on the task's own span with original values (D346)", async () => {
    const harness = executorHarness({ sessions: happySessionHarness() });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const searching = taskSpanPath(trace, NodeIdSchema.parse("searching"), 1, 1);

    const observed = harness.emitter.events()
      .filter((event) => event.t === "data.observed" && event.spanPath === searching);
    // ONE event per `ctx.recordData` CALL: `searchPersonOrgTask` records both
    // of its points in one batch, and a batch is one observation of the page.
    assert.equal(observed.length, 1);
    const event = observed[0];
    assert.ok(event !== undefined && event.t === "data.observed");
    assert.equal(event.nodeId, "searching");
    assert.equal(event.taskId, "ucpath/search-person-org");
    assert.equal(event.observedAt, event.ts);
    assert.deepEqual(event.points.map((point) => point.field), ["results", "selection"]);
    assert.deepEqual([...new Set(event.points.map((point) => point.direction))], ["read"]);

    // Classification stays declared per leaf; the original is retained for the operator.
    const values = new Map(event.points.flatMap((point) => point.values.map((value) => [value.key, value])));
    assert.equal(values.get("results")?.transform, "allow");
    assert.equal(values.get("results")?.state, "allowed");
    assert.equal(values.get("selection.status")?.state, "allowed");
    const emplId = values.get("selection.selected.emplId");
    assert.equal(emplId?.transform, "allow");
    assert.equal(emplId?.state, "allowed");

    // A point covering a populated object contributes one value PER LEAF, in
    // the same path vocabulary a `FactProvenance` row is written under.
    const selection = event.points.find((point) => point.field === "selection");
    assert.ok((selection?.values.length ?? 0) > 1);
    assert.equal(selection?.values.every((value) => value.key.startsWith("selection.")), true);

    // The whole identifier is retained alongside the classified projection.
    const checkpoint = database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "searching");
    const recorded = JSON.stringify(checkpoint?.output.value ?? {});
    const wholeEid = /"emplId":"(\d+)"/.exec(recorded)?.[1];
    assert.ok(wholeEid !== undefined && wholeEid.length > 4);
    assert.equal(emplId?.state === "allowed" ? emplId.value : undefined, wholeEid);
    assert.equal(JSON.stringify(event).includes(wholeEid), true);
  });

  it("retains a protected canary EID in real executor observed-data emission", async () => {
    const harness = executorHarness({ sessions: happySessionHarness() });
    const { database, clock } = harness.authority;
    const binding = { kind: "test-data-local" as const, inputPath: "emplId" as const,
      name: "personLookupCanaryEid" as const, sourceId: "00000000-0000-4000-8000-000000000088" };
    const claimed = enqueueAndClaim(database, personLookupQueuedRun({ protectedBindings: [binding] }), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const points = harness.emitter.events().flatMap((event) => event.t === "data.observed" ? event.points : []);
    const identifiers = points.flatMap((point) => point.values).filter(({ key }) => key.endsWith("emplId"));
    assert.ok(identifiers.length > 0);
    assert.ok(identifiers.every((value) => value.state === "allowed" && value.value !== undefined));
    assert.ok(identifiers.some((value) => value.state === "allowed" && value.value === "10873698"));
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.input.parsed.protectedBindings, [binding]);
  });

  it("fails the task by name on an UNDECLARED leaf, emitting nothing for that batch (D270)", async () => {
    // The point is honest about the page and the classification table has no
    // line for it. Dropping it would make the log look complete while hiding
    // what the run read, so the recording task fails instead.
    const undeclaredCrossVerify = defineTask(crmDriver, CrmReadOnboardingRecord, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const read = await ctx.driver.readOnboardingRecord(input);
        ctx.recordData([{ direction: "read", field: "undeclaredLeaf", value: "x" }]);
        return read.output;
      },
    });
    const brokenCrmStore = defineBrowserStore("crm", crmDriver, crmSession, {
      readOnboardingRecord: undeclaredCrossVerify,
      readOnboardingDates: readOnboardingDatesTask,
    });
    const stores: (typeof taskStoreRegistry.stores)[number][] = taskStoreRegistry.stores.map((store) =>
      store.namespace === "crm" ? brokenCrmStore : store);
    const registry = defineTaskStoreRegistry(stores, {
      scenarioIds: EXECUTABLE_SCENARIO_IDS,
      tasks: stores.flatMap((store) => Object.values(store.tasks))
        .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
    });

    const harness = executorHarness({ stores: registry });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    // The refusal names the task AND the field — the two things an author needs.
    assert.match(failure.summary, /crm\/read-onboarding-record/);
    assert.match(failure.summary, /undeclaredLeaf/);
    assert.match(failure.summary, /no declared evidence classification/);

    // Nothing from that batch reached the stream, and no checkpoint landed.
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const crossVerify = taskSpanPath(trace, NodeIdSchema.parse("cross-verify"), 1, 1);
    assert.equal(
      harness.emitter.events().filter((event) =>
        event.t === "data.observed" && event.spanPath === crossVerify).length,
      0,
    );
    assert.equal(
      database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "cross-verify"),
      undefined,
    );
  });

  it("fails a task whose provenance does not cover its output, before any checkpoint", async () => {
    // A store task that returns a valid output but records NO data points.
    const brokenCrossVerify = defineTask(crmDriver, CrmReadOnboardingRecord, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const read = await ctx.driver.readOnboardingRecord(input);
        return read.output;
      },
    });
    const crmTasks = {
      readOnboardingRecord: brokenCrossVerify,
      readOnboardingDates: readOnboardingDatesTask,
    };
    const brokenCrmStore = defineBrowserStore("crm", crmDriver, crmSession, crmTasks);
    const stores: (typeof taskStoreRegistry.stores)[number][] = taskStoreRegistry.stores.map((store) =>
      store.namespace === "crm" ? brokenCrmStore : store);
    const corpus = {
      scenarioIds: EXECUTABLE_SCENARIO_IDS,
      tasks: stores.flatMap((store) => Object.values(store.tasks))
        .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
    };
    const registry = defineTaskStoreRegistry(stores, corpus);

    const harness = executorHarness({ stores: registry });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /recorded no provenance points/);
    // The unproven output never became durable authority.
    assert.equal(
      database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "cross-verify"),
      undefined,
    );
  });

  it("bounds a non-cooperative task by its immutable deadline and fails loud", async () => {
    let wedged: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      wedged = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        // Ignores its signal and never settles: only the deadline race bounds it.
        searchPersonOrg: (): Promise<never> => {
          wedged?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const harness = executorHarness({ sessions, taskDeadlineMs: 5_000 });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const executing = executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    await started;
    const deadline = harness.scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === clock.monotonicMs() + 5_000);
    assert.ok(deadline, "the task deadline must be scheduled while the task runs");
    deadline.fire();
    const outcome = await executing;
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /exceeded its immutable 5000ms task deadline/);
    // The wedged session was poison-closed, not reused.
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
  });

  // D166: injected patches now APPLY to replayed checkpoints; a patch naming
  // a node with no checkpoint to replay is refused loudly — a fresh read
  // supersedes any correction, so the patch must never be silently ignored.
  it("rejects injected patches naming a node this run does not replay", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun({ startAt: "cross-verify" });
    const envelope = run.envelope as Record<string, unknown>;
    envelope.injected = [{
      nodeId: "searching",
      fieldPath: "selection.status",
      value: "resolved",
      correctedAt: clock.now().toISOString(),
      reason: "operator correction",
    }];
    const claimed = enqueueAndClaim(database, run, clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const stored = database.authority.runs.get(RUN_ID);
    assert.ok(stored && stored.lifecycle.state === "terminal");
    const failureId = stored.lifecycle.state === "terminal" ? stored.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /does not replay from a checkpoint/);
    assert.equal(harness.sessions.opens(), 0);
  });

  it("returns abandoned when the run signal aborts mid-task and poison-closes the lease", async () => {
    let releaseDriver: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      releaseDriver = resolve;
    });
    const controller = new AbortController();
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          releaseDriver?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const harness = executorHarness({ sessions });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const executing = executeClaimedRun(harness.deps, { ...claimed, signal: controller.signal });
    await started;
    controller.abort(new Error("operator cancelled the run"));
    const outcome = await executing;
    assert.equal(outcome.state, "abandoned");
    if (outcome.state === "abandoned") assert.match(outcome.reason, /operator cancelled the run/);
    await new Promise((resolve) => setImmediate(resolve));
    // No terminal settlement was attempted; the run is still claimed/running.
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "running");
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
  });
});

describe("terminal identity binding", () => {
  it("refuses to execute a run bound to a different descriptor identity", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.contractFingerprint = UUID_6.replaceAll("-", "").padEnd(64, "0");
    database.authority.runs.enqueue(run);
    const claimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    await assert.rejects(
      executeClaimedRun(harness.deps, {
        run: claimed.run,
        claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
        signal: SIGNAL,
      }),
      /the worker is miswired/,
    );
  });
});


describe("worker terminal service boundary", () => {
  it("honours an admitted cancellation before the next non-fenced operation", async () => {
    const h = executorHarness();
    const { database, clock } = h.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    assert.equal(testRunService(database, clock).transition({
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: RUN_ID,
      expectedVersion: claimed.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
    }).state, "applied");
    const outcome = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "abandoned");
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    assert.equal(h.sessions.opens("ucpath"), 0);
    assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run"
      && event.outcome === "cancelled").length, 1);
  });

  for (const failure of ["refusal", "outer-rollback"] as const) {
    it(`never publishes run end after terminal ${failure}`, async () => {
      const h = executorHarness();
      const { database, clock } = h.authority;
      const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
      const lifecycle = h.deps.lifecycle;
      const deps: RunExecutorDependencies = { ...h.deps, lifecycle: { ...lifecycle,
        terminalize: (...args) => database.withAuthorityTransaction(() => {
          if (failure === "refusal") return { state: "refused", refusal: { reason: "lost" } };
          const result = lifecycle.terminalize(...args);
          assert.equal(result.state, "applied");
          assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 1, "state and event coexist inside the uncommitted transaction");
          throw new Error("outer terminal rollback");
        }),
      } };
      if (failure === "refusal") assert.equal((await executeClaimedRun(deps, { ...claimed, signal: SIGNAL })).state, "abandoned");
      else await assert.rejects(executeClaimedRun(deps, { ...claimed, signal: SIGNAL }), /outer terminal rollback/);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.authority.runResults.get(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
      assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 0);
    });
  }
});


describe("original claim at failure terminalization", () => {
  it("cannot borrow a replacement worker claim after awaiting diagnostic capture", async () => {
    const h = executorHarness();
    const { database, clock } = h.authority;
    const invalid = RunRecordSchema.parse(personLookupQueuedRun());
    const claimed = enqueueAndClaim(database, { ...invalid, input: {
      ...invalid.input, parsed: { schemaHash: "a".repeat(64), value: {} },
    } }, clock.now().toISOString());
    const lifecycle = h.deps.lifecycle;
    const deps: RunExecutorDependencies = { ...h.deps, diagnostics: {
      captureForFailure: async (context) => {
        const current = database.authority.runs.get(RUN_ID);
        assert.ok(current);
        assert.equal(lifecycle.requeue({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: RUN_ID,
          expectedVersion: current.version, claim: claimed.claim, cause: "recovery" }).state, "applied");
        const replacement = database.authority.runs.claimNext({ workflow: WORKFLOW_ID,
          workerId: "replacement-worker", now: clock.now().toISOString() });
        assert.equal(replacement.state, "claimed");
        return DiagnosticBundleSchema.parse({ bundleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          runId: RUN_ID, origin: { kind: "failure", failureId: context.failure.failureId },
          createdAt: clock.now().toISOString(), contentDigest: "a".repeat(64),
          configFingerprint: context.configFingerprint, descriptorFingerprint: context.descriptorFingerprint,
          redaction: { fields: [], warnings: [] }, attachments: [],
          retention: { kind: "pinned", reason: "write-recovery" },
        });
      },
      persist: () => { throw new Error("lost claimant must never persist the prepared bundle"); },
    } };
    const result = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(result.state, "abandoned");
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "claimed");
    assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
    assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 0);
  });
});

describe("cancellation racing failure authorization", () => {
  it("settles cancelled when admission commits after the boundary read but before authorization", async () => {
    const h = executorHarness();
    const { database, clock } = h.authority;
    const input = RunRecordSchema.parse(personLookupQueuedRun());
    const claimed = enqueueAndClaim(database, { ...input, input: {
      ...input.input, parsed: { schemaHash: "a".repeat(64), value: {} },
    } }, clock.now().toISOString());
    let interleaved = false;
    let validatingReads = 0;
    const deps: RunExecutorDependencies = { ...h.deps, authority: {
      authority: { ...database.authority, runs: { get: (runId) => {
        const current = database.authority.runs.get(runId);
        if (current?.lifecycle.state === "validating") validatingReads++;
        if (!interleaved && validatingReads === 2) {
          assert.ok(current);
          interleaved = true;
          assert.equal(testRunService(database, clock).transition({
            commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", runId,
            expectedVersion: current.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
          }).state, "applied");
        }
        return current;
      } } },
      afterAuthorityCommit: database.afterAuthorityCommit.bind(database),
      withAuthorityTransaction: database.withAuthorityTransaction.bind(database),
    } };
    const outcome = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(interleaved, true);
    assert.equal(outcome.state, "abandoned");
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
    assert.deepEqual(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run")
      .map((event) => event.outcome), ["cancelled"]);
  });
});

describe("cancellation racing terminal admission", () => {
  it("settles cancellation after a success request loses its version at service admission", async () => {
    const h = executorHarness();
    const { database, clock } = h.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const lifecycle = h.deps.lifecycle;
    let interleaved = false;
    const deps: RunExecutorDependencies = { ...h.deps, lifecycle: { ...lifecycle,
      terminalize: (...args) => {
        if (!interleaved) {
          interleaved = true;
          const current = database.authority.runs.get(RUN_ID);
          assert.ok(current?.lifecycle.state === "running");
          assert.equal(testRunService(database, clock).transition({
            commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", runId: RUN_ID,
            expectedVersion: current.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
          }).state, "applied");
        }
        return lifecycle.terminalize(...args);
      },
    } };
    assert.equal((await executeClaimedRun(deps, { ...claimed, signal: SIGNAL })).state, "abandoned");
    assert.equal(interleaved, true);
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
    assert.deepEqual(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run")
      .map((event) => event.outcome), ["cancelled"]);
  });
});

it("executes two canonical children and a nested child, preserving every derived input through real terminal authority and source routes", async () => {
  const harness = executorHarness({ descriptor: plan1Parent.descriptor, stores: plan1Stores });
  const { database, clock, stateRoot } = harness.authority;
  const config = { ...CONFIG_SNAPSHOT.config, actor: { ...CONFIG_SNAPSHOT.config.actor, label: "Different operator" } };
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
  database.authority.configSnapshots.insert({ ...CONFIG_SNAPSHOT, configSnapshotId: PLAN1_CONFIG_ID, config, fingerprint });
  const writer = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
  const originalTerminalize = harness.deps.lifecycle.terminalize;
  const fixtureLifecycle = { ...harness.deps.lifecycle, terminalize: (...args: Parameters<typeof originalTerminalize>) => originalTerminalize(...args) };
  let number = 0;
  const createRun = (compiled: typeof plan1Parent, value: unknown, parent?: RunParent, itemId?: string) => {
    const sequence = ++number;
    return buildQueuedRun({ descriptor: compiled.descriptor, appVersion: "0.1.0", runId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      itemId: itemId ?? `00000000-0000-4000-8001-${String(sequence).padStart(12, "0")}`, traceId: `fp-170000-${String(sequence).padStart(4, "0")}`,
      rawInput: JsonValueSchema.parse(value), canonicalInput: { schemaHash: deriveSchemaHash(Plan1CanonicalInput, "output"), value: Plan1Input.parse(value) }, ingressSchemaHash: deriveSchemaHash(Plan1Input, "input"),
      configFingerprint: fingerprint, configSnapshotId: PLAN1_CONFIG_ID, resolvedInstance: {}, shape: parent === undefined ? "single" : "operation-member", priority: "bulk", dryRun: false,
      attempt: 1, runNumber: sequence, now: clock.now().toISOString(), ...(parent === undefined ? {} : { parent }) });
  };
  const childExecutor: NonNullable<RunExecutorDependencies["childRuns"]> = { async executeChildRun(context) {
    const node = context.node;
    if (node.cardinality !== "one" || node.await !== "terminal") throw new Error("fixture-child-shape-mismatch");
    const compiled = plan1Workflows.find((compiled) => compiled.descriptor.id === node.target.id);
    if (compiled === undefined) throw new Error("fixture-child-target-unavailable");
    const value = node.bind(context.scope);
    const childInput = createRun(compiled, value, { runId: context.run.envelope.runId, edgeId: node.edgeId, tracePrefix: context.run.envelope.traceId }, node.deriveChildItemId(Plan1Input.parse(value)));
    const protectedBindings = context.run.input.parsed.protectedBindings;
    const child = protectedBindings === undefined ? childInput : { ...childInput, input: { ...childInput.input, parsed: { ...childInput.input.parsed, protectedBindings } } };
    database.authority.runs.enqueue(child);
    const childClaim = database.authority.runs.claimNext({ workflow: compiled.descriptor.id, workerId: `worker-child-${number}`, now: clock.now().toISOString() });
    if (childClaim.state !== "claimed") throw new Error("fixture-child-claim-refused");
    const claimed = { run: childClaim.run, claim: { workerId: childClaim.run.lifecycle.state === "claimed" ? childClaim.run.lifecycle.workerId : "invalid", claimGeneration: childClaim.run.claimGeneration } };
    const outcome = await executeClaimedRun({ ...harness.deps, descriptor: compiled.descriptor, lifecycle: fixtureLifecycle, childRuns: childExecutor, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    if (outcome.state !== "done") throw new Error(`fixture-child-did-not-complete:${JSON.stringify(outcome)}:${JSON.stringify(database.authority.runs.get(child.envelope.runId))}`);
    const result = database.authority.runResults.get(child.envelope.runId);
    assert.ok(result);
    return { state: "done", runId: child.envelope.runId, itemId: child.envelope.itemId, output: result.result.value };
  } };
  const root = createRun(plan1Parent, { emplId: "10800000", text: "same", mode: "ok" });
  const claimed = enqueueAndClaim(database, root, clock.now().toISOString(), plan1Parent.descriptor.id);
  const outcome = await executeClaimedRun({ ...harness.deps, lifecycle: fixtureLifecycle, childRuns: childExecutor, taskNotes: writer }, { ...claimed, signal: SIGNAL });
  assert.equal(outcome.state, "done", JSON.stringify(database.authority.failures.listByRun(root.envelope.runId)));
  const retained = database.authority.runResults.get(root.envelope.runId);
  assert.ok(retained);
  assert.deepEqual(retained.dependencies.map((dependency) => dependency.state), ["child-resolved", "child-resolved", "resolved"]);
  const notes = readEventStreamLines(stateRoot, "notes").map(({ text }) => NoteWireSchema.parse(JSON.parse(text)));
  const consumed = notes.find((note) => "runId" in note && note.runId === root.envelope.runId && note.action?.operation?.state === "completed" && note.action.operation.logicalActionId === "consume-text")?.action?.operation;
  assert.ok(consumed?.value?.producer.kind === "transformation");
  assert.deepEqual(consumed.value.producer.inputs?.map((input) => [input.inputId, input.state, input.identities.length]), [["left", "retained", 2], ["right", "retained", 1], ["label", "definition-source", 0]]);
  const identity = consumed.value.producer.inputs?.[0]?.identities[0];
  assert.ok(identity);
  const deps = { stateRoot, runReader: testRunService(database, clock), canonical: { database }, descriptors: { resolve: () => undefined }, projection: { runLogSnapshot: () => ({ entries: [] }) } } as unknown as RunDetailQueryDeps;
  const found = resolveOperationSource(deps, root.envelope.runId, { identity });
  assert.equal(found.state, "found");
  assert.throws(() => resolveOperationSource(deps, identity.runId, { identity: (() => { const { value: _value, ...identity } = consumed; return identity; })() }), /child-not-authorized/u);
  assert.throws(() => resolveOperationSource(deps, root.envelope.runId, { identity: { ...identity, childInvocation: { ...identity.childInvocation, edgeId: "foreign-edge" } } }), /child-identity-mismatch/u);
  assert.throws(() => resolveOperationSource(deps, root.envelope.runId, { identity: { ...identity, logicalActionId: "unknown-action" } }), /unknown-frozen-action/u);
  assert.throws(() => resolveOperationSource(deps, root.envelope.runId, { identity: { ...identity, invocationId: "unknown-invocation" } }), /unknown-frozen-invocation/u);
  const protectedParentBase = createRun(plan1Parent, { emplId: "10800000", text: "secret-derived", mode: "ok" });
  const protectedParent = { ...protectedParentBase, input: { ...protectedParentBase.input, parsed: { ...protectedParentBase.input.parsed, protectedBindings: [{ kind: "legacy-protected-input" as const, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const }] } } };
  const protectedClaim = enqueueAndClaim(database, protectedParent, clock.now().toISOString(), plan1Parent.descriptor.id);
  assert.equal((await executeClaimedRun({ ...harness.deps, childRuns: childExecutor, taskNotes: writer }, { ...protectedClaim, signal: SIGNAL })).state, "done", database.authority.failures.listByRun(protectedParent.envelope.runId).map((failure) => failure.summary).join(";"));
  const protectedNotes = readEventStreamLines(stateRoot, "notes").map(({ text }) => NoteWireSchema.parse(JSON.parse(text))).filter((note) => "runId" in note && note.runId === protectedParent.envelope.runId);
  const protectedConsumed = protectedNotes.find((note) => note.action?.operation?.logicalActionId === "consume-text" && note.action.operation.state === "completed")?.action;
  assert.equal(protectedConsumed?.operation?.value?.consumed.state, "withheld");
  assert.equal(protectedConsumed?.value, undefined);
  for (const mode of ["fail", "repeat", "ok", "unprotected"] as const) {
    const fresh = createRun(plan1Workflows[0], { emplId: "10800000", text: "same", mode: mode === "unprotected" ? "ok" : mode });
    const local = mode !== "ok" ? fresh : { ...fresh, input: { ...fresh.input, parsed: { ...fresh.input.parsed, protectedBindings: [{ kind: "legacy-protected-input" as const, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const }] } } };
    const localClaim = enqueueAndClaim(database, local, clock.now().toISOString(), plan1Workflows[0].descriptor.id);
    const localOutcome = await executeClaimedRun({ ...harness.deps, descriptor: plan1Workflows[0].descriptor, taskNotes: writer }, { ...localClaim, signal: SIGNAL });
    assert.equal(localOutcome.state, mode === "fail" ? "failed" : "done");
    const localNotes = readEventStreamLines(stateRoot, "notes").map(({ text }) => NoteWireSchema.parse(JSON.parse(text))).filter((note) => "runId" in note && note.runId === local.envelope.runId);
    assert.ok(localNotes.some((note) => note.action?.operation?.state === "not-run" && note.action.operation.reason === "condition-false"));
    if (mode === "fail") assert.ok(localNotes.some((note) => note.action?.operation?.state === "failed" && note.action.operation.reason === "callback-failed"));
    if (mode === "repeat") assert.equal(database.authority.runResults.get(local.envelope.runId)?.operationLineage?.[0]?.inputs[0]?.state, "unavailable");
    if (mode === "unprotected") {
      const replay = createRun(plan1Workflows[0], { emplId: "10800000", text: "same", mode: "ok" }, undefined, local.envelope.itemId);
      const replayClaim = enqueueAndClaim(database, { ...replay, envelope: { ...replay.envelope, attempt: 2 } }, clock.now().toISOString(), plan1Workflows[0].descriptor.id);
      assert.equal((await executeClaimedRun({ ...harness.deps, descriptor: plan1Workflows[0].descriptor, taskNotes: writer }, { ...replayClaim, signal: SIGNAL })).state, "done");
      const origin = database.authority.runResults.get(replay.envelope.runId)?.operationSources?.[0]?.identity;
      assert.ok(origin);
      assert.equal(origin.runId, local.envelope.runId);
      assert.equal(resolveOperationSource(deps, replay.envelope.runId, { identity: origin }).state, "found");
      const correctedBase = createRun(plan1Workflows[0], { emplId: "10800000", text: "same", mode: "ok" }, undefined, local.envelope.itemId);
      const corrected = { ...correctedBase, envelope: { ...correctedBase.envelope, attempt: 3, injected: [{ nodeId: "first", fieldPath: "disposition", value: "operator-corrected", correctedAt: clock.now().toISOString(), reason: "Synthetic operator correction" }] } };
      const correctedClaim = enqueueAndClaim(database, corrected, clock.now().toISOString(), plan1Workflows[0].descriptor.id);
      assert.equal((await executeClaimedRun({ ...harness.deps, descriptor: plan1Workflows[0].descriptor, taskNotes: writer }, { ...correctedClaim, signal: SIGNAL })).state, "done");
      const correctedResult = database.authority.runResults.get(corrected.envelope.runId);
      assert.equal(correctedResult?.operationLineage?.[0]?.inputs[0]?.state, "unavailable");
      assert.equal(Plan1Output.parse(correctedResult?.result.value).disposition, "operator-corrected/same");
      assert.ok(!correctedResult?.dependencies.some((dependency) => dependency.state === "resolved" && dependency.nodeId === "first" && dependency.operationSources?.some((source) => source.path === "disposition")));

    }
    if (mode === "ok") {
      const read = localNotes.find((note) => note.action?.operation?.logicalActionId === "read-eid" && note.action.operation.state === "completed");
      assert.equal(read?.action?.operation?.value?.consumed.state, "redacted");
      assert.equal(localNotes.find((note) => note.action?.operation?.logicalActionId === "read-disposition" && note.action.operation.state === "completed")?.action?.operation?.value?.consumed.state, "redacted", "unequal protected-derived output cannot be classified safe by equality");
      assert.equal(read?.action?.value, undefined);
      assert.ok(read?.action?.operation?.value?.consumed !== undefined && !("value" in read.action.operation.value.consumed));

    }
  }

});
