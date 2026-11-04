import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, vi } from "vitest";
import { runRelayCommand, startRelay, stopRelay } from "../../../scripts/dev/relay.js";
import { testProcessImport } from "../../support/compiled-process.js";
import { createPrivateDirectory, writePrivateStage } from "../../../src/backend/storage/private-path.js";
import { observeProcessIdentity } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";

async function fixture(mode = "clean") {
  const root = mkdtempSync(join(tmpdir(), "relay-launcher-"));
  const directory = join(root, "launcher");
  const signals = new EventEmitter();
  const output: string[] = [];
  const errors: string[] = [];
  if (mode === "stale") {
    createPrivateDirectory(directory, { mode: 0o700 });
    const old = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] });
    assert.ok(old.pid);
    const identity = observeProcessIdentity(old.pid); assert.ok(identity.state === "alive");
    old.stdin.end(); await new Promise<void>(resolve => { old.once("close", () => { resolve(); }); });
    writePrivateStage(join(directory, "broker.json"), Buffer.from(JSON.stringify({ port: 1, token: randomBytes(32).toString("hex"), pid: old.pid, identity: identity.identity })));
    writeFileSync(join(directory, "keep"), "unrelated");
  }
  if (mode === "partial-stage") {
    createPrivateDirectory(directory, { mode: 0o700 });
    writePrivateStage(join(directory, "broker.interrupted.stage"), Buffer.from("{"));
  }
  const running = startRelay({ directory, signals, prepare: async () => undefined,
    backendArguments: ["--import", testProcessImport(), fileURLToPath(new URL("../../support/processes/relay-drain-child.ts", import.meta.url)), root, mode],
    openWindow: async () => { output.push("opened"); if (mode === "window-failure") throw new Error("relay-microsoft-edge-not-found"); },
    write: message => { output.push(message); }, writeError: message => { errors.push(message); },
  });
  await vi.waitFor(() => { assert.ok(mode === "disconnected" ? existsSync(join(root, "draining")) : output.includes("opened")); });
  return { root, directory, signals, output, errors, running,
    release: () => { writeFileSync(join(root, "release"), "release"); },
    async close() {
      signals.emit("SIGTERM"); writeFileSync(join(root, "release"), "release");
      await running; rmSync(root, { recursive: true, force: true });
    },
  };
}

it("authenticates a separate stop command, waits through a write, and absorbs repeated stops", async () => {
  const run = await fixture();
  try {
    const broker: unknown = JSON.parse(readFileSync(join(run.directory, "broker.json"), "utf8"));
    assert.ok(typeof broker === "object" && broker !== null && "port" in broker && typeof broker.port === "number");
    const port = broker.port;
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("error", reject); socket.once("close", () => { resolve(); });
      socket.once("connect", () => { socket.write(`${JSON.stringify({ action: "stop", nonce: randomBytes(32).toString("hex"), proof: "0".repeat(64) })}\n`); });
    });
    assert.equal(existsSync(join(run.root, "draining")), false);
    assert.equal(await startRelay({ directory: run.directory, prepare: async () => { throw new Error("must not start"); } }), 0);
    assert.equal(run.output.filter(value => value === "opened").length, 2);
    let settled = false;
    const stopping = stopRelay(run.directory).then(result => { settled = true; return result; });
    await vi.waitFor(() => { assert.ok(existsSync(join(run.root, "draining"))); });
    const repeated = stopRelay(run.directory);
    run.signals.emit("SIGINT");
    assert.equal(settled, false);
    assert.equal(existsSync(join(run.root, "committed")), false);
    run.release();
    assert.deepEqual(await stopping, { type: "relay-dashboard-stopped", state: "clean" });
    assert.deepEqual(await repeated, { type: "relay-dashboard-stopped", state: "clean" });
    assert.equal(await run.running, 0);
    assert.equal(readFileSync(join(run.root, "committed"), "utf8"), "drained and synced");
    assert.equal(existsSync(join(run.directory, "broker.json")), false);
    assert.equal(run.signals.listenerCount("SIGINT"), 0);
    assert.equal(run.signals.listenerCount("SIGTERM"), 0);
  } finally { await run.close(); }
});

