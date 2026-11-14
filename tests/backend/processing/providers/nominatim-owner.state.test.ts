import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { transitionNominatimOwner } from "../../../../src/backend/processing/providers/nominatim-owner.js";

/** Section 4 entry 52 of the processing-review-state design. Each cell is that table, not the implementation. */
const phases = ["running", "stopping", "stopped", "stop-failed"] as const;
const events = ["request", "attach", "stop", "drained", "drain-timeout"] as const;

const NOT_STOPPING = { refused: "not-stopping" } as const;
const UNAVAILABLE = { refused: "adapter-unavailable" } as const;
const CHANNEL = { refused: "channel-unavailable" } as const;

const expected = {
  running: {
    request: { effect: "queued" },
    attach: { effect: "attached" },
    stop: { effect: "stopping" },
    drained: NOT_STOPPING,
    "drain-timeout": NOT_STOPPING,
  },
  stopping: {
    request: UNAVAILABLE,
    attach: CHANNEL,
    stop: { effect: "same-promise" },
    drained: { effect: "stopped" },
    "drain-timeout": { effect: "stop-failed" },
  },
  stopped: {
    request: UNAVAILABLE,
    attach: CHANNEL,
    stop: { effect: "resolved" },
    drained: NOT_STOPPING,
    "drain-timeout": NOT_STOPPING,
  },
  "stop-failed": {
    request: UNAVAILABLE,
    attach: CHANNEL,
    stop: { effect: "same-rejection" },
    drained: NOT_STOPPING,
    "drain-timeout": NOT_STOPPING,
  },
} as const;

describe("geocode owner transition table", () => {
  for (const phase of phases) {
    for (const event of events) {
      it(`${phase} on ${event}`, () => {
        assert.deepEqual(transitionNominatimOwner(phase, event), expected[phase][event]);
      });
    }
  }
});
