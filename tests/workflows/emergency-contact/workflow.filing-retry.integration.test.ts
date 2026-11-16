import assert from "node:assert/strict";
import { afterAll, afterEach, beforeEach, it } from "vitest";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { aggregateMemberRetryAvailable } from "../../../src/backend/runs/queries/run-retry.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { createEmergencyContactRetryWorld } from "../../support/helpers/backend/emergency-contact-retry-world.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
afterAll(world.releaseTemplates);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
let f: Fixture;
// Both people Save; the first person's OnBase session open fails once, before any Import, and the parent is still open.
beforeEach(async () => { f = await world.fixture({ failures: 0, filingFailures: 1 }); });
const signal = () => new AbortController().signal;

function people(fixture: Fixture) {
  const [waiting, other] = fixture.children();
  assert.ok(waiting); assert.ok(other);
  const filings = fixture.database.authority.runs.listChildren(waiting.envelope.runId);
  const filing = filings.find(run => !filings.some(next => next.envelope.retryOf === run.envelope.runId)); assert.ok(filing);
  return { waiting, other, filing, filings };
}
function rows(fixture: Fixture) {
  const parent = fixture.current(), children = fixture.database.authority.runs.listChildren(parent.envelope.runId);
  const members = readQueueRecordMembers(fixture.database.authority, fixture.canonical.lifecycle, parent, children, fixture.resolve); assert.ok(members);
  return members.members.map(row => ({ status: row.status, statusLabel: row.statusLabel, runId: row.target.runId, workflowId: row.target.workflowId, section: row.target.section }));
}
const served = (fixture: Fixture, run: RunRecord) => aggregateMemberRetryAvailable(fixture.database.authority, fixture.canonical.lifecycle, fixture.current(run.envelope.runId), fixture.resolve);
const saves = (fixture: Fixture) => [...fixture.persistence.values()].map(value => value.submissions.length);
const retry = (fixture: Fixture, run: RunRecord) => fixture.canonical.kernel.execute(fixture.runCommand("retry", fixture.current(run.envelope.runId)));
async function settle(fixture: Fixture) {
  for (let steps = 0; fixture.current().lifecycle.state !== "terminal"; steps++) {
    assert.ok(steps < 8, "the run must settle");
    const stepped = await fixture.raw.step(fixture.parentRun, signal());
    assert.ok(stepped.outcome.state === "done" || stepped.outcome.state === "yielded-delegation", `${stepped.run.envelope.workflow} ${stepped.outcome.state}`);
  }
}
function assertComplete(fixture: Fixture, filingId: string) {
  const { waiting, other, filings } = people(fixture);
  assert.deepEqual([waiting, other].map(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome), ["done", "done"]);
  const parent = fixture.current();
  assert.ok(parent.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done");
  assert.deepEqual(filings.map(run => run.envelope.runId).filter(runId => runId !== filingId).length, 1, "Retry admits exactly one new filing");
  assert.equal(fixture.filing.imports(), 1);
  assert.deepEqual(saves(fixture), [1, 1]);
  assert.deepEqual(rows(fixture).map(row => [row.status, row.statusLabel, row.workflowId]), [["done", "Saved", "emergency-contact-member"], ["done", "Saved", "emergency-contact-member"]]);
}

it("a filing that fails before its Import leaves the person failed at the filing step and serves Retry on the filing alone", () => {
  const { waiting, other, filing, filings } = people(f);
  assert.equal(filings.length, 1);
  assert.ok(filing.lifecycle.state === "terminal" && filing.lifecycle.outcome === "failed");
  assert.match(f.database.authority.failures.listByRun(filing.envelope.runId)[0]?.summary ?? "", /fixture-onbase-unavailable/u, "the failure names its cause");
  assert.deepEqual(f.database.authority.writeIntents.listByRun(filing.envelope.runId), []);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(waiting.envelope.runId).map(intent => intent.status), ["committed"]);
  assert.ok(other.lifecycle.state === "terminal" && other.lifecycle.outcome === "done", "the other person is unaffected");
  assert.notEqual(f.current().lifecycle.state, "terminal");
  assert.deepEqual(rows(f), [
    { status: "failed", statusLabel: "Failed", runId: filing.envelope.runId, workflowId: "onbase", section: "logs" },
    { status: "done", statusLabel: "Saved", runId: other.envelope.runId, workflowId: "emergency-contact-member", section: "logs" },
  ]);
  assert.equal(served(f, filing), true);
  assert.equal(served(f, waiting), false);
  const before = canonicalJsonStringify([f.children(), filings]);
  assert.equal(retry(f, waiting).state, "rejected", "a member whose Save was issued is never retried");
  assert.equal(canonicalJsonStringify([f.children(), f.database.authority.runs.listChildren(waiting.envelope.runId)]), before);
  assert.deepEqual(saves(f), [1, 1]);
});

