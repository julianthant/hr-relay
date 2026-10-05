import { describe, expect, it } from "vitest";
import { archiveQueuePreview, archiveWorkflowTree } from "../../../src/dashboard/surfaces/queue/queue-archive-model.js";
import { mockArchiveExport, mockArchiveFilter, mockArchiveScope, mockArchiveWorkflows } from "../../../src/dashboard/surfaces/archive/archive-mock-model.js";
import { mockArchiveLogs } from "../../../src/dashboard/surfaces/archive/archive-mock-logs-model.js";
import { seedQueuePreview } from "../../../src/dashboard/surfaces/queue/queue-preview-model.js";
import { seedMockRuns } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { reviewRecords, updateMockReview } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { FIXTURE_DAY, FIXTURE_NOW } from "../../parity/helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-queue.js";

describe("queue snapshots in the local Archive", () => {
  it("retains a terminal row's identity, original settings and completion instead of the archive time", () => {
    const record = seedQueuePreview(FIXTURE_DAY_WIRE.queueSurfaces).records.find(record => record.row.status === "failed")!;
    const report = archiveQueuePreview(record, "Person lookup", FIXTURE_NOW);
    expect(report.outcome).toBe("failed");
    expect(record.row.endedAt.state).toBe("present");
    if (record.row.endedAt.state === "present") expect(report.completed).toBe(record.row.endedAt.value);
    expect(report.archived).toBe(FIXTURE_NOW);
    expect(report.snapshot).toEqual({ kind: "queue", record });
    expect(JSON.parse(report.files[0].content)).toEqual(report.snapshot);
    expect(mockArchiveLogs(report)).toEqual(report.savedLogs);
    expect(report.savedLogs?.timeline.map(stage => stage.label)).toEqual(record.row.pipeline.map(step => step.label));
  });

  it("archives OCR with its parent and dependent subtree, preserving edits and selection without approval", () => {
    const initial = seedMockRuns();
    const ocr = initial.find(run => run.workflowId === "ocr" && run.draft.formType === "oath")!;
    const records = reviewRecords(ocr).map((record, index) => ({ ...record, selected: index !== 1,
      fields: record.fields.map(field => field.label === "Notes" ? { ...field, value: "Retain this manual edit" } : field),
    }));
    const runs = updateMockReview(initial, ocr.id, records);
    const before = JSON.stringify(runs);
    const { ids, reports } = archiveWorkflowTree(runs, ocr.id, FIXTURE_DAY, FIXTURE_NOW);
    expect(ids).toContain(ocr.id);
    expect(ids).toContain(ocr.parentId);
    expect(reports.map(report => report.snapshot?.kind === "workflow" ? report.snapshot.run.id : undefined).sort()).toEqual([...ids].sort());
    const report = reports.find(report => report.workflow === "ocr")!;
    expect(report.outcome).toBe("waiting");
    expect(report.completed).toBeUndefined();
    expect(report.snapshot?.kind === "workflow" && report.snapshot.run.approved).toBe(false);
    expect(report.snapshot?.kind === "workflow" && report.snapshot.run.records).toEqual(records);
    expect(report.fields).toContainEqual(["Jordan Lee · Page 1 · Notes", "Retain this manual edit"]);
    expect(JSON.stringify(runs)).toBe(before);
    expect(report.snapshot?.kind === "workflow" && report.snapshot.run).not.toBe(runs.find(run => run.id === ocr.id));
    expect(mockArchiveLogs(report)).toEqual(report.savedLogs);
    expect(mockArchiveLogs(report).timeline.some(stage => stage.state === "waiting")).toBe(true);
  });

  it("makes new workflow snapshots searchable and exportable without inventing a completion date", () => {
    const runs = seedMockRuns();
    const ocr = runs.find(run => run.workflowId === "ocr")!;
    const { reports } = archiveWorkflowTree(runs, ocr.id, FIXTURE_DAY, FIXTURE_NOW);
    const folder = { dashboardKey: "unrecorded", workflow: "ocr" };
    const scoped = mockArchiveScope(folder, reports)!;
    expect(scoped).toHaveLength(1);
    expect(mockArchiveWorkflows(reports)).toContainEqual({ id: "ocr", label: "OCR" });
    expect(mockArchiveFilter(scoped, { filters: { search: ocr.subject } })).toEqual(scoped);
    expect(mockArchiveFilter(scoped, { filters: { from: "2026-01-01T00:00:00Z" } })).toEqual([]);
    expect(mockArchiveExport(scoped, "csv")).toContain('"Review",""');
    const exported = JSON.parse(mockArchiveExport(scoped, "json")) as { records: { snapshot: { run: { id: string } }; completed?: string }[] };
    expect(exported.records[0].snapshot.run.id).toBe(ocr.id);
    expect(exported.records[0]).not.toHaveProperty("completed");
  });

  it("refuses a missing source rather than archiving a substitute", () => {
    expect(() => archiveWorkflowTree(seedMockRuns(), "missing", FIXTURE_DAY, FIXTURE_NOW)).toThrow("MOCK_DELETE_TARGET_MISSING");
  });
});
