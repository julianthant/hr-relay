import assert from "node:assert/strict";
import { it } from "vitest";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { createQueueQueries } from "../../../../src/dashboard/client/queries/queue-queries.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";
import { createClientDayFixtures } from "../../../support/helpers/dashboard/client-day-fixtures.js";

it("refuses a valid day document belonging to a different requested day", async () => {
  const { dayOf } = createClientDayFixtures("2026-08-03", "d".repeat(64));
  const transport = createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: async () => new Response(JSON.stringify(dayOf([], "pc:1")), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(createQueueQueries(transport).dashboardDay("2026-08-04"), /day-request-identity-mismatch/);
  assert.equal((await createQueueQueries(transport).dashboardDay("2026-08-03")).day, "2026-08-03");
});

it("asks again when the server answers a retryable 503, and fails on the third or on any other refusal", async () => {
  const { dayOf } = createClientDayFixtures("2026-08-03", "d".repeat(64));
  const refusal = (retryable: boolean) => new Response(JSON.stringify({ state: "error", code: "STORAGE_SNAPSHOT_CHANGED", message: "changed", retryable }),
    { status: 503, headers: { "content-type": "application/json" } });
  const day = () => new Response(JSON.stringify(dayOf([], "pc:1")), { headers: { "content-type": "application/json" } });
  const served = (responses: (() => Response)[]) => {
    let calls = 0;
    const transport = createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: async () => { const next = responses[Math.min(calls, responses.length - 1)]; calls += 1; return next(); } });
    return { queries: createQueueQueries(transport), calls: () => calls };
  };

  const recovers = served([() => refusal(true), () => refusal(true), day]);
  assert.equal((await recovers.queries.dashboardDay("2026-08-03")).day, "2026-08-03");
  assert.equal(recovers.calls(), 3);

  const persists = served([() => refusal(true)]);
  await assert.rejects(persists.queries.dashboardDay("2026-08-03"), (error: unknown) => error instanceof DashboardClientError && error.status === 503);
  assert.equal(persists.calls(), 3);

  const refused = served([() => refusal(false), day]);
  await assert.rejects(refused.queries.dashboardDay("2026-08-03"), (error: unknown) => error instanceof DashboardClientError && error.status === 503);
  assert.equal(refused.calls(), 1);
});
