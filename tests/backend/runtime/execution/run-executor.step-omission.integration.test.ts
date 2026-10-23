import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { testWorkerLifetime, testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/backend/runs/commands/command-kernel.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../../../../src/models/workflow/step-omission.js";
import { NodeIdSchema,ScenarioIdSchema,taskId,TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineServiceStore,defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,RUN_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
happySessionHarness,
ManualScheduler,
openAuthorityHarness,
recordingLogger,
sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;
const SCENARIO = ScenarioIdSchema.parse("ocr/step-omission-happy");

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);
// Use a manifest-known fixture task so execution resolves a real implementation fingerprint.
const FixtureIo = z.strictObject({ disposition: z.string().min(1), providerState: z.string().min(1) });
const fixtureContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Step omission fixture task",
  effect: "read",
  input: z.strictObject({ disposition: z.string().min(1) }),
  output: FixtureIo,
  errorCodes: ["provider-unavailable"] as const,
  subject: { kind: "none", reason: "step omission fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { disposition: "observed", providerState: "observed!" },
});

const invocations: string[] = [];
const fixtureTask = defineTask(fixtureContract, {
  sessions: [],
  async run({ input, ctx }) {
    invocations.push(input.disposition);
    const providerState = `${input.disposition}!`;
    ctx.recordData([
      { direction: "read", field: "disposition", value: input.disposition },
      { direction: "read", field: "providerState", value: providerState },
    ]);
    return { disposition: input.disposition, providerState };
  },
});

function fixtureDescriptor(
  id: string,
  code: string,
  omission: StepOmissionDeclaration,
  artifactProjections?: readonly Readonly<{
    id: string;
    source: Readonly<{ nodeId: "read" | "fold"; fieldPath: string }>;
    keyFields: readonly [string, ...string[]];
    sink: "xlsx-retention";
    blocking: true;
  }>[],
) {
  const fixtureFlow = flow(FixtureInput)
    .step("read", fixtureContract, { dependsOn: [], replay: "checkpoint", bind: () => ({ disposition: "observed" }) })
    .step("fold", fixtureContract, {
      dependsOn: ["read"],
      replay: "checkpoint",
      bind: ({ outputs }) => ({ disposition: outputs.read.providerState }),
    })
    .build({
      schema: z.strictObject({ folded: z.string().min(1) }),
      dependsOn: ["read", "fold"],
      derive: ({ outputs }) => ({ folded: outputs.fold.providerState }),
    });
  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Step omission fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof FixtureInput>) => `name:${input.name}` },
    presentation: { title: (input: z.output<typeof FixtureInput>) => input.name },
    scenarios: [`${id}/happy`],
    timeline: [
      { key: "reading", label: "Reading", nodes: ["read"], omission },
      { key: "folding", label: "Folding", nodes: ["fold"] },
    ],
    flow: fixtureFlow,
    ...(artifactProjections === undefined ? {} : { artifactProjections }),
  });
}

const FORM = { fields: [{ key: "value", label: "Value", kind: "text" as const }] };
const honestDescriptor = fixtureDescriptor("omission-honest", "oh", {
  form: FORM,
  produces: { read: ({ facts }) => ({ disposition: facts.value, providerState: facts.value }) },
});
const lyingDescriptor = fixtureDescriptor("omission-lying", "ol", {
  form: FORM,
  produces: { read: () => ({ wrong: "shape" }) },
});
const bareDescriptor = fixtureDescriptor("omission-bare", "ob", { form: FORM, produces: {} });
/** Bullet 5 — the asserted node ("read") also declares an artifact projection; an assertion projects nothing. */
const projectingDescriptor = fixtureDescriptor(
  "omission-projecting",
  "op",
  { form: FORM, produces: { read: ({ facts }) => ({ disposition: facts.value, providerState: facts.value }) } },
  [{
    id: "retention-row",
    source: { nodeId: "read", fieldPath: "disposition" },
    keyFields: ["disposition"],
    sink: "xlsx-retention",
    blocking: true,
  }],
);


