import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createApplicationLifecycle } from "../../../../src/backend/runs/lifecycle/application-lifecycle.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { ApplicationAdmissionRefusedError } from "../../../../src/backend/storage/sqlite/run-store-contracts.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

it("polls current lifecycle facts without collecting the profile closure inventory", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  const inventory = vi.spyOn(f.database, "readProfileResourceCustody").mockImplementation(() => {
    throw new Error("lifecycle must not collect the closure inventory");
  });
  const artifacts = vi.spyOn(f.database, "readManagedArtifactReferences").mockImplementation(() => {
    throw new Error("lifecycle must not scan retained JSON for artifacts");
  });
  cleanups.push(() => { inventory.mockRestore(); artifacts.mockRestore(); });
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() {}, onFailure: error => { throw error; },
    updateHost: { pending: () => true, async install() {} } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().update, "pending");
  assert.deepEqual(lifecycle.snapshot().targets, []);
  const run = f.create();
  assert.equal(lifecycle.snapshot().update, "deferred");
  assert.deepEqual(lifecycle.snapshot().targets, [{ runId: run.envelope.runId, expectedVersion: run.version, pauseUnavailable: false }]);
  const paused = f.service.pause({ commandId: "a1000000-0000-4000-8000-000000000002", runId: run.envelope.runId, expectedVersion: run.version });
  assert.equal(paused.state, "applied");
  const target = lifecycle.snapshot().targets[0]; assert.ok(target);
  assert.equal(target.expectedVersion, run.version + 1);
  assert.equal(target.pause?.state, "paused");
  assert.equal(inventory.mock.calls.length, 0);
  assert.equal(artifacts.mock.calls.length, 0);
});

it("refuses changed physical run evidence on the next lifecycle poll", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  const run = f.create();
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() {}, onFailure: error => { throw error; } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().targets[0]?.expectedVersion, run.version);
  const peer = new DatabaseSync(f.path);
  try {
    peer.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(run.envelope.runId);
    assert.throws(() => lifecycle.snapshot(), /version.*whole-record JSON/u);
  } finally {
    peer.prepare("UPDATE runs SET version=? WHERE id=?").run(run.version, run.envelope.runId);
    peer.close();
  }
});

it("holds durable current-runtime admission before awaiting an idle installer and retains it on failure", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  let rejectInstall: ((error: Error) => void) | undefined;
  let installs = 0;
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit: () => { throw new Error("unexpected quit"); },
    onFailure: error => { throw error; }, updateHost: { pending: () => true,
      install: () => { installs += 1; return new Promise<void>((_resolve, reject) => { rejectInstall = reject; }); } } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().update, "pending");
  const installing = lifecycle.installIdleUpdate();
  assert.equal(installs, 1);
  assert.equal(f.database.authority.runs.admission().state, "draining");
  assert.throws(() => f.create());
  await assert.rejects(lifecycle.installIdleUpdate(), /application-update-work-active/u);
  assert.ok(rejectInstall); rejectInstall(new Error("fixture installer failed"));
  await assert.rejects(installing, error => error instanceof ApplicationAdmissionRefusedError
    && error.code === "APPLICATION_ADMISSION_REFUSED" && error.cause instanceof Error && error.cause.message === "fixture installer failed");
  assert.equal(f.database.authority.runs.admission().state, "draining");
  const active = f.database.authority.runtimeConfig.get(); assert.ok(active);
  assert.notEqual(f.save({ "timeouts.taskMs": { set: 90_000 } }).state, "applied");
  assert.deepEqual(f.database.authority.runtimeConfig.get(), active);
  assert.equal(f.database.authority.runs.admission().state, "draining");
  f.database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
    configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint, activatedAt: f.clock.now().toISOString() });
  assert.equal(f.database.authority.runs.admission().state, "open");
});

it("defers idle updates while a paused run is retained", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  const run = f.create();
  const pause = f.service.pause({ commandId: "a1000000-0000-4000-8000-000000000001", runId: run.envelope.runId, expectedVersion: run.version });
  assert.equal(pause.state, "applied");
  let installs = 0;
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() {}, onFailure: error => { throw error; },
    updateHost: { pending: () => true, async install() { installs += 1; } } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().update, "deferred");
  const target = lifecycle.snapshot().targets.find(target => target.runId === run.envelope.runId);
  assert.equal(target?.pause?.state, "paused");
  assert.equal(target.pauseUnavailable, false);
  await assert.rejects(lifecycle.installIdleUpdate(), /application-update-work-active/u);
  assert.equal(installs, 0);
  assert.equal(f.database.authority.runs.admission().state, "open");
});
