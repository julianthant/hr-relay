import { createClonedProfileFixtures, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { plan1Contract, plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { childExecutionBuildManifest } from "../../../support/fixtures/child-execution-build-manifest.js";
import { randomUUID } from "node:crypto";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { testWorkerPorts, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { testRunLifecycle,testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterAll,afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/backend/runs/commands/command-kernel.js";
import {
executeClaimedRun,
type ChildRunExecutor,
type RunExecutorDependencies,
} from "../../../../src/backend/runtime/execution/run-executor.js";
import { createGateSourceRuntime,type GateSourceDelivery,type GateSourceEnvelope } from "../../../../src/backend/runtime/gates/gate-source-runtime.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import type { GateResultRecord } from "../../../../src/models/workflow/gates.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import {
DelegationEdgeIdSchema,
GateIdSchema,
RunIdSchema,
TraceIdSchema,
WorkflowIdSchema,
} from "../../../../src/rules/identity/ids.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,RUN_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
happySessionHarness,
ManualScheduler,
openAuthorityHarness,
recordingLogger,
recordingTimelineEmitter,
sessionManagerFor,
type AuthorityHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());
const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

/* ── test descriptors (real factory builds, no tasks → no manifest rows) ─── */

const ControlInput = z.strictObject({
  name: z.string().min(1),
  route: z.enum(["left", "right"]).default("left"),
});
const ControlCanonicalInput = defineCanonicalInput(
  ControlInput,
  z.strictObject({ name: z.string().min(1), route: z.enum(["left", "right"]) }),
  [{ name: "Battistessa, Johnnie" }, { name: "Morrow, Bea", route: "right" }],
);
const GateResultSchema = z.strictObject({ approved: z.boolean() });

function descriptorMeta(id: string, code: string) {
  return {
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Control fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: ControlCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof ControlInput>) => `name:${input.name}` },
    presentation: { title: (input: z.output<typeof ControlInput>) => input.name },
    scenarios: [`${id}/happy`],
  } as const;
}

const gateBranchFlow = flow(ControlInput)
  .branch("route", {
    dependsOn: [],
    choose: ({ input }) => input.route,
    cases: { left: ["left-gate"], right: ["right-gate"] },
  })
  .gate("left-gate", {
    dependsOn: ["route"],
    label: "Left approval",
    resolvedBy: "operator",
    result: GateResultSchema,
  })
  .gate("right-gate", {
    dependsOn: ["route"],
    label: "Right approval",
    resolvedBy: "operator",
    result: GateResultSchema,
  })
  .build({
    schema: z.strictObject({ route: z.enum(["left", "right"]) }),
    dependsOn: [],
    derive: ({ input }) => ({ route: input.route }),
  });

const gateBranchDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("control-gate-branch", "cg"),
  flow: gateBranchFlow,
});

const settledParallelFlow = flow(ControlInput)
  .parallel("fan", [
    { id: "a", nodes: ["gate-a"] },
    { id: "b", nodes: ["gate-b"] },
  ], { join: "all-settled" })
  .gate("gate-a", { dependsOn: ["fan"], label: "A", resolvedBy: "operator", result: GateResultSchema })
  .gate("gate-b", { dependsOn: ["fan"], label: "B", resolvedBy: "operator", result: GateResultSchema })
  .build({
    schema: z.strictObject({ ok: z.boolean() }),
    dependsOn: [],
    derive: () => ({ ok: true }),
  });

const settledParallelDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("control-parallel-settled", "cp"),
  flow: settledParallelFlow,
});

const childResult = z.strictObject({ ok: z.boolean() });
const childLeafDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("control-child-leaf", "cl"),
  flow: flow(ControlInput)
    .step("observe", plan1Contract, { dependsOn: [], replay: "checkpoint",
      bind: ({ input }) => ({ emplId: "10800000", text: input.name, mode: "ok" as const }) })
    .build({ schema: childResult, dependsOn: ["observe"], derive: () => ({ ok: true }) }),
});
const childTarget = {
  id: childLeafDescriptor.id,
  input: ControlInput,
  result: childResult,
};

