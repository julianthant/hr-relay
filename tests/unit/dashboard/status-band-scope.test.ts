/**
 * The status band answers ONE question about ONE scope (R4-1/R4-2).
 *
 * The band's pills and its `All` segment used to come from two different served
 * aggregations at two different scopes: the eight pills read the day's
 * `statusCounts` folded across every workflow, while `All` read the day total
 * out of `monthCounts`. The queue underneath renders one workflow, so `Failed 3`
 * could sit above a queue with no failures and the ported title "Every row in
 * this view" was false.
 *
 * These are pure functions over the SERVED arrays — nothing here folds a row,
 * which `shell.tsx:1-17` refuses by name (D81's one count path). The test pins
 * exactly that: the scope selector reads one workflow's entry, and the two
 * composites are closed under addition with the primitives beside them.
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { WorkflowCountWireSchema } from "../../../src/domain/dashboard/projection.js";
import {
  activeCount,
  activeStatusWords,
  needsYouCount,
  statusCount,
  statusPillOrder,
  totalCount,
  workflowStatusCounts,
} from "../../../src/dashboard/surfaces/shell-model.js";

/**
 * Two workflows on one day, with deliberately different shapes — PARSED through
 * the wire schema, so the fixture cannot drift from what the server may serve
 * (the schema also refines that each entry's per-status counts sum to `count`,
 * which is the fact `totalCount` relies on).
 */
const WORKFLOW_COUNTS = z.array(WorkflowCountWireSchema).parse([
  {
    workflowId: "person-lookup",
    count: 6,
    statusCounts: [
      { status: "queued", count: 2 },
      { status: "running", count: 1 },
      { status: "done", count: 3 },
    ],
  },
  {
    workflowId: "separations-kuali-read",
    count: 5,
    statusCounts: [
      { status: "failed", count: 3 },
      { status: "awaiting-approval", count: 1 },
      { status: "blocked", count: 1 },
    ],
  },
]);

describe("workflowStatusCounts — the band's scope selector", () => {
  it("reads the ACTIVE workflow's entry, not the day's fold", () => {
    expect(workflowStatusCounts(WORKFLOW_COUNTS, "person-lookup")).toEqual(
      WORKFLOW_COUNTS[0].statusCounts,
    );
    expect(statusCount(workflowStatusCounts(WORKFLOW_COUNTS, "person-lookup"), "failed")).toBe(0);
    expect(statusCount(workflowStatusCounts(WORKFLOW_COUNTS, "separations-kuali-read"), "failed")).toBe(3);
  });

  /**
   * A workflow with no row today has no entry in the served array, and that IS
   * zero — the projection builds the array by folding the surfaces it serves.
   * The band must still draw its eight slots rather than vanish.
   */
  it("answers an unserved workflow with an empty array, so every pill reads zero", () => {
    const none = workflowStatusCounts(WORKFLOW_COUNTS, "workflow-with-no-row");
    expect(none).toEqual([]);
    expect(totalCount(none)).toBe(0);
    expect(activeCount(none)).toBe(0);
    expect(needsYouCount(none)).toBe(0);
  });
});

describe("totalCount — the `All` segment (R4-2)", () => {
  it("keeps Cancelling active and selectable, including after its selected bucket empties", () => {
    const counts = z.array(WorkflowCountWireSchema).parse([{
      workflowId: "person-lookup", count: 4,
      statusCounts: [{ status: "cancelling", count: 3 }, { status: "done", count: 1 }],
    }])[0].statusCounts;
    expect(activeCount(counts)).toBe(3);
    expect(activeStatusWords(counts)).toBe("queued, running or cancelling");
    expect(activeStatusWords([])).toBe("queued or running");
    expect(needsYouCount(counts)).toBe(0);
    expect(totalCount(counts)).toBe(4);
    expect(statusPillOrder(counts, "all")).toContain("cancelling");
    expect(statusPillOrder([], "cancelling")).toContain("cancelling");
    expect(statusPillOrder([], "all")).toHaveLength(8);
  });

  it("folds the SAME array the pills render, and matches the served row total", () => {
    for (const entry of WORKFLOW_COUNTS) {
      expect(totalCount(entry.statusCounts)).toBe(entry.count);
    }
  });

  it("stays closed under addition with the composites beside it", () => {
    const separations = workflowStatusCounts(WORKFLOW_COUNTS, "separations-kuali-read");
    // needsYou is the ONLY deliberate overlap, and it is a sum of two pills.
    expect(needsYouCount(separations)).toBe(2);
    expect(activeCount(separations)).toBe(0);
    expect(totalCount(separations)).toBe(
      statusCount(separations, "failed") + needsYouCount(separations),
    );
  });
});