const ApprovalSchema = z.strictObject({ approved: z.boolean() });
const gateOmissionFlow = flow(FixtureInput)
  .step("read", fixtureContract, { dependsOn: [], replay: "checkpoint", bind: () => ({ disposition: "observed" }) })
  .gate("approval", { dependsOn: ["read"], label: "Approval", resolvedBy: "operator", result: ApprovalSchema })
  .step("fold", fixtureContract, {
    dependsOn: ["read", "approval"],
    replay: "checkpoint",
    bind: ({ outputs }) => ({ disposition: outputs.read.providerState }),
  })
  .build({
    schema: z.strictObject({ folded: z.string().min(1) }),
    dependsOn: ["read", "fold"],
    derive: ({ outputs }) => ({ folded: outputs.fold.providerState }),
  });

const gateOmissionDescriptor = defineWorkflowDescriptor({
  id: "omission-gate-fixture",
  version: 1,
  contractFingerprint: HASH_A,
  code: "og",
  label: "Step omission gate fixture",
  icon: "Search",
  category: "operations",
  canonicalInput: FixtureCanonicalInput,
  inputSubject: "name",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input: z.output<typeof FixtureInput>) => `name:${input.name}` },
  presentation: { title: (input: z.output<typeof FixtureInput>) => input.name },
  scenarios: ["omission-gate-fixture/happy"],
  timeline: [
    {
      key: "reading",
      label: "Reading",
      nodes: ["read"],
      omission: { form: FORM, produces: { read: ({ facts }) => ({ disposition: facts.value, providerState: facts.value }) } },
    },
    { key: "approving", label: "Approving", nodes: ["approval"] },
    { key: "folding", label: "Folding", nodes: ["fold"] },
  ],
  flow: gateOmissionFlow,
});

const registry = defineTaskStoreRegistry([defineServiceStore("ocr", { fixture: fixtureTask })], {
  scenarioIds: [SCENARIO],
  tasks: [{ id: fixtureContract.id, effect: fixtureContract.effect }],
});

function harnessFor(descriptor: AnyWorkflowDescriptor) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor, poolIndex: 1 });
  const emitter = {
    emitter: createTimelineEmitter({ repository: authority.database.authority.timelineEvents, clock: authority.clock }),
    events: () => authority.database.authority.timelineEvents.page({}).flatMap((record) =>
      record.payload.kind === "span" ? [record.payload.event] : []),
  };
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor,
    stores: registry,
    authority: authority.database,
    sessions: sessionManagerFor(happySessionHarness(), authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("a"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
  return { authority, emitter, deps };
}

function queuedRunFor(descriptor: AnyWorkflowDescriptor, stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: { protectedBindings: [], schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: { name: "Battistessa, Johnnie" } },
      ingressSchemaHash: HASH_A,
    },
  };
}

