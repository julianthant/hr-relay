// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { WorkflowMockQueue } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-queue.js";
import { seedMockRuns } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";

describe("mock Queue clock wiring", () => {
  it("keeps elapsed growing across midnight and a selected-day change", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const run = seedMockRuns().find(run => run.workflowId === "emergency-contact");
    if (!run) throw new Error("Missing pending fixture");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = async (day: string, nowIso: string) => {
      await act(async () => root.render(createElement(TooltipProvider, null, createElement(WorkflowMockQueue, {
        label: "Emergency Contact", runs: [run], allRuns: [run], day, nowIso,
        anchorIso: "2026-08-03T23:59:30.000Z", sort: "attention",
        onSelect() {}, onRetry() {}, onDelete() {},
      }))));
      const footer = container.querySelector("[data-queue-row-footer]");
      if (!footer) throw new Error("Missing Queue footer");
      return footer.firstElementChild?.lastElementChild?.textContent;
    };
    try {
      expect(await render("2026-08-03", "2026-08-03T23:59:30.000Z")).toBe("0s");
      expect(await render("2026-08-03", "2026-08-04T00:00:30.000Z")).toBe("1m 0s");
      expect(await render("2026-08-02", "2026-08-04T00:00:30.000Z")).toBe("1m 0s");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
