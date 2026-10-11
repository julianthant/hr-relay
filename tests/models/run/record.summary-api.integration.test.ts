import assert from "node:assert/strict";
import { it } from "vitest";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { summaryFixture } from "../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id,NOW } from "../../support/helpers/database-foundation/fixtures.js";


it("contains operation members once and preserves protected titles and missing warning evidence", () => {
  const f = summaryFixture();
  try {
    const rootId = id(8870), memberId = id(8871);
    f.db.withAuthorityTransaction(() => {
      for (const [runId, shape] of [[rootId, "operation"], [memberId, "operation-member"]] as const) {
        f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
          envelope: { ...f.run.envelope, runId, itemId: runId, shape, enqueuedAt: NOW,
            ...(shape === "operation-member" ? { parent: { runId: rootId, tracePrefix: f.run.envelope.traceId, edgeId: "synthetic-member" } } : {}) },
          input: { ...f.run.input, raw: { emplId: "10812345" }, parsed: { ...f.run.input.parsed, value: { emplId: "10812345" },
            protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: id(8872) }] } },
          displayName: "10812345", lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOW, updatedAt: NOW }));
      }
    });
    const wire = f.projection.buildDashboardDayWire("2026-09-09");
    assert.equal(wire.monthCounts.find(day => day.day === "2026-09-09")?.count, 1);
    assert.equal(wire.statusCounts.find(row => row.status === "queued")?.count, 1);
    const root = wire.queueSurfaces.find(row => row.runId === rootId);
    assert.equal(root?.surfaceKind, "operation");
    if (root?.surfaceKind !== "operation") throw new Error("operation-not-served");
    assert.deepEqual(root.memberRunIds, [memberId]);
    assert.equal(root.memberRollup.total, 1);
    assert.equal(root.warnings.state, "absent");
    assert.deepEqual(root.displayName, {
      state: "absent",
      reason: "the operator's display name is withheld because this run carries protected input",
    });
    assert.equal(JSON.stringify(wire).includes("10812345"), false);
    const report = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
    assert.equal(report.totalRuns, 1);
  } finally { f.dispose(); }
});
