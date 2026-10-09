
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { defineWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineTaskContract } from "../../../../../../src/models/task/task-contract.js";
import { ScenarioIdSchema, taskId } from "../../../../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../src/models/workflow/presentation.js";
import { RunCheckpointRecordSchema } from "../../../../../../src/models/workflow/checkpoint.js";
import { buildRunDetail } from "../../../../../../src/backend/runs/queries/run-detail.js";
import type { RunDetailDescriptorView } from "../../../../../../src/backend/runs/queries/run-detail.js";
import { HASH_A } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  claimEventOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/* ── 1. the factory derives and REFUSES ──────────────────────────────────── */

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);
const SCENARIO = ScenarioIdSchema.parse("ocr/capability-wiring-happy");

function fixtureContract(id: string, title: string) {
  return defineTaskContract({
    id: taskId(`ucpath/${id}`),
    title,
    effect: "read",
    input: z.strictObject({ name: z.string().min(1) }),
    output: z.strictObject({ value: z.string().min(1) }),
    errorCodes: ["provider-unavailable"] as const,
    subject: { kind: "none", reason: "timeline category fixture" },
    scenarios: [SCENARIO],
    freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
    provenance: { default: "live" },
    example: { value: "v" },
  });
}

const READ_ONE = fixtureContract("read-timeline-one", "Read one");
const READ_TWO = fixtureContract("read-timeline-two", "Read two");

/** A two-node graph, so a declared timeline has something to be wrong about. */
function descriptorWith(
  timeline?: readonly Readonly<{ key: string; label: string; nodes: readonly string[] }>[],
) {
  return descriptorNamed("timeline-fixture", "tf", "first", timeline);
}


function descriptorNamed<First extends string>(
  id: string,
  code: string,
  first: First,
  timeline?: readonly Readonly<{ key: string; label: string; nodes: readonly string[] }>[],
) {
  const fixtureFlow = flow(FixtureInput)
    .step(first, READ_ONE, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ name: input.name }) })
    .step("second", READ_TWO, { dependsOn: [first], replay: "checkpoint", bind: ({ input }) => ({ name: input.name }) })
    .build({
      schema: z.strictObject({ done: z.boolean() }),
      dependsOn: ["second"],
      derive: () => ({ done: true }),
    });
  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Timeline fixture",
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
    scenarios: ["wiring-projection/happy"],
    ...(timeline === undefined ? {} : { timeline }),
    flow: fixtureFlow,
  });
}

describe("the descriptor's declared timeline", () => {
  it("derives ONE category per node when a descriptor declares nothing", () => {

    assert.deepEqual(descriptorWith().timeline, [
      { key: "first", label: "Read one", nodes: [{ id: "first", label: "Read one" }] },
      { key: "second", label: "Read two", nodes: [{ id: "second", label: "Read two" }] },
    ]);
  });


  it("derives the default key for a node id that leads with a digit", () => {
    const digitLed = descriptorNamed("timeline-digit-fixture", "td", "2fa-prompt");
    assert.deepEqual(digitLed.timeline, [
      { key: "2fa-prompt", label: "Read one", nodes: [{ id: "2fa-prompt", label: "Read one" }] },
      { key: "second", label: "Read two", nodes: [{ id: "second", label: "Read two" }] },
    ]);
  });

  it("normalizes a declared category and carries each member's own label", () => {
    const declared = descriptorWith([
      { key: "everything", label: "Everything", nodes: ["first", "second"] },
    ]).timeline;
    assert.deepEqual(declared, [{
      key: "everything",
      label: "Everything",
      nodes: [{ id: "first", label: "Read one" }, { id: "second", label: "Read two" }],
    }]);
  });

  it("REFUSES a declaration that leaves a node out, naming the node", () => {
    // The load-bearing arm. A node missing from the declaration renders
    // nowhere, and nothing else in the system would ever notice.
    assert.throws(
      () => descriptorWith([{ key: "only-the-first", label: "Only the first", nodes: ["first"] }]),
      /does not cover: second/,
    );
  });

  it("REFUSES a node claimed by two categories", () => {
    assert.throws(
      () => descriptorWith([
        { key: "a", label: "A", nodes: ["first", "second"] },
        { key: "b", label: "B", nodes: ["second"] },
      ]),
      /name node second twice/,
    );
  });

  it("REFUSES a category naming a node the graph does not declare", () => {
    assert.throws(
      () => descriptorWith([
        { key: "a", label: "A", nodes: ["first", "second"] },
        { key: "b", label: "B", nodes: ["ghost"] },
      ]),
      /names undeclared node ghost/,
    );
  });

  it("REFUSES two categories sharing one label, because the strip keys on it", () => {
    assert.throws(
      () => descriptorWith([
        { key: "one", label: "Same", nodes: ["first"] },
        { key: "two", label: "Same", nodes: ["second"] },
      ]),
      /timeline category labels must be unique/,
    );
  });

  it("REFUSES two categories sharing one key, naming the duplicate", () => {

    assert.throws(
      () => descriptorWith([
        { key: "same", label: "One", nodes: ["first"] },
        { key: "same", label: "Two", nodes: ["second"] },
      ]),
      /timeline category keys must be unique/,
    );
  });

  it("REFUSES a category key that is not kebab-case", () => {
    assert.throws(
      () => descriptorWith([{ key: "Not Kebab", label: "All", nodes: ["first", "second"] }]),
      /kebab-case/,
    );
  });


  it("REFUSES a category key that is a bare ordinal or a UUID", () => {
    assert.throws(
      () => descriptorWith([{ key: "3", label: "All", nodes: ["first", "second"] }]),
      /bare ordinal/,
    );
    assert.throws(
      () => descriptorWith([
        { key: "0f1e2d3c-4b5a-4968-8776-655443332211", label: "All", nodes: ["first", "second"] },
      ]),
      /must not be a UUID/,
    );
  });
});

