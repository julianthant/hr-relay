import { describe, expect, it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { approveMockRun, mockQueueCounts, mockQueueView, seedMockRuns } from "../../../src/dashboard/surfaces/workflow-mock-model.js";
import { mockQueueId, mockQueueSurface, mockQueueSurfaces } from "../../../src/dashboard/surfaces/workflow-queue-model.js";
import { discardMockReview } from "../../../src/dashboard/surfaces/workflow-review-model.js";

const day = "2026-08-03";
describe("canonical workflow mock queue presentations", () => {
  it("parses every workflow into the canonical wire without enabling commands", () => {
    const runs = seedMockRuns(), rows = mockQueueSurfaces(runs, day);
    expect(rows).toHaveLength(runs.length);
    for (const [index, row] of rows.entries()) {
      expect(QueueSurfaceWireSchema.safeParse(row).success).toBe(true);
      expect(row.title).toBe(runs[index].subject);
      expect(row.actions).toEqual([]); expect(row.linkedRuns).toEqual([]);
      expect(row.resolvedInstances).toEqual([]);
      expect(row.session.state).toBe("absent"); expect(row.runNumber.state).toBe("absent");
    }
  });
  it("keeps presentation identities stable through edits, filters and reordering", () => {
    const runs = seedMockRuns(), contact = runs.find(run => run.workflowId === "emergency-contact")!;
    const id = mockQueueId(contact.id);
    expect(mockQueueSurface({ ...contact, subject: "Renamed" }, day).runId).toBe(id);
    expect(mockQueueSurfaces([...runs].reverse(), day).find(row => row.runId === id)?.title).toBe(contact.subject);
    expect(mockQueueSurfaces(mockQueueView(runs, ["needsYou"], "attention"), day).some(row => row.runId === id)).toBe(true);
    expect(() => mockQueueSurfaces([contact, contact], day)).toThrow("MOCK_QUEUE_ID_COLLISION");
    expect(() => mockQueueSurface(contact, "invalid-day")).toThrow();
  });
  it("shows approval gates only on pending preparation and retains independent child lineage", () => {
    const runs = seedMockRuns(), parent = runs.find(run => run.workflowId === "emergency-contact")!;
    const waiting = mockQueueSurface(parent, day);
    expect(waiting.status).toBe("awaiting-approval"); expect(waiting.gateOpenedAt.state).toBe("present"); expect(waiting.endedAt.state).toBe("absent");
    const approved = approveMockRun(runs, parent.id);
    const child = approved.find(run => run.parentId === parent.id)!;
    const row = mockQueueSurface(child, day);
    expect(row.containment).toBe("linked"); expect(row.lineage).toEqual({ state: "child", parentRunId: waiting.runId });
    expect(row.status).toBe("done"); expect(row.endedAt.state).toBe("present"); expect(row.gateOpenedAt.state).toBe("absent");
    const ocr = mockQueueSurface(runs.find(run => run.workflowId === "ocr")!, day);
    expect(ocr.status).toBe("done"); expect(ocr.gateOpenedAt.state).toBe("absent");
  });
  it("keeps discarded records out of completed and approval counts and filters", () => {
    const parent = seedMockRuns().find(run => run.workflowId === "onbase")!;
    const discarded = discardMockReview([parent], parent.id);
    expect(mockQueueSurface(discarded[0], day).status).toBe("cancelled");
    expect(mockQueueView(discarded, ["done"], "attention")).toEqual([]);
    expect(mockQueueView(discarded, ["cancelled"], "attention")).toEqual(discarded);
    expect(mockQueueCounts(discarded)).toEqual([{ status: "awaiting-approval", count: 0 }, { status: "done", count: 0 }, { status: "cancelled", count: 1 }]);
  });
});
