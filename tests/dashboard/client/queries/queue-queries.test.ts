import assert from "node:assert/strict";
import { it } from "vitest";
import { createQueueQueries } from "../../../../src/dashboard/client/queries/queue-queries.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";
import { createClientDayFixtures } from "../../../support/helpers/dashboard/client-day-fixtures.js";

it("refuses a valid day document belonging to a different requested day", async () => {
  const { dayOf } = createClientDayFixtures("2026-08-03", "d".repeat(64));
  const transport = createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: async () => new Response(JSON.stringify(dayOf([], "pc:1")), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(createQueueQueries(transport).dashboardDay("2026-08-04"), /day-request-identity-mismatch/);
  assert.equal((await createQueueQueries(transport).dashboardDay("2026-08-03")).day, "2026-08-03");
});
