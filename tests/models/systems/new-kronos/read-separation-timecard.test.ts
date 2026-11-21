import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadSeparationTimecardOutputSchema } from "../../../../src/models/systems/new-kronos/read-separation-timecard.js";
import { NewKronosAppliedRangeSchema, NewKronosTimecardGridSchema } from "../../../../src/models/ui/new-kronos-timecard.js";

describe("read separation timecard output", () => {
  it("admits exactly the driver's applied range and grid proofs", () => {
    assert.equal(ReadSeparationTimecardOutputSchema.shape.range, NewKronosAppliedRangeSchema);
    assert.equal(ReadSeparationTimecardOutputSchema.shape.grid, NewKronosTimecardGridSchema);
  });

  it("still requires a matched subject", () => {
    const subject = {
      observationId: "new-kronos.timecard.displayed-eid", expectedEid: "10000001",
      observedEmployeeId: "10000001", observedDisplayName: "Doe, Jane",
    };
    const schema = ReadSeparationTimecardOutputSchema.shape.subject;
    assert.equal(schema.safeParse({ ...subject, matches: true }).success, true);
    assert.equal(schema.safeParse({ ...subject, matches: false }).success, false);
  });
});
