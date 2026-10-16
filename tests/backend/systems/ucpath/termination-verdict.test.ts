import { createUcpathPendingRowFixtures } from "../../../support/helpers/ucpath-pending-row-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
firstDisagreeingName,
ucpathPendingSweepVerdict,
ucpathTerminationFilingPresence,
ucpathTerminationVerdict,
} from "../../../../src/backend/systems/ucpath/termination-verdict.js";
import {
ucpathPendingTransactionSetDigest
} from "../../../../src/models/systems/ucpath/delete-pending-terminations.js";
import type {
UcpathTransactionRow,
UcpathTransactionScan,
} from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema,IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { TerminationReceiptSchema } from "../../../../src/rules/separations/termination-receipt.js";

const EID = EidSchema.parse("10203262");
const NAME = "Droli Clauldoa";
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T02:00:00.000Z");
const EFFDT = "06/11/2026";

const TARGET = {
  emplId: EID,
  expectedName: NAME,
  emplRecord: "0",
  effectiveDate: EFFDT,
  template: "UC_VOL_TERM" as const,
  reasonCode: "Resign - No Reason Given",
  lastDateWorked: "06/10/2026",
  initiatorComments: "x",
};

const { row } = createUcpathPendingRowFixtures(EID, NAME, EFFDT);

function scan(rows: readonly UcpathTransactionRow[]): UcpathTransactionScan {
  return { state: "read", emplId: EID, rows: [...rows], scannedRowCount: rows.length, observedAt: OBSERVED_AT };
}

const EMPTY_SET = {
  kind: "ucpath-pending-termination-set" as const,
  emplId: EID,
  eligible: [],
  protected: [],
  observedAt: OBSERVED_AT,
  source: "ss-smart-hr-detail-read" as const,
};
const SWEEP_TARGET = { emplId: EID, expectedName: NAME, observedSet: EMPTY_SET };

