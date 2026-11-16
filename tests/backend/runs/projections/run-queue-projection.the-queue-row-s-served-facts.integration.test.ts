import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { claimEventOf, DAY, failureRecordOf, instantOffsetOf, receiptWithWarningsOf, taskEventsOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const {world, runRecordOf, queuedEventOf, seedWorld, cleanup } = createRunQueueProjectionTestWorld();


afterEach(cleanup);


describe("the queue row's served facts", () => {
  /** A terminal-failed run whose failure record authority holds. */
  function seedFailed(w: DashboardWorld, seed = 4): void {
    queuedEventOf(w, { seed });
    claimEventOf(w, seed);
    taskEventsOf(w, seed, "searching", "failed");
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed),
      outcome: "failed", failureId: uuidOf(seed + 9000),
    });
    w.authority.put(runRecordOf({
      seed,
      lifecycle: {
        state: "terminal", outcome: "failed",
        endedAt: "2026-08-03T17:12:00.000Z", failureId: uuidOf(seed + 9000),
      },
      version: 3,
    }));
  }

  function rowOf(w: DashboardWorld, seed: number) {
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(seed));
    assert.ok(surface);
    return surface;
  }

  it("a failed row shows the unregistered-code sentence, not its raw summary", async () => {
    const w = await world();
    seedFailed(w);
    const failure = failureRecordOf({ seed: 4, code: "CRM_UNAVAILABLE" });
    w.authority.failures.set(String(failure.failureId), failure);

    assert.deepEqual(rowOf(w, 4).liveMessage, {
      state: "present",
      value: "This failure code is not in the current catalog. Review the recorded local evidence.",
    });
    assert.notEqual(rowOf(w, 4).liveMessage, { state: "present", value: failure.summary });
  });

  it("a failure record authority does not hold is NAMED, never replaced by a guess", async () => {
    const w = await world();
    // The failure id rides the lifecycle; nothing puts the record.
    seedFailed(w);
    const { liveMessage } = rowOf(w, 4);
    assert.equal(liveMessage.state, "absent");
    assert.match(
      liveMessage.state === "absent" ? liveMessage.reason : "",
      new RegExp(`failure ${uuidOf(9004)}, which authority does not hold`),
    );
  });

  it("every non-failed row states WHY it carries no sentence rather than carrying one", async () => {
    const w = await world();
    seedWorld(w);
    const running = rowOf(w, 2);
    const done = rowOf(w, 3);
    assert.equal(running.liveMessage.state, "absent");
    assert.match(
      running.liveMessage.state === "absent" ? running.liveMessage.reason : "",
      /run is running/,
    );
    assert.equal(done.liveMessage.state, "absent");
    assert.match(
      done.liveMessage.state === "absent" ? done.liveMessage.reason : "",
      /only a failed run carries an error sentence/,
    );
  });

  it("`dryRun` comes off the run envelope and is served on every row", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, dryRun: true });
    queuedEventOf(w, { seed: 2 });
    assert.equal(rowOf(w, 1).dryRun, true);
    assert.equal(rowOf(w, 2).dryRun, false);
  });

  it("only an awaiting row dates its gate, and the instant is the GATE's own", async () => {
    const w = await world();
    seedWorld(w);
    const record = w.authority.getRun(uuidOf(9));
    assert.ok(record);
    w.authority.put({ ...record, updatedAt: IsoInstantSchema.parse(instantOffsetOf(0, 1000)) });
    const gated = rowOf(w, 9);
    assert.equal(gated.status, "awaiting-approval");
    const openedAt = w.projection.runFold(uuidOf(9))?.openGates.at(-1)?.openedAt;
    assert.deepEqual(gated.gateOpenedAt, { state: "present", value: openedAt });
    // …and it is NOT `updatedAt`, which moves on every patch.
    assert.notEqual(gated.gateOpenedAt.state === "present" ? gated.gateOpenedAt.value : "", gated.updatedAt);
    for (const seed of [1, 2, 3, 4]) {
      assert.equal(rowOf(w, seed).gateOpenedAt.state, "absent");
    }
  });

  it("a parked-gate run whose gate span is missing falls back to authority's park instant", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: {
        state: "parked-gate", gateId: "approval",
        parkedAt: "2026-08-03T17:05:00.000Z", resumeAt: "cross-verify",
      },
      version: 2,
    }));
    assert.deepEqual(rowOf(w, 1).gateOpenedAt, { state: "present", value: "2026-08-03T17:05:00.000Z" });
  });

  it("the △ chip's count is the receipt's real warning set, titled by the first", async () => {
    const w = await world();
    seedWorld(w);
    w.authority.receipts.set(uuidOf(3), receiptWithWarningsOf({
      seed: 3,
      summaries: ["CRM dates were replayed past their freshness limit", "the second warning"],
    }));
    assert.deepEqual(rowOf(w, 3).warnings, {
      state: "present",
      count: 2,
      first: "CRM dates were replayed past their freshness limit",
    });
  });
});