it("Retry of the filing imports once without another Save, then the person and the run read complete", async () => {
  const { filing } = people(f);
  const command = f.runCommand("retry", f.current(filing.envelope.runId));
  assert.equal(f.canonical.kernel.execute(command).state, "applied");
  assert.equal(f.canonical.kernel.execute(command).state, "already-applied");
  assert.equal(served(f, filing), false);
  await settle(f);
  assertComplete(f, filing.envelope.runId);
});

it("Retry of the filing is accepted while the parent is paused and completes after Resume", async () => {
  const { filing } = people(f);
  assert.equal(f.canonical.kernel.execute(f.runCommand("pause", f.current())).state, "applied");
  assert.equal(served(f, filing), true);
  assert.equal(retry(f, filing).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  await settle(f);
  assertComplete(f, filing.envelope.runId);
});

it("an Import with an unsure result parks the filing for the Saved / Not saved decision, serves no Retry and never imports again", async () => {
  const { filing, waiting } = people(f);
  f.filing.next.page.lostClick = true;
  assert.equal(retry(f, filing).state, "applied");
  const stepped = await f.raw.step(f.parentRun, signal());
  assert.equal(stepped.run.envelope.workflow, "onbase");
  const parked = f.current(stepped.run.envelope.runId);
  assert.equal(parked.lifecycle.state, "parked-write", JSON.stringify(stepped.outcome));
  assert.deepEqual(f.database.authority.writeIntents.listByRun(parked.envelope.runId).map(intent => intent.status), ["parked"]);
  assert.equal(f.filing.imports(), 1);
  assert.equal(served(f, parked), false);
  assert.equal(retry(f, parked).state, "rejected");
  assert.equal(served(f, waiting), false);
  assert.equal(retry(f, waiting).state, "rejected");
  await assert.rejects(f.raw.step(f.parentRun, signal()), "nothing is left to run while the decision is open");
  assert.equal(f.filing.imports(), 1);
  assert.deepEqual(saves(f), [1, 1]);
  assert.deepEqual(rows(f)[0], { status: "blocked", statusLabel: "Blocked", runId: parked.envelope.runId, workflowId: "onbase", section: "logs" });
});

for (const state of ["retried and queued again", "still failed"] as const) it(`Stop on the parent cancels the person whose filing is ${state}`, () => {
  const { filing } = people(f);
  if (state === "retried and queued again") assert.equal(retry(f, filing).state, "applied");
  assert.equal(f.canonical.kernel.execute({ ...f.runCommand("retry", f.current()), type: "cancel" }).state, "applied");
  const { waiting, filing: current } = people(f);
  if (state === "retried and queued again") {
    assert.equal(current.envelope.retryOf, filing.envelope.runId);
    assert.ok(current.lifecycle.state === "terminal" && current.lifecycle.outcome === "cancelled", JSON.stringify(current.lifecycle));
  } else assert.equal(current.envelope.runId, filing.envelope.runId);
  for (const run of [waiting, f.current()]) assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled", `${run.envelope.workflow} ${JSON.stringify(run.lifecycle)}`);
  assert.equal(served(f, current), false);
  assert.equal(f.filing.imports(), 0);
  assert.deepEqual(saves(f), [1, 1]);
});
