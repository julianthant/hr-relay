import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerAssistantRoutes } from "../../../../../src/backend/transports/http/routes/assistant.js";

it("guards loopback/origin/media before body or inference and bounds request bytes", async () => {
  const app: DashboardApp = new Hono(); let calls = 0;
  registerAssistantRoutes(app, { async respond() { calls++; return { state: "answered", text: "Synthetic", citations: [] }; } });
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" };
  for (const patch of [{ origin: "https://foreign.example" }, { host: "foreign.example" }, { "content-type": "text/plain" }]) {
    const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: { ...headers, ...patch }, body: "{}" });
    assert.ok(response.status === 403 || response.status === 415);
  }
  assert.equal(calls, 0);
  for (const body of ["malformed", JSON.stringify({ message: "x".repeat(20_001) })]) {
    const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body: JSON.stringify({ message: "Explain" }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
});
it("never exposes a thrown service error through framework logs or response", async () => {
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error("CANARY_PRIVATE_SERVICE_ERROR"); } });
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: {
    host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json",
  }, body: JSON.stringify({ message: "Explain" }) });
  assert.equal(response.status, 400); assert.equal((await response.text()).includes("CANARY_PRIVATE_SERVICE_ERROR"), false);
});
