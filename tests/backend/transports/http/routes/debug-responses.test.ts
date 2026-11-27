import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it, vi } from "vitest";
import { z } from "zod";
import { registerDebugResponses } from "../../../../../src/backend/transports/http/routes/debug-responses.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import type { ActorId } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { debugTimelineFixture } from "../../../../support/helpers/backend/debug-timeline-fixture.js";

function fixture(failAppend = false, lines?: string[]) {
  const { records, repository } = debugTimelineFixture();
  const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
  registerDebugResponses(app, createDebugEventWriter({ repository: failAppend ? { ...repository, append() { throw new Error("append-failed"); } } : repository,
    clock: manualClock(new Date("2026-11-03T00:00:00.000Z")), build: "test",
    ...(lines === undefined ? {} : { development: true, writeStderr: (line: string) => { lines.push(line); } }) }));
  app.onError((_error, c) => c.json({ state: "error", code: "DASHBOARD_READ_FAILED", message: "PRIVATE_NAME" }, 500));
  app.get("/api/v1/runs/:runId", c => c.json({ state: "refused", code: "PROFILE_SESSION_STALE",
    message: "PRIVATE_NAME", eid: "PRIVATE_EID", password: "PRIVATE_CREDENTIAL" }, 409));
  app.get("/thrown", () => { throw new Error("PRIVATE_PAGE_TEXT"); });
  app.post("/unknown", c => c.json({ state: "unknown", actionId: "PRIVATE_ACTION" }));
  app.get("/api/v1/preflight", c => c.json({ state: "unavailable", code: "PREFLIGHT_READ_FAILED", reason: "PRIVATE_NAME" }));
  app.get("/ok", c => c.json({ state: "applied" }));
  app.get("/confirm", c => c.json({ state: "confirmation-required" }));
  app.get("/binary", () => new Response("PRIVATE_BODY", { status: 503 }));
  app.get("/malformed", () => new Response("PRIVATE_BODY", { status: 502, headers: { "content-type": "application/json" } }));
  app.get("/attachment", () => new Response("PRIVATE_BODY", { headers: { "content-type": "application/json", "content-disposition": "attachment; filename=private.json" } }));
  return { app, records };
}

describe("HTTP terminal diagnostics", () => {
  it("mirrors the registered template while excluding incoming path, query and response values", async () => {
    const lines: string[] = []; const { app } = fixture(false, lines);
    await app.request("/api/v1/runs/PRIVATE_PATH_CANARY?token=PRIVATE_QUERY_CANARY");
    assert.equal(lines.length, 1);
    const mirror = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(mirror.method, "GET"); assert.equal(mirror.route, "/api/v1/runs/:runId"); assert.equal(mirror.status, 409);
    assert.equal(lines.join("").includes("PRIVATE_"), false);
  });
  it.each([
    { path: "/api/v1/runs/PRIVATE_NAME", method: "GET", status: 409 },
    { path: "/thrown", method: "GET", status: 500 },
    { path: "/unknown", method: "POST", status: 200 },
    { path: "/api/v1/preflight", method: "GET", status: 200 },
    { path: "/binary", method: "GET", status: 503 },
    { path: "/malformed", method: "GET", status: 502 },
  ])("records $method $path once without response or request values", async ({ path, method, status }) => {
    const { app, records } = fixture();
    const response = await app.request(path, { method });
    assert.equal(response.status, status);
    assert.equal(records.length, 1);
    assert.equal(JSON.stringify(records).includes("PRIVATE_"), false);
    assert.equal(records[0].payload.kind, "debug");
    if (records[0].payload.kind !== "debug") assert.fail("expected debug event");
    assert.equal(records[0].payload.event.area, "request");
    if (status === 409) assert.equal(records[0].payload.event.route, "/api/v1/runs/:runId");
    if (path === "/api/v1/preflight") assert.equal(records[0].payload.event.code, "PREFLIGHT_READ_FAILED");
  });
  it("serves a successful GET without cloning its JSON response", async () => {
    const { app, records } = fixture();
    const body = { state: "unknown", actionId: "PRIVATE_ACTION" };
    const original = Response.json(body);
    const clone = vi.spyOn(original, "clone");
    app.get("/api/v1/explorer", () => original);

    const response = await app.request("/api/v1/explorer");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body);
    assert.equal(clone.mock.calls.length, 0);
    assert.deepEqual(records, []);
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
    const response = await app.request("/unknown", { method: "POST" });
    assert.equal(response.status, 500);
    assert.equal(z.object({ code: z.string() }).parse(await response.json()).code, "LOGGING_UNAVAILABLE");
    assert.deepEqual(records, []);
  });
});
