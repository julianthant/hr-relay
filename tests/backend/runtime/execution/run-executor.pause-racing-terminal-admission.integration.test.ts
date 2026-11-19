import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createEmergencyContactRetryWorld } from "../../../support/helpers/backend/emergency-contact-retry-world.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createProfileFixtureSet();
const world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);

it.each([false, true])("releases the original claim when Pause wins success admission (withdrawn=%s)", async withdrawn => {
  const { authority: { database, clock }, deps } = await world.executorHarness();
  const claimed = world.enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const runId = claimed.run.envelope.runId;
  const service = testRunService(database, clock);
  const outcome = await executeClaimedRun({ ...deps, lifecycle: { ...deps.lifecycle,
    terminalize: (...args) => {
      const current = database.authority.runs.get(runId);
      assert.ok(current?.lifecycle.state === "running");
      const pause = service.pause({ commandId: randomUUID(), runId, expectedVersion: current.version });
      assert.ok(pause.state === "applied");
      const admission = deps.lifecycle.terminalize(...args);
      assert.deepEqual(admission, { state: "refused", refusal: { reason: "lost" } });
      if (withdrawn) {
        const resume = service.resumePaused({ commandId: randomUUID(), runId, expectedVersion: pause.run.version });
        assert.ok(resume.state === "applied");
        assert.equal(resume.run.pause, undefined);
        assert.deepEqual(runClaim(resume.run), runClaim(current));
      }
      return admission;
    },
  } }, { ...claimed, signal: world.SIGNAL });
  const released = database.authority.runs.get(runId);
  assert.ok(released);
  assert.equal(runClaim(released), undefined);
  assert.equal(released.pause?.state, withdrawn ? undefined : "paused");
  assert.equal(released.lifecycle.state, "queued");
  assert.deepEqual(outcome, { state: "abandoned", runId, reason: withdrawn ? "requeued" : "paused" });
  assert.equal(database.authority.runResults.get(runId), undefined);
});

describe("a delegation-accounting parent", () => {
  const accountingWorld = createEmergencyContactRetryWorld();
  let f: Awaited<ReturnType<typeof accountingWorld.fixture>>;
  beforeEach(async () => { f = await accountingWorld.fixture({ failures: 1 }); });
  afterEach(accountingWorld.cleanup);
  afterAll(accountingWorld.releaseTemplates);

  it.each(["withdrawn pause", "cancel"] as const)("handles a %s at success admission", async control => {
    const signal = new AbortController().signal;
    await f.canonical.execute(f.parentRun, signal);
    const failed = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
    assert.ok(failed);
    assert.equal(f.canonical.kernel.execute(f.runCommand("retry", failed)).state, "applied");
    assert.equal((await f.canonical.step(f.parentRun, signal)).outcome.state, "done");
    assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
    const parentId = f.parentRun.envelope.runId;
    const acknowledged = f.database.authority.lifecycleJournal.findRunResume(parentId);
    assert.ok(acknowledged);

    const transaction = f.database.withAuthorityTransaction.bind(f.database);
    let interleaved = false;
    f.hooks.onSpan = event => {
      if (event.t !== "span.ended" || event.kind !== "task" || event.outcome !== "done"
        || event.runId !== parentId || !event.spanPath.includes("/read-result#")) return;
      delete f.hooks.onSpan;
      // The last accounting checkpoint has committed. The next transaction admits the parent result.
      vi.spyOn(f.database, "withAuthorityTransaction").mockImplementationOnce(work => {
        const running = f.current();
        assert.equal(running.lifecycle.state, "running");
        const pause = f.runCommand("pause", running);
        if (control === "withdrawn pause") {
          assert.equal(f.canonical.kernel.execute(pause).state, "applied");
          assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
          assert.equal(f.current().pause, undefined);
        } else {
          assert.equal(f.canonical.kernel.execute({ ...pause, type: "cancel" }).state, "applied");
          assert.equal(f.current().cancelRequested, true);
        }
        assert.deepEqual(runClaim(f.current()), runClaim(running));
        interleaved = true;
        return transaction(work);
      });
    };
    const { outcome } = await f.canonical.step(f.parentRun, signal);
    assert.ok(interleaved);
    const parent = f.current();
    assert.equal(runClaim(parent), undefined);
    assert.equal(parent.pause, undefined);
    assert.deepEqual(f.database.authority.lifecycleJournal.findRunResume(parentId), acknowledged);
    if (control === "cancel") {
      assert.deepEqual(outcome, { state: "abandoned", runId: parentId, reason: "cancelled" });
      assert.ok(parent.lifecycle.state === "terminal" && parent.lifecycle.outcome === "cancelled");
    } else {
      if (parent.lifecycle.state === "queued") {
        assert.equal(outcome.state, "abandoned");
        assert.equal((await f.canonical.step(f.parentRun, signal)).outcome.state, "done");
      }
      const completed = f.current();
      assert.ok(completed.lifecycle.state === "terminal" && completed.lifecycle.outcome === "done");
    }
  });
});
