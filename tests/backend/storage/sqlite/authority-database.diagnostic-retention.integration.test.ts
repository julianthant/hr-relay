import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import type { DiagnosticBundle } from "../../../../src/models/trust/diagnostic.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";

const DAY_MS = 86_400_000;
afterEach(() => { vi.restoreAllMocks(); });

async function setup() {
  const fixture = await trustWorld();
  const artifacts = createContentAddressedArtifactWriter({ admission: fixture.profile.admission });
  await artifacts.ready;
  const service = createDiagnosticCaptureService({ authority: fixture.database.authority,
    artifacts, clock: fixture.world.clock, ids: { uuid: randomUUID } });
  const capture = (runId: string, texts = ['{"race":true}'], retention?: { kind: "pinned"; reason: "knowledge" }) => operatorRequestedCapture({ service, runId,
    configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [], ...(retention === undefined ? {} : { retention }),
    attachments: texts.map(text => ({ kind: "console-summary" as const, mediaType: "application/json", sensitivity: "redacted" as const, bytes: Buffer.from(text) })) });
  const path = (bundle: DiagnosticBundle, index = 0) => {
    const attachment = bundle.attachments[index];
    assert.ok(attachment);
    return join(fixture.profile.admission.artifactRoot, `${attachment.digest}.artifact`);
  };
  return { fixture, capture, path };
}

// A peer connection keeps the run's queued row and writes it back just before the sweeper's nth write
// lock: the run is active again, as a delegation refresh would leave it.
function peerRequeue(fixture: Awaited<ReturnType<typeof trustWorld>>, runId: string) {
  const peer = new DatabaseSync(fixture.profile.path);
  const row = peer.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  assert.ok(row);
  const columns = Object.keys(row);
  const exec = DatabaseSync.prototype.exec;
  const requeue = () => peer.prepare(`UPDATE runs SET ${columns.map(column => `${column}=?`).join(",")} WHERE id=?`)
    .run(...columns.map(column => row[column] ?? null), runId);
  return {
    now: requeue,
    beforeLock(lock: number) {
      let locks = 0;
      vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
        if (this !== peer && sql === "BEGIN IMMEDIATE" && ++locks === lock) requeue();
        return exec.call(this, sql);
      });
    },
    close: () => peer.close(),
  };
}

it("keeps the bundle and bytes of a run requeued between the eligibility check and the purge", async () => {
  const { fixture, capture, path } = await setup();
  let peer: ReturnType<typeof peerRequeue> | undefined;
  try {
    const run = fixture.create(830);
    const bundle = await capture(run.envelope.runId);
    peer = peerRequeue(fixture, run.envelope.runId);
    fixture.cancel(run, 832);
    fixture.world.clock.advanceWall(31 * DAY_MS);
    peer.beforeLock(1);

    const swept = fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString());

    assert.deepEqual(swept.purged, []);
    assert.equal(fixture.database.authority.diagnosticBundles.get(bundle.bundleId)?.availability, undefined);
    assert.equal(existsSync(path(bundle)), true);
  } finally {
    vi.restoreAllMocks();
    peer?.close();
    await fixture.dispose();
  }
});

it("keeps the bundle and bytes of a run requeued between the purge mark and byte removal", async () => {
  const { fixture, capture, path } = await setup();
  let peer: ReturnType<typeof peerRequeue> | undefined;
  try {
    const run = fixture.create(831);
    const bundle = await capture(run.envelope.runId);
    peer = peerRequeue(fixture, run.envelope.runId);
    fixture.cancel(run, 833);
    fixture.world.clock.advanceWall(31 * DAY_MS);
    peer.beforeLock(2);

    const swept = fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString());

    assert.deepEqual(swept.purged, []);
    assert.equal(fixture.database.authority.diagnosticBundles.get(bundle.bundleId)?.availability, undefined);
    assert.equal(existsSync(path(bundle)), true);
  } finally {
    vi.restoreAllMocks();
    peer?.close();
    await fixture.dispose();
  }
});

it("keeps bytes a requeued run shares with a later due bundle of a finished run", async () => {
  const { fixture, capture, path } = await setup();
  let peer: ReturnType<typeof peerRequeue> | undefined;
  try {
    const requeued = fixture.create(834), finished = fixture.create(835);
    const kept = await capture(requeued.envelope.runId);
    fixture.world.clock.advanceWall(1000);
    const shared = await capture(finished.envelope.runId);
    assert.equal(path(shared), path(kept));
    peer = peerRequeue(fixture, requeued.envelope.runId);
    fixture.cancel(requeued, 836);
    fixture.cancel(finished, 837);
    fixture.world.clock.advanceWall(31 * DAY_MS);
    peer.beforeLock(2);

    const swept = fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString());

    assert.deepEqual(swept.purged, [shared.bundleId]);
    assert.equal(fixture.database.authority.diagnosticBundles.get(kept.bundleId)?.availability, undefined);
    assert.equal(existsSync(path(kept)), true);
  } finally {
    vi.restoreAllMocks();
    peer?.close();
    await fixture.dispose();
  }
});

it("keeps an earlier completed purge refused after its run is requeued", async () => {
  const { fixture, capture, path } = await setup();
  let peer: ReturnType<typeof peerRequeue> | undefined;
  try {
    const run = fixture.create(838), holder = fixture.create(839);
    const purged = await capture(run.envelope.runId);
    const pinned = await capture(holder.envelope.runId, undefined, { kind: "pinned", reason: "knowledge" });
    assert.equal(path(pinned), path(purged));
    peer = peerRequeue(fixture, run.envelope.runId);
    fixture.cancel(run, 840);
    fixture.world.clock.advanceWall(31 * DAY_MS);
    assert.deepEqual(fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString()).purged, [purged.bundleId]);
    peer.now();

    fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString());

    assert.equal(fixture.database.authority.diagnosticBundles.get(purged.bundleId)?.availability?.state, "purged");
    assert.equal(existsSync(path(pinned)), true);
  } finally {
    vi.restoreAllMocks();
    peer?.close();
    await fixture.dispose();
  }
});

it("keeps a requeued run's remaining shared bytes when a later due bundle is purged", async () => {
  const { fixture, capture, path } = await setup();
  let peer: ReturnType<typeof peerRequeue> | undefined;
  try {
    const requeued = fixture.create(841), finished = fixture.create(842);
    const owner = await capture(requeued.envelope.runId, ['{"unique":true}', '{"shared":true}']);
    fixture.world.clock.advanceWall(1000);
    const later = await capture(finished.envelope.runId, ['{"shared":true}']);
    assert.equal(path(later), path(owner, 1));
    peer = peerRequeue(fixture, requeued.envelope.runId);
    fixture.cancel(requeued, 843);
    fixture.cancel(finished, 844);
    fixture.world.clock.advanceWall(31 * DAY_MS);
    // Lock 3 follows every byte removal of the owner on this code; on per-attachment removal it fell between them.
    peer.beforeLock(3);

    fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString());

    assert.equal(existsSync(path(owner, 1)), true);
  } finally {
    vi.restoreAllMocks();
    peer?.close();
    await fixture.dispose();
  }
});
