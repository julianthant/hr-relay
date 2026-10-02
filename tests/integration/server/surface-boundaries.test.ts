import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it } from "vitest";
import { DESCRIPTORS } from "../../../src/backend/app/control/workflow-registry.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { ActivityReportSelectionSchema } from "../../../src/domain/dashboard/activity-selection.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { composeActivity } from "../../../src/backend/app/dashboard/compose/activity.js";
import { composeQueueSummaries } from "../../../src/backend/app/dashboard/compose/queue-summaries.js";
import { registerActivityRoutes } from "../../../src/backend/transports/dashboard/routes/activity.js";
import { failureStatus } from "../../../src/backend/transports/dashboard/routes/failure-status.js";
import type { DashboardApp } from "../../../src/backend/transports/dashboard/routes/api-types.js";
import { foundationFixture, id, NOW } from "../../helpers/database-foundation/fixtures.js";

/** Real SQLite summary consumers through their independently composed HTTP/read ports. */
describe("composed Activity and Queue boundaries", () => {
  it("serves JSON and CSV from the same bounded Activity query and pages Queue independently", async () => {
    const f = foundationFixture();
    try {
      f.db.withAuthorityTransaction(() => {
        for (let n = 0; n < 7; n += 1) f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
          envelope: { ...f.run.envelope, runId: id(4100 + n), itemId: id(4100 + n), enqueuedAt: NOW },
          lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOW,
        }));
      });
      f.db.readRunSummaries = () => { throw new Error("surface boundary cannot read the whole summary corpus"); };
      const activity = composeActivity({ database: f.db, clock: f.clock,
        descriptors: { resolve: workflowId => DESCRIPTORS.find(row => row.id === workflowId) },
        ledger: createTransactionHistory(f.db.authority),
      });
      const queue = composeQueueSummaries(f.db);
      const app: DashboardApp = new Hono();
      app.onError((error, context) => { const result = failureStatus(error); return context.json(result.body, result.status); });
      registerActivityRoutes(app, { activity });
      const from = "2026-09-09", to = from;
      const expected = activity.read(from, to);
      assert.equal(expected.totalRuns, 7);
      const response = await app.request(`/api/v1/reports/activity?from=${from}&to=${to}`);
      assert.equal(response.status, 200);
      assert.deepEqual(ActivityReportSelectionSchema.parse(await response.json()), expected);
      const csv = await app.request(`/api/v1/reports/activity.csv?${new URLSearchParams({ from, to, snapshot: expected.snapshot.token })}`);
      assert.equal(csv.status, 200);
      assert.equal(csv.headers.get("cache-control"), "no-store");
      assert.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="activity-/u);
      assert.match(await csv.text(), /2026-09-09/u);
      const seen: string[] = [];
      let after: { localDay: string; runId: string } | undefined;
      do {
        const page = queue.withSnapshot(() => queue.queue({ fromDay: from, toDay: to, limit: 2, topLevel: true, ...(after === undefined ? {} : { after }) }));
        assert.ok(page.items.length <= 2);
        seen.push(...page.items.map(row => row.runId));
        after = page.next ?? undefined;
      } while (after !== undefined);
      assert.deepEqual(seen, Array.from({ length: 7 }, (_, n) => id(4100 + n)));
      assert.deepEqual(activity.read(from, to), expected, "Queue reads cannot alter Activity authority or totals");
      for (const path of ["/api/v1/reports/activity", "/api/v1/reports/activity.csv?from=2026-09-09", "/api/v1/reports/activity?from=2026-09-10&to=2026-09-09"]) {
        assert.notEqual((await app.request(path)).status, 200, "a missing or reversed range cannot become a default report");
      }
      assert.throws(() => queue.queue({ fromDay: to, toDay: "2026-09-08", limit: 2, topLevel: true }), /range-invalid/u);
    } finally { f.dispose(); }
  });
});
