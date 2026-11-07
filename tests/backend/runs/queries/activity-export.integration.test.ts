import assert from "node:assert/strict";
import { it } from "vitest";
import { activityReportCsv } from "../../../../src/backend/runs/queries/activity-export.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { summaryFixture } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id, NOW } from "../../../support/helpers/database-foundation/fixtures.js";

import { describe } from "vitest";

{

it("serves selected Queue rows and Activity without enumerating canonical history", async () => {
  const f = await summaryFixture();
  try {
    const selected = RunRecordSchema.parse({ ...f.run, envelope: { ...f.run.envelope, runId: id(8101), itemId: id(8101), enqueuedAt: NOW },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOW, updatedAt: NOW });
    f.db.authority.runs.enqueue(selected);
    f.servedReader.list = () => { throw new Error("whole-history-read-forbidden"); };
    const wire = f.projection.buildDashboardDayWire("2026-09-09");
    assert.deepEqual(wire.queueSurfaces.map(row => row.runId), [selected.envelope.runId]);
    assert.equal(wire.monthCounts.find(day => day.day === "2026-09-09")?.count, 1);
    assert.equal(wire.statusCounts.find(row => row.status === "queued")?.count, 1);
    const report = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
    assert.equal(report.totalRuns, 1);
    assert.match(activityReportCsv(report), /Runs in range,1/);
    assert.doesNotMatch(JSON.stringify(report), /sourceDigest|configFingerprint|"identity"/);
  } finally { await f.dispose(); }
});
}

{

describe("Activity consumes the served summary boundary", () => {
  it("renders the same selected database summaries as Queue and CSV, without reading canonical history", async () => {
    const f = await summaryFixture();
    try {
      const now = "2026-09-09T12:00:00.000Z";
      for (const runId of [id(9781), id(9782)]) f.db.authority.runs.enqueue(RunRecordSchema.parse({
        ...f.run, envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: now },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: now, updatedAt: now,
      }));
      f.servedReader.list = () => { throw new Error("activity-consumer-enumerated-history"); };
      const selected = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
      const held = f.projection.buildDashboardDayWire("2026-09-09").queueSurfaces;
      assert.equal(selected.totalRuns, 2);
      assert.deepEqual(selected.statuses.find((entry) => entry.status === "queued")?.sample, held.map((row) => row.runId));
      assert.match(activityReportCsv(selected), /Runs in range,2/u);
      assert.throws(() => f.projection.buildActivityReportWire("2026-09-10", "2026-09-09"));
    } finally { await f.dispose(); }
  });

});
}
