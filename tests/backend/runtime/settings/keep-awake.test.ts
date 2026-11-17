import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { it } from "vitest";
import { createKeepAwake } from "../../../../src/backend/runtime/settings/keep-awake.js";

it("holds one macOS sleep assertion until the last active run settles", async () => {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 456 });
  const starts: { command: string; args: readonly string[] }[] = [];
  let kills = 0;
  child.kill = () => { kills++; child.emit("close", 0, "SIGTERM"); return true; };
  const holder = createKeepAwake({ platform: "darwin", pid: 123,
    startProcess: (command, args) => { starts.push({ command, args }); return child; },
    debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } },
  });
  await holder.update(false);
  assert.equal(starts.length, 0);
  await holder.update(true);
  await holder.update(true);
  assert.deepEqual(starts, [{ command: "/usr/bin/caffeinate", args: ["-i", "-w", "123"] }]);
  assert.equal(kills, 0);
  await holder.update(false);
  assert.equal(kills, 1);
  await holder.stop();
  assert.equal(kills, 1);
});

it("waits for child closure on backend stop and cannot restart afterwards", async () => {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 456 });
  let kills = 0, starts = 0, stopped = false;
  child.kill = () => { kills++; return true; };
  const holder = createKeepAwake({ platform: "darwin", startProcess: () => { starts++; return child; },
    debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  await holder.update(true);
  const stopping = holder.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(kills, 1);
  assert.equal(stopped, false);
  child.emit("close", 0, "SIGTERM");
  await stopping;
  await holder.update(true);
  await holder.stop();
  assert.equal(stopped, true);
  assert.equal(starts, 1);
  assert.equal(kills, 1);
});

it("reports a failed start without rejecting activity or repeatedly spawning in the same episode", async () => {
  const events: unknown[] = [];
  let starts = 0;
  const holder = createKeepAwake({ platform: "darwin", startProcess: () => { starts++; throw new Error("unavailable"); },
    debugEvents: { emit: event => events.push(event) } });
  await holder.update(true);
  await holder.update(true);
  assert.equal(starts, 1);
  assert.equal(events.length, 1);
  assert.match(JSON.stringify(events), /keep-awake-start-failed/u);
  assert.doesNotMatch(JSON.stringify(events), /unavailable/u);
  await holder.update(false);
  await holder.update(true);
  assert.equal(starts, 2);
  await holder.stop();
});

it("handles an asynchronous spawn error and awaits its close without signalling an unstarted process", async () => {
  const child = new ChildProcess(), events: unknown[] = [];
  child.kill = () => { throw new Error("unstarted-process-signalled"); };
  const holder = createKeepAwake({ platform: "darwin", startProcess: () => child,
    debugEvents: { emit: event => events.push(event) } });
  await holder.update(true);
  child.emit("error", new Error("private-path-is-not-logged"));
  const stopping = holder.stop();
  child.emit("close", -1, null);
  await stopping;
  assert.equal(events.length, 1);
  assert.match(JSON.stringify(events), /keep-awake-start-failed/u);
  assert.doesNotMatch(JSON.stringify(events), /private-path/u);
});

it("reports an unexpected exit and refuses to claim a failed release is closed", async () => {
  const child = new ChildProcess(), events: unknown[] = [];
  Object.defineProperty(child, "pid", { value: 456 });
  child.kill = () => false;
  const holder = createKeepAwake({ platform: "darwin", startProcess: () => child,
    debugEvents: { emit: event => events.push(event) } });
  await holder.update(true);
  await assert.rejects(holder.stop(), /keep-awake-stop-failed/u);
  child.emit("close", 0, null);
  await holder.stop();
  assert.equal(events.length, 0);

  const exited = new ChildProcess();
  const other = createKeepAwake({ platform: "darwin", startProcess: () => exited,
    debugEvents: { emit: event => events.push(event) } });
  await other.update(true);
  exited.emit("close", 1, null);
  await other.stop();
  assert.equal(events.length, 1);
  assert.match(JSON.stringify(events), /keep-awake-exited/u);
});

it("does not create a late holder when stop wins before a queued update", async () => {
  const holder = createKeepAwake({ platform: "darwin", startProcess: () => { throw new Error("late-start"); },
    debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  await Promise.all([holder.update(true), holder.stop()]);
});

it.each(["win32", "linux"] as const)("keeps the same no-op interface on %s", async platform => {
  const holder = createKeepAwake({ platform, startProcess: () => { throw new Error("unsupported-platform-started"); },
    debugEvents: { emit: () => { throw new Error("unexpected-debug-event"); } } });
  await holder.update(true);
  await holder.update(false);
  await holder.stop();
});
