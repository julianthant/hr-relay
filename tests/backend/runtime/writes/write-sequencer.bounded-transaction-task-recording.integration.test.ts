
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import {
invokeBoundedTask
} from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { TaskIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import {
WRITE_FIXTURE_EID,
WRITE_FIXTURE_NOW
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { ManualScheduler,recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";

describe("bounded transaction task recording", () => {
  it("publishes a whole recordData call before a later throw and reads the wall clock once", async () => {
    const baseClock = manualClock(new Date(WRITE_FIXTURE_NOW));
    let wallClockReads = 0;
    const clock: TestClock = {
      ...baseClock,
      now(): Date {
        wallClockReads += 1;
        return baseClock.now();
      },
    };
    const batches: { recordedAt: string; fields: readonly string[] }[] = [];

    await assert.rejects(
      invokeBoundedTask(
        {
          clock,
          scheduler: new ManualScheduler(clock),
          taskDeadlineMs: 60_000,
          log: recordingLogger().log,
        },
        TaskIdSchema.parse("ucpath/read-write-fixture-probe"),
        new AbortController().signal,
        async (_signal, recordData) => {
          recordData([
            { direction: "read", field: "state", value: "absent" },
            { direction: "read", field: "eid", value: WRITE_FIXTURE_EID },
          ]);
          assert.equal(batches.length, 1, "record-time sink runs before task continuation");
          throw new Error("later probe failure");
        },
        (batch) => batches.push({
          recordedAt: batch.recordedAt,
          fields: batch.points.map(({ field }) => field),
        }),
      ),
      /later probe failure/u,
    );

    assert.deepEqual(batches, [{ recordedAt: WRITE_FIXTURE_NOW, fields: ["state", "eid"] }]);
    assert.equal(wallClockReads, 1, "one recordData call owns one instant, not one per point or field");
  });
});

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
