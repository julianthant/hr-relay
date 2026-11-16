import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";

const commandId = "738b193e-2d63-463c-9e7f-9f0691b65820";
const otherId = "838b193e-2d63-463c-9e7f-9f0691b65820";
const request = { commandId, requestedAt: "2026-08-03T17:10:00.000Z", requestedBy: "local-operator", source: "dashboard",
  family: "worker-browser", type: "retry-worker", target: { workerId: "person-lookup-1", lifetimeId: null, expectedVersion: 1, workflowId: "person-lookup" } };
const result = { state: "applied", commandId, affectedTargets: [{ family: "worker-browser", workerId: "person-lookup-1" }] };

function clientOver(body: unknown) {
  const calls: { url: string; method: string }[] = [];
  const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  } });
  return { client, calls };
}

describe("worker command readback", () => {
  it("returns the recorded receipt or unavailable by GET alone", async () => {
    const recorded = { state: "recorded", request, result };
    const h = clientOver(recorded);
    assert.deepEqual(await h.client.workerCommandResult(commandId), recorded);
    assert.deepEqual(h.calls, [{ url: `http://bff.test/api/v1/worker-commands/${commandId}`, method: "GET" }]);
    const none = clientOver({ state: "unavailable" });
    assert.deepEqual(await none.client.workerCommandResult(commandId), { state: "unavailable" });
    assert.deepEqual(none.calls.map(call => call.method), ["GET"]);
  });

  it("refuses another command's record, a mismatched result and a pending result", async () => {
    for (const body of [
      { state: "recorded", request: { ...request, commandId: otherId }, result: { ...result, commandId: otherId } },
      { state: "recorded", request, result: { ...result, commandId: otherId } },
      { state: "recorded", request, result: { state: "pending", commandId } },
    ]) {
      const h = clientOver(body);
      await assert.rejects(h.client.workerCommandResult(commandId), (error: unknown) => {
        assert.ok(error instanceof DashboardClientError); assert.equal(error.kind, "schema"); return true;
      });
      assert.equal(h.calls.length, 1);
    }
  });
});
