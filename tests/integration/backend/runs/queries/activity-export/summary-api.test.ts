import { FingerprintSchema } from "../../../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { summaryFixture } from "../../../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { activityReportCsv } from "../../../../../../src/backend/runs/queries/activity-export.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { id, NOW } from "../../../../../support/helpers/database-foundation/fixtures.js";

it("serves selected Queue rows and Activity without enumerating canonical history", () => {
  const f = summaryFixture();
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
  } finally { f.dispose(); }
});

import { foundationFixture } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { ledgerCommitFixture } from "../../../../../support/fixtures/ledger-projection-fixtures.js";
import { atomicWriteCheckpoint } from "../../../../../support/helpers/timeline-write-fixture.js";
import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createOperatorProjection } from "../../../../../../src/backend/app/composition/dashboard/operator.js";
import { queryQueueSummaries, queryActivitySummaries } from "../../../../../../src/backend/runs/queries/run-summaries.js";
import { composeOperatorXlsxWorkbook } from "../../../../../../src/backend/runs/exports/operator-xlsx-workbook.js";
import readXlsxFile from "read-excel-file/node";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";

it("keeps JSON, CSV and XLSX write evidence through restart and terminal run deletion", async () => {
  const f = foundationFixture();
  let database = f.db;
  try {
    const run = f.run;
    const commit = ledgerCommitFixture(78, { runId: run.envelope.runId, workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId, traceId: run.envelope.traceId, configFingerprint: run.envelope.configFingerprint, confirmedAt: NOW });
    assert.equal(database.authority.writeIntents.fenceAttempt({ intent: commit.intent, attempt: commit.attempt }).state, "fenced");
    database.commitWriteAttempt(commit.commit, { ...atomicWriteCheckpoint(commit.commit),
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint });
    const read = () => {
      const db = database;
      const reader = new RunRecordService({ database: db, clock: f.clock, ids: { uuid: () => id(8850) }, publishQueued: () => {} });
      const ledger = createTransactionHistory(db.authority);
      const descriptors = { resolve: () => undefined };
      return createOperatorProjection({ database: db, stateRoot: f.root, clock: f.clock, appVersion: "0.1.0",
        descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger, descriptors,
        reader: { read: reader.read.bind(reader), list: reader.list.bind(reader),
          summaries: { withSnapshot: work => db.withAuthorityReadSnapshot(work), queue: query => queryQueueSummaries(db, query),
            activity: (from, to) => queryActivitySummaries(db, { from, to, generatedAt: NOW }, { ledger, descriptors }) } },
      }).buildActivityReportWire("2026-01-01", "2026-09-30");
    };
    
    const reader = new RunRecordService({ database, clock: f.clock, ids: { uuid: () => id(8850) }, publishQueued: () => {} });
    for (const terminal of [run]) {
      const cancelled = reader.transition({ commandId: id(8851), runId: terminal.envelope.runId,
        expectedVersion: terminal.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      assert.equal(cancelled.state, "applied");
      if (cancelled.state !== "applied" || cancelled.run.lifecycle.state !== "running") throw new Error("cancellation fixture did not retain its worker claim");
      assert.equal(reader.terminalize({ commandId: id(8856), kind: "cancelled",
        runId: terminal.envelope.runId, expectedVersion: cancelled.run.version,
        claim: { workerId: cancelled.run.lifecycle.workerId, claimGeneration: cancelled.run.claimGeneration },
        endedAt: NOW }, personLookupDescriptor).state, "applied");
    }
    const before = read();
    const beforeGeneration = database.getMeta().authorityGeneration;
    assert.equal(before.totalRuns, 1);
    assert.equal(before.volume?.coveredRuns, before.totalRuns);
    assert.equal(before.volume?.buckets.reduce((total, bucket) => total + bucket.runs, 0), before.totalRuns);
    assert.equal(before.ledger.systems[0]?.entries, 1);
    database.close();
    database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "summary-export-reopen" }, f.clock);
    const reopenedReader = new RunRecordService({ database, clock: f.clock, ids: { uuid: () => id(8852) }, publishQueued: () => {} });
    const retained = database.authority.runs.get(run.envelope.runId);
    assert.ok(retained);
    assert.equal(read().totalRuns, 1);
    assert.equal(reopenedReader.delete({ commandId: id(8853), runId: retained.envelope.runId,
      expectedVersion: retained.version }).state, "deleted");
    const after = read();
    const afterGeneration = database.getMeta().authorityGeneration;
    assert.equal(after.totalRuns, 0);
    assert.equal(after.volume?.coveredRuns, after.totalRuns);
    assert.equal(after.volume?.buckets.reduce((total, bucket) => total + bucket.runs, 0), after.totalRuns);
    assert.deepEqual(after.ledger, before.ledger);
    for (const { report, authorityGeneration } of [
      { report: before, authorityGeneration: beforeGeneration },
      { report: after, authorityGeneration: afterGeneration },
    ]) {
      const csv = activityReportCsv(report);
      const workbook = await composeOperatorXlsxWorkbook({ selection: { kind: "activity", snapshot: {
        from: report.from, to: report.to, generatedAt: report.generatedAt,
        sourceIdentity: database.getSourceDatabaseIdentity(), totalRuns: report.totalRuns,
        authorityGeneration, reportDigest: sha256Hex(canonicalJsonStringify(report)),
      } }, report });
      const sheets = await readXlsxFile(workbook.bytes);
      assert.deepEqual(sheets.find(sheet => sheet.sheet === "Ledger")?.data.slice(1), [["ucpath", 1, 1, 0]]);
      assert.match(csv, /ucpath,1,1,0/);
      const text = JSON.stringify({ report, csv, cells: sheets });
      for (const secret of [String(commit.intent.idempotencyKey), String(commit.intent.idempotencyKeyDigest)]) assert.equal(text.includes(secret), false);
    }
    assert.deepEqual(read().ledger, before.ledger);
    database.close();
    database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "summary-delete-reopen" }, f.clock);
    assert.equal(read().totalRuns, 0);
    assert.deepEqual(read().ledger, before.ledger);
  } finally { database.close(); f.dispose(); }
});

