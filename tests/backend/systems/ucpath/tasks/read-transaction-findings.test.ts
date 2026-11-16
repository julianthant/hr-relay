import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readTransactionFindingsTask } from "../../../../../src/backend/systems/ucpath/tasks/read-transaction-findings.js";
import { createDeterministicUcpathSmartHrDriver } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import { UcpathReadTransactionFindings } from "../../../../../src/models/systems/ucpath/read-transaction-findings.js";
import { UcpathTransactionFindingsSchema, type UcpathTransactionFindings } from "../../../../../src/models/ui/ucpath-transaction-findings.js";
import { UcpathTransactionScanSchema } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { RecordedDataPointSchema, type DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";

const EID = EidSchema.parse("10800000");
const NAME = "Synthetic, Findings";
const NOW = "2026-11-02T18:00:00.000Z";
const ROW = { transactionId: "T900001", emplId: EID, displayedName: NAME, action: "Terminatn",
  approvalStatus: "Pending", startDate: "11/02/2026", submittedAt: "11/01/26 2:03:04.123456PM", detailVerified: true } as const;
const READ = UcpathTransactionFindingsSchema.parse({ state: "read", emplId: EID, rows: [ROW], scannedRowCount: 1,
  completeness: { state: "complete", reportedRowCount: 1 }, observedAt: NOW, source: "ss-smart-hr-list-and-detail" });

function harness(findings: UcpathTransactionFindings, overrideSubject = false) {
  const points: DataPoint[] = [];
  const driver = createDeterministicUcpathSmartHrDriver({ findings,
    scan: UcpathTransactionScanSchema.parse({ state: "read", emplId: EID, rows: [], scannedRowCount: 0, observedAt: NOW }) });
  return { points, run: () => readTransactionFindingsTask.impl.run({ input: { emplId: EID, expectedName: NAME }, ctx: {
    signal: new AbortController().signal, captureScreenshot: async () => {},
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    driver: overrideSubject ? { ...driver, readTransactionFindings: async () => findings } : driver,
    fail: (code: string): never => { throw new Error(code); },
    recordData: (value: DataPoint | readonly DataPoint[]) => { if ("field" in value) points.push(value); else points.push(...value); },
  } }) };
}

describe("UCPath transaction findings task", () => {
  it("records a complete empty population without claiming a submission", async () => {
    const empty = UcpathTransactionFindingsSchema.parse({ ...READ, rows: [], scannedRowCount: 0,
      completeness: { state: "complete", reportedRowCount: 0 } });
    const h = harness(empty);
    const output = await h.run();
    assert.deepEqual(output.rows, []);
    assert.deepEqual(output.completeness, { state: "complete", reportedRowCount: 0 });
    assert.deepEqual(h.points.find(point => point.field === "rows")?.value, []);
  });

  it("records the actual submission time, verified row and population accounting", async () => {
    const h = harness(READ);
    assert.deepEqual(await h.run(), READ);
    assert.deepEqual(h.points.map(point => point.field), ["state", "emplId", "rows", "scannedRowCount", "completeness", "observedAt", "source"]);
    assert.deepEqual(h.points.find(point => point.field === "rows")?.value, [ROW]);
    const recorded = h.points.map(point => RecordedDataPointSchema.parse({ ...point, recordedAt: NOW,
      execution: { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "sp-180000-aaaa", attempt: 1,
        workflowId: "separations", nodeId: "transaction-findings", taskId: UcpathReadTransactionFindings.id } }));
    const redacted = redactObservedDataPoints(UcpathReadTransactionFindings.id, recorded);
    assert.equal(redacted.find(point => point.field === "rows")?.values[0].classification, "sensitive-hr");
    assert.equal(redacted.find(point => point.field === "emplId")?.values[0].classification, "direct-identifier");
    assert.equal(redacted.find(point => point.field === "observedAt")?.values[0].classification, "safe-diagnostic");
  });

  it("retains capped findings as incomplete without converting them to a clean absence", async () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ ...ROW, transactionId: `T${String(900000 + index)}` }));
    const capped = UcpathTransactionFindingsSchema.parse({ ...READ, rows, scannedRowCount: 300,
      completeness: { state: "incomplete", reason: "search-cap", reportedRowCount: 300 } });
    const output = await harness(capped).run();
    assert.equal(output.rows.length, 300);
    assert.deepEqual(output.completeness, { state: "incomplete", reason: "search-cap", reportedRowCount: 300 });
  });

  it("maps an unreadable scan to a declared failure before recording findings", async () => {
    const h = harness(UcpathTransactionFindingsSchema.parse({ state: "unreadable", emplId: EID,
      reason: "row identity unavailable", diagnostic: { state: "not-attempted", cause: "not-indeterminate-settlement" }, observedAt: NOW }));
    await assert.rejects(h.run(), /^Error: unexpected-page-state$/u);
    assert.deepEqual(h.points, []);
  });

  it("rejects a different displayed subject or foreign scan without recording it", async () => {
    for (const finding of [
      { ...READ, rows: [{ ...ROW, displayedName: "Different, Person" }] },
      { ...READ, emplId: "10800001", rows: [{ ...ROW, emplId: "10800001" }] },
    ]) {
      const h = harness(UcpathTransactionFindingsSchema.parse(finding), true);
      await assert.rejects(h.run(), /^Error: subject-mismatch$/u);
      assert.deepEqual(h.points, []);
    }
  });
});