describe("ucpath termination verdicts", () => {

  it("folds the live four-row scan for EID 10203262 to `present` on the matching date", () => {

    const verdict = ucpathTerminationVerdict(TARGET, scan([
      row(),
      row({ transactionId: "T002197996", approvalStatus: "Approved", startDate: "07/01/2026" }),
      row({ transactionId: "T001816218", action: "(blank)", approvalStatus: "Approved", startDate: "01/02/2025" }),
      row({ transactionId: "T001781115", action: "HIR", approvalStatus: "Approved", startDate: "09/01/2024" }),
    ]));
    assert.equal(verdict.state, "present");
    if (verdict.state !== "present") return;
    assert.equal(verdict.proof.transactionId, "T002209631");
    // The PAIR: a Denied transaction carries a well-formed T… too.
    assert.equal(verdict.proof.approvalStatus, "Pending");
  });

  it("an unreadable scan is unknown, never absent", () => {
    const unreadable: UcpathTransactionScan = {
      state: "unreadable",
      emplId: EID,
      reason: "the results grid did not render within the bound",
      diagnostic: { state: "not-attempted", cause: "not-indeterminate-settlement" },
      observedAt: OBSERVED_AT,
    };
    assert.equal(ucpathTerminationVerdict(TARGET, unreadable).state, "unknown");
    assert.equal(ucpathPendingSweepVerdict(SWEEP_TARGET, unreadable).state, "unknown");
  });

  it("two terminations on one date are `ambiguous`, never a pick", () => {
    const verdict = ucpathTerminationVerdict(TARGET, scan([
      row(),
      row({ transactionId: "T002209999" }),
    ]));
    assert.equal(verdict.state, "ambiguous");
    if (verdict.state !== "ambiguous") return;
    assert.equal(verdict.matches, 2);
    assert.equal(verdict.evidence.length, 2);
  });

  it("the sweep's polarity: `present` means there is nothing to delete", () => {
    const protectedRow = row({ approvalStatus: "Approved" });
    const clear = ucpathPendingSweepVerdict(
      {
        ...SWEEP_TARGET,
        observedSet: { ...EMPTY_SET, protected: [protectedRow, row({
          transactionId: "T002209999", action: "HIR", approvalStatus: "Approved",
        })] },
      },
      scan([protectedRow, row({ transactionId: "T002209999", action: "HIR", approvalStatus: "Approved" })]),
    );
    assert.equal(clear.state, "present");
    if (clear.state !== "present") return;
    assert.equal(clear.proof.scannedRowCount, 2);
    assert.equal(clear.proof.version, 2);
    assert.equal(clear.proof.selectedTransactionIds, "none");
    assert.equal(
      clear.proof.protectedTransactionIds,
      "T002209631,T002209999",
    );
    assert.equal(
      clear.proof.setDigest,
      ucpathPendingTransactionSetDigest({
        ...EMPTY_SET,
        protected: [protectedRow, row({
          transactionId: "T002209999",
          action: "HIR",
          approvalStatus: "Approved",
        })],
      }),
    );

    const pending = row();
    const dirty = ucpathPendingSweepVerdict(
      { ...SWEEP_TARGET, observedSet: { ...EMPTY_SET, eligible: [pending] } },
      scan([pending]),
    );
    assert.equal(dirty.state, "absent");
  });

  it("settles only when the exact selected IDs are absent and protected rows survive", () => {
    const pending = row();
    const protectedRow = row({ transactionId: "T002197996", approvalStatus: "Approved" });
    const target = {
      ...SWEEP_TARGET,
      observedSet: { ...EMPTY_SET, eligible: [pending], protected: [protectedRow] },
    };
    const settled = ucpathPendingSweepVerdict(target, scan([protectedRow]));
    assert.equal(settled.state, "present");
    if (settled.state === "present") {
      assert.equal(settled.proof.selectedTransactionIds, pending.transactionId);
      assert.equal(settled.proof.protectedTransactionIds, protectedRow.transactionId);
      assert.equal(
        settled.proof.setDigest,
        ucpathPendingTransactionSetDigest(target.observedSet),
      );
    }

    for (const changed of [
      scan([pending, protectedRow]),
      scan([row({ transactionId: "T002209999" }), protectedRow]),
      scan([]),
    ]) {
      assert.notEqual(ucpathPendingSweepVerdict(target, changed).state, "present");
    }
  });

  it("an absence is bound to the person AND the date it was gathered for", () => {
    const june = ucpathTerminationVerdict(TARGET, scan([]));
    const july = ucpathTerminationVerdict({ ...TARGET, effectiveDate: "07/11/2026" }, scan([]));
    assert.equal(june.state, "absent");
    assert.equal(july.state, "absent");
    if (june.state !== "absent" || july.state !== "absent") return;
    // Different questions ⇒ different digests, so an absence gathered for one
    // date can never be counted toward the other key's settlement.
    assert.notEqual(june.evidence.queryDigest, july.evidence.queryDigest);
    assert.notEqual(june.evidence.idempotencyKeyDigest, july.evidence.idempotencyKeyDigest);
    assert.notEqual(june.evidence.evidenceRef, july.evidence.evidenceRef);
  });

  it("compares names as token multisets, because UCPath and Kuali order them differently", () => {
    // Live: UCPath renders `Droli Clauldoa`, the Kuali document says
    // `Clauldoa, Droli`. Both are the same person and neither is a mismatch.
    assert.equal(firstDisagreeingName(scan([row()]), "Clauldoa, Droli"), undefined);
    assert.equal(firstDisagreeingName(scan([row()]), "  droli   clauldoa "), undefined);
    assert.equal(firstDisagreeingName(scan([row()]), "Dreindo Craria"), NAME);
    // An unreadable scan has no rows to disagree — the verdict handles it.
    assert.equal(
      firstDisagreeingName(
        {
          state: "unreadable",
          emplId: EID,
          reason: "x",
          diagnostic: { state: "not-attempted", cause: "not-indeterminate-settlement" },
          observedAt: OBSERVED_AT,
        },
        "anybody",
      ),
      undefined,
    );
  });

  it("requires the exact successful filing to survive before Kuali finalization", () => {
    const receipt = TerminationReceiptSchema.parse({
      transactionNumber: "T002209631",
      approvalStatus: "Pending",
      effectiveDate: EFFDT,
      emplId: EID,
      displayedName: NAME,
      disposition: "committed",
    });
    const present = ucpathTerminationFilingPresence(receipt, scan([row()]));
    assert.equal(present.state, "present");
    if (present.state === "present") {
      assert.equal(present.proof.transactionId, receipt.transactionNumber);
      assert.equal(present.proof.authority, "kuali-finalization-precondition");
    }

    for (const invalid of [
      scan([]),
      scan([row({ emplId: EidSchema.parse("10779300") })]),
      scan([row({ startDate: "06/12/2026" })]),
      scan([row({ approvalStatus: "Denied" })]),
      scan([row({ action: "HIR" })]),
      scan([row({ displayedName: "Somebody Else" })]),
      scan([row(), row()]),
    ]) {
      assert.notEqual(ucpathTerminationFilingPresence(receipt, invalid).state, "present");
    }

    const advanced = ucpathTerminationFilingPresence(
      receipt,
      scan([row({ approvalStatus: "Approved" })]),
    );
    assert.equal(advanced.state, "present", "a still-acceptable status may advance after filing");

    const asserted = ucpathTerminationFilingPresence(
      TerminationReceiptSchema.parse({ ...receipt, disposition: "operator-asserted" }),
      scan([row()]),
    );
    assert.equal(
      asserted.state === "present" ? asserted.proof.receiptDisposition : undefined,
      "operator-asserted",
      "fresh presence does not promote asserted ingress into controlled-filing evidence",
    );
  });
});
