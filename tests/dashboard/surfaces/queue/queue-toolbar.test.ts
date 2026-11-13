import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { PauseAllQuitControls, RunPauseControl } from "../../../../src/dashboard/surfaces/queue/queue-toolbar.js";

describe("pause labels", () => {
  it("renders each served step interrupt and does not claim the step finishes", () => {
    const restart = renderToStaticMarkup(createElement(RunPauseControl, { runLabel: "Alex", state: "pause-pending", interrupt: { action: "pause", step: "cancel" } }));
    assert.match(restart, /This step will restart/u);
    const cancelled = renderToStaticMarkup(createElement(RunPauseControl, { runLabel: "Alex", state: "pause-pending", interrupt: { action: "stop", step: "cancel" } }));
    assert.match(cancelled, /This step is cancelled/u);
    const save = renderToStaticMarkup(createElement(RunPauseControl, { runLabel: "Alex", state: "pause-pending", interrupt: { action: "pause", step: "finish-write" } }));
    assert.match(save, /Finishing the save first/u);
    const bare = renderToStaticMarkup(createElement(RunPauseControl, { runLabel: "Alex", state: "pause-pending" }));
    assert.match(bare, /Pause is not yet recorded/u);
    assert.doesNotMatch(bare, /never interrupted|after this step/u);
    const pausing = renderToStaticMarkup(createElement(PauseAllQuitControls, { state: "pausing", activeCount: 2 }));
    assert.match(pausing, /Pauses are not yet confirmed\. A save in progress finishes first\./u);
    assert.match(pausing, /A save in progress finishes first\. Other steps restart on Resume\./u);
    assert.doesNotMatch(pausing, /after their current step|Finishing current steps/u);
    const quit = renderToStaticMarkup(createElement(PauseAllQuitControls, { state: "ready", activeCount: 2, quitRequested: true }));
    assert.match(quit, /A save in progress finishes first\. Other steps restart on Resume\./u);
    assert.doesNotMatch(quit, /Resume them next time/u);
  });
});
