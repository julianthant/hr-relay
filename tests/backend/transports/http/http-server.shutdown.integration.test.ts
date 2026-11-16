import assert from "node:assert/strict";
import { request, type IncomingMessage } from "node:http";
import { Hono } from "hono";
import { it } from "vitest";
import { startDashboardHttpServer } from "../../../../src/backend/transports/http/http-server.js";
import type { ActorId } from "../../../../src/rules/identity/ids.js";

function contains(error: unknown, expected: unknown): boolean {
  return error === expected || error instanceof AggregateError && error.errors.some((value: unknown) => contains(value, expected));
}

for (const observer of ["absent", "records", "throws"] as const) for (const fails of [false, true]) it(`settles a disconnect-first mounted tab (observer ${observer}, cancellation fails ${fails}) before deciding custody`, async () => {
  const cancelled = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), first = Promise.withResolvers<void>();
  const primary = new Error("fixture owned stream cancellation failed"), observerFailure = new Error("fixture transfer observer failed"), diagnostics: Error[] = [];
  const base = new Hono<{ Variables: { requestActorId: ActorId } }>(); base.get("/health", c => c.body(null, 204));
  const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
  app.get("/tab", () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1])); },
    async cancel() { cancelled.resolve(); await release.promise; if (fails) throw primary; },
  }), { headers: { "content-type": "text/event-stream" } }));
  const server = await startDashboardHttpServer({ app: base, port: 0, ...(observer !== "absent" ? { onTransferError: (error: Error) => { diagnostics.push(error); if (observer === "throws") throw observerFailure; } } : {}) });
  const mount = server.mount(app, value => new URL(value.url).pathname === "/tab");
  const response = Promise.withResolvers<IncomingMessage>();
  const client = request(`http://127.0.0.1:${server.port}/tab`, response.resolve);
  const clientErrors: Error[] = []; client.on("error", error => { clientErrors.push(error); response.reject(error); }); client.end();
  let closed = false;
  try {
    const incoming = await response.promise;
    incoming.on("error", error => clientErrors.push(error)); incoming.once("data", () => { incoming.pause(); first.resolve(); });
    await first.promise; incoming.destroy(); await cancelled.promise;
    let terminal = false;
    const closing = mount.close();
    const outcome = closing.then(() => { terminal = true; return undefined; }, (error: unknown) => { terminal = true; return error; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(terminal, false);
    release.resolve(); const result = await outcome;
    if (fails || observer === "throws") {
      const expected = fails ? primary : observerFailure;
      assert.ok(contains(result, expected), "original unclosed-resource failure must survive");
      if (observer === "throws") assert.ok(contains(result, observerFailure));
      assert.equal(mount.close(), closing);
      await assert.rejects(server.close(), error => contains(error, expected)); closed = true;
    } else {
      assert.equal(result, undefined, "fulfilled body cancellation proves closure despite the earlier client disconnect");
      const health = await fetch(`http://127.0.0.1:${server.port}/health`); assert.equal(health.status, 204); await health.arrayBuffer();
      await server.close(); closed = true;
    }
    if (observer !== "absent") {
      assert.equal(diagnostics.length, 1);
      if (fails) assert.ok(contains(diagnostics[0], primary));
      else assert.match(diagnostics[0]?.message ?? "", /^dashboard response closed/u);
    }
  } finally {
    release.resolve(); client.destroy();
    if (!closed) {
      if (fails || observer === "throws") await assert.rejects(server.close(), error => contains(error, fails ? primary : observerFailure));
      else await server.close();
    }
  }
});
