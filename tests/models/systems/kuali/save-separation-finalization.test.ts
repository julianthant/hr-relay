
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { kualiFinalizationIdempotencyKey } from "../../../../src/models/systems/kuali/save-separation-finalization.js";
import type {
KualiFinalizationTarget,
KualiFinalizationVariables
} from "../../../../src/models/ui/kuali-separation-finalization.js";
import {
KualiFinalizationVariablesSchema
} from "../../../../src/models/ui/kuali-separation-finalization.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";

const VARIABLES: KualiFinalizationVariables = KualiFinalizationVariablesSchema.parse({
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Julian Zaw",
  lastDayWorked: "06/09/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T002209631",
  timekeeperComments: "Termination effective date set from the reconciled separation date.",
  observedExistingComments: "",
});

const TARGET: KualiFinalizationTarget = Object.freeze({
  actionId: "6a7a33b2ac106d428b3217e0",
  documentNumber: "4510",
  emplId: EidSchema.parse("10001799"),
  variables: VARIABLES,
});

describe("Kuali separation finalization — the permanent key and the formKey table", () => {
  it("keys on the document and the transaction number, and on nothing else", () => {
    assert.equal(kualiFinalizationIdempotencyKey(TARGET), "kuali:4510|finalization|T002209631");
    // Action ids name workflow steps, not documents; they cannot define permanent transaction identity.
    assert.equal(
      kualiFinalizationIdempotencyKey({ ...TARGET, actionId: "0123456789abcdef01234567" }),
      kualiFinalizationIdempotencyKey(TARGET),
    );
    // A differently composed comments string is not a second finalization.
    assert.equal(
      kualiFinalizationIdempotencyKey({
        ...TARGET,
        variables: { ...VARIABLES, timekeeperComments: "something else entirely" },
      }),
      kualiFinalizationIdempotencyKey(TARGET),
    );
    // A different UCPath transaction genuinely is a different write.
    assert.notEqual(
      kualiFinalizationIdempotencyKey({
        ...TARGET,
        variables: { ...VARIABLES, transactionNumber: "T002209632" },
      }),
      kualiFinalizationIdempotencyKey(TARGET),
    );
  });
});
