import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { plan1Parent,plan1Workflows } from "../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema,taskSpanPath } from "../../../src/backend/logs/span-emitter.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/index.js";
import { crmDriver } from "../../../src/backend/systems/crm/driver-declaration.js";
import { crmSession } from "../../../src/backend/systems/crm/session-provider.js";
import { readOnboardingDatesTask } from "../../../src/backend/systems/crm/tasks/read-onboarding-dates.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { EidSchema,NodeIdSchema,TraceIdSchema } from "../../../src/rules/identity/ids.js";
import { TaskError } from "../../../src/workflow-kit/errors.js";
import { defineBrowserStore,defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../../src/workflow-kit/validation/scenario-execution.js";
import { compileWorkflow,defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../support/fixtures/workflow-definition-fixtures.js";
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
} from "../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

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

describe("person-lookup full walk", () => {

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


    const skipSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && "outcome" in event && event.outcome === "skipped");
    assert.ok(skipSpan);
    assert.equal(
      skipSpan.t === "span.ended" && "notRunReason" in skipSpan ? skipSpan.notRunReason : undefined,
      crmDates.reason,
    );
  });
});

describe("failure, retry, and resume", () => {

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

    assert.deepEqual(crossVerifySpans, [
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "failed"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 2, 1), "done"],
    ]);
  });

  it("emits every recorded point on the task's own span with original values", async () => {
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

  it("fails the task by name on an UNDECLARED leaf, emitting nothing for that batch", async () => {

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
});
