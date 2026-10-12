
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type {
UcpathTransactionRow
} from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import {
isUcpathTerminationAction,
isUcpathTerminationInProgress,
} from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";

const EID = EidSchema.parse("10001799");
const NAME = "Drose Clauckia";
const EFFDT = "06/11/2026";

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

describe("ucpath termination verdicts", () => {

  it("matches BOTH live action vocabularies, and nothing else", () => {
    // PeopleSoft renders codes in SS Smart HR and descriptions in Transactions in Progress.
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
});
