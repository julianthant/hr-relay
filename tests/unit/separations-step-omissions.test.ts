/**
 * D307 — Separations' omittable steps (slice one: Kronos timecard, UCPath
 * transaction, Kuali finalization). Proves the declarations the step folders
 * author, the plan and cascade the real graph yields, the pure builders the
 * producers rebuild from, and the result's omitted arms.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { ReadSeparationDatesOutputSchema } from "../../src/domain/contracts/separations/read-separation-dates.js";
import { VerifyIdentityApprovalOutputSchema } from "../../src/domain/contracts/separations/verify-identity-approval.js";
import { VerifyTerminationReceiptOutputSchema } from "../../src/domain/contracts/separations/verify-termination-receipt.js";
import { IsoInstantSchema } from "../../src/domain/ids.js";
import { SeparationPlanSchema, assertSeparationDates } from "../../src/domain/separations/separation-dates.js";
import { assertTerminationReceipt } from "../../src/domain/separations/termination-receipt.js";
import {
  planStepOmissions,
  stepOmissionCascade,
  type StepOmissionGraphView,
} from "../../src/domain/workflow/step-omission.js";
import { SeparationsResultSchema, separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
import { KRONOS_TIMECARD_OMISSION } from "../../src/workflows/separations/kronos-timecard/omission.js";
import { UCPATH_TRANSACTION_OMISSION } from "../../src/workflows/separations/ucpath-transaction/omission.js";
import { COMPOSITION_SCOPE_OUTPUTS } from "./fixtures/separations-composition-fixtures.js";
import { CURRENT_SEPARATIONS_RESULT } from "./fixtures/activity-person-pseudonym-fixtures.js";

const PLAN = SeparationPlanSchema.parse({
  documentNumber: "4444",
  employeeName: "Person, Deterministic",
  kualiLastDayWorked: "06/18/2026",
  kualiSeparationDate: "06/18/2026",
  asOfDate: "08/20/2026",
  timecardWindow: { start: "05/19/2026", end: "06/19/2026" },
});
const ASSERTED_AT = IsoInstantSchema.parse("2026-09-01T17:00:00.000Z");

function graphView(): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(separationsDescriptor).map((node) => ({
      id: String(node.id), kind: node.kind, dependsOn: node.dependsOn.map(String),
    })),
    timeline: separationsDescriptor.timeline,
    stepOmissions: separationsDescriptor.stepOmissions,
  };
}

describe("separations omittable steps (D307, slice one)", () => {
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

  it("forces no other step out and blocks on none", () => {
    const rows = stepOmissionCascade(graphView());
    assert.deepEqual([...rows.entries()], [
      ["kronos-timecard", { state: "omittable", forces: [] }],
      ["ucpath-transaction", { state: "omittable", forces: [] }],
      ["kuali-finalization", { state: "omittable", forces: [] }],
    ]);
  });

  it("classifies each omission over the real graph: browser reads and transactions omitted, folds asserted", () => {
    const view = graphView();
    const kronos = planStepOmissions(view, [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } }]);
    assert.deepEqual(kronos.refusals, []);
    assert.deepEqual([...kronos.omitted.keys()], ["timecard-search", "timecard"]);
    assert.deepEqual([...kronos.asserted.keys()], ["dates"]);

    const ucpath = planStepOmissions(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } }]);
    assert.deepEqual(ucpath.refusals, []);
    assert.deepEqual([...ucpath.omitted.keys()], ["clear-pending", "file-termination"]);
    assert.deepEqual([...ucpath.asserted.keys()], ["receipt"]);

    const finalization = planStepOmissions(view, [{ step: "kuali-finalization", facts: {} }]);
    assert.deepEqual(finalization.refusals, []);
    assert.deepEqual([...finalization.omitted.keys()], ["finalize-kuali"]);
    assert.equal(finalization.asserted.size, 0);

    const all = planStepOmissions(view, [
      { step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } },
      { step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } },
      { step: "kuali-finalization", facts: {} },
    ]);
    assert.deepEqual(all.refusals, []);

    // A read step nothing declares stays exactly as locked as D285 left it.
    const identity = planStepOmissions(view, [{ step: "identity-check", facts: {} }]);
    assert.deepEqual(identity.refusals.map(({ code }) => code), ["step-not-omittable"]);
    // The UCPath approval status is closed to the statuses a receipt may carry.
    const denied = planStepOmissions(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Denied" } }]);
    assert.deepEqual(denied.refusals.map(({ code }) => code), ["facts-invalid"]);
  });

  it("rebuilds the reconciled dates from a typed pair with no invented leave and an honest comment", () => {
    const dates = assertSeparationDates({ plan: PLAN, timekeeperName: "Julian Zaw", lastDayWorked: "06/18/2026", separationDate: "06/19/2026" });
    assert.equal(dates.terminationEffectiveDate, "06/20/2026");
    assert.equal(dates.lastDayWorkedChanged, false);
    assert.equal(dates.separationDateChanged, true);
    assert.deepEqual(
      [dates.latestSickDate, dates.firstHolidayDate, dates.latestHolidayDate, dates.separationDeterminingLeave, dates.unclassifiedPayCodes],
      [null, null, null, null, []],
    );
    assert.match(dates.dateChangeComments, /Updated Separation Date from 06\/18\/2026 to 06\/19\/2026 per operator entry at run start\. -JZ/u);
    assert.doesNotMatch(dates.dateChangeComments, /Kronos/u);
    assert.doesNotMatch(dates.terminationComments, /Sick Leave|Holiday Pay/u);
    assert.throws(
      () => assertSeparationDates({ plan: PLAN, timekeeperName: "Julian Zaw", lastDayWorked: "06/19/2026", separationDate: "06/18/2026" }),
      /precedes the asserted last day worked/u,
    );
  });

  it("rebuilds a receipt from a typed number and status, and refuses what a live receipt would refuse", () => {
    const receipt = assertTerminationReceipt({
      transactionNumber: "T002204014", approvalStatus: "Approved",
      approvedEmplId: "10800000", approvedName: "Deterministic Person", expectedEffectiveDate: "06/20/2026",
    });
    assert.equal(receipt.disposition, "operator-asserted");
    assert.equal(receipt.effectiveDate, "06/20/2026");
    assert.throws(
      () => assertTerminationReceipt({ transactionNumber: "2204014", approvalStatus: "Approved", approvedEmplId: "10800000", approvedName: "x", expectedEffectiveDate: "06/20/2026" }),
      /T followed by 6–12 digits/u,
    );
    assert.throws(
      () => assertTerminationReceipt({ transactionNumber: "T002204014", approvalStatus: "Denied", approvedEmplId: "10800000", approvedName: "x", expectedEffectiveDate: "06/20/2026" }),
      /termination-not-in-effect/u,
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
