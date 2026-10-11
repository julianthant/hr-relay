
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { timelineEventDuration } from "../../../src/models/dashboard/run-detail.js";
import {
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

describe("a timeline event's own measured duration", () => {

  it("reads a FROZEN record with no duration leaf forward, by name", () => {

    const measured = timelineEventDuration({});
    assert.equal(measured.state, "absent");
    assert.match(measured.state === "absent" ? measured.reason : "", /frozen before per-step durations/);
  });
});
