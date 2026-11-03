import assert from "node:assert/strict";
import type { ChildProcess,SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DashboardLauncherOptions } from "../../../scripts/dev/dashboard.js";
import { DASHBOARD_LAUNCH_NONCE_ENV } from "../../../src/backend/transports/http/frontend-owner.js";
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

async function start(backendSource = BACKEND, options: Pick<DashboardLauncherOptions, "mode" | "frontendOwnerFile"> = {}) {
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
  const done = runDevDashboard({ ...options, signals, startupTimeoutMs: 3000, writeError: message => output.push(message) });
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
  it("explains how to start web without a backend and launches no children", async () => {
    const root = mkdtempSync(join(tmpdir(), "missing-backend-"));
    try {
      const run = await start(BACKEND, { mode: "web", frontendOwnerFile: join(root, "cache", "frontend-owner") });
      assert.equal(await run.done, 1);
      assert.deepEqual(run.output, ['[dashboard] Start npm run backend first and wait for "listening".\n']);
      assert.equal(run.children.length, 0);
      assert.equal(run.signals.listenerCount("SIGINT"), 0);
      assert.equal(run.signals.listenerCount("SIGTERM"), 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("preserves a malformed ownership refusal instead of treating it as a missing backend", async () => {
    const root = mkdtempSync(join(tmpdir(), "invalid-backend-owner-"));
    try {
      const frontendOwnerFile = join(root, "frontend-owner");
      writeFileSync(frontendOwnerFile, "invalid");
      await assert.rejects(start(BACKEND, { mode: "web", frontendOwnerFile }), { name: "ZodError" });
      assert.equal(mocks.spawn.mock.calls.length, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("starts split backend and web processes with one ownership nonce and drains each", async () => {
    const root = mkdtempSync(join(tmpdir(), "split-dashboard-"));
    const frontendOwnerFile = join(root, "frontend-owner");
    const backend = await start(BACKEND, { mode: "backend", frontendOwnerFile });
    let web: Awaited<ReturnType<typeof start>> | undefined;
    try {
      await waitUntil(() => existsSync(frontendOwnerFile));
      assert.equal(backend.children.length, 1);
      const backendNonce = (mocks.spawn.mock.calls[0][2] as SpawnOptions).env?.[DASHBOARD_LAUNCH_NONCE_ENV];
      assert.equal((mocks.spawn.mock.calls[0][2] as SpawnOptions).env?.RELAY_DEV_DEBUG_MIRROR, "1");
      web = await start(BACKEND, { mode: "web", frontendOwnerFile });
      await waitUntil(() => web!.output.join("").includes("frontend-started"));
      assert.equal(web.children.length, 1);
      assert.equal((mocks.spawn.mock.calls[0][2] as SpawnOptions).env?.[DASHBOARD_LAUNCH_NONCE_ENV], backendNonce);
      web.signals.emit("SIGINT");
      assert.equal(await web.done, 0);
      backend.signals.emit("SIGINT");
      assert.equal(await backend.done, 0);
      assert.equal(existsSync(frontendOwnerFile), false);
    } finally {
      for (const run of [backend, web]) run?.children.forEach(child => { if (child.exitCode === null) child.kill("SIGKILL"); });
      rmSync(root, { recursive: true, force: true });
    }
  });
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
