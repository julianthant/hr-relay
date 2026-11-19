import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import type { RunDetailDescriptorView } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import {
  APPROVAL_NODE, COMPARISON_NODE, DEPARTMENT_NODE, EMPLOYMENT_NODE, GATE_NODE, JOB_SUMMARY_NODE, NAME_SEARCH_NODE, SUBJECT_NODE,
} from "../../../../src/workflows/separations/steps/identity-check/step.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { queuedEventOf, runEndedEventOf, taskEventsOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const { world, RUN_ID, cleanup } = createRunDetailTestWorld(profileFixtures.create);
afterEach(cleanup);

const WORKFLOW = "separations";
const HASH = "a".repeat(64);
const RESOLVED_AT = "2026-08-19T09:15:00.000Z";
const TERMINAL_DONE = { state: "terminal", outcome: "done", endedAt: "2026-08-19T09:20:00.000Z" } as const;

type Stage = NonNullable<RunDetailDescriptorView["timeline"]>[number];
const IDENTITY_CHECK: Stage = { key: "identity-check", label: "Identity check", nodes: [
    { id: NAME_SEARCH_NODE, label: "Name Search" }, { id: SUBJECT_NODE, label: "Separation Subject" },
    { id: COMPARISON_NODE, label: "Identity Comparison" }, { id: GATE_NODE, label: "Identity Approval" },
    { id: APPROVAL_NODE, label: "Approval Check" }] };
const JOB_SUMMARY: Stage = { key: "job-summary", label: "Job summary", nodes: [
    { id: JOB_SUMMARY_NODE, label: "Job Summary" }, { id: EMPLOYMENT_NODE, label: "Employment" },
    { id: DEPARTMENT_NODE, label: "Department Option" }] };
const SEPARATIONS = [IDENTITY_CHECK, JOB_SUMMARY];

function detailOf(w: DashboardWorld, timeline: readonly Stage[] = SEPARATIONS) {
  return buildRunDetail({ runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ details: [], version: 1, contractFingerprint: HASH_A, timeline }) } }, RUN_ID);
}

function settledRun(w: DashboardWorld, identity: (w: DashboardWorld) => void): void {
  queuedEventOf(w, { seed: 1, workflow: WORKFLOW, lifecycle: TERMINAL_DONE, version: 5 });
  for (const node of [NAME_SEARCH_NODE, SUBJECT_NODE, JOB_SUMMARY_NODE, EMPLOYMENT_NODE, DEPARTMENT_NODE, COMPARISON_NODE]) taskEventsOf(w, 1, node, "done");
  identity(w);
  taskEventsOf(w, 1, APPROVAL_NODE, "done");
  runEndedEventOf(w, 1, "done", { workflow: WORKFLOW });
}

/** A supplied Employee ID: the comparison requires no approval, so the executor records the gate as a condition-false skip. */
const suppliedEid = (w: DashboardWorld) => taskEventsOf(w, 1, GATE_NODE, "skipped", "condition-false");

/** The name-only gate: the operator answered the identity approval. */
function nameOnlyGate(w: DashboardWorld): void {
  w.authority.putGateResult({ runId: RUN_ID, gateId: GATE_NODE, nodeId: GATE_NODE, commandId: uuidOf(77), expectedVersion: 4,
    resolvedBy: "local-operator", resolvedAt: RESOLVED_AT, checkpointFingerprint: HASH,
    result: { schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"), value: { decision: "approved", evidenceDigest: HASH } } });
  const span = { workflow: WORKFLOW, runId: RUN_ID, attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: GATE_NODE };
  w.writer.emit({ ...span, t: "gate.opened", ts: w.clock.now().toISOString() });
  w.writer.emit({ ...span, t: "gate.resolved", ts: RESOLVED_AT, resolutionKey: "resolved", resultHash: HASH });
}

function stageOf(detail: ReturnType<typeof detailOf>, label: string) {
  const stage = detail.timeline.steps?.find(step => step.label === label);
  assert.ok(stage !== undefined, `the served timeline must carry the ${label} stage`);
  return { state: stage.state, members: stage.members.map(member => [member.label, member.state]) };
}

/** Every served event belongs to a served stage member, as the Logs panel and the assistant require. */
function assertEventsOwned(detail: ReturnType<typeof detailOf>): void {
  const members = new Set(detail.timeline.steps?.flatMap(step => step.members.map(member => member.nodeId)));
  for (const event of detail.timeline.events) assert.ok(members.has(event.native?.nodeId), `event for ${String(event.native?.nodeId)} has no served stage member`);
}

describe("the served run timeline lists only the sub-steps that apply to the run", () => {
  it("leaves the identity approval out of a supplied-EID run and reads Identity check done", async () => {
    const w = await world();
    settledRun(w, suppliedEid);

    const detail = detailOf(w);
    assert.deepEqual(stageOf(detail, "Identity check"), { state: "done", members: [
      ["Name Search", "done"], ["Separation Subject", "done"], ["Identity Comparison", "done"], ["Approval Check", "done"]] });
    assert.equal(detail.timeline.events.some(event => event.native?.nodeId === GATE_NODE), false);
    assertEventsOwned(detail);
  });

  it("keeps the identity approval in a name-only-gate run", async () => {
    const w = await world();
    settledRun(w, nameOnlyGate);

    const detail = detailOf(w);
    assert.deepEqual(stageOf(detail, "Identity check"), { state: "done", members: [
      ["Name Search", "done"], ["Separation Subject", "done"], ["Identity Comparison", "done"], ["Identity Approval", "done"], ["Approval Check", "done"]] });
    assert.equal(detail.timeline.events.some(event => event.native?.nodeId === GATE_NODE), true);
    assertEventsOwned(detail);
  });

  it("serves no stage whose every sub-step sat on a branch the run did not take", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, workflow: WORKFLOW, lifecycle: TERMINAL_DONE, version: 5 });
    taskEventsOf(w, 1, NAME_SEARCH_NODE, "done");
    taskEventsOf(w, 1, JOB_SUMMARY_NODE, "skipped", "branch-not-selected");
    taskEventsOf(w, 1, EMPLOYMENT_NODE, "skipped", "condition-false");
    runEndedEventOf(w, 1, "done", { workflow: WORKFLOW });

    const detail = detailOf(w, [
      { key: "identity-check", label: "Identity check", nodes: [{ id: NAME_SEARCH_NODE, label: "Name Search" }] },
      { key: "job-summary", label: "Job summary", nodes: [{ id: JOB_SUMMARY_NODE, label: "Job Summary" }, { id: EMPLOYMENT_NODE, label: "Employment" }] },
    ]);
    assert.deepEqual(detail.timeline.steps?.map(step => step.label), ["Identity check"]);
    assertEventsOwned(detail);
  });

  it("still lists a sub-step the operator supplied or omitted", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, workflow: WORKFLOW, lifecycle: TERMINAL_DONE, version: 5 });
    taskEventsOf(w, 1, JOB_SUMMARY_NODE, "skipped", "operator-asserted");
    taskEventsOf(w, 1, EMPLOYMENT_NODE, "skipped", "step-omitted");
    taskEventsOf(w, 1, DEPARTMENT_NODE, "done");
    runEndedEventOf(w, 1, "done", { workflow: WORKFLOW });

    assert.deepEqual(stageOf(detailOf(w, [JOB_SUMMARY]), "Job summary").members,
      [["Job Summary", "skipped"], ["Employment", "skipped"], ["Department Option", "done"]]);
  });
});
