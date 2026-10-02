import assert from "node:assert/strict";
import { it } from "vitest";
import { archiveFixture } from "../../helpers/archive-transfer/fixtures.js";
import { NOW, id } from "../../helpers/database-foundation/fixtures.js";
import { createRunLifecycleStorage } from "../helpers/lifecycle-storage.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { captureArchiveReport } from "../../../src/backend/storage/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/backend/storage/archive-transfer.js";
import { sealArchiveReport, type ArchiveGroupQuery } from "../../../src/domain/archive/report.js";
import { projectArchiveReport, queryArchiveReports } from "../../../src/backend/runs/dashboard/queries/archive-reports.js";
import { createFixtureBff } from "../../parity/helpers/fixture-bff.js";
import { SavedArchiveReportWireSchema, SavedArchiveGroupsWireSchema, SavedArchiveIndexWireSchema, SavedRuntimeVersionIndexWireSchema, type SavedArchiveReportWire } from "../../../src/domain/dashboard/archive.js";

it("matches rich fixture predicates, capture grouping and equal-timestamp cursors to composed SQLite authority", async () => {
  const f = archiveFixture();
  try {
    const storage = createRunLifecycleStorage(f.database);
    const reports: SavedArchiveReportWire[] = [];
    for (let index = 0; index < 4; index += 1) {
      const run = RunRecordSchema.parse({ ...f.base.run, envelope: { ...f.base.run.envelope, runId: id(99300 + index), itemId: id(99300 + index), workflow: index === 3 ? "other-workflow" : "retired-query-workflow" }, lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, displayName: index === 0 ? "Special 雪 title" : "Other retained title" });
      f.database.authority.runs.enqueue(run);
      f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: 1, now: NOW, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      const snapshot = storage.capture(run.envelope.runId);
      const base = captureArchiveReport({ snapshot, transferId: id(99400 + index), capturedAt: `2026-08-${index === 0 ? "07" : "14"}T10:00:00.000Z`, files: [], sections: [{ kind: "values", title: "Public structured fields", values: [{ label: "City", value: { city: "München", "a.b": "Needle 雪" } }] }] });
      const report = sealArchiveReport({ ...base.content, schemaVersion: index === 0 ? 1 : 2, ...(index === 0 ? {} : { runtimeVersion: { state: index === 1 ? "adopted" : "stamped", dashboard: { major: 2, minor: 0 }, workflow: { major: 2, minor: 1 } } }) });
      transferArchiveReport(storage, report, snapshot.run.version);
      const projected = projectArchiveReport(storage.readReport(run.envelope.runId)); assert.equal(projected.state, "available");
      if (projected.state !== "available") throw new Error("Synthetic report unavailable");
      reports.push(SavedArchiveReportWireSchema.parse(projected));
    }
    const versions = SavedRuntimeVersionIndexWireSchema.parse({ revision: 1, dashboard: { major: 2, minor: 0 }, workflows: [], changes: [] });
    const { app } = createFixtureBff({ archiveComparison: { reports, versions } });
    const queries: ArchiveGroupQuery[] = [{}, { workflow: "retired-query-workflow" }, { workflow: "missing" }, { title: "Special 雪 title" },
      { search: "needle 雪" }, { search: "MÜNCHEN" }, { search: reports[0].archiveFingerprint }, { outcome: "cancelled" }, { outcome: "failed" },
      { descriptorVersion: "1" }, { descriptorVersion: "missing" }, { from: NOW, to: NOW }, { from: "2099-01-01T00:00:00.000Z" },
      { capturedFrom: "2026-08-14T10:00:00.000Z" }, { capturedTo: "2026-08-07T10:00:00.000Z" },
      { dashboardVersion: { major: 2, minor: 0 }, workflowVersion: { major: 2, minor: 1 } }, { dashboardVersion: { major: 1, minor: 0 } },
      { versionState: "unrecorded" }, { versionState: "stamped" }, { versionState: "adopted" },
      { workflow: "retired-query-workflow", search: "Needle", versionState: "adopted", capturedFrom: "2026-08-14T10:00:00.000Z" }];
    const paramsFor = (query: object) => new URLSearchParams(Object.entries(query).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
    for (const query of queries) {
      const served = SavedArchiveIndexWireSchema.parse(await (await app.request(`/api/v1/archive/reports?${paramsFor({ ...query, limit: 50 })}`)).json());
      const actual = queryArchiveReports(storage, { ...query, limit: 50 });
      assert.deepEqual(served.items.map(report => report.runId), actual.items.map(report => report.state === "available" ? report.runId : "unavailable"), JSON.stringify(query));
      const groups = SavedArchiveGroupsWireSchema.parse(await (await app.request(`/api/v1/archive/groups?${paramsFor(query)}`)).json());
      const key = (group: Pick<typeof groups.groups[number], "dashboardVersion" | "workflow" | "workflowVersion">) => `${JSON.stringify(group.dashboardVersion)}:${group.workflow}:${JSON.stringify(group.workflowVersion)}`;
      assert.deepEqual([...groups.groups].sort((a, b) => key(a).localeCompare(key(b))), [...storage.archiveGroups(query)].sort((a, b) => key(a).localeCompare(key(b))), JSON.stringify(query));
    }
    let after: Parameters<typeof queryArchiveReports>[1]["after"];
    const seen: string[] = [];
    do {
      const query = { workflow: "retired-query-workflow", limit: 1, ...(after === undefined ? {} : { after }) };
      const served = SavedArchiveIndexWireSchema.parse(await (await app.request(`/api/v1/archive/reports?${paramsFor(query)}`)).json());
      const actual = queryArchiveReports(storage, query);
      assert.deepEqual(served, actual);
      seen.push(...served.items.map(report => report.runId));
      after = served.next ?? undefined;
    } while (after !== undefined);
    assert.deepEqual(seen, reports.slice(0, 3).map(report => report.runId));
  } finally { f.dispose(); }
});
