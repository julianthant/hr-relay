import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { PauseAllQuitControls, RunPauseControl } from "../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { queuePauseLabel } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import type { QueueSurfaceWire, StepInterruptWire } from "../../../../src/models/dashboard/projection.js";

type Control = NonNullable<QueueSurfaceWire["pauseControl"]>;
const row = (state: Control["state"], command?: Control["command"]) => ({ pauseControl: { state, expectedVersion: 1, ...(command === undefined ? {} : { command }) } }) as QueueSurfaceWire;
const render = (state: Control["state"], command?: Control["command"], interrupt?: StepInterruptWire) =>
  renderToStaticMarkup(createElement(RunPauseControl, { runLabel: "Alex", state, onAction: () => undefined, ...(command === undefined ? {} : { command }), ...(interrupt === undefined ? {} : { interrupt }) }));

describe("run toolbar shows the served pause control", () => {
  it("takes the button word from the served command", () => {
    assert.match(render("running", "pause"), />Pause</u);
    assert.match(render("paused", "resume"), />Resume</u);
    assert.match(render("pause-pending"), />Pausing…</u);
    assert.match(render("pause-pending", "resume"), />Resume</u);
    assert.match(render("unavailable"), /pause authority is unavailable/u);
  });
  it("disables the button only when the backend serves no command", () => {
    assert.doesNotMatch(render("running", "pause"), /disabled=""/u);
    assert.doesNotMatch(render("paused", "resume"), /disabled=""/u);
    assert.match(render("pause-pending"), /disabled=""/u);
    assert.match(render("unavailable"), /disabled=""/u);
    assert.doesNotMatch(render("pause-pending", "resume"), /disabled=""/u);
  });
  it("names the served interrupt for a run both pausing and stopping by its stop", () => {
    assert.match(render("pause-pending", undefined, { action: "stop", step: "cancel" }), /This step is cancelled/u);
    assert.match(render("pause-pending", undefined, { action: "stop", step: "finish-write" }), /Finishing the save first/u);
  });
  it("labels the queue row from the served state", () => {
    assert.equal(queuePauseLabel(row("paused", "resume")), "Paused");
    assert.equal(queuePauseLabel(row("pause-pending")), "Pausing");
    assert.equal(queuePauseLabel(row("running", "pause")), undefined);
    assert.equal(queuePauseLabel(row("unavailable")), undefined);
  });
});

describe("Pause all shows the served application state", () => {
  const all = (state: "ready" | "pausing" | "paused" | "unavailable") => renderToStaticMarkup(createElement(PauseAllQuitControls, { state, activeCount: 2, onPauseAll: () => undefined, onResumeAll: () => undefined }));
  it("offers Pause all when ready and Resume all when paused", () => {
    assert.match(all("ready"), /aria-label="Pause all runs"/u);
    assert.match(all("paused"), /aria-label="Resume all runs"/u);
  });
  it("disables the control while pausing or unavailable", () => {
    assert.match(all("pausing"), /Pauses are not yet confirmed/u);
    assert.match(all("pausing"), /disabled=""/u);
    assert.match(all("unavailable"), /Pause all is unavailable/u);
  });
});