/** A SECOND run of the same logical item (attempt 2), with no omission this time. */
function secondRunFor(descriptor: AnyWorkflowDescriptor, startAt?: string) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId: UUID_4,
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-3333`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
      attempt: 2,
      ...(startAt === undefined ? {} : { startAt }),
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: { protectedBindings: [], schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: { name: "Battistessa, Johnnie" } },
      ingressSchemaHash: HASH_A,
    },
  };
}

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const workerId = database.authority.workerSlots.list(descriptor.id).find(slot => slot.retiredAt === null)?.workerId;
  assert.ok(workerId);
  const claimMember1 = database.authority.workerSlots.get(workerId);
  if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
  const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, descriptor.id, claimMember1.poolIndex).workerLifetime,
    workflow: descriptor.id,
    workerId,
    now: new Date("2026-09-01T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId, claimGeneration: claimed.run.claimGeneration } };
}


async function parkAtGate(harness: ReturnType<typeof harnessFor>): Promise<RunRecord> {
  const { database } = harness.authority;
  database.authority.runs.enqueue(queuedRunFor(gateOmissionDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
  const first = claim(database, gateOmissionDescriptor);
  const parked = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
  assert.deepEqual(parked, { state: "parked-gate", runId: RUN_ID, gateId: "approval" });
  const run = database.authority.runs.get(RUN_ID);
  assert.ok(run !== undefined && run.lifecycle.state === "parked-gate");
  return run;
}

/** Record the operator's approval and release the parked run back to the queue. */
function resolveApprovalGate(harness: ReturnType<typeof harnessFor>, parkedRun: RunRecord): void {
  const { database } = harness.authority;
  const gateResult = { schemaHash: deriveSchemaHash(ApprovalSchema, "output"), value: { approved: true } };
  database.authority.gateResults.insert({
    runId: RUN_ID,
    gateId: "approval",
    nodeId: "approve",
    commandId: "cccccccc-0000-4000-8000-000000000000",
    expectedVersion: parkedRun.version,
    resolvedBy: "local-operator",
    resolvedAt: harness.authority.clock.now().toISOString(),
    checkpointFingerprint: deriveGateResultCheckpointFingerprint(gateResult),
    result: gateResult,
  });
  const resumed = database.authority.runs.resume({
    runId: RUN_ID,
    expectedVersion: parkedRun.version,
    startAt: parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : undefined,
    now: harness.authority.clock.now().toISOString(),
  });
  assert.equal(resumed.state, "applied");
}

/** Every `run_checkpoints` row for `read` at this run's attempt — one is correct, two is the corruption. */
function markedRowsFor(database: AuthorityDatabase, run: RunRecord) {
  return database.authority.runCheckpoints.listByAttempt(
    gateOmissionDescriptor.id, run.envelope.itemId, "read", run.envelope.attempt,
  );
}

describe("executor step omission", () => {
  it("publishes the producer's output without running the task, and the terminal record cites it as asserted", async () => {
    invocations.length = 0;
    const harness = harnessFor(honestDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(honestDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, honestDescriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    if (outcome.state === "failed") {
      const failure = database.authority.failures.get(outcome.failureId);
      assert.fail(`run failed at ${failure?.nodeId ?? "?"}: ${failure?.summary ?? "?"}`);
    }
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    // Only the fold ran, and it consumed the ASSERTED value, not an observation.
    assert.deepEqual(invocations, ["typed"]);

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    assert.deepEqual(result.result.value, { folded: "typed!" });
    assert.deepEqual(
      result.dependencies.map((dependency) => [dependency.nodeId, dependency.state]),
      [["read", "asserted"], ["fold", "resolved"]],
    );
    const asserted = result.dependencies.find((dependency) => dependency.nodeId === "read");
    assert.ok(asserted?.state === "asserted");
    assert.equal(asserted.step, "reading");
    assert.equal(asserted.outputSchemaHash, deriveSchemaHash(FixtureIo, "output"));

    // The assertion is durable as a MARKED checkpoint row — every leaf operator-sourced,
    // the omitted step named — so the commit-input rebuild and the receipt can resolve it.
    const assertedRow = database.authority.runCheckpoints.latest(honestDescriptor.id, run.envelope.itemId, "read");
    assert.ok(assertedRow);
    assert.deepEqual(assertedRow.assertion, { step: "reading", assertedAt: asserted.assertedAt });
    assert.deepEqual(assertedRow.output.value, { disposition: "typed", providerState: "typed" });
    assert.deepEqual(assertedRow.provenance.map(({ path, source }) => [path, source]), [["disposition", "operator"], ["providerState", "operator"]]);
    const foldRow = database.authority.runCheckpoints.latest(honestDescriptor.id, run.envelope.itemId, "fold");
    assert.ok(foldRow);
    assert.equal(foldRow.assertion, undefined);

    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const spans = harness.emitter.events().map((event) => [event.t, event.spanPath, "outcome" in event ? event.outcome : ""]);
    assert.deepEqual(spans, [
      ["span.started", taskSpanPath(trace, node("read"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("read"), 1, 1), "skipped"],
      ["span.started", taskSpanPath(trace, node("fold"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("fold"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("fold"), 1, 1), "done"],
      ["span.ended", trace, "done"],
    ]);
    const skip = harness.emitter.events().find((event) => event.t === "span.ended" && "outcome" in event && event.outcome === "skipped");
    assert.ok(skip !== undefined && skip.t === "span.ended" && "notRunReason" in skip);
    assert.equal(skip.notRunReason, "operator-asserted");
  });

  it("runs every node as before when no step is omitted", async () => {
    invocations.length = 0;
    const harness = harnessFor(honestDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(honestDescriptor));
    const claimed = claim(database, honestDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    if (outcome.state === "failed") {
      const failure = database.authority.failures.get(outcome.failureId);
      assert.fail(`run failed at ${failure?.nodeId ?? "?"}: ${failure?.summary ?? "?"}`);
    }
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    assert.deepEqual(invocations, ["observed", "observed!"]);
    const result = database.authority.runResults.get(RUN_ID);
    assert.deepEqual(result?.dependencies.map((dependency) => dependency.state), ["resolved", "resolved"]);
  });

  it("fails the asserted node by name when its producer returns a value the output schema refuses", async () => {
    const harness = harnessFor(lyingDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(lyingDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, lyingDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.equal(failure?.nodeId, "read");
    assert.match(failure?.summary ?? "", /producer for node "read" returned a value the node's output schema refuses at: disposition, providerState/u);
  });

  it("terminalizes as an entry-validation failure when an executing node would read a node the omission leaves unread", async () => {
    const harness = harnessFor(bareDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(bareDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, bareDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    // A refused omission is THIS run's failure, with a durable record the
    // operator can read — never a thrown error that leaves the run claimed.
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.match(failure?.summary ?? "", /step omission refused \[dependency-omitted\]: node "fold" \(step "folding"\) reads "read"/u);
  });

  it("fails an asserted node by name when it also declares an artifact projection — an assertion projects nothing", async () => {
    const harness = harnessFor(projectingDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(projectingDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, projectingDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.equal(failure?.nodeId, "read");
    assert.match(failure?.summary ?? "", /node "read" declares artifact projections and cannot be asserted/u);
  });

  it("an assertion never replays as an observation across a resume that no longer omits the step", async () => {
    const harness = harnessFor(honestDescriptor);
    const { database } = harness.authority;
    // First run: omit "reading" so "read" is durable as a MARKED assertion row.
    database.authority.runs.enqueue(queuedRunFor(honestDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const first = claim(database, honestDescriptor);
    const firstOutcome = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
    assert.deepEqual(firstOutcome, { state: "done", runId: RUN_ID });

    // Second run of the SAME item, attempt 2, with NO omission and an explicit
    // resume PAST the assertion — the resume cannot cross it.
    database.authority.runs.enqueue(secondRunFor(honestDescriptor, "fold"));
    const second = claim(database, honestDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(UUID_4);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.match(
      failure?.summary ?? "",
      /latest checkpoint is an operator assertion for omitted step "reading", and this run does not omit that step; an assertion never replays as an observation/u,
    );
  });

  it("an ordinary second run with no omission and no startAt executes the node fresh, writing an unmarked row", async () => {
    invocations.length = 0;
    const harness = harnessFor(honestDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(honestDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const first = claim(database, honestDescriptor);
    const firstOutcome = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
    assert.deepEqual(firstOutcome, { state: "done", runId: RUN_ID });
    invocations.length = 0;

    database.authority.runs.enqueue(secondRunFor(honestDescriptor));
    const second = claim(database, honestDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    if (outcome.state === "failed") {
      const failure = database.authority.failures.get(outcome.failureId);
      assert.fail(`second run failed at ${failure?.nodeId ?? "?"}: ${failure?.summary ?? "?"}`);
    }
    assert.deepEqual(outcome, { state: "done", runId: UUID_4 });

    assert.deepEqual(invocations, ["observed", "observed!"]);

    const rows = database.authority.runCheckpoints.listByAttempt(honestDescriptor.id, QUEUED_RUN.envelope.itemId, "read", 2);
    assert.equal(rows.length, 1, "the second attempt wrote exactly one row for \"read\"");
    assert.equal(rows[0]?.assertion, undefined, "the fresh observation carries no assertion marker");
    assert.equal(rows[0]?.runId, UUID_4);
  });

  it("an asserted node upstream of a gate republishes its single marked row across resume", async () => {
    invocations.length = 0;
    const harness = harnessFor(gateOmissionDescriptor);
    const { database } = harness.authority;
    const parkedRun = await parkAtGate(harness);
    // "read" never actually ran — its output is the operator's typed fact, never the task.
    assert.deepEqual(invocations, []);
    assert.equal(parkedRun.lifecycle.state === "parked-gate" ? parkedRun.lifecycle.resumeAt : undefined, "fold");

    const beforeResume = markedRowsFor(database, parkedRun);
    assert.equal(beforeResume.length, 1, "the parked attempt holds exactly ONE marked row for \"read\"");
    const firstAssertedAt = beforeResume[0]?.assertion?.assertedAt;
    assert.ok(firstAssertedAt !== undefined);
    assert.deepEqual(beforeResume[0]?.assertion, { step: "reading", assertedAt: firstAssertedAt });

    /* ── resolve the gate, then resume with a NEW claim ──────────────────────── */
    resolveApprovalGate(harness, parkedRun);
    const second = claim(database, gateOmissionDescriptor);
    assert.equal(second.claim.claimGeneration, 2, "the resume is a NEW claim of the same attempt");
    const outcome = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    if (outcome.state === "failed") {
      const failure = database.authority.failures.get(outcome.failureId);
      assert.fail(`resumed run failed at ${failure?.nodeId ?? "?"}: ${failure?.summary ?? "?"}`);
    }
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });

    assert.deepEqual(invocations, ["typed"]);

    /* ── exactly ONE row for "read", byte-identical to the one the park left ── */
    const afterResume = markedRowsFor(database, parkedRun);
    assert.equal(afterResume.length, 1, "the resume did not mint a second row for the asserted node");
    assert.deepEqual(afterResume[0], beforeResume[0], "the republished row is the parked row, unchanged");
    const assertion = beforeResume[0];
    assert.ok(assertion);
    const replay = database.authority.timelineEvents.page({ runId: RUN_ID }).filter((row) =>
      row.payload.kind === "checkpoint-replayed" && row.payload.checkpoint.nodeId === "read");
    assert.equal(replay.length, 1);
    const payload = replay[0]?.payload;
    assert.ok(payload?.kind === "checkpoint-replayed");
    assert.equal(payload.claimGeneration, 2);
    assert.deepEqual(payload.checkpoint, timelineCheckpointReference(assertion));
    const recorded = database.authority.timelineEvents.page({ runId: RUN_ID }).filter((row) =>
      row.payload.kind === "checkpoint-recorded" && row.payload.checkpoint.nodeId === "read");
    assert.equal(recorded.length, 1, "resume must not claim a second assertion observation");

    /* ── the terminal dependency for "read" is asserted, and the mirror accepted it ── */
    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result !== undefined);
    const readDependency = result.dependencies.find((dependency) => dependency.nodeId === "read");
    assert.ok(readDependency?.state === "asserted");
    assert.equal(readDependency.step, "reading");
    assert.equal(readDependency.outputSchemaHash, beforeResume[0]?.output.schemaHash);

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  });

  it("refuses to terminalize when a SECOND marked row binds the same assertion at the attempt", async () => {
    invocations.length = 0;
    const harness = harnessFor(gateOmissionDescriptor);
    const { database } = harness.authority;
    const parkedRun = await parkAtGate(harness);
    const parkedRow = markedRowsFor(database, parkedRun)[0];
    assert.ok(parkedRow !== undefined);


    database.authority.runCheckpoints.insert({ ...parkedRow, claimGeneration: 2 });
    assert.equal(markedRowsFor(database, parkedRun).length, 2, "the fixture must actually hold two marked rows");

    resolveApprovalGate(harness, parkedRun);
    const second = claim(database, gateOmissionDescriptor);
    await assert.rejects(
      executeClaimedRun(harness.deps, { ...second, signal: SIGNAL }),
      /terminal dependency read is marked asserted for step reading but 2 marked checkpoint row\(s\) bind that assertion at the terminal attempt/u,
    );
    // The run did NOT terminalize behind the refusal.
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state !== "terminal");
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
  });
});
