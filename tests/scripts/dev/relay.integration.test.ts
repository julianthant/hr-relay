import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, vi } from "vitest";
import { startRelay, stopRelay } from "../../../scripts/dev/relay.js";
import { testProcessImport } from "../../support/compiled-process.js";
import { createPrivateDirectory, writePrivateStage } from "../../../src/backend/storage/private-path.js";
import { observeProcessIdentity } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";

async function fixture(mode = "clean") {
  const root = mkdtempSync(join(tmpdir(), "relay-launcher-"));
  const directory = join(root, "launcher");
  const signals = new EventEmitter();
  const output: string[] = [];
  const running = startRelay({ directory, signals, prepare: async () => undefined,
    backendArguments: ["--import", testProcessImport(), fileURLToPath(new URL("../../support/processes/relay-backend.ts", import.meta.url)), root, mode],
    openWindow: async () => { output.push("opened"); }, write: message => { output.push(message); },
  });
  await vi.waitFor(() => { assert.ok(mode === "disconnected" ? existsSync(join(root, "draining")) : output.includes("opened")); });
  return { root, directory, signals, output, running,
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
      socket.once("connect", () => { socket.write(`${JSON.stringify({ action: "stop", token: "0".repeat(64) })}\n`); });
    });
    assert.equal(existsSync(join(run.root, "draining")), false);
    await assert.rejects(startRelay({ directory: run.directory, prepare: async () => { throw new Error("must not start"); } }), /already-running/u);
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
    const stopping = assert.rejects(stopRelay(run.directory), /closure-unproved/u);
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
        : createHmac("sha256", Buffer.from(token, "hex")).update(JSON.stringify(["relay-stopped", nonce, result])).digest("hex");
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
