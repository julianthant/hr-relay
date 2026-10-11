import { createTimelineEmitter } from "../../src/backend/storage/events/timeline-emitter.js";
import { plan1Parent,plan1Workflows } from "../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testWorkerPorts } from "../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../src/backend/logs/span-emitter.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { AuthorityDatabase } from "../../src/backend/storage/sqlite/index.js";
import type { RunRecord } from "../../src/models/run/record.js";
import { CrmReadOnboardingRecord } from "../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg,SearchPersonOrgOutputSchema } from "../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../src/models/workflow/canonical-input.js";
import {
OPERATION_DISPLAY_FORMAT_VERSION,
type WorkflowOperationDisplayDeclaration,
} from "../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { EidSchema } from "../../src/rules/identity/ids.js";
import { TaskError } from "../../src/workflow-kit/errors.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../src/workflow-kit/workflow.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../support/fixtures/workflow-definition-fixtures.js";
import {
happySessionHarness,
healthyUcpathDriver,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
sessionManagerFor,
type AuthorityHarness,
type SessionFactoryHarness
} from "../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";

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

describe("failure, retry, and resume", () => {

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
});
