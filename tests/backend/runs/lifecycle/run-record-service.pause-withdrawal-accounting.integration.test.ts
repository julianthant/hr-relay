import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { createEmergencyContactRetryWorld } from "../../../support/helpers/backend/emergency-contact-retry-world.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
afterAll(world.releaseTemplates);
const signal = () => new AbortController().signal;

it("withdraws a pause on a running accounting parent and keeps its acknowledged member retry, so the parent completes", async () => {
  const f = await world.fixture({ failures: 1 });
  await f.canonical.execute(f.parentRun, signal());
  const failed = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", failed)).state, "applied");
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  assert.equal(f.current().pause?.state, "paused");
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  const parentId = f.parentRun.envelope.runId;
  assert.equal(f.database.authority.dependencies.readiness(parentId, "join").state, "ready");
  const acknowledged = f.database.authority.lifecycleJournal.findRunResume(parentId);
  assert.ok(acknowledged);

  let withdrawn = false;
  f.hooks.onSpan = event => {
    if (withdrawn || event.t !== "span.started" || event.kind !== "task" || event.runId !== parentId || !event.spanPath.includes("/read-result")) return;
    const running = f.current();
    assert.equal(running.lifecycle.state, "running");
    assert.equal(f.canonical.kernel.execute(f.runCommand("pause", running)).state, "applied");
    const requested = f.current();
    assert.equal(requested.pause?.state, "requested");
    assert.equal(f.canonical.kernel.execute(f.runCommand("resume", requested)).state, "applied");
    assert.equal(f.current().pause, undefined);
    withdrawn = true;
  };
  const completed = await f.canonical.step(f.parentRun, signal());
  assert.ok(withdrawn, "the parent reached its accounting read-result step");
  assert.equal(completed.outcome.state, "done");
  const parent = f.current();
  assert.ok(parent.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done");
  assert.deepEqual(f.database.authority.lifecycleJournal.findRunResume(parentId)?.request.commandId, acknowledged.request.commandId);
});
