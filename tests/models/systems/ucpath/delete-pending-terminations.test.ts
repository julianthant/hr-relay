import { createUcpathPendingRowFixtures } from "../../../support/helpers/ucpath-pending-row-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
ucpathPendingSweepIdempotencyKey
} from "../../../../src/models/systems/ucpath/delete-pending-terminations.js";

import { EidSchema,IsoInstantSchema } from "../../../../src/rules/identity/ids.js";

const EID = EidSchema.parse("10203262");
const NAME = "Droli Clauldoa";
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T02:00:00.000Z");
const EFFDT = "06/11/2026";

const { row } = createUcpathPendingRowFixtures(EID, NAME, EFFDT);

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
  it("keys a pending sweep by its exact machine-observed transaction set", () => {
    const first = {
      ...SWEEP_TARGET,
      observedSet: {
        kind: "ucpath-pending-termination-set" as const,
        emplId: EID,
        eligible: [row({ transactionId: "T002209631" })],
        protected: [row({ transactionId: "T002197996", approvalStatus: "Approved" })],
        observedAt: OBSERVED_AT,
        source: "ss-smart-hr-detail-read" as const,
      },
    };
    const second = {
      ...first,
      observedSet: {
        ...first.observedSet,
        eligible: [row({ transactionId: "T002209999" })],
      },
    };

    assert.notEqual(
      ucpathPendingSweepIdempotencyKey(first),
      ucpathPendingSweepIdempotencyKey(second),
      "two pending transaction sets for one EID must never share one permanent write key",
    );
  });

  it("uses the same key for the same canonical set observed at another time", () => {
    const observedSet = {
      ...EMPTY_SET,
      eligible: [row()],
      protected: [row({ transactionId: "T002197996", approvalStatus: "Approved" })],
    };
    const first = { ...SWEEP_TARGET, observedSet };
    const second = {
      ...SWEEP_TARGET,
      observedSet: { ...observedSet, observedAt: IsoInstantSchema.parse("2026-08-14T03:00:00.000Z") },
    };
    assert.equal(ucpathPendingSweepIdempotencyKey(first), ucpathPendingSweepIdempotencyKey(second));
  });
});
