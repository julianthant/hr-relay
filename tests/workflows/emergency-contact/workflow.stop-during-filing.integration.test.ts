import assert from "node:assert/strict";
import { afterAll, afterEach, beforeEach, it } from "vitest";
import type { RunRecord } from "../../../src/models/run/record.js";
import { createEmergencyContactRetryWorld } from "../../support/helpers/backend/emergency-contact-retry-world.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
afterAll(world.releaseTemplates);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
let f: Fixture;
// Both people Save; the first person's filing failed before any Import and is retried, so the retried filing runs next.
beforeEach(async () => {
  f = await world.fixture({ failures: 0, filingFailures: 1 });
  const { filing } = people(f);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", f.current(filing.envelope.runId))).state, "applied");
});
const signal = () => new AbortController().signal;

function people(fixture: Fixture) {
  const [waiting] = fixture.children(); assert.ok(waiting);
  const filings = fixture.database.authority.runs.listChildren(waiting.envelope.runId);
  const filing = filings.find(run => !filings.some(next => next.envelope.retryOf === run.envelope.runId)); assert.ok(filing);
  return { waiting, filing };
}
const stop = (fixture: Fixture) => fixture.canonical.kernel.execute({ ...fixture.runCommand("retry", fixture.current()), type: "cancel" });
const saves = (fixture: Fixture) => [...fixture.persistence.values()].map(value => value.submissions.length);
const tree = (fixture: Fixture) => {
  const runs: RunRecord[] = [];
  const walk = (run: RunRecord): void => { runs.push(run); for (const child of fixture.database.authority.runs.listChildren(run.envelope.runId)) walk(child); };
  walk(fixture.current());
  return runs;
};
async function settle(fixture: Fixture) {
  for (let steps = 0; fixture.current().lifecycle.state !== "terminal"; steps++) {
    assert.ok(steps < 8, "the run must settle");
    await fixture.raw.step(fixture.parentRun, signal());
  }
}

it("one Stop while the filing has not reached its Import cancels it, then the person and the run settle cancelled with nothing queued", async () => {
  // The OnBase session opens inside the claimed filing, before its Import is fenced.
  f.filing.next.onOpen = () => { assert.equal(stop(f).state, "applied"); };
  const stepped = await f.raw.step(f.parentRun, signal());
  assert.deepEqual(stepped.outcome, { state: "abandoned", runId: people(f).filing.envelope.runId, reason: "cancelled" });
  await settle(f);
  const { waiting, filing } = people(f);
  for (const run of [filing, waiting, f.current()]) assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled", `${run.envelope.workflow} ${JSON.stringify(run.lifecycle)}`);
  assert.deepEqual(tree(f).filter(run => run.lifecycle.state !== "terminal").map(run => run.envelope.workflow), [], "nothing is left queued");
  assert.deepEqual(f.database.authority.writeIntents.listByRun(filing.envelope.runId), []);
  assert.equal(f.filing.imports(), 0);
  assert.deepEqual(saves(f), [1, 1]);
});

it("Stop while the Import is fenced is refused; the Import finishes once and is never clicked again", async () => {
  let refusal: ReturnType<typeof stop> | undefined;
  // Read by the fake page right after the Import click, inside the fenced write.
  f.filing.next.page = { get lostClick() { refusal = stop(f); return false; } };
  const stepped = await f.raw.step(f.parentRun, signal());
  assert.equal(refusal?.state, "rejected");
  assert.equal(stepped.outcome.state, "done");
  assert.equal(f.current().cancelRequested, undefined, "nothing was marked for cancellation");
  await settle(f);
  const { waiting, filing } = people(f);
  for (const run of [filing, waiting, f.current()]) assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", `${run.envelope.workflow} ${JSON.stringify(run.lifecycle)}`);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(filing.envelope.runId).map(intent => intent.status), ["committed"]);
  assert.equal(f.filing.imports(), 1);
  assert.deepEqual(saves(f), [1, 1]);
});

it("an Import with an unsure result keeps the Saved / Not saved decision; Stop is refused and the Import is not clicked again", async () => {
  f.filing.next.page.lostClick = true;
  const stepped = await f.raw.step(f.parentRun, signal());
  const parked = f.current(stepped.run.envelope.runId);
  assert.equal(parked.lifecycle.state, "parked-write", JSON.stringify(stepped.outcome));
  assert.equal(stop(f).state, "rejected");
  assert.equal(f.current(parked.envelope.runId).lifecycle.state, "parked-write");
  assert.deepEqual(f.database.authority.writeIntents.listByRun(parked.envelope.runId).map(intent => intent.status), ["parked"]);
  await assert.rejects(f.raw.step(f.parentRun, signal()), "nothing is left to run while the decision is open");
  assert.equal(f.filing.imports(), 1);
  assert.deepEqual(saves(f), [1, 1]);
});