/* ── 2. the served fold ──────────────────────────────────────────────────── */

const CATEGORIES: NonNullable<RunDetailDescriptorView["timeline"]> = [
  { label: "Kuali extraction", nodes: [{ id: "document", label: "Separation Document" }, { id: "plan", label: "Separation Plan" }] },
  { label: "Identity check", nodes: [{ id: "comparison", label: "Identity Comparison" }, { id: "identity-approval", label: "Identity Approval" }] },
  { label: "Kronos timecard", nodes: [{ id: "timecard", label: "Timecard" }] },
];

function detailOf(w: DashboardWorld, timeline?: NonNullable<RunDetailDescriptorView["timeline"]>, seed = 1) {
  return buildRunDetail(
    { runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => (timeline === undefined ? { details: [] } : { details: [], timeline }) },
    },
    uuidOf(seed),
  );
}

function spanBase(seed: number, node: string, attempt = 1) {
  return {
    workflow: "person-lookup" as const,
    runId: uuidOf(seed),
    traceId: traceOf(seed),
    spanPath: `${traceOf(seed)}/${node}#${String(attempt)}`,
    parentSpanPath: traceOf(seed),
    attempt: 1,
    kind: "task" as const,
  };
}

/** One task span, started and ended, taking `ms` of the world's clock. */
function ranFor(w: DashboardWorld, node: string, ms: number, outcome: "done" | "failed" = "done", attempt = 1): void {
  w.writer.emit({ ...spanBase(1, node, attempt), t: "span.started", ts: w.clock.now().toISOString(), name: node });
  w.clock.advanceWall(ms);
  w.writer.emit({ ...spanBase(1, node, attempt), t: "span.ended", ts: w.clock.now().toISOString(), outcome });
}

function seedRun(w: DashboardWorld): void {
  queuedEventOf(w, { seed: 1 });
  claimEventOf(w, 1);
}

describe("the served categorical steps", () => {
  it("serves ONE step per category, not one per node", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "document", 6_000);
    ranFor(w, "plan", 2_000);

    const steps = detailOf(w, CATEGORIES).timeline.steps;
    assert.equal(steps?.length, 3);
    assert.deepEqual(steps?.map((step) => step.label), ["Kuali extraction", "Identity check", "Kronos timecard"]);
    // The five raw events are still served beside them — the categorical strip
    // is a presentation of the timeline, never a replacement for its history.
    assert.equal(detailOf(w, CATEGORIES).timeline.events.length, 2);
  });

  it("sums the measured member durations into the category's own number", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "document", 6_000);
    ranFor(w, "plan", 2_000);

    const extraction = detailOf(w, CATEGORIES).timeline.steps?.[0];
    assert.equal(extraction?.durationSec, 8);
    assert.equal(extraction?.state, "done");
    assert.deepEqual(extraction?.members, [
      { label: "Separation Document", state: "done", durationSec: 6 },
      { label: "Separation Plan", state: "done", durationSec: 2 },
    ]);
  });

  it("folds a re-execution into ×N rather than drawing a second segment", () => {

    const w = world();
    seedRun(w);
    ranFor(w, "timecard", 5_000, "done", 1);
    ranFor(w, "timecard", 9_000, "done", 2);

    const steps = detailOf(w, CATEGORIES).timeline.steps;
    const kronos = steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(steps?.filter((step) => step.label === "Kronos timecard").length, 1);
    assert.equal(kronos?.executions, 2);
    // Both executions are real work and both count toward the category's time.
    assert.equal(kronos?.durationSec, 14);
  });

  it("carries no ×N marker when every member ran exactly once", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "timecard", 5_000);
    assert.equal(detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard")?.executions, undefined);
  });

  it("renders an open gate as its CATEGORY's state — a wait is a state of a step", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    w.writer.emit({
      t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: "identity-approval",
    });

    const identity = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Identity check");
    assert.equal(identity?.state, "blocked");
    // The gate is a MEMBER, so it takes no segment of its own; the category it
    // belongs to is what goes hatched.
    assert.deepEqual(identity?.members.map((member) => [member.label, member.state]), [
      ["Identity Comparison", "done"],
      ["Identity Approval", "blocked"],
    ]);
    // And a gate still owns no duration: the wait is a fact about a human.
    assert.equal(identity?.members.at(-1)?.durationSec, undefined);
  });

  it("lets a FAILURE anywhere in a category be the category's fact", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "document", 1_000, "done");
    ranFor(w, "plan", 1_000, "failed");

    const extraction = detailOf(w, CATEGORIES).timeline.steps?.[0];
    assert.equal(extraction?.state, "failed");
    // The member breakdown still shows which half succeeded — the fold states
    // the loudest fact, the disclosure keeps the whole one.
    assert.deepEqual(extraction?.members.map((member) => member.state), ["done", "failed"]);
  });

  it("reports a category nothing has reached as pending, with no invented duration", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "document", 1_000);
    ranFor(w, "plan", 1_000);

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "pending");
    assert.equal(kronos?.durationSec, undefined);
  });

  it("serves NO steps when no registered descriptor can say what the graph's shape is", () => {

    const w = world();
    seedRun(w);
    ranFor(w, "document", 1_000);

    const detail = detailOf(w);
    assert.equal(detail.timeline.steps, undefined);
    assert.equal(detail.timeline.events.length, 1);
  });
});




