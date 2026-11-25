import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost, ReadLaneRestartedError, type DashboardReadLanes } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, laneRollbackFails, laneTimedBackground, laneTimedSleep } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** One checkpoint window is the longest retry spacing. */
const POLICY = { thresholdBytes: 64 * 1024, minRetryMs: 250, maxRetryMs: 1_000 };
const WAL_PEAK_LIMIT_BYTES = 16 * 1024 * 1024;
const INTERACTIVE_MS = 10, BACKGROUND_MS = 60;
/** The gate's peer write rate; the 16 MiB peak is defined against it. */
const WRITER_COMMITS_PER_SECOND = 100;

async function walHost(checkpoint: typeof POLICY = POLICY) {
  const fixture = await openBoundDatabaseFixture("read-lane-wal");
  cleanups.push(() => fixture.close());
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
    lanes: ["navigation"], entry: LANE_READS_ENTRY, checkpoint });
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

/** A lane read's own start and finish on the shared wall clock. */
const SpanSchema = z.object({ startedAt: z.number(), finishedAt: z.number() });
const wallMs = () => performance.timeOrigin + performance.now();
/** Lane time a click dispatched at `at` must wait for: the rest of the read already running then. */
const aheadOf = (at: number, spans: readonly z.infer<typeof SpanSchema>[]) =>
  Math.max(0, ...spans.filter(span => span.startedAt <= at && at < span.finishedAt).map(span => span.finishedAt - at));

it("G1-WAL: bounds the WAL under a continuous writer, a held peer read and a failed rollback, keeps clicks prompt, and resets after the release", async ({ annotate }) => {
  const { fixture, lanes, walBytes, writer, peak } = await walHost();
  const held = new DatabaseSync(fixture.path, { readOnly: true });
  cleanups.push(() => { if (held.isOpen) held.close(); });
  held.exec("BEGIN");
  held.prepare("SELECT count(*) AS n FROM sqlite_schema").get();

  const write = writer();
  const spans: z.infer<typeof SpanSchema>[] = [];
  const clicks: { dispatchedAt: number; startedAt: number; afterRestart: boolean }[] = [];
  const background: Promise<unknown>[] = [];
  const started = performance.now();
  let injected = false, afterRestart = false, restartWaitMs: number | undefined;
  while (performance.now() - started < 2_500) {
    if (!injected && performance.now() - started > 1_000) {
      // The lane's own rollback fails mid-workload: the lane must exit, release its read mark and restart.
      injected = true;
      await assert.rejects(lanes.read(laneRollbackFails, {}), (error: unknown) => error instanceof ReadLaneRestartedError);
      afterRestart = true;
    }
    if (clicks.length % 4 === 0) {
      background.push(lanes.read(laneTimedBackground, { tag: `scan-${String(clicks.length)}`, ms: BACKGROUND_MS })
        .then(reply => { spans.push(SpanSchema.parse(JSON.parse(reply.body))); }));
    }
    const dispatchedAt = wallMs();
    const span = SpanSchema.parse(JSON.parse((await lanes.read(laneTimedSleep, { tag: `click-${String(clicks.length)}`, ms: INTERACTIVE_MS })).body));
    spans.push(span);
    clicks.push({ dispatchedAt, startedAt: span.startedAt, afterRestart });
    if (afterRestart) restartWaitMs = span.startedAt - dispatchedAt;
    afterRestart = false;
    await delay(25);
  }
  await Promise.all(background);
  const written = write.stop();
  assert.equal(lanes.status().restarts, 1);
  const busy = lanes.status().checkpoints.filter(attempt => attempt.busy !== 0);
  assert.ok(busy.length >= 2, "the held read keeps checkpoints busy");
  const attempts = lanes.status().checkpoints.map(attempt => attempt.atMs);
  for (let index = 1; index < attempts.length; index++) {
    assert.ok(attempts[index] - attempts[index - 1] >= POLICY.minRetryMs - 1, `checkpoint attempts ${String(index - 1)} and ${String(index)} are spaced`);
  }

  // Release the peer read; no further dashboard request is made. Only the exited lane's released mark lets the WAL reset.
  held.exec("COMMIT");
  held.close();
  const resetMs = await walResetWithin(walBytes, 2 * POLICY.maxRetryMs);
  const status = lanes.status();
  // The click after the failed rollback waits for the lane's restart, which no read runs ahead of.
  const measured = clicks.filter(click => !click.afterRestart).map(click => ({ waitMs: click.startedAt - click.dispatchedAt,
    aheadMs: aheadOf(click.dispatchedAt, spans) }));
  const longest = measured.reduce((worst, click) => click.waitMs - click.aheadMs > worst.waitMs - worst.aheadMs ? click : worst);
  await annotate(JSON.stringify({ gate: "G1-WAL", commitsPerSecond: WRITER_COMMITS_PER_SECOND, written, peakWalBytes: Math.max(peak(), status.walPeakBytes),
    resetMs, clicks: measured.length, longestInteractiveWaitMs: longest.waitMs, runningAheadMs: longest.aheadMs, restartWaitMs,
    checkpoints: frames(lanes) }));
  assert.ok(resetMs !== undefined, "the WAL is empty within two windows of the release");
  assert.ok(Math.max(peak(), status.walPeakBytes) < WAL_PEAK_LIMIT_BYTES);
  const last = status.checkpoints.at(-1);
  assert.equal(last?.busy, 0);
  assert.equal(last?.walBytesAfter, 0);
  // A click waits at most for the read running ahead of it, measured in the lane, plus 50 ms.
  assert.ok(longest.waitMs <= longest.aheadMs + 50, `interactive wait ${String(longest.waitMs)} ms behind ${String(longest.aheadMs)} ms of running read`);
});

it("takes the writer's automatic checkpoints while the host runs and hands them back at close", async () => {
  const { fixture, lanes, walBytes, writer } = await walHost({ ...POLICY, thresholdBytes: 1024 ** 3 });
  assert.equal(fixture.database.autoCheckpointPages(), 0);
  // SQLite's 1,000-page automatic checkpoint would restart the idle-reader WAL near 1,000 pages; under custody it only grows.
  const write = writer();
  const deadline = performance.now() + 20_000;
  while (walBytes() <= 1_200 * 4_096 && performance.now() < deadline) await delay(50);
  write.stop();
  assert.ok(walBytes() > 1_200 * 4_096, `the WAL grew past the automatic checkpoint: ${String(walBytes())} bytes`);
  assert.equal(lanes.status().checkpoints.length, 0);
  await lanes.close();
  assert.equal(fixture.database.autoCheckpointPages(), 1_000);
});
