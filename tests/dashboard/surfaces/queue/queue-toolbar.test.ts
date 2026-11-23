// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { bulkUnavailableSentence } from "../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { PauseAllQuitControls } from "../../../../src/dashboard/surfaces/queue/queue-toolbar.js";

describe("the review dialog's third bucket", () => {
  it("speaks in the PAST about rows that were already gone when the batch was sent", () => {
    const text = bulkUnavailableSentence(2, "past");
    assert.equal(text, "2 selected rows were no longer on this day when this batch was sent, so nothing was sent for them");
    assert.notEqual(text, bulkUnavailableSentence(2, "present"), "the present-tense sentence must not be the one pinned to a past instant");
  });

  it("agrees with itself in the SINGULAR too", () => {
    assert.equal(bulkUnavailableSentence(1, "past"), "1 selected row was no longer on this day when this batch was sent, so nothing was sent for it");
  });
});

describe("pause labels", () => {
  it("renders each served step interrupt and does not claim the step finishes", () => {
    const pausing = renderToStaticMarkup(createElement(PauseAllQuitControls, { state: "pausing", activeCount: 2 }));
    assert.match(pausing, /Pauses are not yet confirmed\. A save in progress finishes first\./u);
    assert.match(pausing, /A save in progress finishes first\. Other steps restart on Resume\./u);
    assert.doesNotMatch(pausing, /after their current step|Finishing current steps/u);
    const quit = renderToStaticMarkup(createElement(PauseAllQuitControls, { state: "ready", activeCount: 2, quitRequested: true }));
    assert.match(quit, /A save in progress finishes first\. Other steps restart on Resume\./u);
    assert.doesNotMatch(quit, /Resume them next time/u);
  });
});
