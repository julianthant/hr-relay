import { describe,expect,it } from "vitest";
import { approveMockRun,mockQueueCounts,mockQueueView,mockRunLog,mockRunSubset,seedMockRuns } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { keepsMockRun, PRODUCT_WORKFLOW_COMPOSITION, WORKFLOW_SOURCES } from "../../../../../src/dashboard/app/workflow-sources.js";
import { mockQueueId,mockQueueSurface,mockQueueSurfaces } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { discardMockReview } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";

const anchor = "2026-08-03T16:10:00.000Z";
describe("canonical workflow mock queue presentations", () => {
  it("keeps delegated previews connected when their intermediate workflow is served", () => {
    const all = seedMockRuns();
    const runs = mockRunSubset(all, run => keepsMockRun(PRODUCT_WORKFLOW_COMPOSITION, run));
    const rows = mockQueueSurfaces(runs, anchor);
    expect(runs.some(run => WORKFLOW_SOURCES[run.workflowId] === "served")).toBe(false);
    for (const id of ["i9-lookup"]) {
      const child = runs.find(run => run.workflowId === id)!;
      const parent = runs.find(run => run.id === child.parentId)!;
      expect(parent.workflowId).toBe("onbase");
      expect(rows.find(row => row.runId === mockQueueId(child.id))?.parent?.runId).toBe(mockQueueId(parent.id));
    }
    expect(runs.every(run => run.ocrRunId === undefined || runs.some(target => target.id === run.ocrRunId))).toBe(true);
    expect(mockRunSubset(all, () => true)).toEqual(all);
    const child = all.find(run => run.workflowId === "i9-lookup")!;
    expect(() => mockRunSubset([{ ...child, parentId: "missing" }], () => true)).toThrow("MOCK_QUEUE_PARENT_UNAVAILABLE");
  });
  it("parses every workflow into the canonical wire without enabling commands", () => {
    const runs = seedMockRuns(), rows = mockQueueSurfaces(runs, anchor);
    expect(rows).toHaveLength(runs.length);
    for (const [index, row] of rows.entries()) {
      expect(QueueSurfaceWireSchema.safeParse(row).success).toBe(true);
      expect(row.title).toBe(runs[index].subject);
      expect(row.actions).toEqual([]); expect(row.linkedRuns).toEqual([]);
      expect(row.resolvedInstances).toEqual([]);
      expect(row.session.state).toBe("absent"); expect(row.runNumber.state).toBe("absent");
      const { timeline, endTime, durationSeconds } = mockRunLog(runs[index]);
      expect(row.pipeline.map(step => step.label)).toEqual(timeline.map(stage => stage.label));
      expect(endTime >= timeline[timeline.length - 1].time!).toBe(true);
      expect(row.updatedAt).toBe(anchor);
      expect(Date.parse(row.updatedAt) - Date.parse(row.startedAt)).toBe(durationSeconds * 1000);
    }
  });
  it.each(["2026-08-03T00:00:01.000Z", "2026-08-03T03:15:00-07:00", "2026-11-01T01:00:01-08:00"])("anchors fixtures before an early or offset clock: %s", anchorIso => {
    const runs = seedMockRuns();
    for (const run of runs) {
      const row = mockQueueSurface(run, anchorIso, runs.find(parent => parent.id === run.parentId));
      const duration = mockRunLog(run).durationSeconds * 1000;
      expect(Date.parse(row.startedAt)).toBe(Date.parse(anchorIso) - duration);
      expect(Date.parse(row.updatedAt)).toBe(Date.parse(anchorIso));
      if (row.endedAt.state === "present") expect(Date.parse(row.endedAt.value) - Date.parse(row.startedAt)).toBe(duration);
      else {
        const later = Date.parse(anchorIso) + 60000;
        expect(later - Date.parse(row.startedAt)).toBe(duration + 60000);
        expect(mockQueueSurface(run, anchorIso, runs.find(parent => parent.id === run.parentId))).toEqual(row);
      }
    }
  });
  it("keeps presentation identities stable through edits, filters and reordering", () => {
    const runs = seedMockRuns(), contact = runs.find(run => run.workflowId === "ocr")!;
    const id = mockQueueId(contact.id);
    expect(mockQueueSurface({ ...contact, subject: "Renamed" }, anchor, runs.find(parent => parent.id === contact.parentId)).runId).toBe(id);
    expect(mockQueueSurfaces([...runs].reverse(), anchor).find(row => row.runId === id)?.title).toBe(contact.subject);
    expect(mockQueueSurfaces(mockQueueView(runs, ["needsYou"], "attention"), anchor, runs).some(row => row.runId === id)).toBe(true);
    expect(() => mockQueueSurfaces([contact, contact], anchor, runs)).toThrow("MOCK_QUEUE_ID_COLLISION");
    expect(() => mockQueueSurface(contact, "invalid-day")).toThrow();
  });
  it("shows approval gates only on pending preparation and retains independent child lineage", () => {
    const runs = seedMockRuns(), parent = runs.find(run => run.workflowId === "emergency-contact")!, source = runs.find(run => run.id === parent.ocrRunId)!;
    const waiting = mockQueueSurface(source, anchor, parent);
    expect(mockQueueSurface(parent, anchor).status).toBe("running");
    expect(mockQueueSurface(parent, anchor).liveMessage).toEqual({ state: "present", value: "Review extracted records" }); expect(mockQueueSurface(parent, anchor).gateOpenedAt.state).toBe("absent");
    expect(waiting.status).toBe("awaiting-approval"); expect(waiting.gateOpenedAt.state).toBe("present"); expect(waiting.endedAt.state).toBe("absent");
    const approved = approveMockRun(runs, source.id);
    const child = approved.find(run => run.parentId === parent.id && run.role === "person")!;
    const row = mockQueueSurface(child, anchor, parent);
    expect(row.parent?.visibility).toBe("linked"); expect(row.parent?.runId).toBe(mockQueueId(parent.id));
    expect(row.status).toBe("done"); expect(row.endedAt.state).toBe("present"); expect(row.gateOpenedAt.state).toBe("absent");
    const ocrRun = runs.find(run => run.workflowId === "ocr")!;
    const ocr = mockQueueSurface(ocrRun, anchor, runs.find(run => run.id === ocrRun.parentId));
    expect(ocr.status).toBe("awaiting-approval"); expect(ocr.gateOpenedAt.state).toBe("present");
  });
  it("keeps discarded records out of completed and approval counts and filters", () => {
    const runs = seedMockRuns(), parent = runs.find(run => run.workflowId === "ocr")!;
    const discarded = discardMockReview([parent], parent.id);
    expect(mockQueueSurface(discarded[0], anchor, runs.find(run => run.id === parent.parentId)).status).toBe("cancelled");
    expect(mockQueueView(discarded, ["done"], "attention")).toEqual([]);
    expect(mockQueueView(discarded, ["cancelled"], "attention")).toEqual(discarded);
    expect(mockQueueCounts(discarded)).toEqual([{ status: "awaiting-approval", count: 0 }, { status: "running", count: 0 }, { status: "done", count: 0 }, { status: "cancelled", count: 1 }]);
  });
});
