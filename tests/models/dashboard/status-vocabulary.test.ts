import { createActivityReportFixtures } from "../../support/helpers/dashboard/activity-report-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { dsStatusOf,PROPOSED_STATUS } from "../../../src/dashboard/surfaces/shared/status/status-model.js";
import {
activityReportCaveats
} from "../../../src/models/dashboard/activity.js";
import {
DISPLAY_STATUS_LABELS,
displayStatusOf,
displayStatusProseLabelOf,
} from "../../../src/models/dashboard/status-vocabulary.js";

const { FILLED } = createActivityReportFixtures();

describe("the Activity report's CSV export", () => {
  it("uses the shared display vocabulary and sentence treatment for all closed statuses", () => {
    const caveat = activityReportCaveats(FILLED).find((value) => value.startsWith("Error rate counts"));
    assert.ok(caveat);
    assert.equal(DISPLAY_STATUS_LABELS[displayStatusOf("blocked")], PROPOSED_STATUS[dsStatusOf("blocked")].label);
    assert.equal(DISPLAY_STATUS_LABELS.parked, "Write parked");
    assert.equal(
      caveat,
      "Error rate counts only runs that reached a terminal state. Anything queued, running, waiting on you "
      + "or write parked is excluded and reported separately as still open, so a busy span cannot read as a finished one.",
    );
    assert.equal(caveat.includes("blocked"), false);

    const proseLabels = [
      ["queued", "queued"],
      ["running", "running"],
      ["blocked", "write parked"],
      ["awaiting-approval", "waiting on you"],
      ["done", "done"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
      ["partial", "done with warnings"],
    ] as const;
    for (const [status, expected] of proseLabels) {
      assert.equal(displayStatusProseLabelOf(status), expected);
    }
  });
});
