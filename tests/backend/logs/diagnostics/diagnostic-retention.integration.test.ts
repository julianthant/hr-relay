import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { composeDashboardTimeline } from "../../../../src/backend/app/composition/dashboard/timeline.js";
import type { StartupCleanup } from "../../../../src/backend/app/composition/dashboard/runtime-contracts.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import type { DiagnosticBundle } from "../../../../src/models/trust/diagnostic.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";

const DAY_MS = 86_400_000;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function captures(fixture: Awaited<ReturnType<typeof trustWorld>>) {
  const artifacts = createContentAddressedArtifactWriter({ admission: fixture.profile.admission });
  await artifacts.ready;
  const service = createDiagnosticCaptureService({ authority: fixture.database.authority,
    artifacts, clock: fixture.world.clock, ids: { uuid: randomUUID } });
  const request = (runId: string, text: string) => ({ service, runId,
    configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
    attachments: [{ kind: "console-summary" as const, mediaType: "application/json", sensitivity: "redacted" as const,
      bytes: Buffer.from(text) }] });
  return { service, request, path(bundle: DiagnosticBundle) {
    const attachment = bundle.attachments[0];
    assert.ok(attachment);
    return join(fixture.profile.admission.artifactRoot, `${attachment.digest}.artifact`);
  } };
}