it.each(["failed", "silent"])("refuses success when backend stop is %s", async mode => {
  const run = await fixture(mode);
  try {
    const stopping = assert.rejects(stopRelay(run.directory), /did not prove a clean backend stop/u);
    await vi.waitFor(() => { assert.ok(existsSync(join(run.root, "draining"))); });
    run.release();
    await stopping;
    assert.equal(await run.running, 1);
    assert.equal(existsSync(join(run.directory, "broker.json")), false);
  } finally { await run.close(); }
});

it("reports backup unavailability quietly after checked child closure", async () => {
  const run = await fixture("backup-unavailable");
  try {
    const stopping = stopRelay(run.directory);
    await vi.waitFor(() => { assert.ok(existsSync(join(run.root, "draining"))); });
    run.release();
    assert.deepEqual(await stopping, { type: "relay-dashboard-stopped", state: "backup-unavailable" });
    assert.equal(await run.running, 0);
    assert.ok(run.output.includes("Relay stopped. Windows backups are unavailable."));
  } finally { await run.close(); }
});

it("drains when the parent channel disappears before readiness", async () => {
  const run = await fixture("disconnected");
  try {
    assert.equal(existsSync(join(run.root, "committed")), false);
    run.release();
    assert.equal(await run.running, 1, "a missing parent receipt remains unproved even when the drain completes");
    assert.equal(readFileSync(join(run.root, "committed"), "utf8"), "drained and synced");
    assert.equal(existsSync(join(run.directory, "broker.json")), false);
  } finally { await run.close(); }
});

