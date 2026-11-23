import assert from "node:assert/strict";
import { request, type IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { it } from "vitest";
import { startDashboardHttpServer } from "../../../../src/backend/transports/http/http-server.js";
import type { ActorId } from "../../../../src/rules/identity/ids.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";
import { fillDiagnosticBudget } from "../../../support/helpers/backend/full-diagnostic-budget.js";
import { TimelineDiagnosticBudgetError } from "../../../../src/models/events/timeline.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

function contains(error: unknown, expected: unknown): boolean {
  return error === expected || error instanceof AggregateError && error.errors.some((value: unknown) => contains(value, expected));
}

it("closes a selected mount after a slow successful response at diagnostic capacity", async () => {
  const f = await foundationFixture();
  try {
    const timeline = f.db.authority.timelineEvents;
    fillDiagnosticBudget(DatabaseSync, f.path, timeline, f.clock);
    const before = timeline.highWaterMark();
    const writer = createDebugEventWriter({ repository: timeline, clock: f.clock, build: "test" });
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    app.get("/slow", c => { f.clock.advanceMonotonic(501); return c.text("ok"); });
    const server = await startDashboardHttpServer({ app, port: 0 });
    let attempts = 0;
    try {
      const mount = server.mount(app, () => true, { clock: f.clock, debugEvents: { emit(input) { attempts++; writer.emit(input); } } });
      const response = await fetch(`http://127.0.0.1:${server.port}/slow`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "ok");
      await mount.close();
      assert.equal(attempts, 1);
      assert.equal(timeline.highWaterMark(), before);
    } finally { await server.close(); }
  } finally { await f.dispose(); }
});

it.each([
  { status: 200 as const, failure: new Error("timing writer unavailable") },
  { status: 503 as const, failure: new TimelineDiagnosticBudgetError() },
])("retains the timing write failure for a mounted HTTP $status", async ({ status, failure }) => {
  const clock = manualClock(new Date("2026-01-01T00:00:00Z"));
  const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
  app.get("/slow", c => { clock.advanceMonotonic(501); return c.text("complete", status); });
  const server = await startDashboardHttpServer({ app, port: 0 });
  try {
    const mount = server.mount(app, () => true, { clock, debugEvents: { emit() { throw failure; } } });
    const response = await fetch(`http://127.0.0.1:${server.port}/slow`);
    assert.equal(response.status, status);
    assert.equal(await response.text(), "complete");
    await assert.rejects(mount.close(), error => contains(error, failure));
  } finally { await assert.rejects(server.close(), error => contains(error, failure)); }
});

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

// Select the unchanged schema-39 sweep case in task CI.
