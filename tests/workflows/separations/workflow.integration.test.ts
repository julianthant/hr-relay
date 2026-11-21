import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReadSeparationDatesOutputSchema } from "../../../src/models/workflows/separations/read-separation-dates.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { SeparationPlanSchema } from "../../../src/rules/separations/separation-dates.js";
import { KRONOS_TIMECARD_OMISSION, SeparationsResultSchema } from "../../../src/workflows/separations/workflow.js";
import { CURRENT_SEPARATIONS_RESULT } from "../../support/fixtures/integration/separations-run-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

const PLAN = SeparationPlanSchema.parse({
  documentNumber: "4444",
  employeeName: "Person, Deterministic",
  kualiLastDayWorked: "06/18/2026",
  kualiSeparationDate: "06/18/2026",
  asOfDate: "08/20/2026",
  timecardWindow: { start: "05/19/2026", end: "06/19/2026" },
});
const ASSERTED_AT = IsoInstantSchema.parse("2026-09-01T17:00:00.000Z");

describe("separations typed timecard step", () => {
  it("declares typed values only for the timecard step; the write steps always run", () => {
    assert.deepEqual(
      separationsDescriptor.stepOmissions.map(({ step }) => step),
      ["kronos-timecard"],
    );
    assert.deepEqual(
      separationsDescriptor.stepOmissions.map(({ produces }) => Object.keys(produces)),
      [["dates"]],
    );
  });

  it("the timecard producer rebuilds a schema-valid dates output from the scope, and refuses a scope missing its upstream", () => {
    const datesProducer = KRONOS_TIMECARD_OMISSION.produces.dates;
    assert.ok(datesProducer !== undefined);

    const dates = ReadSeparationDatesOutputSchema.parse(datesProducer({
      facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" },
      scope: { input: { documentNumber: "4444", timekeeperInitials: "JZ" }, outputs: { plan: PLAN } },
      assertedAt: ASSERTED_AT,
    }));
    assert.equal(dates.terminationEffectiveDate, "06/19/2026");
    assert.throws(
      () => datesProducer({ facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" }, scope: { input: { timekeeperInitials: "JZ" }, outputs: {} }, assertedAt: ASSERTED_AT }),
      /invalid input|expected object|Required|undefined/iu,
    );
  });

  it("keeps every earlier result parseable and admits the omitted arms", () => {
    assert.deepEqual(SeparationsResultSchema.parse(CURRENT_SEPARATIONS_RESULT), CURRENT_SEPARATIONS_RESULT);
    const omitted = SeparationsResultSchema.parse({
      ...CURRENT_SEPARATIONS_RESULT,
      pendingSweep: { state: "omitted", step: "ucpath-transaction" },
      finalization: { state: "omitted", step: "kuali-finalization" },
    });
    assert.deepEqual(omitted.pendingSweep, { state: "omitted", step: "ucpath-transaction" });
    assert.equal(SeparationsResultSchema.safeParse({ ...CURRENT_SEPARATIONS_RESULT, finalization: { state: "omitted" } }).success, false);
  });
});
