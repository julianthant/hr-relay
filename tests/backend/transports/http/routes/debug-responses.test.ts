import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it } from "vitest";
import { z } from "zod";
import { registerDebugResponses } from "../../../../../src/backend/transports/http/routes/debug-responses.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import type { ActorId } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { debugTimelineFixture } from "../../../../support/helpers/backend/debug-timeline-fixture.js";

function fixture(failAppend = false) {
  const { records, repository } = debugTimelineFixture();
  const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
  registerDebugResponses(app, createDebugEventWriter({ repository: failAppend ? { ...repository, append() { throw new Error("append-failed"); } } : repository,
    clock: manualClock(new Date("2026-11-03T00:00:00.000Z")), build: "test" }));
  app.onError((_error, c) => c.json({ state: "error", code: "DASHBOARD_READ_FAILED", message: "PRIVATE_NAME" }, 500));
  app.get("/api/v1/runs/:runId", c => c.json({ state: "refused", code: "PROFILE_SESSION_STALE",
    message: "PRIVATE_NAME", eid: "PRIVATE_EID", password: "PRIVATE_CREDENTIAL" }, 409));
  app.get("/thrown", () => { throw new Error("PRIVATE_PAGE_TEXT"); });
  app.get("/unknown", c => c.json({ state: "unknown", actionId: "PRIVATE_ACTION" }));
  app.get("/ok", c => c.json({ state: "applied" }));
  app.get("/confirm", c => c.json({ state: "confirmation-required" }));
  app.get("/binary", () => new Response("PRIVATE_BODY", { status: 503 }));
  app.get("/malformed", () => new Response("PRIVATE_BODY", { headers: { "content-type": "application/json" } }));
  app.get("/attachment", () => new Response("PRIVATE_BODY", { headers: { "content-type": "application/json", "content-disposition": "attachment; filename=private.json" } }));
  return { app, records };
}

describe("HTTP terminal diagnostics", () => {
  it.each(["/api/v1/runs/PRIVATE_NAME", "/thrown", "/unknown", "/binary", "/malformed"])("records %s once without response or request values", async path => {
    const { app, records } = fixture();
    const response = await app.request(path);
    assert.equal(response.status, path === "/unknown" || path === "/malformed" ? 200 : path === "/binary" ? 503 : path === "/thrown" ? 500 : 409);
    assert.equal(records.length, 1);
    assert.equal(JSON.stringify(records).includes("PRIVATE_"), false);
    assert.equal(records[0].payload.kind, "debug");
    if (records[0].payload.kind !== "debug") assert.fail("expected debug event");
    assert.equal(records[0].payload.event.area, "request");
    if (path.startsWith("/api/")) assert.equal(records[0].payload.event.route, "/api/v1/runs/:runId");
  });
  it("leaves successful and confirmation results alone", async () => {
    const { app, records } = fixture();
    assert.equal((await app.request("/ok")).status, 200);
    assert.equal((await app.request("/confirm")).status, 200);
    assert.equal((await app.request("/attachment")).status, 200);
    assert.deepEqual(records, []);
  });
  it("fails loud when persistence fails", async () => {
    const { app, records } = fixture(true);
    const response = await app.request("/unknown");
    assert.equal(response.status, 500);
    assert.equal(z.object({ code: z.string() }).parse(await response.json()).code, "LOGGING_UNAVAILABLE");
    assert.deepEqual(records, []);
  });
});
