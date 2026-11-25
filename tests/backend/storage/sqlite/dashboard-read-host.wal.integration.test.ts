import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, it } from "vitest";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost, ReadLaneRestartedError, type DashboardReadLanes } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, laneBackground, laneSleep, laneStuck } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { scaledMs } from "../../../support/time-scale.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** One checkpoint window is the longest retry spacing. */
const POLICY = { thresholdBytes: 64 * 1024, minRetryMs: 250, maxRetryMs: 1_000 };
const WAL_PEAK_LIMIT_BYTES = 16 * 1024 * 1024;
const INTERACTIVE_MS = 10, BACKGROUND_MS = 60;
/** The gate's peer write rate; the 16 MiB peak is defined against it. */
const WRITER_COMMITS_PER_SECOND = 100;

async function walHost() {
  const fixture = await openBoundDatabaseFixture("read-lane-wal");
  cleanups.push(() => fixture.close());
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
    lanes: ["navigation"], entry: LANE_READS_ENTRY, checkpoint: POLICY });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  const wal = `${fixture.path}-wal`;
  const walBytes = () => { try { return statSync(wal).size; } catch { return 0; } };
  let peak = 0;
  const notes = createNoteTimelineWriter({ repository: fixture.database.authority.timelineEvents, clock: systemClock });
  /**
   * A continuous peer writer on the main connection at WRITER_COMMITS_PER_SECOND, catching up after a late tick, sampling
   * the WAL after each commit. A held read keeps the WAL from resetting, so its size follows the commit count.
   */
  const writer = () => {
    let written = 0;
    const began = performance.now();
    const timer = setInterval(() => {
      const due = Math.floor((performance.now() - began) * WRITER_COMMITS_PER_SECOND / 1_000);
      while (written < due) {
        notes.emitNote({ workflow: "person-lookup", address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step",
          message: `peer write ${String(++written)} ${"x".repeat(512)}` });
        peak = Math.max(peak, walBytes());
      }
    }, 1_000 / WRITER_COMMITS_PER_SECOND);
    return { stop: () => { clearInterval(timer); return written; } };
  };
  return { fixture, lanes, walBytes, writer, peak: () => peak };
}

/** Polls the WAL file, with no dashboard request, until it is empty or the deadline passes. */
async function walResetWithin(walBytes: () => number, deadlineMs: number): Promise<number | undefined> {
  const started = performance.now();
  while (performance.now() - started <= deadlineMs) {
    if (walBytes() === 0) return performance.now() - started;
    await delay(10);
  }
  return undefined;
}

function frames(lanes: DashboardReadLanes) {
  return lanes.status().checkpoints.map(attempt => ({ busy: attempt.busy, copied: attempt.checkpointed, left: attempt.log - attempt.checkpointed,
    walBytesAfter: attempt.walBytesAfter }));
}

it("G1-WAL: bounds the WAL under a continuous writer and a held peer read, keeps clicks prompt, and resets after the release", async ({ annotate }) => {
  const { fixture, lanes, walBytes, writer, peak } = await walHost();
  const held = new DatabaseSync(fixture.path, { readOnly: true });
  cleanups.push(() => { if (held.isOpen) held.close(); });
  held.exec("BEGIN");
  held.prepare("SELECT count(*) AS n FROM sqlite_schema").get();

  const write = writer();
  const waits: number[] = [];
  const background: Promise<unknown>[] = [];
  const started = performance.now();
  while (performance.now() - started < 2_500) {
    if (waits.length % 4 === 0) background.push(lanes.read(laneBackground, { tag: `scan-${String(waits.length)}`, ms: BACKGROUND_MS }));
    const dispatched = performance.now();
    await lanes.read(laneSleep, { tag: `click-${String(waits.length)}`, ms: INTERACTIVE_MS });
    waits.push(performance.now() - dispatched - INTERACTIVE_MS);
    await delay(25);
  }
  await Promise.all(background);
  const written = write.stop();
  const busy = lanes.status().checkpoints.filter(attempt => attempt.busy !== 0);
  assert.ok(busy.length >= 2, "the held read keeps checkpoints busy");
  const attempts = lanes.status().checkpoints.map(attempt => attempt.atMs);
  for (let index = 1; index < attempts.length; index++) {
    assert.ok(attempts[index] - attempts[index - 1] >= POLICY.minRetryMs - 1, `checkpoint attempts ${String(index - 1)} and ${String(index)} are spaced`);
  }

  // Release the peer read; no further dashboard request is made.
  held.exec("COMMIT");
  held.close();
  const resetMs = await walResetWithin(walBytes, 2 * POLICY.maxRetryMs);
  const status = lanes.status();
  const longestRead = Math.max(...waits);
  await annotate(JSON.stringify({ gate: "G1-WAL", commitsPerSecond: WRITER_COMMITS_PER_SECOND, written, peakWalBytes: Math.max(peak(), status.walPeakBytes), resetMs, longestInteractiveWaitMs: longestRead,
    checkpoints: frames(lanes) }));
  assert.ok(resetMs !== undefined, "the WAL is empty within two windows of the release");
  assert.ok(Math.max(peak(), status.walPeakBytes) < WAL_PEAK_LIMIT_BYTES);
  const last = status.checkpoints.at(-1);
  assert.equal(last?.busy, 0);
  assert.equal(last?.walBytesAfter, 0);
  // A click waits at most for the longest read running ahead of it, plus 50 ms.
  assert.ok(longestRead <= BACKGROUND_MS + scaledMs(50), `longest interactive wait ${String(longestRead)} ms`);
});

it("G1-WAL: a read left in a transaction exits its lane, releases the mark and the WAL resets at the next window", async ({ annotate }) => {
  const { lanes, walBytes, writer } = await walHost();
  const stuck = lanes.read(laneStuck, {});
  const queued = lanes.read(laneSleep, { tag: "after-restart", ms: 0 });
  await assert.rejects(stuck, (error: unknown) => error instanceof ReadLaneRestartedError && error.code === "READ_LANE_RESTARTED");
  assert.equal((await queued).cached, false);
  assert.equal(lanes.status().restarts, 1);
  // Grow the WAL past the threshold; a checkpoint now succeeds only if the exited lane's read mark is gone.
  const write = writer();
  await delay(200);
  write.stop();
  const before = lanes.status().checkpoints.length;
  await lanes.read(laneSleep, { tag: "trigger", ms: 0 });
  const resetMs = await walResetWithin(walBytes, 2 * POLICY.maxRetryMs);
  await annotate(JSON.stringify({ gate: "G1-WAL rollback", resetMs, checkpoints: frames(lanes) }));
  assert.ok(lanes.status().checkpoints.length > before);
  assert.ok(resetMs !== undefined, "the restarted lane released the stuck read's mark");
  assert.equal(lanes.status().checkpoints.at(-1)?.walBytesAfter, 0);
});
