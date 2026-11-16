// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, it, vi } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { LogSample } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import type { LogTimelineStage } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-timeline-model.js";
import { QueueSurfaceWireSchema, type StepInterruptWire } from "../../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-day.js";

const { useRunWiring, projectRunLogs } = vi.hoisted(() => ({ useRunWiring: vi.fn(), projectRunLogs: vi.fn() }));
vi.mock("../../../../../src/dashboard/state/client-context.js", () => ({ useDashboardClient: () => ({}), useDashboardCommandBinding: () => undefined }));
vi.mock("../../../../../src/dashboard/state/run-wiring-adapter.js", () => ({ projectRunLogs, useRunWiring }));
vi.mock("../../../../../src/dashboard/surfaces/run-detail/review/review.js", () => ({ RunReview: () => null }));

const timeline: readonly LogTimelineStage[] = [
  { id: "read", label: "Read", state: "completed", substeps: [] },
  { id: "verify", label: "Verify", state: "active", substeps: [] },
  { id: "finish", label: "Finish", state: "pending", substeps: [] },
];
const running = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.status === "running")!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useRunWiring.mockReset(); projectRunLogs.mockReset();
  useRunWiring.mockReturnValue({ state: "loaded", snapshot: { detail: { header: { title: "Lookup" }, availableSections: ["logs"] }, logs: {}, unavailableEvidence: [] } });
  projectRunLogs.mockReturnValue({ steps: [], timeline });
});

function render(state: "running" | "pause-pending" | "paused" | "unavailable", interrupt?: StepInterruptWire): string {
  const row = QueueSurfaceWireSchema.parse({ ...running, pauseControl: { state, expectedVersion: running.rowRevision },
    ...(interrupt === undefined ? {} : { interrupt }) });
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(LogSample, { source: "served", selection: { row, workflowLabel: "Person Lookup" } })));
}

describe("Logs timeline shows the served pause control and interrupt", () => {
  it("adds no pause line while running or unavailable", () => {
    assert.doesNotMatch(render("running"), /Pause recorded|This step/u);
    assert.doesNotMatch(render("unavailable"), /Pause recorded|This step/u);
  });
  it("names a pending pause by the served interrupt", () => {
    assert.match(render("pause-pending", { action: "pause", step: "cancel" }), /This step will restart/u);
    assert.match(render("pause-pending", { action: "pause", step: "finish-write" }), /Finishing the save first/u);
  });
  it("names the stop when the run is both pausing and stopping", () => {
    const both = render("pause-pending", { action: "stop", step: "cancel" });
    assert.match(both, /This step is cancelled/u);
    assert.doesNotMatch(both, /will restart/u);
  });
  it("records a completed pause", () => {
    assert.match(render("paused"), /Pause recorded\. Resume to continue\./u);
  });
});
