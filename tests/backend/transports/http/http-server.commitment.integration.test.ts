import assert from "node:assert/strict";
import { request } from "node:http";
import { afterEach, it } from "vitest";
import { Hono } from "hono";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api.js";
import { startDashboardHttpServer, type DashboardHttpListener } from "../../../../src/backend/transports/http/http-server.js";

let server: DashboardHttpListener | undefined;
afterEach(async () => { const owner = server; server = undefined; await owner?.close(); });

it("commits only after actual body finish and allows listener drain outside the completed transfer", async () => {
  const app: DashboardApp = new Hono();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let committed: Promise<void> | undefined;
  let finished = false;
  app.post("/", async c => {
    await c.req.json();
    const response = new Response(new ReadableStream<Uint8Array>({ start(value) {
      controller = value; value.enqueue(new Uint8Array([1]));
    } }));
    assert.ok(server);
    committed = server.committedResponse(response).then(() => { finished = true; });
    return response;
  });
  server = await startDashboardHttpServer({ app, port: 0 });
  const response = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "{}" });
  const reader = response.body?.getReader(); assert.ok(reader);
  assert.equal((await reader.read()).done, false);
  assert.equal(finished, false);
  assert.ok(controller); controller.close();
  assert.equal((await reader.read()).done, true); reader.releaseLock();
  assert.ok(committed); await committed;
  assert.equal(finished, true);
  const owner = server; server = undefined;
  await owner.close();
});

it("refuses commitment when a response finishes before the admitted request body is complete", async () => {
  const app: DashboardApp = new Hono();
  let committed: Promise<void> | undefined;
  app.post("/", c => {
    const response = c.json({ state: "refused" }); assert.ok(server);
    committed = server.committedResponse(response);
    void committed.catch(() => undefined);
    return response;
  });
  server = await startDashboardHttpServer({ app, port: 0 });
  const pending = request({ hostname: "127.0.0.1", port: server.port, method: "POST", headers: { "content-length": "100" } });
  pending.on("error", () => undefined);
  try {
    const response = new Promise<void>(resolve => { pending.once("response", value => { value.resume(); value.once("end", resolve); }); });
    pending.write("{");
    await response;
    assert.ok(committed);
    await assert.rejects(committed, error => error instanceof Error && error.message === "dashboard request and response commitment unproved");
  } finally { pending.destroy(); }
});

it("refuses repeated response registrations rather than replacing the original commitment owner", async () => {
  const app: DashboardApp = new Hono();
  let committed: Promise<void> | undefined;
  app.post("/", async c => {
    await c.req.json();
    const response = c.json({ state: "refused" }); assert.ok(server);
    committed = server.committedResponse(response);
    assert.throws(() => server?.committedResponse(response), { message: "dashboard response commitment unavailable" });
    return response;
  });
  server = await startDashboardHttpServer({ app, port: 0 });
  const response = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "{}" });
  await response.arrayBuffer(); assert.ok(committed); await committed;
});

it("commits a genuinely ended GET request without a request-body consumer", async () => {
  const app: DashboardApp = new Hono();
  let committed: Promise<void> | undefined;
  app.get("/", c => {
    const response = c.json({ state: "complete" }); assert.ok(server);
    committed = server.committedResponse(response);
    return response;
  });
  server = await startDashboardHttpServer({ app, port: 0 });
  const response = await fetch(`http://127.0.0.1:${server.port}/`);
  await response.arrayBuffer(); assert.ok(committed); await committed;
});

it("settles an owned partial GET request on issued shutdown before entering the route", async () => {
  const app: DashboardApp = new Hono();
  let entered = 0, responses = 0;
  const observed: Error[] = [];
  app.get("/", c => { entered++; return c.json({ state: "complete" }); });
  server = await startDashboardHttpServer({ app, port: 0, onTransferError: error => { observed.push(error); } });
  const pending = request({ hostname: "127.0.0.1", port: server.port, method: "GET",
    headers: { "content-length": "2", expect: "100-continue" } });
  const continued = new Promise<void>((resolve, reject) => { pending.once("continue", resolve); pending.once("error", reject); });
  const failed = new Promise<Error>(resolve => { pending.once("error", resolve); });
  const socketClosed = new Promise<void>(resolve => { pending.once("socket", socket => { socket.once("close", () => resolve()); }); });
  pending.on("response", response => { responses++; response.resume(); });
  try {
    pending.flushHeaders(); await continued;
    await new Promise<void>((resolve, reject) => { pending.write("{", error => error === null || error === undefined ? resolve() : reject(error)); });
    assert.equal(entered, 0); assert.equal(responses, 0);
    const owner = server; server = undefined; await owner.close();
    const failure = await failed;
    assert.equal(Reflect.get(failure, "code"), "ECONNRESET");
    await socketClosed;
    assert.equal(entered, 0); assert.equal(responses, 0); assert.deepEqual(observed, []);
  } finally { pending.destroy(); }
});
