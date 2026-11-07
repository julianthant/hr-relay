import { createUcpathPendingRowFixtures } from "../../support/helpers/ucpath-pending-row-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";

import {
isUcpathTerminationAction,
isUcpathTerminationInProgress,
} from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";

const EID = EidSchema.parse("10203262");
const NAME = "Droli Clauldoa";
const EFFDT = "06/11/2026";

const { row } = createUcpathPendingRowFixtures(EID, NAME, EFFDT);

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
