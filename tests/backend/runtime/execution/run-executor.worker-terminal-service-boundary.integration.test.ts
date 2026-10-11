import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { plan1Parent,plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testRunService,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../src/backend/logs/span-emitter.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../../support/fixtures/workflow-definition-fixtures.js";
import {
happySessionHarness,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingEmitter,
recordingLogger,
sessionManagerFor,
type AuthorityHarness,
type SessionFactoryHarness
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

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
