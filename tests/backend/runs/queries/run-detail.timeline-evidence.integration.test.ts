import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import type { RunDetailDescriptorView } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { ScenarioIdSchema, taskId } from "../../../../src/rules/identity/ids.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { claimEventOf, instantOffsetOf, queuedEventOf, runRecordOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { timelineEventDuration } from "../../../../src/models/dashboard/run-detail.js";
import { DAY } from "../../../support/helpers/backend/dashboard-harness.js";

{
const {world, cleanup } = createRunDetailTestWorld();

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
afterEach(cleanup);

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
  { key: "extraction", label: "Kuali extraction", nodes: [{ id: "document", label: "Separation Document" }, { id: "plan", label: "Separation Plan" }] },
  { key: "identity", label: "Identity check", nodes: [{ id: "comparison", label: "Identity Comparison" }, { id: "identity-approval", label: "Identity Approval" }] },
  { key: "timecard", label: "Kronos timecard", nodes: [{ id: "timecard", label: "Timecard" }] },
];

function detailOf(w: DashboardWorld, timeline?: NonNullable<RunDetailDescriptorView["timeline"]>, seed = 1) {
  return buildRunDetail(
    { runReader: w.runReader, timeline: w.timeline,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => (timeline === undefined ? { details: [] } : { details: [], version: 1, contractFingerprint: HASH_A, timeline }) },
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
afterEach(cleanup);

  it("serves ONE step per category, not one per node", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "document", 6_000);
    ranFor(w, "plan", 2_000);

    const steps = detailOf(w, CATEGORIES).timeline.steps;
    assert.equal(steps?.length, 3);
    assert.deepEqual(steps?.map((step) => step.label), ["Kuali extraction", "Identity check", "Kronos timecard"]);
    // The five raw events are still served beside them — the categorical strip
    // is a presentation of the timeline, never a replacement for its history.
    assert.equal(detailOf(w, CATEGORIES).timeline.events.length, 2);
    assert.deepEqual(steps?.map(step => step.key), ["extraction", "identity", "timecard"]);
    assert.deepEqual(steps?.[0].members.map(member => [member.nodeId, member.categoryKey]), [
      ["document", "extraction"], ["plan", "extraction"],
    ]);
    for (const event of detailOf(w, CATEGORIES).timeline.events) {
      assert.ok(event.native);
      const stored = w.timeline.get(event.native.eventId); assert.ok(stored);
      assert.equal(event.native.order, stored.cursor);
      assert.equal(event.categoryKey, "extraction");
    }
  });

  it("sums the measured member durations into the category's own number", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "document", 6_000);
    ranFor(w, "plan", 2_000);

    const extraction = detailOf(w, CATEGORIES).timeline.steps?.[0];
    assert.equal(extraction?.durationSec, 8);
    assert.equal(extraction?.state, "done");
    assert.deepEqual(extraction?.members, [
      { nodeId: "document", categoryKey: "extraction", label: "Separation Document", state: "done", durationSec: 6 },
      { nodeId: "plan", categoryKey: "extraction", label: "Separation Plan", state: "done", durationSec: 2 },
    ]);
  });

  it("folds a re-execution into ×N rather than drawing a second segment", async () => {

    const w = await world();
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

  it("carries no ×N marker when every member ran exactly once", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "timecard", 5_000);
    assert.equal(detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard")?.executions, undefined);
  });

  it("renders an open gate as its CATEGORY's state — a wait is a state of a step", async () => {
    const w = await world();
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

  it("lets a FAILURE anywhere in a category be the category's fact", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "document", 1_000, "done");
    ranFor(w, "plan", 1_000, "failed");

    const extraction = detailOf(w, CATEGORIES).timeline.steps?.[0];
    assert.equal(extraction?.state, "failed");
    // The member breakdown still shows which half succeeded — the fold states
    // the loudest fact, the disclosure keeps the whole one.
    assert.deepEqual(extraction?.members.map((member) => member.state), ["done", "failed"]);
  });

  it("reports a category nothing has reached as pending, with no invented duration", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "document", 1_000);
    ranFor(w, "plan", 1_000);

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "pending");
    assert.equal(kronos?.durationSec, undefined);
  });

  it("serves NO steps when no registered descriptor can say what the graph's shape is", async () => {

    const w = await world();
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
    claimGeneration: input.claimGeneration ?? 1,
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
afterEach(cleanup);

  it("renders a no-span node with an earlier run's checkpoint as REPLAYED", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 2, attempt: 8, claimGeneration: 2 });
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "replayed");
    // NEVER `took 0s`: a replay emits no span, so nothing measured it.
    assert.equal(kronos?.durationSec, undefined);
    assert.deepEqual(kronos?.members, [{
      nodeId: "timecard", categoryKey: "timecard", label: "Timecard",
      state: "replayed",
      replayedFrom: { attempt: 8, claimGeneration: 2 },
    }]);
  });

  it("leaves a node with NEITHER span nor checkpoint exactly as it was", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "pending");
    assert.equal(kronos?.members.at(0)?.replayedFrom, undefined);
  });

  it("leaves a node that EXECUTED exactly as it was, checkpoint or not", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "timecard", 5_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 2 });
    terminal(w, "done");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "done");
    assert.equal(kronos?.durationSec, 5);
    assert.equal(kronos?.members.at(0)?.replayedFrom, undefined);
  });

  it("REFUSES the claim on a run that stopped elsewhere — a failed run never reached the node", async () => {
    // The load-bearing refusal. Only a terminal `done` run visited every node,
    // so only there does "no span" rule out "the run stopped before this".
    const w = await world();
    seedRun(w);
    ranFor(w, "comparison", 3_000, "failed");
    checkpointOf(w, { nodeId: "timecard", runSeed: 2 });
    terminal(w, "failed");

    const kronos = detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard");
    assert.equal(kronos?.state, "pending");
  });

  it("REFUSES the claim on a checkpoint THIS run wrote — that is an execution, not a replay", async () => {
    const w = await world();
    seedRun(w);
    ranFor(w, "comparison", 3_000);
    checkpointOf(w, { nodeId: "timecard", runSeed: 1 });
    terminal(w, "done");

    assert.equal(
      detailOf(w, CATEGORIES).timeline.steps?.find((step) => step.label === "Kronos timecard")?.state,
      "pending",
    );
  });

  it("folds a category whose members MIXED replay and execution as done", async () => {
    // A category where something executed is a category that ran; the member
    // list keeps the whole picture either way.
    const w = await world();
    seedRun(w);
    ranFor(w, "plan", 2_000);
    checkpointOf(w, { nodeId: "document", runSeed: 2 });
    terminal(w, "done");

    const extraction = detailOf(w, CATEGORIES).timeline.steps?.[0];
    assert.equal(extraction?.state, "done");
    assert.deepEqual(extraction?.members.map((member) => member.state), ["replayed", "done"]);

    assert.equal(extraction?.durationSec, 2);
  });

  it("keeps a settled GATE reading `done`, because its own durable record says so", async () => {
    // A gate never replays across runs (`replay-gate` reads this run's own
    // `gate_results` row), so the gate arm is untouched by this decision.
    const w = await world();
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
}

{
const {world, cleanup } = createRunDetailTestWorld();

const SEED = 1;
const NODE = "timecard-search";

const SPAN_PATH = `${traceOf(SEED)}/${NODE}#1`;

function deps(w: DashboardWorld) {
  return { runReader: w.runReader, timeline: w.timeline,
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => undefined },
  };
}

// Distinct producers can emit the same span identity; each execution retains its own durable sequence.
function executeOnce(w: DashboardWorld, pid: number, ms: number): void {
  const writer = createTimelineEmitter({ repository: w.timeline, clock: w.clock, pid });
  const base = {
    workflow: "person-lookup" as const,
    runId: uuidOf(SEED),
    traceId: traceOf(SEED),
    attempt: 1,
    spanPath: SPAN_PATH,
    parentSpanPath: traceOf(SEED),
    kind: "task" as const,
  };
  writer.emit({ ...base, t: "span.started", ts: w.clock.now().toISOString(), name: NODE });
  w.clock.advanceWall(ms);
  writer.emit({ ...base, t: "span.ended", ts: w.clock.now().toISOString(), outcome: "done" });
  w.clock.advanceWall(1_000);
  w.projection.ingestFromTimeline();
}

/** The poisoned run, terminal exactly as the real one is. */
async function poisonedWorld(): Promise<DashboardWorld> {
  const w = await world();
  queuedEventOf(w, { seed: SEED });
  claimEventOf(w, SEED);
  executeOnce(w, 4242, 4_000);

  executeOnce(w, 4243, 9_000);
  const endedAt = instantOffsetOf(0, 60_000);
  w.authority.put(RunRecordSchema.parse({ ...runRecordOf({ seed: SEED }),
    lifecycle: { state: "terminal", outcome: "done", endedAt }, version: 2, claimGeneration: 1, updatedAt: endedAt,
    completion: { schemaVersion: 1, kind: "done", expectedVersion: 1, claim: { workerId: "worker-1", claimGeneration: 1 }, authorizedAt: endedAt, resultDigest: "a".repeat(64) },
  }));
  return w;
}

describe("two executions sharing one span identity in a checkpoint without claim generation", () => {
afterEach(cleanup);

  it("parses a timeline with repeated execution identities", async () => {

    const w = await poisonedWorld();
    const detail = buildRunDetail(deps(w), uuidOf(SEED));
    assert.equal(detail.runId, uuidOf(SEED));
  });

  it("renders TWO executions, because that is what the stream records", async () => {
    const w = await poisonedWorld();
    const { events } = buildRunDetail(deps(w), uuidOf(SEED)).timeline;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.label), [NODE, NODE]);
    assert.ok(events[0].native && events[1].native);
    assert.notEqual(events[0].native.eventId, events[1].native.eventId);
    w.projection.rebuildFromTimeline();
    assert.deepEqual(buildRunDetail(deps(w), uuidOf(SEED)).timeline.events.map(event => event.native), events.map(event => event.native));

    assert.deepEqual(
      events.map((event) => event.durationMs),
      [{ state: "present", ms: 4_000 }, { state: "present", ms: 9_000 }],
    );
  });

  it("gives the two executions DISTINCT note ids", async () => {
    const w = await poisonedWorld();
    const ids = buildRunDetail(deps(w), uuidOf(SEED)).timeline.events.map((event) => event.noteId);
    assert.equal(new Set(ids).size, 2);
  });

  it("leaves the FIRST execution's id byte-identical — the ordinal is read forward", async () => {
    // Ordinal 1 adds no suffix, preserving existing timeline identities.
    const single = await world();
    queuedEventOf(single, { seed: SEED });
    claimEventOf(single, SEED);
    executeOnce(single, 4242, 4_000);
    const before = buildRunDetail(deps(single), uuidOf(SEED)).timeline.events;

    const w = await poisonedWorld();
    const after = buildRunDetail(deps(w), uuidOf(SEED)).timeline.events;
    assert.equal(after[0]?.noteId, before[0]?.noteId);
    assert.notEqual(after[1]?.noteId, before[0]?.noteId);
  });

});
}

