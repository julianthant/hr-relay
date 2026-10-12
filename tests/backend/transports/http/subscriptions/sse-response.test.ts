import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { DashboardStreamConnection } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";

describe("SSE lifecycle settlement", () => {
  it("records connect and one actual close across cancellation races", async () => {
    const events: string[] = [];
    let closed = 0;
    const connection: DashboardStreamConnection = { initial: [], pending: 0,
      next: async () => undefined, close: () => { closed++; } };
    const reader = dashboardEventStreamBody(connection, phase => events.push(phase)).getReader();
    await reader.read(); await reader.cancel();
    assert.deepEqual(events, ["started", "settled"]); assert.equal(closed, 1);
  });
  it("records actual stream failure once and preserves the original error", async () => {
    const events: string[] = [];
    const connection: DashboardStreamConnection = { initial: [], pending: 0,
      next: async () => { throw new Error("stream-error"); }, close: () => {} };
    const reader = dashboardEventStreamBody(connection, phase => events.push(phase)).getReader();
    await assert.rejects(reader.read(), /stream-error/u);
    assert.deepEqual(events, ["started", "failed"]);
  });
});