it("closes the broker and removes only its capability if preparation fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-preparation-"));
  const directory = join(root, "launcher");
  createPrivateDirectory(directory, { mode: 0o700 });
  writeFileSync(join(directory, "keep"), "unrelated");
  const signals = new EventEmitter();
  try {
    await assert.rejects(startRelay({ directory, signals, prepare: async () => { throw new Error("preparation refused"); } }), /preparation refused/u);
    assert.equal(existsSync(join(directory, "broker.json")), false);
    assert.equal(readFileSync(join(directory, "keep"), "utf8"), "unrelated");
    assert.equal(signals.listenerCount("SIGTERM"), 0);
    await assert.rejects(stopRelay(directory), /not-running/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("refuses a stop receipt from a backend that never reached readiness", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-early-stop-"));
  const directory = join(root, "launcher");
  try {
    assert.equal(await startRelay({ directory, signals: new EventEmitter(), prepare: async () => undefined,
      backendArguments: ["-e", "process.send({type:'relay-dashboard-stopped',state:'clean'},()=>process.disconnect());"],
      openWindow: async () => { throw new Error("unready backend must not open a window"); }, write: () => undefined,
    }), 1);
    assert.equal(existsSync(join(directory, "broker.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(["proof", "nonce"])("rejects a forged stop receipt with the wrong %s", async mismatch => {
  const root = mkdtempSync(join(tmpdir(), "relay-forged-receipt-"));
  const directory = join(root, "launcher");
  createPrivateDirectory(directory, { mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  let captured = "";
  const server = createServer(socket => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      captured += chunk;
      if (!captured.endsWith("\n")) return;
      const request: unknown = JSON.parse(captured);
      assert.ok(typeof request === "object" && request !== null && "nonce" in request && typeof request.nonce === "string");
      const nonce = mismatch === "nonce" ? randomBytes(32).toString("hex") : request.nonce;
      const result = { type: "relay-dashboard-stopped", state: "clean" };
      const proof = mismatch === "proof" ? "0".repeat(64)
        : createHmac("sha256", Buffer.from(token, "hex")).update(JSON.stringify(["relay-result", "stop", nonce, result])).digest("hex");
      socket.end(`${JSON.stringify({ nonce, proof, result })}\n`);
    });
  });
  try {
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); const self = observeProcessIdentity(process.pid);
    assert.ok(address !== null && typeof address !== "string" && self.state === "alive");
    writePrivateStage(join(directory, "broker.json"), Buffer.from(JSON.stringify({ port: address.port, token, pid: process.pid, identity: self.identity })));
    await assert.rejects(stopRelay(directory), /response-unauthenticated/u);
    assert.equal(captured.includes(token), false, "the private capability never crosses the socket");
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); });
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["stale", "partial-stage"])("starts past an owned %s publication without touching other files", async mode => {
  const run = await fixture(mode);
  try {
    if (mode === "stale") assert.equal(readFileSync(join(run.directory, "keep"), "utf8"), "unrelated");
    else assert.equal(readFileSync(join(run.directory, "broker.interrupted.stage"), "utf8"), "{");
    const stopping = stopRelay(run.directory);
    await vi.waitFor(() => { assert.ok(existsSync(join(run.root, "draining"))); });
    run.release(); await stopping;
    assert.equal(await run.running, 0);
  } finally { await run.close(); }
});

it("explains a window failure while retaining proof of a clean backend stop", async () => {
  const run = await fixture("window-failure");
  try {
    await vi.waitFor(() => { assert.ok(existsSync(join(run.root, "draining"))); });
    run.release();
    assert.equal(await run.running, 1);
    assert.ok(run.errors.some(reason => reason.includes("Microsoft Edge was not found")));
    assert.ok(run.output.includes("Relay backend stopped cleanly; the app window could not open."));
    assert.equal(run.errors.some(reason => reason.includes("did not complete a verified clean stop")), false);
  } finally { await run.close(); }
});

it("formats a top-level command failure as one public line without a stack or secret", async () => {
  const errors: string[] = [];
  assert.equal(await runRelayCommand(["invalid-command-with-private-value"], { writeError: reason => { errors.push(reason); } }), 1);
  assert.deepEqual(errors, ["Usage: relay.cmd [start|stop]"]);
});

it("names an invalid control file without discarding an unproved owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-invalid-control-")), directory = join(root, "launcher");
  createPrivateDirectory(directory, { mode: 0o700 });
  writePrivateStage(join(directory, "broker.json"), Buffer.from("{"));
  const errors: string[] = [];
  try {
    assert.equal(await runRelayCommand([], { directory, writeError: reason => { errors.push(reason); } }), 1);
    assert.deepEqual(errors, ["The private launcher control file is invalid. Preserve the folder and report this error."]);
    assert.equal(readFileSync(join(directory, "broker.json"), "utf8"), "{");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("publishes one complete owner when two launchers race, without overwriting the winner", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-publication-race-"));
  const directory = join(root, "launcher"), signals = new EventEmitter();
  let winner: Buffer | undefined;
  let prepare: (() => void) | undefined;
  const prepared = new Promise<void>(resolve => { prepare = resolve; });
  const argumentsForChild = ["--import", testProcessImport(), fileURLToPath(new URL("../../support/processes/relay-drain-child.ts", import.meta.url)), root, "clean"];
  const first = startRelay({ directory, signals, backendArguments: argumentsForChild, openWindow: async () => undefined,
    prepare: () => { winner = readFileSync(join(directory, "broker.json")); return prepared; }, write: () => undefined,
  });
  const second = startRelay({ directory, signals: new EventEmitter(), backendArguments: argumentsForChild,
    prepare: async () => { throw new Error("losing publisher must not start a backend"); }, openWindow: async () => undefined, write: () => undefined,
  });
  try {
    await assert.rejects(second, error => error instanceof Error && (error.message === "relay-launcher-publication-failed" || "code" in error && error.code === "EEXIST"));
    assert.ok(winner); assert.equal(readFileSync(join(directory, "broker.json")).equals(winner), true);
  } finally {
    prepare?.(); signals.emit("SIGTERM"); writeFileSync(join(root, "release"), "release");
    assert.equal(await first, 0); rmSync(root, { recursive: true, force: true });
  }
});
