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
  const capture = (runId: string) => operatorRequestedCapture({ service, runId,
    configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
    attachments: [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: Buffer.from('{"race":true}') }] });
  const path = (bundle: DiagnosticBundle) => {
    const attachment = bundle.attachments[0];
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
  return {
    beforeLock(lock: number) {
      let locks = 0;
      vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
        if (this !== peer && sql === "BEGIN IMMEDIATE" && ++locks === lock) {
          peer.prepare(`UPDATE runs SET ${columns.map(column => `${column}=?`).join(",")} WHERE id=?`)
            .run(...columns.map(column => row[column] ?? null), runId);
        }
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

it("keeps the bytes of a run requeued between the purge mark and byte removal", async () => {
  const { fixture, capture, path } = await setup();
  let peer: ReturnType<typeof peerRequeue> | undefined;
  try {
    const run = fixture.create(831);
    const bundle = await capture(run.envelope.runId);
    peer = peerRequeue(fixture, run.envelope.runId);
    fixture.cancel(run, 833);
    fixture.world.clock.advanceWall(31 * DAY_MS);
    peer.beforeLock(2);

    fixture.database.sweepOrdinaryDiagnostics(fixture.world.clock.now().toISOString());

    assert.equal(existsSync(path(bundle)), true);
  } finally {
    vi.restoreAllMocks();
    peer?.close();
    await fixture.dispose();
  }
});
