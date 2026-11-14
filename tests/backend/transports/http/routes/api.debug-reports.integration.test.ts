import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import type { DashboardErrorReport } from "../../../../../src/models/events/debug-report.js";
import { resolutionApp, resolutionFixture } from "../../../../support/helpers/failure-resolution/fixtures.js";

it("links a dashboard report to a known run and leaves absent run identities unlinked", async () => {
  const f = await resolutionFixture();
  try {
    const app = resolutionApp(f);
    for (const runId of [f.run.envelope.runId, undefined, randomUUID()]) {
      const reportId = randomUUID();
      const response = await app.request("http://localhost/api/v1/debug/errors", {
        method: "POST", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ reportId, clientId: "browser", release: "test", route: "/", surface: "app",
          code: "DASHBOARD_UNHANDLED_ERROR", message: "Synthetic failure", ...(runId === undefined ? {} : { runId }) }),
      });
      assert.equal(response.status, 201, await response.text());
      const record = f.db.authority.timelineEvents.page({}).find(row => row.payload.kind === "debug" && row.payload.event.correlationId === reportId);
      assert.ok(record);
      if (runId === f.run.envelope.runId) {
        assert.deepEqual(record.scope, { kind: "run", runId });
        assert.equal(record.workflow, "person-lookup");
        assert.ok(f.db.authority.timelineEvents.page({ runId }).some(row => row.eventId === record.eventId));
      } else {
        assert.deepEqual(record.scope, { kind: "client", clientId: "browser" });
        assert.equal(record.workflow, undefined);
        assert.equal(f.db.authority.timelineEvents.page({ runId: f.run.envelope.runId }).some(row => row.eventId === record.eventId), false);
      }
    }
  } finally { await f.dispose(); }
});

it("forwards the currently open run through the typed client's report path", async () => {
  const f = await resolutionFixture();
  try {
    const app = resolutionApp(f);
    let openRunId: DashboardErrorReport["runId"] = f.run.envelope.runId;
    const client = createDashboardClient({ baseUrl: "http://localhost", runId: () => openRunId,
      fetchImpl: async (url, init) => url.endsWith("/profile/state")
        ? Response.json({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready" })
        : app.request(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), host: "localhost", origin: "http://localhost" } }),
    });
    await client.readProfileSession();
    for (const runId of [f.run.envelope.runId, undefined]) {
      openRunId = runId;
      const reportId = randomUUID();
      await client.reportError({ reportId, clientId: "browser", release: "test", route: "/", surface: "app",
        code: "DASHBOARD_UNHANDLED_ERROR", message: "Synthetic failure" });
      const record = f.db.authority.timelineEvents.page({}).find(row => row.payload.kind === "debug" && row.payload.event.correlationId === reportId);
      assert.ok(record);
      assert.deepEqual(record.scope, runId === undefined ? { kind: "client", clientId: "browser" } : { kind: "run", runId });
    }
  } finally { await f.dispose(); }
});
