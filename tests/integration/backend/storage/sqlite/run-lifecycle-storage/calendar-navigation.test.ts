import { createRunLifecycleStorage } from "../../../../../../src/backend/storage/sqlite/run-lifecycle-storage.js";
import { projectArchiveReport } from "../../../../../../src/backend/runs/queries/archive-reports.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { summaryFixture } from "../../../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { foundationFixture, id } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { archiveFixture } from "../../../../../support/helpers/archive-transfer/fixtures.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { createCalendarQuery } from "../../../../../../src/backend/runs/queries/calendar.js";
import { registerShellRoutes } from "../../../../../../src/backend/transports/http/routes/shell.js";
import type { DashboardApp } from "../../../../../../src/backend/transports/http/routes/api-types.js";
import type { ShellRouteDeps } from "../../../../../../src/backend/transports/http/routes/shell-types.js";

it("reads bounded real month counts and chronological bounds without whole-history readers or writes", () => {
  const f = summaryFixture();
  try {
    for (const [i, day] of ["2024-12-31", "2025-01-02", "2026-08-03", "2026-08-03", "2026-09-08"].entries()) {
      const at = `${day}T12:00:00.000Z`;
      f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
        envelope: { ...f.run.envelope, runId: id(4000 + i), itemId: id(4000 + i), enqueuedAt: at },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: at, updatedAt: at }));
    }
    const member = RunRecordSchema.parse({ ...f.run,
      envelope: { ...f.run.envelope, runId: id(4099), itemId: id(4099), enqueuedAt: "2026-08-03T12:00:00.000Z",
        shape: "operation-member", parent: { runId: id(4002), tracePrefix: f.run.envelope.traceId, edgeId: "searching" } },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0,
      createdAt: "2026-08-03T12:00:00.000Z", updatedAt: "2026-08-03T12:00:00.000Z" });
    f.db.authority.runs.enqueue(member);
    f.db.readRunSummaries = () => { throw new Error("whole-history-reader-forbidden"); };
    f.servedReader.list = () => { throw new Error("canonical-list-forbidden"); };
    assert.throws(() => f.db.readRunSummaries(), /whole-history-reader-forbidden/u);
    const query = createCalendarQuery(f.db, f.clock);
    const before = f.db.getMeta();
    const calendar = query.read({ month: "2026-08", day: "2026-08-02" });
    assert.deepEqual(calendar.monthCounts, [{ day: "2026-08-03", count: 2 }]);
    assert.equal(calendar.firstDay, "2024-12-31");
    assert.equal(calendar.previousDay, "2026-07-31");
    assert.equal(query.read({ month: "2025-01", day: "2025-01-01" }).previousDay, "2024-12-31");
    assert.equal(calendar.nextDay, "2026-08-03");
    assert.equal(calendar.lastDay, "2026-09-08");
    const wire = f.projection.buildDashboardDayWire("2026-08-03");
    assert.deepEqual(calendar.monthCounts, wire.monthCounts);
    assert.equal(wire.queueSurfaces.filter(row => row.surfaceKind !== "member").length, 2);
    assert.equal(wire.statusCounts.reduce((sum, row) => sum + row.count, 0), 2);
    assert.deepEqual(query.read({ month: "2025-02", day: "2025-02-20" }).monthCounts, []);
    assert.equal(query.read({ month: "2026-09", day: "2026-09-08" }).nextDay, "2026-09-09");
    assert.equal(query.read({ month: "2026-09", day: "2026-09-09" }).nextDay, null);
    assert.deepEqual(f.db.getMeta(), before);
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      const plan = raw.prepare("EXPLAIN QUERY PLAN SELECT record_json FROM run_summaries WHERE workflow=? AND local_day<? AND json_extract(record_json,'$.shape')!='operation-member' ORDER BY local_day DESC LIMIT 1").all("person-lookup", "2026-09-09");
      assert.match(JSON.stringify(plan), /USING INDEX/u);
      assert.doesNotMatch(JSON.stringify(plan), /SCAN run_summaries|TEMP B-TREE/u);
    } finally { raw.close(); }
  } finally { f.dispose(); }
});

