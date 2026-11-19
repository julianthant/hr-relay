import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { composeProfileActivity } from "../../../../src/backend/app/composition/storage-compose.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { startSettingsKeepAwake } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { boundProfileAdmission } from "../../../support/helpers/synthetic-database-admission.js";

it("follows saved settings and the first and last active run, then drains through backend shutdown", async () => {
  const f = await settingsFixture();
  let starts = 0, kills = 0;
  const observer = startSettingsKeepAwake({ database: f.database, platform: "darwin",
    startProcess: () => {
      starts++;
      const child = new ChildProcess();
      Object.defineProperty(child, "pid", { value: 456 });
      child.kill = () => { kills++; child.emit("close", 0, "SIGTERM"); return true; };
      return child;
    }, debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  const settle = (runId: string) => {
    const source = f.service.read(runId);
    assert.equal(source.state, "present");
    if (source.state !== "present") throw new Error("fixture-run-missing");
    requireLifecycleApplied(f.service.transition({ commandId: randomUUID(), runId, expectedVersion: source.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } }));
  };
  try {
    await observer.observe();
    assert.equal(starts, 0);
    const first = f.create({ matchKey: "first" });
    await observer.observe();
    assert.equal(starts, 1);
    const second = f.create({ matchKey: "second" });
    await observer.observe();
    settle(first.envelope.runId);
    await observer.observe();
    assert.equal(starts, 1);
    assert.equal(kills, 0);
    assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: false } }).state, "applied");
    await observer.observe();
    assert.equal(kills, 1);
    assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: true } }).state, "applied");
    await observer.observe();
    assert.equal(starts, 2);
    settle(second.envelope.runId);
    await observer.observe();
    assert.equal(kills, 2);
    f.create({ matchKey: "shutdown" });
    await observer.observe();
    assert.equal(starts, 3);
    const admission = boundProfileAdmission(f.path);
    const activity = composeProfileActivity({ admission, database: f.database, clock: f.clock, lifecycle: f.service,
      supervisor: { state: "not-constructed" }, commandActivities: new Set([observer]) });
    activity.requestShutdown(admission.profileBinding.profileId);
    await activity.awaitCancellation();
    assert.equal(kills, 3);
    assert.equal(observer.hasUnquiescedWork(), false);
    f.closeDatabase();
    await observer.observe();
    assert.equal(starts, 3);
  } finally {
    await observer.awaitCancellation();
    await f.close();
  }
});

it("polls the current saved preference and stops polling before authority closes", async () => {
  const f = await settingsFixture();
  let starts = 0, kills = 0;
  assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: false } }).state, "applied");
  f.create();
  const snapshots = vi.spyOn(f.database, "withAuthorityReadSnapshot");
  vi.useFakeTimers();
  const observer = startSettingsKeepAwake({ database: f.database, platform: "darwin",
    startProcess: () => {
      starts++;
      const child = new ChildProcess();
      Object.defineProperty(child, "pid", { value: 456 });
      child.kill = () => { kills++; child.emit("close", 0, "SIGTERM"); return true; };
      return child;
    }, debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  try {
    await observer.observe();
    assert.equal(starts, 0);
    assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: true } }).state, "applied");
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(starts, 1);
    const reads = snapshots.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(starts, 1);
    assert.equal(snapshots.mock.calls.length, reads);
    assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: false } }).state, "applied");
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(kills, 1);
    await observer.awaitCancellation();
    f.closeDatabase();
    await vi.advanceTimersByTimeAsync(5000);
    assert.equal(starts, 1);
  } finally {
    await observer.awaitCancellation();
    snapshots.mockRestore();
    vi.useRealTimers();
    await f.close();
  }
});

it("keeps awake for live work without decoding terminal runs and rereads after peer commits", async () => {
  const f = await settingsFixture();
  const queued = f.create({ matchKey: "terminal" });
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: randomUUID(), runId: queued.envelope.runId,
    expectedVersion: queued.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } }));
  const active = f.create({ matchKey: "active" });
  const events: unknown[] = [];
  let starts = 0, kills = 0;
  const observer = startSettingsKeepAwake({ database: f.database, platform: "darwin", startProcess: () => {
    starts++;
    const child = new ChildProcess();
    child.kill = () => { kills++; child.emit("close", 0, "SIGTERM"); return true; };
    Object.defineProperty(child, "pid", { value: 456 });
    return child;
  }, debugEvents: { emit: event => events.push(event) } });
  const peer = new DatabaseSync(f.path);
  const update = peer.prepare("UPDATE runs SET version=? WHERE id=?");
  const move = peer.prepare("UPDATE runs SET state=?, outcome=? WHERE id=?");
  try {
    await observer.observe();
    assert.equal(starts, 1);
    update.run(terminal.version + 1, terminal.envelope.runId);
    assert.throws(() => f.service.read(terminal.envelope.runId), /version.*whole-record JSON/u);
    await observer.observe();
    assert.equal(starts, 1);
    assert.deepEqual(events, []);

    update.run(active.version + 1, active.envelope.runId);
    try {
      await assert.rejects(observer.observe(), /version.*whole-record JSON/u);
      await assert.rejects(observer.observe(), /version.*whole-record JSON/u);
    } finally {
      update.run(active.version, active.envelope.runId);
    }
    await observer.observe();

    move.run("terminal", "cancelled", active.envelope.runId);
    try {
      assert.throws(() => f.service.read(active.envelope.runId), /state.*whole-record JSON/u);
      await assert.rejects(observer.observe(), /state.*whole-record JSON/u);
      await assert.rejects(observer.observe(), /state.*whole-record JSON/u);
      assert.equal(kills, 0);
    } finally {
      move.run("queued", null, active.envelope.runId);
    }
    await observer.observe();
    assert.equal(starts, 1);
  } finally {
    update.run(terminal.version, terminal.envelope.runId);
    peer.close();
    await observer.awaitCancellation();
    await f.close();
  }
});

it("records a holder start failure without failing an active dry run or a settings save", async () => {
  const f = await settingsFixture(), events: unknown[] = [];
  const run = f.create();
  const observer = startSettingsKeepAwake({ database: f.database, platform: "darwin",
    startProcess: () => { throw new Error("unavailable"); }, debugEvents: { emit: event => events.push(event) } });
  try {
    await observer.observe();
    assert.equal(events.length, 1);
    assert.match(JSON.stringify(events), /keep-awake-start-failed/u);
    const current = f.service.read(run.envelope.runId);
    assert.equal(current.state, "present");
    if (current.state !== "present") throw new Error("fixture-run-missing");
    assert.deepEqual(current.run.lifecycle, { state: "queued" });
    assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: false } }).state, "applied");
    await observer.observe();
    assert.equal(events.length, 1);
  } finally {
    await observer.awaitCancellation();
    await f.close();
  }
});