it("keeps deterministic cursor ties, day/status/workflow/system membership and canonical stale-action refusal", () => {
  const f = summaryFixture();
  try {
    const ids = [id(8860), id(8861), id(8862), id(8863)];
    f.db.withAuthorityTransaction(() => ids.forEach((runId, n) => f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
      envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: n === 3 ? "2026-09-08T12:00:00.000Z" : NOW },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: n === 3 ? "2026-09-08T12:00:00.000Z" : NOW, updatedAt: NOW }))));
    f.servedReader.list = () => { throw new Error("selected-page-read-history"); };
    const selected = f.projection.buildDashboardDayWire("2026-09-09");
    assert.deepEqual(selected.queueSurfaces.map(row => row.runId), ids.slice(0, 3));
    assert.equal(selected.monthCounts.find(day => day.day === "2026-09-08")?.count, 1);
    assert.equal(selected.workflowCounts.find(row => row.workflowId === "person-lookup")?.count, 3);
    assert.equal(selected.queueSurfaces.filter(row => row.status === "queued" && row.workflowId === "person-lookup"
      && row.resolvedInstances.some(instance => instance.system === "ucpath")).length, 3);
    assert.equal(selected.queueSurfaces.filter(row => row.resolvedInstances.some(instance => String(instance.system) === "unknown-system")).length, 0);
    let after: { localDay: string; runId: string } | undefined;
    const seen: string[] = [];
    do {
      const page = queryQueueSummaries(f.db, { workflow: "person-lookup", fromDay: "2026-09-09", toDay: "2026-09-09", status: "queued", limit: 1, ...(after === undefined ? {} : { after }) });
      seen.push(...page.items.map(row => row.runId)); after = page.next ?? undefined;
    } while (after !== undefined);
    assert.deepEqual(seen, ids.slice(0, 3));
    assert.deepEqual(queryQueueSummaries(f.db, { workflow: "other-workflow", limit: 1 }).items, []);
    const row = selected.queueSurfaces[0];
    assert.equal(f.reader.transition({ commandId: id(8865), runId: row.runId, expectedVersion: row.rowRevision,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }).state, "applied");
    const generation = f.db.getMeta().authorityGeneration;
    assert.deepEqual(f.reader.transition({ commandId: id(8866), runId: row.runId, expectedVersion: row.rowRevision,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }), { state: "refused", refusal: { reason: "conflict", currentVersion: row.rowRevision + 1 } });
    assert.equal(f.db.getMeta().authorityGeneration, generation);
    const refreshed = f.projection.buildDashboardDayWire("2026-09-09");
    assert.equal(refreshed.queueSurfaces.find(item => item.runId === row.runId)?.status, "cancelled");
    assert.equal(refreshed.statusCounts.find(item => item.status === "queued")?.count, 2);
  } finally { f.dispose(); }
});

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
