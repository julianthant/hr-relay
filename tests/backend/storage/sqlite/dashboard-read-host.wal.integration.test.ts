import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost, ReadLaneRestartedError, type DashboardReadLanes } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, laneRollbackFails, laneSearchBarrier, laneTimedBackground, laneTimedSleep } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** One checkpoint window is the longest retry spacing. */
const POLICY = { thresholdBytes: 64 * 1024, minRetryMs: 250, maxRetryMs: 1_000 };
const WAL_PEAK_LIMIT_BYTES = 16 * 1024 * 1024;
const INTERACTIVE_MS = 10, BACKGROUND_MS = 60;
/** The gate's peer write rate and workload; the 16 MiB peak is defined against them. */
const WRITER_COMMITS_PER_SECOND = 100, WRITER_COMMITS = 250;

async function walHost(checkpoint: typeof POLICY = POLICY, withSearch = false) {
  const fixture = await openBoundDatabaseFixture("read-lane-wal");
  cleanups.push(() => fixture.close());
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
    lanes: withSearch ? ["navigation", "search"] : ["navigation"], entry: LANE_READS_ENTRY, checkpoint });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  const wal = `${fixture.path}-wal`;
  const walBytes = () => { try { return statSync(wal).size; } catch { return 0; } };
  let peak = 0;
  const notes = createNoteTimelineWriter({ repository: fixture.database.authority.timelineEvents, clock: systemClock });
  /**
   * A continuous peer writer on the main connection, one commit per tick at up to WRITER_COMMITS_PER_SECOND, sampling the
   * WAL after each commit. It shares the host's thread, so it never commits in a burst. A held read keeps the WAL from
   * resetting, so its size follows the commit count. Each tick's main-thread span, the commit and its fsync included, is kept.
   */
  const writer = (limit = Number.POSITIVE_INFINITY) => {
    let written = 0;
    const ticks: { startedAt: number; finishedAt: number }[] = [];
    const timer = setInterval(() => {
      if (written >= limit) return;
      const startedAt = systemClock.nowMs();
      notes.emitNote({ workflow: "person-lookup", address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step",
        message: `peer write ${String(++written)} ${"x".repeat(512)}` });
      ticks.push({ startedAt, finishedAt: systemClock.nowMs() });
      peak = Math.max(peak, walBytes());
    }, 1_000 / WRITER_COMMITS_PER_SECOND);
    return { ticks, done: () => written >= limit, stop: () => { clearInterval(timer); return written; } };
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
/** Lane time spent on other work while a click waited from `from` to `to`: the click goes first, so all of it ran ahead. */
const aheadOf = (from: number, to: number, spans: readonly z.infer<typeof SpanSchema>[]) =>
  spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.finishedAt, to) - Math.max(span.startedAt, from)), 0);