function startTimeline(fixture: Awaited<ReturnType<typeof trustWorld>>) {
  const startupCleanups: StartupCleanup[] = [];
  const loggingRepository = fixture.database.authority.timelineEvents;
  const clock = fixture.world.clock;
  const runtime = composeDashboardTimeline({ database: fixture.database, clock, loggingRepository,
    projection: fixture.world.projection, startupCleanups, admission: fixture.profile.admission,
    lifecycle: fixture.service, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
  return { ...runtime, async stop() { for (const cleanup of startupCleanups.reverse()) await cleanup(); } };
}

it("removes expired ordinary diagnostic rows and bytes at dashboard start", async () => {
  const fixture = await trustWorld();
  let timeline: ReturnType<typeof startTimeline> | undefined;
  try {
    const run = fixture.create(820);
    fixture.cancel(run, 821);
    const capture = await captures(fixture);
    const clock = fixture.world.clock;
    const bundle = await operatorRequestedCapture(capture.request(run.envelope.runId, '{"safe":true}'));
    const path = capture.path(bundle);
    assert.equal(existsSync(path), true);
    clock.advanceWall(31 * DAY_MS);

    timeline = startTimeline(fixture);
    assert.equal(fixture.database.authority.diagnosticBundles.get(bundle.bundleId), undefined);

    assert.equal(existsSync(path), false, "the expired diagnostic file must be removed with its row");
  } finally {
    await timeline?.stop();
    await fixture.dispose();
  }
});

it("keeps rows and files for not-due, pinned, active, shared and pending diagnostics", async () => {
  const fixture = await trustWorld();
  let timeline: ReturnType<typeof startTimeline> | undefined;
  const capture = await captures(fixture);
  let prepared: DiagnosticBundle | undefined;
  try {
    const run = fixture.create(820);
    fixture.cancel(run, 821);
    const active = fixture.create(822);
    const pinned = await operatorRequestedCapture({ ...capture.request(run.envelope.runId, '{"pinned":true}'),
      retention: { kind: "pinned", reason: "write-recovery" } });
    const activeBundle = await operatorRequestedCapture(capture.request(active.envelope.runId, '{"active":true}'));
    const shared = await operatorRequestedCapture(capture.request(run.envelope.runId, '{"shared":true}'));
    const sharedPin = await operatorRequestedCapture({ ...capture.request(run.envelope.runId, '{"shared":true}'),
      retention: { kind: "pinned", reason: "knowledge" } });
    const pending = await operatorRequestedCapture(capture.request(run.envelope.runId, '{"pending":true}'));
    prepared = await capture.service.prepare({ ...capture.request(run.envelope.runId, '{"pending":true}'),
      trigger: "operator-request", requestedBy: "local-operator", retention: { kind: "pinned", reason: "write-recovery" } });
    fixture.world.clock.advanceWall(31 * DAY_MS);
    const notDue = await operatorRequestedCapture(capture.request(run.envelope.runId, '{"recent":true}'));

    timeline = startTimeline(fixture);

    for (const bundle of [pinned, activeBundle, shared, sharedPin, pending, notDue]) {
      assert.ok(fixture.database.authority.diagnosticBundles.get(bundle.bundleId), `retain row ${bundle.bundleId}`);
      assert.equal(existsSync(capture.path(bundle)), true, `retain file ${bundle.bundleId}`);
    }
  } finally {
    await timeline?.stop();
    if (prepared !== undefined) capture.service.discard(prepared);
    await fixture.dispose();
  }
});

it("sweeps daily on an unref'd timer and clears it on cleanup", async () => {
  const fixture = await trustWorld();
  let timeline: ReturnType<typeof startTimeline> | undefined;
  try {
    const run = fixture.create(820);
    fixture.cancel(run, 821);
    const capture = await captures(fixture);
    const bundle = await operatorRequestedCapture(capture.request(run.envelope.runId, '{"daily":true}'));
    fixture.world.clock.advanceWall(29 * DAY_MS);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    timeline = startTimeline(fixture);
    clearInterval(timeline.timelineTimer);
    assert.equal(timeline.diagnosticRetentionTimer.hasRef(), false);
    fixture.world.clock.advanceWall(DAY_MS - 1);
    vi.advanceTimersByTime(DAY_MS - 1);
    assert.ok(fixture.database.authority.diagnosticBundles.get(bundle.bundleId));
    assert.equal(existsSync(capture.path(bundle)), true);

    fixture.world.clock.advanceWall(1);
    vi.advanceTimersByTime(1);
    assert.equal(fixture.database.authority.diagnosticBundles.get(bundle.bundleId), undefined);
    assert.equal(existsSync(capture.path(bundle)), false);
    await timeline.stop();
    assert.equal(vi.getTimerCount(), 0);
  } finally {
    await timeline?.stop();
    vi.useRealTimers();
    await fixture.dispose();
  }
});

it.each(["bytes", "rows"])("records one debug event per failed %s sweep and keeps the timer running", async phase => {
  const fixture = await trustWorld();
  let timeline: ReturnType<typeof startTimeline> | undefined;
  try {
    const run = fixture.create(820);
    fixture.cancel(run, 821);
    const capture = await captures(fixture);
    const bundle = await operatorRequestedCapture(capture.request(run.envelope.runId, '{"retry":true}'));
    fixture.world.clock.advanceWall(31 * DAY_MS);
    const fail = () => { throw new Error("synthetic purge failure"); };
    const fault = phase === "bytes"
      ? vi.spyOn(fixture.database, "sweepOrdinaryDiagnostics").mockImplementation(fail)
      : vi.spyOn(fixture.service, "purge").mockImplementation(fail);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    timeline = startTimeline(fixture);
    clearInterval(timeline.timelineTimer);
    const failures = () => readTimelineRecords(fixture.database.authority.timelineEvents).records.filter(record =>
      record.payload.kind === "debug" && record.payload.event.area === "diagnostic-retention");
    assert.equal(failures().length, 1);
    fixture.world.clock.advanceWall(DAY_MS);
    vi.advanceTimersByTime(DAY_MS);
    assert.equal(failures().length, 2);
    assert.ok(fixture.database.authority.diagnosticBundles.get(bundle.bundleId));

    fault.mockRestore();
    fixture.world.clock.advanceWall(DAY_MS);
    vi.advanceTimersByTime(DAY_MS);
    assert.equal(failures().length, 2);
    assert.equal(fixture.database.authority.diagnosticBundles.get(bundle.bundleId), undefined);
    assert.equal(existsSync(capture.path(bundle)), false);
  } finally {
    await timeline?.stop();
    vi.useRealTimers();
    await fixture.dispose();
  }
});
