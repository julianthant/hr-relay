import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { PauseAllQuitControls } from "../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { queuePauseLabel } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import type { QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";

type Control = NonNullable<QueueSurfaceWire["pauseControl"]>;
const row = (state: Control["state"], command?: Control["command"]) => ({ pauseControl: { state, expectedVersion: 1, ...(command === undefined ? {} : { command }) } }) as QueueSurfaceWire;
describe("the queue row shows the served pause state", () => {
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
  it("dims Pause all with its reason when nothing is running", () => {
    const idle = renderToStaticMarkup(createElement(PauseAllQuitControls, { state: "ready", activeCount: 0, onPauseAll: () => undefined }));
    assert.match(idle, /title="No runs to pause"/u);
    assert.match(idle, /disabled=""/u);
  });
});
