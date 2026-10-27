import { Hono } from "hono";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createCalendarQuery } from "../../../../src/backend/runs/queries/calendar.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import type { ShellRouteDeps } from "../../../../src/backend/transports/http/routes/shell-types.js";
import { registerShellRoutes } from "../../../../src/backend/transports/http/routes/shell.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { summaryFixture } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { foundationFixture,id } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

it("reads bounded real month counts and chronological bounds without whole-history readers or writes", async () => {
  const f = await summaryFixture();
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
      const plan = raw.prepare("EXPLAIN QUERY PLAN SELECT local_day FROM runs INDEXED BY runs_day_idx WHERE local_day<? AND json_extract(envelope_json,'$.shape')!='operation-member' ORDER BY local_day DESC LIMIT 1").all("2026-09-09");
      assert.match(JSON.stringify(plan), /USING INDEX/u);
      assert.doesNotMatch(JSON.stringify(plan), /SCAN runs|TEMP B-TREE/u);
    } finally { raw.close(); }
  } finally { await f.dispose(); }
});

it("refuses invalid queries and unavailable/corrupt publications instead of reporting empty history", async () => {
  const f = await foundationFixture();
  try {
    const query = createCalendarQuery(f.db, f.clock);
    for (const input of [{ month: "2026-13", day: "2026-08-03" }, { month: "2026-08", day: "2026-02-30" }, { month: "2026-08", day: "2026-09-10" }]) {
      assert.throws(() => query.read(input));
    }
    const raw = new DatabaseSync(f.path);
    try {
      raw.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(f.run.envelope.runId);
      assert.throws(() => query.read({ month: "2026-08", day: "2026-08-03" }), /rebuild-required/u);
      raw.prepare("UPDATE runs SET version=? WHERE id=?").run(f.run.version, f.run.envelope.runId);
      assert.ok(query.read({ month: "2026-08", day: "2026-08-03" }).firstDay);
      raw.prepare("DELETE FROM run_search WHERE run_id=?").run(f.run.envelope.runId);
      assert.throws(() => query.read({ month: "2026-08", day: "2026-08-03" }), /rebuild-required/u);
    } finally { raw.close(); }
  } finally { await f.dispose(); }
});

it("terminal deletion removes bounds and counts and leaves Today reachable with empty history", async () => {
  const f = await foundationFixture();
  try {
    let next = 999100;
    const service = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: () => id(next++) }, publishQueued: () => {} });
    const query = createCalendarQuery(f.db, f.clock);
    const day = f.run.envelope.enqueuedAt.slice(0, 10);
    assert.ok(query.read({ month: day.slice(0, 7), day }).firstDay);
    const terminal = service.transition({ commandId: id(999001), runId: f.run.envelope.runId,
      expectedVersion: f.run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } });
    assert.equal(terminal.state, "applied");
    if (terminal.state !== "applied") throw new Error("calendar terminalization refused");
    const current = terminal.run;
    assert.equal(current.lifecycle.state, "running");
    if (current.lifecycle.state !== "running") throw new Error("calendar cancellation lost its held claim");
    const settled = service.terminalize({ kind: "cancelled", commandId: id(999002), runId: current.envelope.runId,
      expectedVersion: current.version, claim: { workerId: current.lifecycle.workerId, claimGeneration: current.claimGeneration },
      endedAt: f.clock.now().toISOString() }, personLookupDescriptor);
    assert.equal(settled.state, "applied");
    if (settled.state !== "applied") throw new Error("calendar cancellation did not settle");
    const deleted = service.delete({ commandId: id(999003), runId: f.run.envelope.runId, expectedVersion: settled.run.version });
    assert.equal(deleted.state, "deleted", JSON.stringify(deleted));
    const empty = query.read({ month: day.slice(0, 7), day });
    assert.deepEqual(empty.monthCounts, []);
    assert.equal(empty.firstDay, null); assert.equal(empty.lastDay, null); assert.equal(empty.previousDay, null);
    assert.equal(empty.nextDay, "2026-09-09");
    assert.equal(f.db.authority.deletedRuns.get(f.run.envelope.runId)?.runId, f.run.envelope.runId);
    assert.deepEqual(query.read({ month: day.slice(0, 7), day }).monthCounts, []);
  } finally { await f.dispose(); }
});

it("serves the strict calendar route and refuses unknown or duplicate parameters", async () => {
  const f = await summaryFixture();
  try {
    const app: DashboardApp = new Hono();
    app.onError((_error, c) => c.json({ error: "refused" }, 400));
    registerShellRoutes(app, { calendar: createCalendarQuery(f.db, f.clock) } as ShellRouteDeps);
    const valid = await app.request("/api/v1/calendar?month=2026-08&day=2026-08-03");
    assert.equal(valid.status, 200);
    for (const suffix of ["&extra=1", "&day=2026-08-04", "&month=2026-09"]) {
      assert.equal((await app.request(`/api/v1/calendar?month=2026-08&day=2026-08-03${suffix}`)).status, 400);
    }
  } finally { await f.dispose(); }
});
