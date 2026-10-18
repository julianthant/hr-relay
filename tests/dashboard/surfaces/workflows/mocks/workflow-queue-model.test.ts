import { describe,expect,it } from "vitest";
import { approveMockRun,mockQueueCounts,mockQueueView,mockRunLog,seedMockRuns } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { mockQueueId,mockQueueSurface,mockQueueSurfaces } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { discardMockReview } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";

const anchor = "2026-08-03T16:10:00.000Z";
describe("canonical workflow mock queue presentations", () => {
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
      const row = mockQueueSurface(run, anchorIso);
      const duration = mockRunLog(run).durationSeconds * 1000;
      expect(Date.parse(row.startedAt)).toBe(Date.parse(anchorIso) - duration);
      expect(Date.parse(row.updatedAt)).toBe(Date.parse(anchorIso));
      if (row.endedAt.state === "present") expect(Date.parse(row.endedAt.value) - Date.parse(row.startedAt)).toBe(duration);
      else {
        const later = Date.parse(anchorIso) + 60000;
        expect(later - Date.parse(row.startedAt)).toBe(duration + 60000);
        expect(mockQueueSurface(run, anchorIso)).toEqual(row);
      }
    }
  });
  it("keeps presentation identities stable through edits, filters and reordering", () => {
    const runs = seedMockRuns(), contact = runs.find(run => run.workflowId === "ocr")!;
    const id = mockQueueId(contact.id);
    expect(mockQueueSurface({ ...contact, subject: "Renamed" }, anchor).runId).toBe(id);
    expect(mockQueueSurfaces([...runs].reverse(), anchor).find(row => row.runId === id)?.title).toBe(contact.subject);
    expect(mockQueueSurfaces(mockQueueView(runs, ["needsYou"], "attention"), anchor).some(row => row.runId === id)).toBe(true);
    expect(() => mockQueueSurfaces([contact, contact], anchor)).toThrow("MOCK_QUEUE_ID_COLLISION");
    expect(() => mockQueueSurface(contact, "invalid-day")).toThrow();
  });
  it("shows approval gates only on pending preparation and retains independent child lineage", () => {
    const runs = seedMockRuns(), parent = runs.find(run => run.workflowId === "emergency-contact")!, source = runs.find(run => run.id === parent.ocrRunId)!;
    const waiting = mockQueueSurface(source, anchor);
    expect(mockQueueSurface(parent, anchor).status).toBe("running");
    expect(mockQueueSurface(parent, anchor).liveMessage).toEqual({ state: "present", value: "Read emergency contact" }); expect(mockQueueSurface(parent, anchor).gateOpenedAt.state).toBe("absent");
    expect(waiting.status).toBe("awaiting-approval"); expect(waiting.gateOpenedAt.state).toBe("present"); expect(waiting.endedAt.state).toBe("absent");
    const approved = approveMockRun(runs, source.id);
    const child = approved.find(run => run.parentId === parent.id && run.role === "person")!;
    const row = mockQueueSurface(child, anchor);
    expect(row.containment).toBe("linked"); expect(row.lineage).toEqual({ state: "child", parentRunId: mockQueueId(parent.id) });
    expect(row.status).toBe("done"); expect(row.endedAt.state).toBe("present"); expect(row.gateOpenedAt.state).toBe("absent");
    const ocr = mockQueueSurface(runs.find(run => run.workflowId === "ocr")!, anchor);
    expect(ocr.status).toBe("awaiting-approval"); expect(ocr.gateOpenedAt.state).toBe("present");
  });
  it("keeps discarded records out of completed and approval counts and filters", () => {
    const parent = seedMockRuns().find(run => run.workflowId === "ocr")!;
    const discarded = discardMockReview([parent], parent.id);
    expect(mockQueueSurface(discarded[0], anchor).status).toBe("cancelled");
    expect(mockQueueView(discarded, ["done"], "attention")).toEqual([]);
    expect(mockQueueView(discarded, ["cancelled"], "attention")).toEqual(discarded);
    expect(mockQueueCounts(discarded)).toEqual([{ status: "awaiting-approval", count: 0 }, { status: "running", count: 0 }, { status: "done", count: 0 }, { status: "cancelled", count: 1 }]);
  });
});