{
const {world, cleanup } = createRunDetailTestWorld();

/** A run the projection can render, with nothing on its timeline yet. */
function seedRun(w: DashboardWorld, seed = 1): void {
  queuedEventOf(w, { seed });
  claimEventOf(w, seed);
}

function detailOf(w: DashboardWorld, seed = 1) {
  return buildRunDetail(
    { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined } },
    uuidOf(seed),
  );
}

function spanBase(seed: number, node: string) {
  return {
    workflow: "person-lookup" as const,
    runId: uuidOf(seed),
    traceId: traceOf(seed),
    spanPath: `${traceOf(seed)}/${node}#1`,
    parentSpanPath: traceOf(seed),
    attempt: 1,
    kind: "task" as const,
  };
}

describe("a timeline event's own measured duration", () => {
afterEach(cleanup);

  it("measures the SPAN, not the gap to the next event", async () => {
    const w = await world();
    seedRun(w);
    const ts = (): string => w.clock.now().toISOString();


    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.started", ts: ts(), name: "ucpath-person" });
    w.clock.advanceWall(2_000);
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.ended", ts: ts(), outcome: "done" });
    w.clock.advanceWall(300_000);
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.started", ts: ts(), name: "cross-verify" });
    w.clock.advanceWall(3_000);
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.ended", ts: ts(), outcome: "done" });

    const events = detailOf(w).timeline.events;
    const first = events.find((event) => event.label === "ucpath-person");
    const second = events.find((event) => event.label === "cross-verify");
    assert.deepEqual(timelineEventDuration({ durationMs: first?.durationMs }), { state: "present", ms: 2_000 });
    assert.deepEqual(timelineEventDuration({ durationMs: second?.durationMs }), { state: "present", ms: 3_000 });
    // And the gap between the two events — 302s — appears nowhere.
    assert.equal(events.some((event) => event.durationMs?.state === "present" && event.durationMs.ms === 302_000), false);
  });

  it("reports a step still in flight as absent, naming the missing end", async () => {
    const w = await world();
    seedRun(w);
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.started", ts: w.clock.now().toISOString(), name: "ucpath-person" });
    w.clock.advanceWall(4_000);

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "ucpath-person");
    const measured = timelineEventDuration({ durationMs: event?.durationMs });
    assert.equal(measured.state, "absent");
    // Unfinished steps have no measured duration; their running clock is a separate fact.
    assert.match(measured.state === "absent" ? measured.reason : "", /has not ended/);
  });

  it("reports a span whose START never reached the fold as absent, not as zero", async () => {
    const w = await world();
    seedRun(w);
    // A projection tail seeded mid-run sees the end and never the start. The
    // run's own queue instant is a plausible substitute and a wrong one.
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.ended", ts: w.clock.now().toISOString(), outcome: "done" });

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "cross-verify");
    const measured = timelineEventDuration({ durationMs: event?.durationMs });
    assert.equal(measured.state, "absent");
    assert.match(measured.state === "absent" ? measured.reason : "", /no span\.started was folded/);
  });

  it("gives a zero-length step a real zero, which is not an absence", async () => {
    const w = await world();
    seedRun(w);
    const ts = w.clock.now().toISOString();
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.started", ts, name: "cross-verify" });
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.ended", ts, outcome: "done" });

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "cross-verify");
    // "It took less than a millisecond" and "we could not measure it" must not
    // render as the same thing; the present arm admits zero for that reason.
    assert.deepEqual(timelineEventDuration({ durationMs: event?.durationMs }), { state: "present", ms: 0 });
  });

  it("serves the leaf on EVERY event the live query builds", async () => {
    const w = await world();
    seedRun(w);
    const ts = (): string => w.clock.now().toISOString();
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.started", ts: ts(), name: "ucpath-person" });
    w.clock.advanceWall(1_000);
    w.writer.emit({ ...spanBase(1, "ucpath-person"), t: "span.ended", ts: ts(), outcome: "done" });
    w.writer.emit({ ...spanBase(1, "cross-verify"), t: "span.started", ts: ts(), name: "cross-verify" });

    const events = detailOf(w).timeline.events;
    assert.equal(events.length > 0, true);
    // Optional duration fields admit archived bytes; live details must declare measured or unmeasured.
    for (const event of events) {
      assert.notEqual(event.durationMs, undefined, `${event.label} carries no duration leaf`);
    }
  });

  it("refuses to put a gate's WAIT in the step column", async () => {
    const w = await world();
    seedRun(w);
    w.writer.emit({
      t: "gate.opened",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: traceOf(1),
      gate: "identity-approval",
    });
    w.clock.advanceWall(600_000);

    const event = detailOf(w).timeline.events.find((candidate) => candidate.label === "gate:identity-approval");
    const measured = timelineEventDuration({ durationMs: event?.durationMs });
    assert.equal(measured.state, "absent");
    // A park's ten minutes is a real fact about a HUMAN, and putting it under
    // a node's name would report thinking time as execution time.
    assert.match(measured.state === "absent" ? measured.reason : "", /a gate is not a task span/);
  });
});

describe("the day the timeline is read from", () => {
afterEach(cleanup);

  it("still renders a full day's wire beside the durations", async () => {
    const w = await world();
    seedRun(w);
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
  });
});
}
