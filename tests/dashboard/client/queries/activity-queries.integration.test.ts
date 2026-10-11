import assert from "node:assert/strict";
import { afterEach,it } from "vitest";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { createActivityQueries } from "../../../../src/dashboard/client/queries/activity-queries.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});

it("propagates a locally cancelled Activity request without accepting a replacement response", async () => {
  let observedSignal: AbortSignal | undefined;
  const client = createActivityQueries(createDashboardTransport({
    baseUrl: "http://localhost",
    fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener("abort", () => reject(new DOMException("request cancelled", "AbortError")), { once: true });
    }),
  }));
  const controller = new AbortController();
  const request = client.activityReport("2026-09-20", "2026-09-20", controller.signal);
  controller.abort();
  await assert.rejects(request, (error: unknown) => error instanceof DashboardClientError
    && error.kind === "network" && error.retryable);
  assert.equal(observedSignal, controller.signal);
  assert.equal(controller.signal.aborted, true);
});
