/**
 * The two folds over one rich UCPath transaction scan, and the action
 * vocabulary the 2026-08-14 live read corrected.
 *
 * The interesting cases here are the ones where a plausible answer would
 * authorize a duplicate termination on a real person: a scan that could not be
 * read, an action code the matcher did not recognise, and a settled row the
 * sweep must not delete.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema, IsoInstantSchema } from "../../src/domain/ids.js";
import {
  isUcpathTerminationAction,
  isUcpathTerminationInProgress,
} from "../../src/domain/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathTransactionRow,
  UcpathTransactionScan,
} from "../../src/domain/ui/ucpath-smart-hr-termination.js";
import {
  firstDisagreeingName,
  ucpathPendingSweepVerdict,
  ucpathTerminationVerdict,
} from "../../src/stores/ucpath/termination-verdict.js";

const EID = EidSchema.parse("10001799");
const NAME = "Drose Clauckia";
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
const SWEEP_TARGET = { emplId: EID, expectedName: NAME };

function row(overrides: Partial<UcpathTransactionRow> = {}): UcpathTransactionRow {
  return {
    transactionId: "T002209631",
    emplId: EID,
    action: "TER",
    approvalStatus: "Pending",
    startDate: EFFDT,
    displayedName: NAME,
    ...overrides,
  };
}

function scan(rows: readonly UcpathTransactionRow[]): UcpathTransactionScan {
  return { state: "read", emplId: EID, rows: [...rows], scannedRowCount: rows.length, observedAt: OBSERVED_AT };
}

describe("ucpath termination verdicts", () => {
  it("matches BOTH live action vocabularies, and nothing else", () => {
    // The defect the live read found: the SS Smart HR grid and detail page
    // render the PeopleSoft CODE, while the Transactions in Progress grid
    // renders the descriptive form. A matcher that knew only the second one
    // answered `absent` about a person who has a Pending termination.
    for (const accepted of ["TER", "ter", " TER ", "Terminatn", "Termination", "terminat"]) {
      assert.equal(isUcpathTerminationAction(accepted), true, accepted);
    }
    // Every other action the live grid actually rendered, plus near misses.
    for (const rejected of ["HIR", "(blank)", "", "XFR", "REH", "TERM_OTHER", "INTERNAL"]) {
      assert.equal(isUcpathTerminationAction(rejected), false, rejected);
    }
  });

  it("never sweeps a SETTLED termination", () => {
    for (const status of ["Pending", "Pushed Back"] as const) {
      assert.equal(isUcpathTerminationInProgress(row({ approvalStatus: status })), true, status);
    }
    for (const status of ["Approved", "Denied", "Error", "Manually Processed"] as const) {
      assert.equal(isUcpathTerminationInProgress(row({ approvalStatus: status })), false, status);
    }
  });

  it("folds the live four-row scan for EID 10001799 to `present` on the matching date", () => {
    // The exact rows read live on 2026-08-14, verbatim.
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

  it("an unreadable scan is `unknown`, never `absent` — D5 and D6 as code", () => {
    const unreadable: UcpathTransactionScan = {
      state: "unreadable",
      emplId: EID,
      reason: "the results grid did not render within the bound",
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
    const clear = ucpathPendingSweepVerdict(
      SWEEP_TARGET,
      scan([row({ approvalStatus: "Approved" }), row({ action: "HIR", approvalStatus: "Approved" })]),
    );
    assert.equal(clear.state, "present");
    if (clear.state !== "present") return;
    assert.equal(clear.proof.scannedRowCount, 2);

    const dirty = ucpathPendingSweepVerdict(SWEEP_TARGET, scan([row()]));
    assert.equal(dirty.state, "absent");
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
    // Live: UCPath renders `Drose Clauckia`, the Kuali document says
    // `Clauckia, Drose`. Both are the same person and neither is a mismatch.
    assert.equal(firstDisagreeingName(scan([row()]), "Clauckia, Drose"), undefined);
    assert.equal(firstDisagreeingName(scan([row()]), "  drose   clauckia "), undefined);
    assert.equal(firstDisagreeingName(scan([row()]), "Dreitho Cramia"), NAME);
    // An unreadable scan has no rows to disagree — the verdict handles it.
    assert.equal(
      firstDisagreeingName(
        { state: "unreadable", emplId: EID, reason: "x", observedAt: OBSERVED_AT },
        "anybody",
      ),
      undefined,
    );
  });
});
