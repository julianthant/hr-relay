import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { WORKFLOW_SOURCES } from "../../../../src/dashboard/app/workflow-sources.js";
import { WorkerCard } from "../../../../src/dashboard/surfaces/sessions/worker-card.js";
import { sessionsFromDay } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { DashboardDayWireSchema, type StepInterruptWire } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../../support/fixtures/dashboard/fixture-day.js";

const catalog = buildWorkflowCatalog([], true, Object.fromEntries(Object.entries(WORKFLOW_SOURCES).map(([id, source]) => [id, source === "hidden" ? source : "mock" as const])));

/** Render worker 1 of the served fixture day with the served directive and interrupt, as the sessions view builds it. */
function render(directive: "run" | "pause" | "stop", interrupt?: StepInterruptWire, state: "running" | "paused" = "running"): string {
  const day = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerCards: FIXTURE_DAY_WIRE.workerCards.map((card, index) =>
    index === 0 ? { ...card, state, directive, ...(interrupt === undefined ? {} : { interrupt }) } : card) });
  const view = sessionsFromDay(day, catalog, FIXTURE_NOW);
  assert.equal(view.state, "ready");
  if (view.state !== "ready") throw new Error("ready view required");
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(WorkerCard, { worker: view.workers[0], onControl: () => undefined })));
}

describe("worker card shows the served pause and stop interrupt", () => {
  it("shows no pending sentence for a running worker", () => {
    assert.doesNotMatch(render("run"), /This step|Finishing the save/u);
  });
  it("names a pausing step by what happens to it", () => {
    assert.match(render("pause", { action: "pause", step: "cancel" }), /This step will restart/u);
    assert.match(render("pause", { action: "pause", step: "finish-write" }), /Finishing the save first/u);
  });
  it("names a stopping step, also when a pause is pending beside the stop", () => {
    assert.match(render("stop", { action: "stop", step: "cancel" }), /This step is cancelled/u);
    const both = render("pause", { action: "stop", step: "cancel" });
    assert.match(both, /This step is cancelled/u);
    assert.doesNotMatch(both, /will restart/u);
  });
  it("derives no sentence from a directive and a state without a served interrupt", () => {
    assert.doesNotMatch(render("pause"), /This step|Finishing the save|Resume requested/u);
    assert.doesNotMatch(render("run", undefined, "paused"), /Resume requested/u);
  });
});
