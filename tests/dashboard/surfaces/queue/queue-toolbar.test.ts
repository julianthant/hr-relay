// @vitest-environment jsdom
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { bulkUnavailableSentence } from "../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { PAUSE_ALL_EFFECT } from "../../../../src/dashboard/surfaces/shared/status/status-model.js";

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

describe("quit dialog", () => {
  it("says what pausing does and does not claim the step finishes", () => {
    assert.match(PAUSE_ALL_EFFECT, /A save in progress finishes first\. Other steps restart on Resume\./u);
    assert.doesNotMatch(PAUSE_ALL_EFFECT, /Resume them next time|after their current step|Finishing current steps/u);
  });
});
