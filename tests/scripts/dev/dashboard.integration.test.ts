import assert from "node:assert/strict";
import type { ChildProcess,SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe,it,vi } from "vitest";
import { scaledMs } from "../../support/time-scale.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

const BACKEND = `
process.on('SIGINT', () => setTimeout(() => { console.log('backend-drained'); process.exit(0); }, 100));
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));
setTimeout(() => { console.log('backend-ready'); process.send({type:'hrauto-dashboard-ready'}); }, 100);
setInterval(() => {}, 1000);
`;
const FRONTEND = `
console.log('frontend-started');
process.on('SIGINT', () => setTimeout(() => { console.log('frontend-drained'); process.exit(0); }, 150));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`;

async function start(backendSource = BACKEND) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const children: ChildProcess[] = []; const output: string[] = [];
  mocks.spawn.mockReset().mockImplementation((_command: string, args: string[], options: SpawnOptions) => {
    const backend = args.includes("cli");
    const child = actual.spawn(process.execPath, ["-e", backend ? backendSource : FRONTEND], {
      ...options, stdio: backend ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.stdout?.on("data", chunk => { output.push(String(chunk)); });
    child.stderr?.on("data", chunk => { output.push(String(chunk)); });
    return child;
  });
  const signals = new EventEmitter();
  const { runDevDashboard } = await import("../../../scripts/dev/dashboard.js");
  const done = runDevDashboard({ signals, startupTimeoutMs: 3000, writeError: message => output.push(message) });
  return { children, output, signals, done };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + scaledMs(3000);
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("fixture progress timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe("dashboard launcher with actual child processes", () => {
  it("orders backend readiness before frontend startup and awaits both signal drains", async () => {
    const run = await start();
    try {
      assert.equal(run.children.length, 1);
      await waitUntil(() => run.output.join("").includes("frontend-started"));
      assert.match(run.output.join(""), /backend-ready[\s\S]*frontend-started/u);
      run.signals.emit("SIGINT"); run.signals.emit("SIGINT");
      assert.equal(await run.done, 0);
      assert.match(run.output.join(""), /backend-drained/u);
      assert.match(run.output.join(""), /frontend-drained/u);
      assert.ok(run.children.every(child => child.exitCode === 0));
      for (const child of run.children) {
        assert.ok(child.pid); assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
      }
    } finally { run.children.forEach(child => { if (child.exitCode === null) child.kill("SIGKILL"); }); }
  });

  it("does not start a frontend when the backend fails before readiness", async () => {
    const run = await start("console.error('backend-startup-refused'); process.exit(9);");
    try {
      assert.equal(await run.done, 9);
      assert.equal(run.children.length, 1);
      assert.match(run.output.join(""), /backend-startup-refused/u);
    } finally { run.children.forEach(child => { if (child.exitCode === null) child.kill("SIGKILL"); }); }
  });
});
