import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { plan1Parent,plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../src/backend/logs/span-emitter.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import {
executeClaimedRun,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import type { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { recordBrowserAction,runDeclaredAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
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
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
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
});
