import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it } from "vitest";
import { registerRunDetailRoutes } from "../../../../src/backend/transports/dashboard/routes/run-detail.js";
import { registerTrustRoutes } from "../../../../src/backend/transports/dashboard/routes/trust.js";
import type { DashboardApp } from "../../../../src/backend/transports/dashboard/routes/api-types.js";
import type { RunDetailQueryDeps } from "../../../../src/server/dashboard/queries/run-detail-types.js";

const RUN = "00000000-0000-4000-8000-000000000301";

describe("attempt-history HTTP route", () => {
  it("routes around the generic run-section route and forwards the bounded query", async () => {
    let received: { runId: string; limit: number; cursor: string | undefined } | undefined;
    const runDetail = {
      itemAttemptHistory: {
        read(runId: string, request: { limit: number; cursor?: string }) {
          received = { runId, limit: request.limit, cursor: request.cursor };
          return {
            schemaVersion: 1,
            state: "unavailable",
            selected: { state: "absent", disposition: "absent", runId },
            reason: "run-not-found",
          } as const;
        },
      },
    } as unknown as RunDetailQueryDeps;
    const app = new Hono() as unknown as DashboardApp;
    registerRunDetailRoutes(app, { runDetail });
    registerTrustRoutes(app, { runDetail });

    const response = await app.request(`/api/v1/runs/${RUN}/attempt-history?limit=2&cursor=cursor-token`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      schemaVersion: 1,
      state: "unavailable",
      selected: { state: "absent", disposition: "absent", runId: RUN },
      reason: "run-not-found",
    });
    assert.deepEqual(received, { runId: RUN, limit: 2, cursor: "cursor-token" });
  });
});
