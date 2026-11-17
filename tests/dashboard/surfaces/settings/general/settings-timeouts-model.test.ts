import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { timeoutSetting } from "../../../../../src/dashboard/surfaces/settings/general/settings-timeouts-model.js";

describe("Performance time limits", () => {
  it("describes Task as the time for one worker task after a session is ready", () => {
    assert.equal(timeoutSetting("timeouts.taskMs")?.description, "Maximum time for one worker task after a session is ready.");
  });
});