const childRunFlow = flow(ControlInput)
  .childRun("delegate", childTarget, {
    dependsOn: [],
    edgeId: DelegationEdgeIdSchema.parse("control-delegate"),
    cardinality: "one",
    bind: ({ input }) => input,
    deriveChildItemId: (_input, identity) => identity.canonicalItemId,
    await: "terminal",
    join: "one",
    policy: {
      onChildFailed: "fail-parent",
      cascadeCancel: "cascade",
      afterChildRetry: "resume-parent",
      visibility: "inline",
    },
  })
  .build({
    schema: z.strictObject({ ok: z.boolean() }),
    dependsOn: [],
    derive: () => ({ ok: true }),
  });

const childRunDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("control-child-run", "cc"),
  flow: childRunFlow,
});

/* ── harness ─────────────────────────────────────────────────────────────── */

function controlQueuedRun(descriptor: AnyWorkflowDescriptor, route: "left" | "right") {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
    },
    input: {
      raw: { name: "Battistessa, Johnnie", route },
      parsed: { protectedBindings: [],
        schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie", route },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

async function controlHarness(descriptor: AnyWorkflowDescriptor, childRuns?: ChildRunExecutor): Promise<Readonly<{
  authority: AuthorityHarness<BoundProfileStorageFixture>;
  emitter: ReturnType<typeof recordingTimelineEmitter>;
  deps: RunExecutorDependencies;
}>> {
  const authority = await openAuthorityHarness(profiles.create);
  testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: descriptor, poolIndex: 1 });
  disposers.push(authority.dispose);
  const sessions = happySessionHarness();
  const emitter = recordingTimelineEmitter(authority.database, authority.clock);
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: await sessionManagerFor(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("d"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
    ...(childRuns === undefined ? {} : { childRuns }),
  };
  disposers.unshift(() => deps.sessions.closeAll("worker-stop"));
  return { authority, emitter, deps };
}

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const { workerId, workerLifetime } = testWorkerLifetime(database, descriptor.id, 1);
  const claimed = database.authority.runs.claimNext({
    workerLifetime, workflow: descriptor.id,
    workerId,
    now: new Date("2026-08-03T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId, claimGeneration: claimed.run.claimGeneration } };
}

const SIGNAL = new AbortController().signal;

const conditionalGateDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("conditional-gate-fixture", "cq"),
  flow: flow(ControlInput)
    .gate("review", {
      dependsOn: [],
      label: "Review",
      resolvedBy: "operator",
      result: GateResultSchema,
      when: { kind: "equals", of: { from: "input", path: "route" }, value: "right" },
    })
    .build({
      schema: z.strictObject({ done: z.boolean() }),
      dependsOn: ["review"],
      derive: () => ({ done: true }),
    }),
});

const SOURCE_EVENT = z.strictObject({ ticket: z.string().min(1), created: z.boolean() });
const CHILD_TERMINAL_EVENT = z.strictObject({
  ticket: z.string().min(1),
  terminal: z.enum(["done", "failed"]),
  complete: z.boolean(),
});
const SOURCE_APPROVAL = z.strictObject({ approved: z.boolean(), note: z.string() });
const sourceGateFlow = flow(ControlInput)
  .gate("approval", { dependsOn: [], label: "Approval", resolvedBy: "operator", result: SOURCE_APPROVAL })
  .gate("ticket-created", {
    dependsOn: ["approval"],
    label: "Ticket created",
    resolvedBy: "external",
    subscribes: {
      kind: "external",
      sourceId: "source-fixture",
      event: SOURCE_EVENT,
      correlationKey: "ticket",
    },
    result: z.strictObject({ created: z.boolean() }),
    resolve: (event: z.output<typeof SOURCE_EVENT>) => ({ created: event.created }),
  })
  .build({ schema: z.strictObject({ created: z.boolean() }), dependsOn: ["ticket-created"],
    derive: ({ outputs }) => ({ created: outputs["ticket-created"].created }) });
const sourceGateDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("source-gate-fixture", "sg"),
  flow: sourceGateFlow,
});
const sourceChildRef = {
  id: WorkflowIdSchema.parse("source-child-fixture"),
  input: ControlInput,
  result: z.strictObject({ complete: z.boolean() }),
};
const childTerminalGateDescriptor = defineWorkflowDescriptor({
  ...descriptorMeta("child-terminal-gate-fixture", "ct"),
  flow: flow(ControlInput)
    .gate("children-complete", {
      dependsOn: [],
      label: "Children complete",
      resolvedBy: "children-terminal",
      subscribes: {
        kind: "workflow",
        workflow: sourceChildRef,
        event: CHILD_TERMINAL_EVENT,
        correlationKey: "ticket",
        terminal: ["done"],
      },
      result: z.strictObject({ complete: z.boolean() }),
      resolve: (event: z.output<typeof CHILD_TERMINAL_EVENT>) => ({ complete: event.complete }),
    })
    .build({ schema: z.strictObject({ complete: z.boolean() }), dependsOn: ["children-complete"],
      derive: ({ outputs }) => ({ complete: outputs["children-complete"].complete }) }),
});