function checkpointOf(
  w: DashboardWorld,
  input: Readonly<{ nodeId: string; runSeed: number; attempt?: number; claimGeneration?: number }>,
): void {
  w.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: uuidOf(1 + 5000),
    nodeId: input.nodeId,
    attempt: input.attempt ?? 8,
    ...(input.claimGeneration === undefined ? {} : { claimGeneration: input.claimGeneration }),
    runId: uuidOf(input.runSeed),
    output: { schemaHash: HASH_A, value: { value: "on file" } },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_A,
    provenance: [],
    writtenAt: instantOffsetOf(0, 1_000),
  }));
}

function terminal(w: DashboardWorld, outcome: "done" | "failed"): void {
  w.authority.put(runRecordOf({
    seed: 1,
    lifecycle: {
      state: "terminal",
      outcome,
      endedAt: instantOffsetOf(0, 90_000),
      ...(outcome === "failed" ? { failureId: uuidOf(9001) } : {}),
    },
  }));
}

describe("a replayed node is not a node that never ran", () => {
  it("renders a no-span node with an earlier run's checkpoint as REPLAYED", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 2, attempt: 8, claimGeneration: 2 });
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "replayed");
    // NEVER `took 0s`: a replay emits no span, so nothing measured it.
    assert.equal(kronos?.durationSec, undefined);
    assert.deepEqual(kronos?.members, [{
      label: "Timecard",
      state: "replayed",
      replayedFrom: { attempt: 8, claimGeneration: 2 },
    }]);
  });

  it("omits a claim generation absent from the stored row rather than fabricating 1", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 2, attempt: 3 });
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.deepEqual(kronos?.members.at(0)?.replayedFrom, { attempt: 3 });
  });

  it("leaves a node with NEITHER span nor checkpoint exactly as it was", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "pending");
    assert.equal(kronos?.members.at(0)?.replayedFrom, undefined);
  });

  it("leaves a node that EXECUTED exactly as it was, checkpoint or not", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "timecard", 5_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 2 });
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "done");
    assert.equal(kronos?.durationSec, 5);
    assert.equal(kronos?.members.at(0)?.replayedFrom, undefined);
  });

  it("REFUSES the claim on a run that stopped elsewhere — a failed run never reached the node", () => {
    // The load-bearing refusal. Only a terminal `done` run visited every node,
    // so only there does "no span" rule out "the run stopped before this".
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000, "failed");
    checkpointOf(w, { nodeId: "timecard", runSeed: 2 });
    terminal(w, "failed");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "pending");
  });

  it("REFUSES the claim on a checkpoint THIS run wrote — that is an execution, not a replay", () => {
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 1 });
    terminal(w, "done");

    assert.equal(
      detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard")?.state,
      "pending",
    );
  });

  it("folds a category whose members MIXED replay and execution as done", () => {
    // A category where something executed is a category that ran; the member
    // list keeps the whole picture either way.
    const w = world();
    seedRun(w);
    ranFor(w, "plan", 2_000);
    checkpointOf(w, { nodeId: "document", runSeed: 2 });
    terminal(w, "done");

    const extraction = detailOf(w, CATEGORIES).timeline.steps?.[0];
    assert.equal(extraction?.state, "done");
    assert.deepEqual(extraction?.members.map((member) => member.state), ["replayed", "done"]);

    assert.equal(extraction?.durationSec, 2);
  });

  it("keeps a settled GATE reading `done`, because its own durable record says so", () => {
    // A gate never replays across runs (`replay-gate` reads this run's own
    // `gate_results` row), so the gate arm is untouched by this decision.
    const w = world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    w.writer.emit({
      t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: "identity-approval",
    });
    w.writer.emit({
      t: "gate.resolved", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: "identity-approval",
      resolutionKey: "resolved", resultHash: HASH_A,
    });
    checkpointOf(w, { nodeId: "identity-approval", runSeed: 2 });
    terminal(w, "done");

    const identity = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Identity check");
    assert.equal(identity?.state, "done");
    assert.deepEqual(identity?.members.map((member) => member.state), ["done", "done"]);
  });
});
