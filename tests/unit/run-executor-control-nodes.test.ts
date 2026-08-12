/**
 * Generic node dispatch for the control kinds person-lookup does not use:
 * branch selection and exclusion, gate park/resume over the stored gate
 * result, the parallel arms, and the child-run/write-sequencer seams' loud
 * capability-unavailable refusals — over REAL factory-built descriptors.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import { deriveGateResultCheckpointFingerprint } from "../../src/core/command-kernel.js";
import {
  executeClaimedRun,
  type ChildRunExecutor,
  type RunExecutorDependencies,
} from "../../src/core/run-executor.js";
import {
  DelegationEdgeIdSchema,
  ItemIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../../src/domain/ids.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { HASH_A, UUID_7 } from "./fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  openAuthorityHarness,
  recordingEmitter,
  recordingLogger,
  sessionManagerFor,
  type AuthorityHarness,
} from "./fixtures/phase1f-executor-harness.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/* ── test descriptors (real factory builds, no tasks → no manifest rows) ─── */

const ControlInput = z.strictObject({
  name: z.string().min(1),
  route: z.enum(["left", "right"]).default("left"),
});
const ControlCanonicalInput = defineCanonicalInput(
  ControlInput,
  z.strictObject({ name: z.string().min(1), route: z.enum(["left", "right"]) }),
  [{ name: "Battistessa, Johnnie" }, { name: "Blirea, Glaundi", route: "right" }],
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

const childTarget = {
  id: WorkflowIdSchema.parse("person-lookup"),
  input: z.strictObject({ emplId: z.string().min(1) }),
  result: z.strictObject({ ok: z.boolean() }),
};

const childRunFlow = flow(ControlInput)
  .childRun("delegate", childTarget, {
    dependsOn: [],
    edgeId: DelegationEdgeIdSchema.parse("control-delegate"),
    cardinality: "one",
    bind: () => ({ emplId: "10873698" }),
    deriveChildItemId: () => ItemIdSchema.parse(UUID_7),
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
      parsed: {
        schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie", route },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

function controlHarness(descriptor: AnyWorkflowDescriptor, childRuns?: ChildRunExecutor): Readonly<{
  authority: AuthorityHarness;
  emitter: ReturnType<typeof recordingEmitter>;
  deps: RunExecutorDependencies;
}> {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = happySessionHarness();
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    descriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: sessionManagerFor(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("d"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
    ...(childRuns === undefined ? {} : { childRuns }),
  };
  return { authority, emitter, deps };
}

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const claimed = database.authority.runs.claimNext({
    workflow: descriptor.id,
    workerId: WORKER_ID,
    now: new Date("2026-08-03T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration } };
}

const SIGNAL = new AbortController().signal;

describe("branch + gate dispatch", () => {
  /**
   * Doc 09 §14 / separations §4d: **no run mode can disable a gate.**
   *
   * `dryRun` is the only run-level mode this envelope carries, and it is the one
   * an operator would most plausibly expect to "just preview". It does not touch
   * the gate arm at all — the executor's `dryRun` reaches exactly one place, the
   * write sequencer — so a dry run parks identically. Legacy's whole D7 defect
   * was a MODE deriving its way into skipping the identity check; the property
   * that makes that unreachable here is that the gate arm reads nothing off the
   * envelope, and this is the executable statement of it.
   */
  it("parks at the gate under dryRun exactly as it does under a real run", async () => {
    const harness = controlHarness(gateBranchDescriptor);
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
    const harness = controlHarness(gateBranchDescriptor);
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
    database.authority.gateResults.insert({
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
    const harness = controlHarness(broken);
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
    const harness = controlHarness(settledParallelDescriptor);
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
    const unwired = controlHarness(childRunDescriptor);
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
    const wired = controlHarness(childRunDescriptor, {
      executeChildRun: (context) => {
        contexts.push(String(context.node.id));
        return Promise.resolve({
          state: "done",
          runId: UUID_7,
          itemId: UUID_7,
          output: { ok: true },
        });
      },
    });
    wired.authority.database.authority.runs.enqueue(controlQueuedRun(childRunDescriptor, "left"));
    const reclaimed = claim(wired.authority.database, childRunDescriptor);
    const done = await executeClaimedRun(wired.deps, { ...reclaimed, signal: SIGNAL });
    assert.deepEqual(done, { state: "done", runId: RUN_ID });
    assert.deepEqual(contexts, ["delegate"]);
  });
});