describe("conditional operator gates", () => {
  it("records a false declared condition without a gate result or opened gate", async () => {
    const harness = await controlHarness(conditionalGateDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(conditionalGateDescriptor, "left"));
    const outcome = await executeClaimedRun(harness.deps, {
      ...claim(database, conditionalGateDescriptor),
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "done");
    assert.deepEqual(database.authority.gateResults.listByRun(RUN_ID), []);
    assert.equal(harness.emitter.events().some((event) => event.t === "gate.opened"), false);
  });

  it("parks when the declared evidence condition requires an operator", async () => {
    const harness = await controlHarness(conditionalGateDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(conditionalGateDescriptor, "right"));
    const outcome = await executeClaimedRun(harness.deps, {
      ...claim(database, conditionalGateDescriptor),
      signal: SIGNAL,
    });
    assert.deepEqual(outcome, { state: "parked-gate", runId: RUN_ID, gateId: "review" });
    assert.equal(harness.emitter.events().some((event) => event.t === "gate.opened"), true);
  });

  it("refuses a stored human result after current evidence makes the gate inapplicable", async () => {
    const harness = await controlHarness(conditionalGateDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(conditionalGateDescriptor, "left"));
    const gateResult = {
      schemaHash: deriveSchemaHash(GateResultSchema, "output"),
      value: { approved: true },
    };
    assert.equal(database.authority.gateResults.insert({ nodeId: "review",
      runId: RUN_ID,
      gateId: "review",
      commandId: UUID_7,
      expectedVersion: 1,
      resolvedBy: "local-operator",
      resolvedAt: harness.authority.clock.now().toISOString(),
      checkpointFingerprint: deriveGateResultCheckpointFingerprint(gateResult),
      result: gateResult,
    }).state, "inserted");
    const outcome = await executeClaimedRun(harness.deps, {
      ...claim(database, conditionalGateDescriptor),
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.match(harness.authority.database.authority.failures.get(outcome.failureId)?.summary ?? "", /inapplicable gate/u);
  });
});

describe("registered source gate settlement", () => {
  it("fails loudly when a non-operator gate has no registered provider", async () => {
    const harness = await controlHarness(childTerminalGateDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(childTerminalGateDescriptor, "left"));
    const outcome = await executeClaimedRun(harness.deps, {
      ...claim(database, childTerminalGateDescriptor),
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.match(database.authority.failures.get(outcome.failureId)?.summary ?? "", /registered source runtime is unavailable/u);
    assert.notEqual(database.authority.runs.get(RUN_ID)?.lifecycle.state, "parked-gate");
    assert.deepEqual(database.authority.gateResults.listByRun(RUN_ID), []);
  });

  it("settles a declared children-terminal event only for its retained terminal set", async () => {
    const harness = await controlHarness(childTerminalGateDescriptor);
    const { database, clock } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(childTerminalGateDescriptor, "left"));
    let deliver: (event: GateSourceEnvelope) => Promise<GateSourceDelivery> = async () => ({
      state: "refused", reason: "source port has not started",
    });
    const port = {
      kind: "workflow" as const,
      sourceId: String(sourceChildRef.id),
      bindCorrelation: ({ canonicalInput }: { canonicalInput: unknown }) =>
        (canonicalInput as { readonly name: string }).name,
      subscribe: async (next: (event: GateSourceEnvelope) => Promise<GateSourceDelivery>) => {
        deliver = next;
        return (): void => undefined;
      },
    };
    const runtime = createGateSourceRuntime({
      database,
      lifecycle: testRunService(database, clock),
      descriptors: { resolve: (workflowId) => workflowId === childTerminalGateDescriptor.id
        ? childTerminalGateDescriptor
        : undefined },
      ports: [port],
      clock,
    });
    const stop = await runtime.start(SIGNAL);
    try {
      const parked = await executeClaimedRun({ ...harness.deps, gateSources: runtime }, {
        ...claim(database, childTerminalGateDescriptor),
        signal: SIGNAL,
      });
      assert.deepEqual(parked, { state: "parked-gate", runId: RUN_ID, gateId: "children-complete" });
      const parkedRun = database.authority.runs.get(RUN_ID);
      assert.ok(parkedRun?.lifecycle.state === "parked-gate");
      if (parkedRun?.lifecycle.state !== "parked-gate") return;
      const event: GateSourceEnvelope = {
        eventId: UUID_7,
        runId: RunIdSchema.parse(RUN_ID),
        attempt: parkedRun.envelope.attempt,
        gateId: GateIdSchema.parse("children-complete"),
        expectedVersion: parkedRun.version,
        event: { ticket: "Battistessa, Johnnie", terminal: "failed", complete: false },
      };
      assert.equal((await deliver(event)).state, "refused");
      assert.deepEqual(database.authority.gateResults.listByRun(RUN_ID), []);
      assert.equal((await deliver({ ...event, event: { ticket: "Battistessa, Johnnie", terminal: "done", complete: true } })).state, "settled");
      const [stored] = database.authority.gateResults.listByRun(RUN_ID);
      assert.ok(stored && "source" in stored);
      if (stored && "source" in stored) {
        assert.equal(stored.source.kind, "workflow");
        assert.equal(stored.source.sourceId, String(sourceChildRef.id));
        assert.deepEqual(stored.result.value, { complete: true });
      }
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    } finally {
      await stop();
    }
  });

  it("binds retained input correlation, refuses invalid events, and replays one typed source result", async () => {
    const harness = await controlHarness(sourceGateDescriptor);
    const { database, clock } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(sourceGateDescriptor, "left"));
    const operatorResult = { schemaHash: deriveSchemaHash(SOURCE_APPROVAL, "output"),
      value: { approved: true, note: "synthetic approval" } };
    assert.equal(database.authority.gateResults.insert({ nodeId: "approval",
      runId: RUN_ID,
      gateId: "approval",
      commandId: UUID_7,
      expectedVersion: 1,
      resolvedBy: "local-operator",
      resolvedAt: clock.now().toISOString(),
      checkpointFingerprint: deriveGateResultCheckpointFingerprint(operatorResult),
      result: operatorResult,
    }).state, "inserted");

    let deliver: (event: GateSourceEnvelope) => Promise<GateSourceDelivery> = async () => ({
      state: "refused", reason: "source port has not started",
    });
    const port = {
      kind: "external" as const,
      sourceId: "source-fixture",
      bindCorrelation: ({ canonicalInput }: { canonicalInput: unknown }) =>
        (canonicalInput as { readonly name: string }).name,
      subscribe: async (next: (event: GateSourceEnvelope) => Promise<GateSourceDelivery>) => {
        deliver = next;
        return (): void => undefined;
      },
    };
    const service = testRunService(database, clock);
    const runtime = createGateSourceRuntime({
      database,
      lifecycle: service,
      descriptors: { resolve: (workflowId) => workflowId === sourceGateDescriptor.id ? sourceGateDescriptor : undefined },
      ports: [port],
      clock,
    });
    const stop = await runtime.start(SIGNAL);
    try {
      const parked = await executeClaimedRun({ ...harness.deps, gateSources: runtime }, {
        ...claim(database, sourceGateDescriptor),
        signal: SIGNAL,
      });
      assert.deepEqual(parked, { state: "parked-gate", runId: RUN_ID, gateId: "ticket-created" });
      const parkedRun = database.authority.runs.get(RUN_ID);
      assert.ok(parkedRun?.lifecycle.state === "parked-gate");
      if (parkedRun?.lifecycle.state !== "parked-gate") return;
      assert.ok(parkedRun.lifecycle.sourceBinding);
      assert.equal(parkedRun.lifecycle.sourceBinding.correlationKey, "ticket");

      const event: GateSourceEnvelope = {
        eventId: UUID_7,
        runId: RunIdSchema.parse(RUN_ID),
        attempt: parkedRun.envelope.attempt,
        gateId: GateIdSchema.parse("ticket-created"),
        expectedVersion: parkedRun.version,
        event: { ticket: "Battistessa, Johnnie", created: true },
      };
      const invalid: GateSourceEnvelope[] = [
        { ...event, event: { ticket: "different", created: true } },
        { ...event, attempt: event.attempt + 1 as GateSourceEnvelope["attempt"] },
        { ...event, expectedVersion: event.expectedVersion - 1 as GateSourceEnvelope["expectedVersion"] },
        { ...event, gateId: "approval" as GateSourceEnvelope["gateId"] },
        { ...event, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000099") },
        { ...event, event: { ticket: 42, created: true } },
      ];
      for (const candidate of invalid) {
        assert.equal((await deliver(candidate)).state, "refused");
      }
      assert.equal((await deliver({ ...event, attempt: 0 } as unknown as GateSourceEnvelope)).state, "refused");
      let wrongSourceDeliver: (event: GateSourceEnvelope) => Promise<GateSourceDelivery> = async () => ({
        state: "refused", reason: "source port has not started",
      });
      const wrongSourceRuntime = createGateSourceRuntime({
        database,
        lifecycle: service,
        descriptors: { resolve: (workflowId) => workflowId === sourceGateDescriptor.id ? sourceGateDescriptor : undefined },
        ports: [{ ...port, sourceId: "wrong-source", subscribe: async (next: typeof deliver) => {
          wrongSourceDeliver = next;
          return (): void => undefined;
        } }],
        clock,
      });
      const stopWrongSource = await wrongSourceRuntime.start(SIGNAL);
      try {
        assert.equal((await wrongSourceDeliver(event)).state, "refused");
      } finally {
        await stopWrongSource();
      }
      const sourceGateRows = (): readonly GateResultRecord[] => database.authority.gateResults.listByRun(RUN_ID)
        .filter((record) => "source" in record);
      const resolutions = (): number => readTimelineRecords(database.authority.timelineEvents, 0, RUN_ID).records
        .filter((record) => record.payload.kind === "span" && record.payload.event.t === "gate.resolved").length;
      assert.equal(sourceGateRows().length, 0);
      assert.equal(resolutions(), 0);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "parked-gate");

      const applied = await deliver(event);
      assert.equal(applied.state, "settled");
      const [stored] = sourceGateRows();
      assert.ok(stored && "source" in stored);
      if (!stored || !("source" in stored)) return;
      assert.equal(stored.source.sourceId, "source-fixture");
      assert.equal(stored.source.eventId, UUID_7);
      assert.deepEqual(stored.result.value, { created: true });
      assert.equal("resolvedBy" in stored, false);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
      assert.equal(resolutions(), 1);

      assert.equal((await deliver(event)).state, "replayed");
      const restarted = createGateSourceRuntime({
        database,
        lifecycle: service,
        descriptors: { resolve: (workflowId) => workflowId === sourceGateDescriptor.id ? sourceGateDescriptor : undefined },
        ports: [port],
        clock,
      });
      const stopRestarted = await restarted.start(SIGNAL);
      try {
        assert.equal((await deliver(event)).state, "replayed");
      } finally {
        await stopRestarted();
      }
      assert.equal((await deliver({ ...event, event: { ticket: "Battistessa, Johnnie", created: false } })).state, "refused");
      assert.equal(sourceGateRows().length, 1);
      assert.equal(resolutions(), 1);
    } finally {
      await stop();
    }
  });
});

describe("branch + gate dispatch", () => {

  it("parks at the gate under dryRun exactly as it does under a real run", async () => {
    const harness = await controlHarness(gateBranchDescriptor);
    const { database } = harness.authority;
    const queued = controlQueuedRun(gateBranchDescriptor, "left");
    database.authority.runs.enqueue({
      ...queued,
      envelope: { ...queued.envelope, dryRun: true },
    });
    const claimed = claim(database, gateBranchDescriptor);
    assert.equal(claimed.run.envelope.dryRun, true);

    const parked = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.deepEqual(parked, { state: "parked-gate", runId: RUN_ID, gateId: "left-gate" });
    // And a resume past an UNRESOLVED gate is impossible: validation refuses by
    // name rather than treating the missing decision as an implicit approval.
    const parkedRun = database.authority.runs.get(RUN_ID);
    assert.ok(parkedRun && parkedRun.lifecycle.state === "parked-gate");
    const resumeAt = parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : undefined;
    assert.ok(resumeAt);
    const resumed = database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parkedRun.version,
      startAt: resumeAt,
      now: harness.authority.clock.now().toISOString(),
    });
    assert.equal(resumed.state, "applied");
    const second = claim(database, gateBranchDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const failure = database.authority.failures.get(
      outcome.state === "failed" ? outcome.failureId : "",
    );
    assert.match(
      `${failure?.summary ?? ""} ${(failure?.causeChain ?? []).map(({ summary }) => summary).join(" ")}`,
      /gate "left-gate" has no stored result; a resume past an unresolved gate is impossible/,
    );
  });

  it("selects a branch case, parks on the reached gate, and resumes through the stored result", async () => {
    const harness = await controlHarness(gateBranchDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(gateBranchDescriptor, "left"));
    const first = claim(database, gateBranchDescriptor);

    const parked = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
    assert.deepEqual(parked, { state: "parked-gate", runId: RUN_ID, gateId: "left-gate" });
    const gateOpened = harness.emitter.events().find((event) => event.t === "gate.opened");
    assert.ok(gateOpened && "gate" in gateOpened && gateOpened.gate === "left-gate");

    const parkedRun = database.authority.runs.get(RUN_ID);
    assert.ok(parkedRun && parkedRun.lifecycle.state === "parked-gate");
    const resumeAt = parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : undefined;
    assert.ok(resumeAt);

    // The kernel's resolve-gate arm: store the schema-bound result, resume.
    const gateResult = {
      schemaHash: deriveSchemaHash(GateResultSchema, "output"),
      value: { approved: true },
    };
    database.authority.gateResults.insert({ nodeId: "left-gate",
      runId: RUN_ID,
      gateId: "left-gate",
      commandId: UUID_7,
      expectedVersion: parkedRun.version,
      resolvedBy: "local-operator",
      resolvedAt: harness.authority.clock.now().toISOString(),
      checkpointFingerprint: deriveGateResultCheckpointFingerprint(gateResult),
      result: gateResult,
    });
    const resumed = database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parkedRun.version,
      startAt: resumeAt,
      now: harness.authority.clock.now().toISOString(),
    });
    assert.equal(resumed.state, "applied");

    const second = claim(database, gateBranchDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    assert.deepEqual(result.result.value, { route: "left" });
    // The non-selected branch target never parked and never resolved.
    assert.equal(database.authority.gateResults.get(`${RUN_ID}:right-gate`), undefined);
  });

  it("fails loud when choose returns an undeclared case", async () => {
    const brokenFlow = flow(ControlInput)
      .branch("route", {
        dependsOn: [],
        choose: () => "sideways" as "left",
        cases: { left: ["left-gate"], right: ["right-gate"] },
      })
      .gate("left-gate", { dependsOn: ["route"], label: "L", resolvedBy: "operator", result: GateResultSchema })
      .gate("right-gate", { dependsOn: ["route"], label: "R", resolvedBy: "operator", result: GateResultSchema })
      .build({
        schema: z.strictObject({ route: z.enum(["left", "right"]) }),
        dependsOn: [],
        derive: ({ input }) => ({ route: input.route }),
      });
    const broken = defineWorkflowDescriptor({
      ...descriptorMeta("control-broken-branch", "cb"),
      flow: brokenFlow,
    });
    const harness = await controlHarness(broken);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(broken, "left"));
    const claimed = claim(database, broken);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.equal(failure.nodeId, "route");
    assert.match(failure.summary, /chose "sideways", which is not a declared case/);
  });
});

