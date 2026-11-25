import assert from "node:assert/strict";
import { describe, it } from "vitest";
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
