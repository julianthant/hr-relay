import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Server } from "node:net";
import { it } from "vitest";
import { createIpcRouter, WorkerIpcProtocolError } from "../../../../src/backend/runtime/workers/worker-ipc-router.js";

class Pipe extends EventEmitter {
  disconnected = false;
  disconnect(): void { this.disconnected = true; }
}

it("delivers interleaved lifetime, Nominatim and worker messages to their own family, with handles", () => {
  const endpoint = new Pipe(), invalid: WorkerIpcProtocolError[] = [], seen: string[] = [];
  const router = createIpcRouter(endpoint, error => { invalid.push(error); });
  const handle = { server: true };
  router.register("runtime-lifetime-lock", (message, received) => { seen.push(`lifetime:${message.kind}:${String(received === handle)}`); });
  router.register("nominatim-", message => { seen.push(`nominatim:${message.kind}`); });
  router.register("worker-", message => { seen.push(`worker:${message.kind}`); });
  endpoint.emit("message", { kind: "runtime-lifetime-lock", port: 1 }, handle);
  endpoint.emit("message", { kind: "nominatim-reply", requestId: "r" });
  endpoint.emit("message", { kind: "worker-activity", activity: { state: "idle" } });
  endpoint.emit("message", { kind: "nominatim-request", requestId: "q" });
  endpoint.emit("message", { kind: "worker-reply", requestId: "w" });
  assert.deepEqual(seen, ["lifetime:runtime-lifetime-lock:true", "nominatim:nominatim-reply", "worker:worker-activity",
    "nominatim:nominatim-request", "worker:worker-reply"]);
  assert.deepEqual(invalid, []);
  router.close();
  endpoint.emit("message", { kind: "worker-activity" });
  assert.equal(seen.length, 5);
});

it("disconnects an unowned kind and closes a Server handle no family accepted", () => {
  const endpoint = new Pipe(), invalid: string[] = [];
  const router = createIpcRouter(endpoint, error => { invalid.push(`${error.code}:${error.kind}`); });
  const handle = new Server();
  let closed = false;
  handle.close = () => { closed = true; return handle; };
  router.register("worker-", () => { assert.fail("unowned message reached the worker family"); });
  endpoint.emit("message", { kind: "unknown-family" }, handle);
  endpoint.emit("message", "not an object");
  assert.deepEqual(invalid, ["WORKER_IPC_PROTOCOL_INVALID:unknown-family", "WORKER_IPC_PROTOCOL_INVALID:missing-kind"]);
  assert.equal(endpoint.disconnected, true);
  assert.equal(closed, true);
  router.close();
});

it("refuses overlapping families", () => {
  const router = createIpcRouter(new Pipe(), () => {});
  router.register("worker-", () => {});
  assert.throws(() => { router.register("worker-ready", () => {}); }, /ipc-family-overlaps/u);
  assert.throws(() => { router.register("worker-", () => {}); }, /ipc-family-overlaps/u);
});
