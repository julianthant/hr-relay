import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { buildRunDetail, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { terminalOutcomeText } from "../../../../src/dashboard/surfaces/run-detail/log-panel-model.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import { queuedEventOf, runEndedEventOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const {world, RUN_ID, cleanup } = createRunDetailTestWorld(profileFixtures.create);

afterEach(cleanup);
const HASH = "a".repeat(64);
const GATE_RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");
const RESOLVED_AT = "2026-08-19T09:15:00.000Z";

const WORKFLOW = "separations";
const GATE = "identity-approval";

const TERMINAL_DONE = {
  state: "terminal",
  outcome: "done",
  endedAt: "2026-08-19T09:20:00.000Z",
} as const;

function depsOf(w: DashboardWorld): RunDetailQueryDeps {
  return { runReader: w.runReader, timeline: w.timeline,
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => ({}) },
  };
}


function putGateResult(
  w: DashboardWorld,
  input: Readonly<{ gateId?: string; decision?: unknown; resolvedBy?: string }> = {},
): void {
  const decision = input.decision ?? "approved";
  w.authority.putGateResult({
    runId: RUN_ID,
    gateId: input.gateId ?? GATE,
    nodeId: input.gateId ?? GATE,
    commandId: uuidOf(77),
    expectedVersion: 4,
    resolvedBy: input.resolvedBy ?? "local-operator",
    resolvedAt: RESOLVED_AT,
    checkpointFingerprint: HASH,
    result: {
      schemaHash: GATE_RESULT_SCHEMA_HASH,
      value: {
        decision,
        evidenceDigest: HASH,
        ...(decision === "rejected" ? { reason: "the document names a different person" } : {}),
      },
    },
  });
}

/** The `gate.resolved` span the projector folds — never the verdict's source. */
function emitGateResolved(w: DashboardWorld, gate = GATE): void {
  w.writer.emit({
    t: "gate.opened", ts: w.clock.now().toISOString(), workflow: WORKFLOW,
    runId: RUN_ID, attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate,
  });
  w.writer.emit({
    t: "gate.resolved", ts: RESOLVED_AT, workflow: WORKFLOW,
    runId: RUN_ID, attempt: 1, traceId: traceOf(1), spanPath: traceOf(1),
    // The literal key the command service emits for EVERY gate. A wire arm
    // keyed on it is the defect; nothing here reads it as a verdict.
    gate, resolutionKey: "resolved", resultHash: HASH,
  });
}

function settledGatedRun(
  w: DashboardWorld,
  input: Readonly<{ dryRun?: boolean }> = {},
): void {
  queuedEventOf(w, {
    seed: 1,
    workflow: WORKFLOW,
    lifecycle: TERMINAL_DONE,
    version: 5,
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
  });
  emitGateResolved(w);
  runEndedEventOf(w, 1, "done", { workflow: WORKFLOW });
}

function gateOf(w: DashboardWorld): ReturnType<typeof buildRunDetail>["gate"] {
  return buildRunDetail(depsOf(w), RUN_ID).gate;
}

describe("a settled gate's panel names the verdict, the approver and the instant", () => {
  it("serves approved/by-whom/when from the durable gate result, not from the span key", async () => {
    const w = await world();
    settledGatedRun(w);
    putGateResult(w);

    const gate = gateOf(w);
    assert.equal(gate.state, "resolved");
    if (gate.state !== "resolved") throw new Error("unreachable");
    assert.equal(gate.resolution, "approved");
    assert.equal(gate.resolvedBy, "local-operator");
    assert.equal(gate.resolvedAt, RESOLVED_AT);
    assert.equal(gate.label, GATE);
    assert.equal(gate.nodeId, GATE);
    assert.notEqual(String(gate.gateId), GATE);
  });

  it("serves a REJECTION as a rejection — a receipt that could only describe approvals is not a record", async () => {
    const w = await world();
    settledGatedRun(w);
    putGateResult(w, { decision: "rejected", resolvedBy: "local-operator" });

    const gate = gateOf(w);
    assert.equal(gate.state, "resolved");
    if (gate.state !== "resolved") throw new Error("unreachable");
    assert.equal(gate.resolution, "rejected");
    assert.equal(gate.resolvedBy, "local-operator");
  });

  it("names the divergence when the span stream saw a resolution authority has no row for", async () => {
    const w = await world();
    settledGatedRun(w);

    const gate = gateOf(w);
    assert.equal(gate.state, "absent");
    if (gate.state !== "absent") throw new Error("unreachable");

    assert.match(gate.reason, /span stream recorded gate identity-approval resolved/);
    assert.match(gate.reason, /authority holds no gate result row/);
  });

  it("states an UNDECLARED gate rather than guessing what its answer meant", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, workflow: WORKFLOW, lifecycle: TERMINAL_DONE, version: 5 });
    emitGateResolved(w, "some-other-gate");
    runEndedEventOf(w, 1, "done", { workflow: WORKFLOW });
    putGateResult(w, { gateId: "some-other-gate" });

    const gate = gateOf(w);
    assert.equal(gate.state, "absent");
    if (gate.state !== "absent") throw new Error("unreachable");
    assert.match(gate.reason, /has no declared decision in src\/domain\/trust\/gate-decisions\.ts/);
  });

  it("refuses an arm value no declaration lists, naming what was stored and what is declared", async () => {
    const w = await world();
    settledGatedRun(w);
    putGateResult(w, { decision: "deferred" });

    const gate = gateOf(w);
    assert.equal(gate.state, "absent");
    if (gate.state !== "absent") throw new Error("unreachable");
    assert.match(gate.reason, /stored "deferred"/);
    assert.match(gate.reason, /declared: approved, rejected/);
  });

  it("keeps saying nothing for a run that never had a gate", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, workflow: WORKFLOW, lifecycle: TERMINAL_DONE, version: 5 });
    runEndedEventOf(w, 1, "done", { workflow: WORKFLOW });

    const gate = gateOf(w);
    assert.deepEqual(gate, { state: "absent", reason: "this run declares no operator gate" });
  });
});

