import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { ucpathSession } from "../../../../src/backend/systems/ucpath/session-provider.js";
import { ucpathStore } from "../../../../src/backend/systems/ucpath/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { crmStore } from "../../../../src/backend/systems/crm/task-registry.js";
import { crmDriver } from "../../../../src/backend/systems/crm/driver-declaration.js";
import { crmSession } from "../../../../src/backend/systems/crm/session-provider.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { plan1Parent, plan1Workflows } from "../../fixtures/plan1-operation-workflows.js";
import { testRunLifecycle, testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ExecutorSpanEventSchema } from "../../../../src/backend/logs/span-emitter.js";
import { type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { type WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrg, SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { OPERATION_DISPLAY_FORMAT_VERSION, type WorkflowOperationDisplayDeclaration } from "../../../../src/models/workflow/operation-display.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { sequentialIdFactory, WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../fixtures/workflow-definition-fixtures.js";
import { happySessionHarness, healthyCrmDriver, healthyUcpathDriver, ManualScheduler, openAuthorityHarness, recordingEmitter, recordingLogger, sessionFactoryHarness, sessionManagerFor, type AuthorityHarness, type SessionFactoryHarness } from "../phase1f-executor-harness.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { CONFIG_SNAPSHOT, UUID_4, UUID_5, UUID_6 } from "../../fixtures/phase1c-contract-fixtures.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { type RunParent } from "../../../../src/models/run/envelope.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { recordBrowserAction, runDeclaredAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";

interface ExecutorHarness {
  readonly authority: AuthorityHarness;
  readonly sessions: SessionFactoryHarness;
  readonly manager: WorkerSessionManager;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly deps: RunExecutorDependencies;
}

export function createRunExecutorTestWorld() {
  const authorityHarnesses = new WeakMap<AuthorityDatabase, AuthorityHarness>();

  const disposers: (() => void | Promise<void>)[] = [];
  const sessionClosures = new Set<() => Promise<void>>();

  async function executorHarness(options: Readonly<{
    sessions?: SessionFactoryHarness;
    autoFireAtOrBelowMs?: number;
    taskDeadlineMs?: number;
    stores?: RunExecutorDependencies["stores"];
    descriptor?: AnyWorkflowDescriptor;
  }> = {}): Promise<ExecutorHarness> {
    const authority = await openAuthorityHarness();
    authorityHarnesses.set(authority.database, authority);
    const sessions = options.sessions ?? happySessionHarness();
    const manager = await sessionManagerFor(sessions, authority.clock);
    let sessionsClosed = false;
    const closeSessions = async () => { await manager.closeAll("worker-stop"); sessionsClosed = true; };
    sessionClosures.add(closeSessions);
    disposers.push(async () => {
      if (!sessionsClosed) throw new Error("executor-fixture-session-closure-unproved");
      await authority.dispose();
    });
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
      stores: options.stores ?? (options.descriptor?.id === ACTION_BINDING_WORKFLOW_ID ? actionBindingRegistry : taskStoreRegistry),
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
    const lifetime = testWorkerLifetime(database, workflow, slot.poolIndex);
    const claimed = database.authority.runs.claimNext({ workflow, workerId: slot.workerId, workerLifetime: lifetime.workerLifetime, now });
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
        steps: [[{ key: "search", label: "Search", operatorFields: [
          { label: "Employee ID", sources: [{ nodeId: "search", kind: "input", fieldPath: "emplId" }] },
          { label: "Selection", sources: [{ nodeId: "search", kind: "output", fieldPath: "selection.status" }] },
        ] }, [search]]],
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

  const actionBindingRegistry = registryWithUcpathSearch(directUcpathSearchFixtureTask);

  function readPersistedNotes(database: AuthorityDatabase) {
    return readTimelineRecords(database.authority.timelineEvents).records.flatMap(record => record.payload.kind === "note" ? [NoteWireSchema.parse(record.payload.note)] : []);
  }

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
              throw new TaskError(SearchPersonOrg.id, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED", "synthetic pre-gesture failure");
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
  const cleanup = async () => {
    const failures: unknown[] = [];
    for (const close of sessionClosures) {
      try { await close(); sessionClosures.delete(close); }
      catch (error) { failures.push(error); }
    }
    for (const dispose of [...disposers]) {
      try { await dispose(); disposers.splice(disposers.indexOf(dispose), 1); }
      catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "executor-fixture-closure-unproved");
  };
  return { disposers, executorHarness, enqueueAndClaim, SIGNAL, ACTION_BINDING_WORKFLOW_ID, actionBindingCompiled, readPersistedNotes, actionBindingQueuedRun, actionBindingSessions, cleanup };
}

export function registryWithCrmSearch(task: typeof crmStore.tasks.searchOnboardingRecords) {
  const replacement = defineBrowserStore("crm", crmDriver, crmSession, { ...crmStore.tasks, searchOnboardingRecords: task });
  const stores = taskStoreRegistry.stores.map(store => store.namespace === "crm" ? replacement : store);
  return defineTaskStoreRegistry(stores, taskStoreRegistry.corpus);
}

export const directUcpathSearchFixtureTask = defineTask(ucpathDriver, SearchPersonOrg, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2000, retryOn: "transient" },
  async run({ input, ctx }) {
    const output = await ctx.driver.searchPersonOrg(input);
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});

export function registryWithUcpathSearch(task: typeof ucpathStore.tasks.searchPersonOrg) {
  const replacement = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { ...ucpathStore.tasks, searchPersonOrg: task });
  const stores = taskStoreRegistry.stores.map(store => store.namespace === "ucpath" ? replacement : store);
  return defineTaskStoreRegistry(stores, taskStoreRegistry.corpus);
}