it("G1-WAL: bounds the WAL under a continuous writer, a held peer read and a failed rollback, keeps clicks prompt, and resets after the release", async ({ annotate }) => {
  const { fixture, lanes, walBytes, writer, peak } = await walHost();
  const held = new DatabaseSync(fixture.path, { readOnly: true });
  cleanups.push(() => { if (held.isOpen) held.close(); });
  held.exec("BEGIN");
  held.prepare("SELECT count(*) AS n FROM sqlite_schema").get();

  const write = writer(WRITER_COMMITS);
  const spans: z.infer<typeof SpanSchema>[] = [];
  const clicks: { dispatchedAt: number; startedAt: number; afterRestart: boolean }[] = [];
  const background: Promise<unknown>[] = [];
  const started = performance.now();
  let injected = false, afterRestart = false, restartWaitMs: number | undefined;
  // Clicks run across the whole workload: the window ends once every peer commit has landed, however slow the runner.
  while (!write.done()) {
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
    const dispatchedAt = systemClock.nowMs();
    const span = SpanSchema.parse(JSON.parse((await lanes.read(laneTimedSleep, { tag: `click-${String(clicks.length)}`, ms: INTERACTIVE_MS })).body));
    spans.push(span);
    clicks.push({ dispatchedAt, startedAt: span.startedAt, afterRestart });
    if (afterRestart) restartWaitMs = span.startedAt - dispatchedAt;
    afterRestart = false;
    await delay(25);
  }
  const windowMs = performance.now() - started;
  await Promise.all(background);
  const written = write.stop();
  assert.equal(written, WRITER_COMMITS);
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
  // The lane truncates the WAL before its checkpoint reply reaches the host.
  const recorded = performance.now() + 1_000;
  while (lanes.status().checkpoints.at(-1)?.walBytesAfter !== 0 && performance.now() < recorded) await delay(10);
  const status = lanes.status();
  // The bound is the read and checkpoint time the lane ran ahead of a click plus 50 ms. Writer ticks get no allowance: the lane
  // takes its next message itself, so no handoff between lane messages waits on the main thread.
  const checkpointSpans = status.checkpoints.map(attempt => ({ startedAt: attempt.startedAtMs, finishedAt: attempt.finishedAtMs }));
  const restartBootMs = status.bootMs.at(-1);
  const measured = clicks.map((click, index) => {
    const waitMs = click.startedAt - click.dispatchedAt, readAheadMs = aheadOf(click.dispatchedAt, click.startedAt, spans);
    const checkpointAheadMs = aheadOf(click.dispatchedAt, click.startedAt, checkpointSpans);
    const writerMs = aheadOf(click.dispatchedAt, click.startedAt, write.ticks);
    // The restart click's bound is the replacement lane's measured boot plus 50 ms; every other click's is its parts plus 50 ms.
    const boundMs = click.afterRestart ? (restartBootMs ?? Number.NaN) + 50 : readAheadMs + checkpointAheadMs + 50;
    // Writer time inside the click's window is reported, not allowed: it overlaps the lane work and the post itself.
    return { click: index, afterRestart: click.afterRestart, waitMs, readAheadMs, checkpointAheadMs, writerMs,
      writerTicks: write.ticks.filter(tick => tick.finishedAt > click.dispatchedAt && tick.startedAt < click.startedAt).length,
      queueingMs: waitMs - readAheadMs - checkpointAheadMs,
      ...(click.afterRestart ? { bootMs: restartBootMs } : {}), boundMs, overBoundMs: waitMs - boundMs };
  });
  const longest = measured.filter(click => !click.afterRestart)
    .reduce((worst, click) => click.overBoundMs > worst.overBoundMs ? click : worst);
  await annotate(JSON.stringify({ gate: "G1-WAL", commitsPerSecond: WRITER_COMMITS_PER_SECOND, written, windowMs, peakWalBytes: Math.max(peak(), status.walPeakBytes),
    resetMs, clicks: measured.length, longestInteractiveWaitMs: longest.waitMs, readAheadMs: longest.readAheadMs,
    checkpointAheadMs: longest.checkpointAheadMs, restartWaitMs, bootMs: status.bootMs, checkpointMs: checkpointSpans.map(span => span.finishedAt - span.startedAt),
    checkpoints: frames(lanes),
    writerTickMs: { count: write.ticks.length, max: Math.max(...write.ticks.map(tick => tick.finishedAt - tick.startedAt)),
      total: write.ticks.reduce((sum, tick) => sum + tick.finishedAt - tick.startedAt, 0) },
    perClick: measured }));
  assert.ok(resetMs !== undefined, "the WAL is empty within two windows of the release");
  assert.ok(Math.max(peak(), status.walPeakBytes) < WAL_PEAK_LIMIT_BYTES);
  const last = status.checkpoints.at(-1);
  assert.equal(last?.busy, 0);
  assert.equal(last?.walBytesAfter, 0);
  // Every click meets its own published bound: its reads and checkpoints plus 50 ms, or the measured boot plus 50 ms after the restart.
  assert.ok(restartBootMs !== undefined && status.bootMs.length === 2);
  assert.equal(measured.filter(click => click.afterRestart).length, 1);
  for (const click of measured) {
    assert.ok(click.waitMs <= click.boundMs, click.afterRestart
      ? `restart click ${String(click.click)} waited ${String(click.waitMs)} ms behind a ${String(restartBootMs)} ms boot`
      : `click ${String(click.click)} waited ${String(click.waitMs)} ms behind ${String(click.readAheadMs)} ms of read, `
        + `${String(click.checkpointAheadMs)} ms of checkpoint (${String(click.writerMs)} ms of writer ticks in its window)`);
  }
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

it("serves navigation while a checkpoint waits for the active Search read", async () => {
  const { lanes, walBytes, writer } = await walHost(POLICY, true);
  const directory = mkdtempSync(join(tmpdir(), "relay-search-checkpoint-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const search = lanes.read(laneSearchBarrier, { tag: "held Search", dir: directory });
  try {
    const deadline = performance.now() + 4_000;
    while (!existsSync(join(directory, "started")) && performance.now() < deadline) await delay(10);
    assert.ok(existsSync(join(directory, "started")));
    const writes = writer();
    try {
      while (walBytes() <= POLICY.thresholdBytes && performance.now() < deadline) await delay(10);
      assert.ok(walBytes() > POLICY.thresholdBytes, "the navigation read is posted behind a checkpoint request");
      assert.ok(await lanes.read(laneTimedSleep, { tag: "Queue during Search", ms: 0 }));
    } finally { writes.stop(); }
  } finally {
    writeFileSync(join(directory, "release"), "");
    await search;
  }
  assert.ok(await walResetWithin(walBytes, 2 * POLICY.maxRetryMs) !== undefined);
});