it("refuses invalid queries and unavailable/corrupt publications instead of reporting empty history", () => {
  const f = foundationFixture();
  try {
    const query = createCalendarQuery(f.db, f.clock);
    const unpublished = new DatabaseSync(f.path);
    unpublished.exec("DELETE FROM summary_publication"); unpublished.close();
    assert.throws(() => query.read({ month: "2026-08", day: "2026-08-03" }), /generation-unavailable/u);
    f.db.refreshRunSummaries();
    assert.ok(query.read({ month: "2026-08", day: "2026-08-03" }).firstDay);
    for (const input of [{ month: "2026-13", day: "2026-08-03" }, { month: "2026-08", day: "2026-02-30" }, { month: "2026-08", day: "2026-09-10" }]) {
      assert.throws(() => query.read(input));
    }
    const raw = new DatabaseSync(f.path);
    try {
      raw.prepare("UPDATE run_summaries SET record_json=json_set(record_json,'$.sourceDigest',?)").run("b".repeat(64));
      assert.throws(() => query.read({ month: "2026-08", day: "2026-08-03" }), /rebuild-required/u);
      raw.prepare("DELETE FROM run_summaries").run();
      assert.throws(() => query.read({ month: "2026-08", day: "2026-08-03" }), /generation-corrupt/u);
    } finally { raw.close(); }
  } finally { f.dispose(); }
});

it("archive publication removes bounds and counts and leaves Today reachable with empty history", () => {
  const f = archiveFixture();
  try {
    f.terminal(); f.database.refreshRunSummaries();
    const query = createCalendarQuery(f.database, f.base.clock);
    const day = f.base.run.envelope.enqueuedAt.slice(0, 10);
    assert.ok(query.read({ month: day.slice(0, 7), day }).firstDay);
    const result = f.kernel.execute(f.applyRequest(f.plan()));
    assert.equal(result.state, "applied");
    const empty = query.read({ month: day.slice(0, 7), day });
    assert.deepEqual(empty.monthCounts, []);
    assert.equal(empty.firstDay, null); assert.equal(empty.lastDay, null); assert.equal(empty.previousDay, null);
    assert.equal(empty.nextDay, "2026-09-09");
    const report = createRunLifecycleStorage(f.database).readReport(f.base.run.envelope.runId);
    assert.ok(report);
    const view = projectArchiveReport(report); assert.equal(view.state, "available");
    if (view.state !== "available") assert.fail("archive fixture must be available");
    assert.equal(f.kernel.execute({ commandId: id(999001), requestedBy: "local-operator", requestedAt: f.base.clock.now().toISOString(),
      family: "version-archive", source: "archive", type: "delete-archived-run",
      target: { archivedRunId: report.content.runId, archiveFingerprint: view.archiveFingerprint } }).state, "applied");
    assert.equal(f.database.authority.deletedRuns.get(report.content.runId)?.runId, report.content.runId);
    assert.deepEqual(query.read({ month: day.slice(0, 7), day }).monthCounts, []);

  } finally { f.dispose(); }
});

it("serves the strict calendar route and refuses unknown or duplicate parameters", async () => {
  const f = summaryFixture();
  try {
    const app: DashboardApp = new Hono();
    app.onError((_error, c) => c.json({ error: "refused" }, 400));
    registerShellRoutes(app, { calendar: createCalendarQuery(f.db, f.clock) } as ShellRouteDeps);
    const valid = await app.request("/api/v1/calendar?month=2026-08&day=2026-08-03");
    assert.equal(valid.status, 200);
    for (const suffix of ["&extra=1", "&day=2026-08-04", "&month=2026-09"]) {
      assert.equal((await app.request(`/api/v1/calendar?month=2026-08&day=2026-08-03${suffix}`)).status, 400);
    }
  } finally { f.dispose(); }
});
