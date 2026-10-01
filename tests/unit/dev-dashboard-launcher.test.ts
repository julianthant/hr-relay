import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn<(command: string, args: readonly string[], options: SpawnOptions) => ChildProcess>() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

class Child extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((_signal: NodeJS.Signals) => true);
  close(code = 0): void { this.exitCode = code; this.emit("exit", code, null); this.emit("close", code, null); }
}

async function launch(timeout = 1000) {
  vi.resetModules();
  const children: Child[] = [];
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = new Child(); children.push(child); return child as unknown as ChildProcess;
  });
  const signals = new EventEmitter();
  const output: string[] = [];
  const module = await import("../../scripts/dev-dashboard.js");
  const done = module.runDevDashboard({ startupTimeoutMs: timeout, signals,
    writeError: message => output.push(message) });
  return { children, signals, output, done };
}

afterEach(() => { vi.useRealTimers(); });

describe("dashboard launcher", () => {
  it("starts the frontend only after its owned backend sends readiness, without npm wrappers", async () => {
    const { children, signals, done } = await launch();
    assert.equal(children.length, 1, "Vite must wait for BFF readiness");
    assert.equal(mocks.spawn.mock.calls[0][0], process.execPath);
    assert.ok(mocks.spawn.mock.calls[0][1].includes("cli"));
    children[0].emit("message", { type: "unrelated" });
    assert.equal(children.length, 1);
    children[0].emit("message", { type: "hrauto-dashboard-ready" });
    assert.equal(children.length, 2);
    assert.equal(mocks.spawn.mock.calls[1][0], process.execPath);
    assert.match(mocks.spawn.mock.calls[1][1][0], /vite\/bin\/vite\.js$/u);
    assert.deepEqual(mocks.spawn.mock.calls[1][1].slice(1), ["--config", "vite.dashboard.config.ts"]);
    assert.equal(mocks.spawn.mock.calls[0][2].env, mocks.spawn.mock.calls[1][2].env);
    signals.emit("SIGINT"); children.forEach(child => child.close());
    assert.equal(await done, 0);
  });

  it("refuses frontend launch when backend startup fails", async () => {
    const { children, done, output } = await launch();
    children[0].close(7);
    assert.equal(await done, 7);
    assert.equal(children.length, 1);
    assert.match(output.join(""), /bff stopped/u);
  });

  it("times out readiness and waits for backend shutdown", async () => {
    vi.useFakeTimers();
    const { children, done, output } = await launch(100);
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(children.length, 1);
    assert.deepEqual(children[0].kill.mock.calls, [["SIGTERM"]]);
    let settled = false; void done.then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    children[0].close(); assert.equal(await done, 1);
    assert.match(output.join(""), /readiness timed out/u);
  });

  it.each([0, 1])("stops and awaits the sibling when child %i exits", async index => {
    const { children, done } = await launch();
    children[0].emit("message", { type: "hrauto-dashboard-ready" });
    children[index].close(4);
    assert.deepEqual(children[1 - index].kill.mock.calls, [["SIGTERM"]]);
    children[1 - index].close(); assert.equal(await done, 4);
  });

  it("keeps signal ownership through repeated Ctrl+C and reaps both children", async () => {
    const { children, signals, done } = await launch();
    children[0].emit("message", { type: "hrauto-dashboard-ready" });
    signals.emit("SIGINT"); signals.emit("SIGINT");
    assert.ok(children.every(child => child.kill.mock.calls.length === 1));
    let settled = false; void done.then(() => { settled = true; });
    children[0].close(); await Promise.resolve(); assert.equal(settled, false);
    assert.equal(signals.listenerCount("SIGINT"), 1);
    children[1].close(); assert.equal(await done, 0);
    assert.equal(signals.listenerCount("SIGINT"), 0);
  });

  it.each(["SIGINT", "SIGSEGV"] as const)("accounts for child termination by %s during shutdown", async signal => {
    const { children, signals, done } = await launch();
    children[0].emit("message", { type: "hrauto-dashboard-ready" });
    signals.emit("SIGINT");
    children[0].signalCode = signal;
    children[0].emit("exit", null, signal); children[0].emit("close", null, signal);
    children[1].close();
    assert.equal(await done, signal === "SIGINT" ? 0 : 1);
  });

  it("reports a spawn failure and waits for the owned backend", async () => {
    const { children, done, output } = await launch();
    children[0].emit("message", { type: "hrauto-dashboard-ready" });
    children[1].emit("error", new Error("spawn refused")); children[1].close();
    assert.deepEqual(children[0].kill.mock.calls, [["SIGTERM"]]);
    children[0].close(); assert.equal(await done, 1);
    assert.match(output.join(""), /could not start web: spawn refused/u);
  });
});
