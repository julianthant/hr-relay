import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
activityRangeValue,
parseActivityRange,
} from "../../../../src/dashboard/surfaces/activity/activity-model.js";

describe("Activity date range model", () => {
  it("keeps the URL from..to shape", () => {
    const parsed = parseActivityRange("2025-12-31..2026-01-01", "2026-01-02");
    assert.deepEqual(parsed, { from: "2025-12-31", to: "2026-01-01" });
    assert.equal(activityRangeValue(parsed), "2025-12-31..2026-01-01");
  });

  it("refuses malformed, impossible, incomplete, and reversed ranges without substitution", () => {
    assert.match(parseActivityRange("", "2026-02-30").refusal ?? "", /requested range was not replaced/u);
    for (const value of [
      "2026-09-10..2026-09-08",
      "2026-02-30..2026-03-01",
      "2026-09-08..",
      "2026-09-08..2026-09-09..extra",
      "2026-9-08..2026-09-09",
      "+010000-01-01..+010000-01-02",
    ]) {
      assert.match(parseActivityRange(value, "2026-09-10").refusal ?? "", /requested range was not replaced/u);
    }
  });
});