describe("a rehearsal's terminal is never verified-done", () => {
  it("serves partial + rehearsal for a dry-run preview terminal", async () => {
    const w = await world();
    settledGatedRun(w, { dryRun: true });
    putGateResult(w);

    const { outcome } = buildRunDetail(depsOf(w), RUN_ID);
    assert.equal(outcome.state, "terminal");
    if (outcome.state !== "terminal") throw new Error("unreachable");
    assert.notEqual(outcome.result, "verified-done");
    // The receipt's OWN verdict for the same run: its terminal-result
    // obligation is `unknown` and its DRY_RUN_PREVIEW warning is load-bearing.
    assert.equal(outcome.result, "partial");
    assert.equal(outcome.rehearsal, true);
  });

  it("leaves the REAL verified path untouched", async () => {
    const w = await world();
    settledGatedRun(w);
    putGateResult(w);

    const { outcome } = buildRunDetail(depsOf(w), RUN_ID);
    assert.equal(outcome.state, "terminal");
    if (outcome.state !== "terminal") throw new Error("unreachable");
    assert.equal(outcome.result, "verified-done");
    // Absent, never `false`: one fact, one spelling.
    assert.equal(outcome.rehearsal, undefined);
  });

  it("does not label a dry run's FAILURE or cancellation a rehearsal outcome", async () => {
    const w = await world();
    queuedEventOf(w, {
      seed: 1,
      workflow: WORKFLOW,
      dryRun: true,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: TERMINAL_DONE.endedAt },
      version: 5,
    });
    runEndedEventOf(w, 1, "cancelled", { workflow: WORKFLOW });

    const { outcome } = buildRunDetail(depsOf(w), RUN_ID);
    assert.equal(outcome.state, "terminal");
    if (outcome.state !== "terminal") throw new Error("unreachable");
    // A cancelled dry run reached no preview terminal, so there is no rehearsal
    // RESULT to report — `cancelled` already says what happened.
    assert.equal(outcome.result, "cancelled");
    assert.equal(outcome.rehearsal, undefined);
  });

  it("says `dry run` on the panel's outcome bar, and says it FIRST", async () => {
    const w = await world();
    settledGatedRun(w, { dryRun: true });
    putGateResult(w);
    const { outcome } = buildRunDetail(depsOf(w), RUN_ID);
    if (outcome.state !== "terminal") throw new Error("unreachable");


    const text = terminalOutcomeText(outcome);
    assert.ok(text.startsWith("dry run · "), text);
    assert.ok(text.includes("partial"), text);
    assert.ok(!text.includes("verified-done"), text);
  });

  it("leaves the real run's outcome bar exactly as it was", async () => {
    const w = await world();
    settledGatedRun(w);
    putGateResult(w);
    const { outcome } = buildRunDetail(depsOf(w), RUN_ID);
    if (outcome.state !== "terminal") throw new Error("unreachable");

    const text = terminalOutcomeText(outcome);
    assert.ok(!text.includes("dry run"), text);
    assert.ok(text.startsWith("verified-done · "), text);
  });
});