describe("parallel and seam arms", () => {
  it("refuses an all-settled parallel join loudly instead of guessing member semantics", async () => {
    const harness = await controlHarness(settledParallelDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(controlQueuedRun(settledParallelDescriptor, "left"));
    const claimed = claim(database, settledParallelDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.equal(failure.nodeId, "fan");
    assert.match(failure.summary, /capability-unavailable/);
  });

  it("fails a child-run node loudly when the delegation seam is not wired, and dispatches when it is", async () => {
    const unwired = await controlHarness(childRunDescriptor);
    unwired.authority.database.authority.runs.enqueue(controlQueuedRun(childRunDescriptor, "left"));
    const claimed = claim(unwired.authority.database, childRunDescriptor);
    const outcome = await executeClaimedRun(unwired.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = unwired.authority.database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = unwired.authority.database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.equal(failure.nodeId, "delegate");
    assert.match(failure.summary, /delegation executor seam/);

    // With a seam wired, the arm parses the typed child outcome.
    const contexts: string[] = [];
    const wired = await controlHarness(childRunDescriptor);
    const { database, path } = wired.authority;
    const resolve = (id: string) => [childRunDescriptor, childLeafDescriptor].find(descriptor => descriptor.id === id);
    let rootIdIssued = false;
    const canonical = canonicalChildExecution({ ...wired.deps, ids: { uuid: () => {
      if (!rootIdIssued) { rootIdIssued = true; return RUN_ID; }
      return randomUUID();
    } } }, database, path, resolve);
    const childRuns: ChildRunExecutor = {
      executeChildRun: context => {
        contexts.push(String(context.node.id));
        return canonical.childRuns.executeChildRun(context);
      },
    };
    const queued = canonical.start(childRunDescriptor, controlQueuedRun(childRunDescriptor, "left").input.raw, { dryRun: false });
    assert.equal(queued.envelope.runId, RUN_ID);
    const reclaimed = claim(database, childRunDescriptor);
    wired.deps.sessions.releaseRunConfigFingerprint();
    wired.deps.sessions.configureExecution(childRunDescriptor.id, wired.deps.stores);
    const pending = await withBoundRunConfigFingerprint(wired.deps.sessions, reclaimed.run.envelope.configFingerprint,
      () => executeClaimedRun({ ...wired.deps, childRuns }, { ...reclaimed, signal: SIGNAL }));
    assert.equal(pending.state, "yielded-delegation");
    assert.deepEqual(contexts, ["delegate"]);
    const children = database.authority.runs.listChildren(RUN_ID);
    assert.equal(children.length, 1);
    assert.ok(children[0]);
    const home = testWorkerLifetime(database, childRunDescriptor.id, 1);
    const runtime = database.authority.runtimeConfig.get();
    assert.ok(runtime);
    const childMutation = canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: childRunDescriptor.id,
      workerId: home.workerId, workerLifetime: home.workerLifetime, runtimeConfig: {
        generation: runtime.generation, settingsRevision: runtime.settingsRevision,
        settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
    assert.equal(childMutation.state, "applied");
    if (!("run" in childMutation)) throw new Error("child fixture claim refused");
    await wired.deps.sessions.closeAll("parked");
    wired.deps.sessions.configureExecution(childLeafDescriptor.id, plan1Stores);
    const childClaim = { run: childMutation.run, claim: { workerId: home.workerId, claimGeneration: childMutation.run.claimGeneration } };
    assert.equal(childClaim.run.envelope.runId, children[0].envelope.runId);
    const childDone = await withBoundRunConfigFingerprint(wired.deps.sessions, childClaim.run.envelope.configFingerprint,
      () => executeClaimedRun({ ...wired.deps, lifecycle: workerRunLifecyclePort(canonical.lifecycle), descriptor: childLeafDescriptor, stores: plan1Stores, buildManifest: childExecutionBuildManifest }, { ...childClaim, signal: SIGNAL }));
    assert.deepEqual(childDone, { state: "done", runId: children[0].envelope.runId });
    await wired.deps.sessions.closeAll("parked");
    wired.deps.sessions.configureExecution(childRunDescriptor.id, wired.deps.stores);
    const resumed = claim(database, childRunDescriptor);
    const done = await withBoundRunConfigFingerprint(wired.deps.sessions, resumed.run.envelope.configFingerprint,
      () => executeClaimedRun({ ...wired.deps, childRuns }, { ...resumed, signal: SIGNAL }));
    assert.deepEqual(done, { state: "done", runId: RUN_ID });
  });
});
