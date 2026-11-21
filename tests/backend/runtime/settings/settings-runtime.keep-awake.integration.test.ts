import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { it, vi } from "vitest";
import { composeProfileActivity } from "../../../../src/backend/app/composition/storage-compose.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createKeepAwake } from "../../../../src/backend/runtime/settings/keep-awake.js";
import { startSettingsKeepAwake } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { boundProfileAdmission } from "../../../support/helpers/synthetic-database-admission.js";

it("follows saved settings and the first and last active run, then drains through backend shutdown", async () => {
  const f = await settingsFixture();
  let starts = 0, kills = 0;
  const observer = startSettingsKeepAwake({ database: f.database, reader: f.service, platform: "darwin",
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
  vi.useFakeTimers();
  const observer = startSettingsKeepAwake({ database: f.database, reader: f.service, platform: "darwin",
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
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(starts, 1);
    assert.equal(f.save({ "preferences.preventSleepWhileRunning": { set: false } }).state, "applied");
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(kills, 1);
    await observer.awaitCancellation();
    f.closeDatabase();
    await vi.advanceTimersByTimeAsync(5000);
    assert.equal(starts, 1);
  } finally {
    await observer.awaitCancellation();
    vi.useRealTimers();
    await f.close();
  }
});

it("records a holder start failure without failing an active dry run or a settings save", async () => {
  const f = await settingsFixture(), events: unknown[] = [];
  const run = f.create();
  const observer = startSettingsKeepAwake({ database: f.database, reader: f.service, platform: "darwin",
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

it.skipIf(process.platform === "win32")("escalates a stalled inhibitor and reaps the owned child", async () => {
  const child = spawn(process.execPath, ["-e", `
    process.on("SIGTERM", () => {});
    process.stdout.write("ready");
    setTimeout(() => {}, 10_000);
  `], { stdio: ["ignore", "pipe", "ignore"] });
  const closed = once(child, "close");
  const kill = vi.spyOn(child, "kill");
  const owner = createKeepAwake({ platform: "darwin", startProcess: () => child,
    debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  try {
    await once(child.stdout, "data");
    vi.useFakeTimers();
    await owner.update(true);
    const stopping = owner.stop();
    try {
      await Promise.resolve();
      await vi.advanceTimersToNextTimerAsync();
      assert.deepEqual(kill.mock.calls, [["SIGTERM"], ["SIGKILL"]]);
      await stopping;
      assert.deepEqual(await closed, [null, "SIGKILL"]);
      assert.equal(child.signalCode, "SIGKILL");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await stopping;
    }
  } finally {
    vi.useRealTimers();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
});

it("escalates a stalled inhibitor and refuses to settle without close evidence", async () => {
  vi.useFakeTimers();
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 456 });
  const kill = vi.spyOn(child, "kill").mockReturnValue(true);
  const owner = createKeepAwake({ platform: "darwin", startProcess: () => child,
    debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  await owner.update(true);
  const stopping = assert.rejects(owner.stop(), /keep-awake-closure-unproved/u);
  try {
    await vi.runAllTimersAsync();
    assert.deepEqual(kill.mock.calls, [["SIGTERM"], ["SIGKILL"]]);
    await stopping;
    await assert.rejects(owner.stop(), /keep-awake-closure-unproved/u);
    assert.equal(kill.mock.calls.length, 2);
  } finally {
    child.emit("close", null, "SIGKILL");
    await stopping.catch(() => undefined);
    vi.useRealTimers();
  }
});
