import assert_m0 from "node:assert/strict";
import { it as it_m0 } from "vitest";
import { activityReportCsv as activityReportCsv_m0 } from "../../../../src/backend/runs/queries/activity-export.js";
import { RunRecordSchema as RunRecordSchema_m0 } from "../../../../src/models/run/record.js";
import { summaryFixture as summaryFixture_m0 } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id as id_m0,NOW as NOW_m0 } from "../../../support/helpers/database-foundation/fixtures.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { activityReportCsv as activityReportCsv_m1 } from "../../../../src/backend/runs/queries/activity-export.js";
import { RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import { summaryFixture as summaryFixture_m1 } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id as id_m1 } from "../../../support/helpers/database-foundation/fixtures.js";


{


it_m0("serves selected Queue rows and Activity without enumerating canonical history", () => {
  const f = summaryFixture_m0();
  try {
    const selected = RunRecordSchema_m0.parse({ ...f.run, envelope: { ...f.run.envelope, runId: id_m0(8101), itemId: id_m0(8101), enqueuedAt: NOW_m0 },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOW_m0, updatedAt: NOW_m0 });
    f.db.authority.runs.enqueue(selected);
    f.servedReader.list = () => { throw new Error("whole-history-read-forbidden"); };
    const wire = f.projection.buildDashboardDayWire("2026-09-09");
    assert_m0.deepEqual(wire.queueSurfaces.map(row => row.runId), [selected.envelope.runId]);
    assert_m0.equal(wire.monthCounts.find(day => day.day === "2026-09-09")?.count, 1);
    assert_m0.equal(wire.statusCounts.find(row => row.status === "queued")?.count, 1);
    const report = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
    assert_m0.equal(report.totalRuns, 1);
    assert_m0.match(activityReportCsv_m0(report), /Runs in range,1/);
    assert_m0.doesNotMatch(JSON.stringify(report), /sourceDigest|configFingerprint|"identity"/);
  } finally { f.dispose(); }
});
}

{


describe_m1("Activity consumes the served summary boundary", () => {
  it_m1("renders the same selected database summaries as Queue and CSV, without reading canonical history", () => {
    const f = summaryFixture_m1();
    try {
      const now = "2026-09-09T12:00:00.000Z";
      for (const runId of [id_m1(9781), id_m1(9782)]) f.db.authority.runs.enqueue(RunRecordSchema_m1.parse({
        ...f.run, envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: now },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: now, updatedAt: now,
      }));
      f.servedReader.list = () => { throw new Error("activity-consumer-enumerated-history"); };
      const selected = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
      const held = f.projection.buildDashboardDayWire("2026-09-09").queueSurfaces;
      assert_m1.equal(selected.totalRuns, 2);
      assert_m1.deepEqual(selected.statuses.find((entry) => entry.status === "queued")?.sample, held.map((row) => row.runId));
      assert_m1.match(activityReportCsv_m1(selected), /Runs in range,2/u);
      assert_m1.throws(() => f.projection.buildActivityReportWire("2026-09-10", "2026-09-09"));
    } finally { f.dispose(); }
  });

});
}
