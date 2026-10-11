
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ReadSeparationDatesOutputSchema } from "../../../src/models/workflows/separations/read-separation-dates.js";
import { VerifyIdentityApprovalOutputSchema } from "../../../src/models/workflows/separations/verify-identity-approval.js";
import { VerifyTerminationReceiptOutputSchema } from "../../../src/models/workflows/separations/verify-termination-receipt.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { SeparationPlanSchema } from "../../../src/rules/separations/separation-dates.js";
import { KRONOS_TIMECARD_OMISSION,SeparationsResultSchema,UCPATH_TRANSACTION_OMISSION } from "../../../src/workflows/separations/workflow.js";
import { CURRENT_SEPARATIONS_RESULT } from "../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { COMPOSITION_SCOPE_OUTPUTS } from "../../support/helpers/separations-composition-fixtures.js";

const PLAN = SeparationPlanSchema.parse({
  documentNumber: "4444",
  employeeName: "Person, Deterministic",
  kualiLastDayWorked: "06/18/2026",
  kualiSeparationDate: "06/18/2026",
  asOfDate: "08/20/2026",
  timecardWindow: { start: "05/19/2026", end: "06/19/2026" },
});
const ASSERTED_AT = IsoInstantSchema.parse("2026-09-01T17:00:00.000Z");

describe("separations omittable write steps", () => {
  it("declares exactly the three write-side steps, in timeline order", () => {
    assert.deepEqual(
      separationsDescriptor.stepOmissions.map(({ step }) => step),
      ["kronos-timecard", "ucpath-transaction", "kuali-finalization"],
    );
    assert.deepEqual(
      separationsDescriptor.stepOmissions.map(({ produces }) => Object.keys(produces)),
      [["dates"], ["receipt"], []],
    );
  });

  it("producers rebuild schema-valid node outputs from the scope, and refuse a scope missing their upstream", () => {
    const datesProducer = KRONOS_TIMECARD_OMISSION.produces.dates;
    const receiptProducer = UCPATH_TRANSACTION_OMISSION.produces.receipt;
    assert.ok(datesProducer !== undefined && receiptProducer !== undefined);

    const dates = ReadSeparationDatesOutputSchema.parse(datesProducer({
      facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" },
      scope: { input: { documentNumber: "4444", timekeeperName: "Julian Zaw" }, outputs: { plan: PLAN } },
      assertedAt: ASSERTED_AT,
    }));
    assert.equal(dates.terminationEffectiveDate, "06/19/2026");
    assert.throws(
      () => datesProducer({ facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" }, scope: { input: { timekeeperName: "Julian Zaw" }, outputs: {} }, assertedAt: ASSERTED_AT }),
      /invalid input|expected object|Required|undefined/iu,
    );

    // The composition fixture's `jobs` is deliberately partial; the receipt
    // producer parses the whole approval output, so build a complete one.
    const approval = VerifyIdentityApprovalOutputSchema.parse({
      documentNumber: COMPOSITION_SCOPE_OUTPUTS.approval.documentNumber,
      approved: COMPOSITION_SCOPE_OUTPUTS.approval.approved,
      jobs: {
        disposition: "single-active-job",
        rowCount: 1,
        activeRowCount: 1,
        inactiveRowCount: 0,
        unknownRowCount: 0,
        rows: [{ rowIndex: 0, emplRecord: "0", hrStatus: "Active", tier: "active", department: "HDH Dining", jobTitle: "Cook", effectiveDate: "01/01/2020" }],
        unreadableCells: [],
      },
    });
    const receipt = VerifyTerminationReceiptOutputSchema.parse(receiptProducer({
      facts: { transactionNumber: "T002204014", approvalStatus: "Pending" },
      scope: { input: {}, outputs: { approval, dates } },
      assertedAt: ASSERTED_AT,
    }));
    assert.equal(receipt.emplId, approval.approved.emplId);
    assert.equal(receipt.displayedName, approval.approved.ucpathName);
    assert.equal(receipt.effectiveDate, dates.terminationEffectiveDate);
    assert.equal(receipt.disposition, "operator-asserted");
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
