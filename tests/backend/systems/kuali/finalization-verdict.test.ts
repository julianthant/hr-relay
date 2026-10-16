import { kualiFinalizationVariablesInput, unfinalizedKualiFieldsInput } from "../../../support/helpers/kuali-finalization-input-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { kualiFinalizationQueryDigest,kualiFinalizationVerdict } from "../../../../src/backend/systems/kuali/finalization-verdict.js";
import { kualiFinalizationIdempotencyKey } from "../../../../src/models/systems/kuali/save-separation-finalization.js";
import type {
KualiFinalizationTarget,
KualiFinalizationVariables,
KualiObservedFinalizationFields,
} from "../../../../src/models/ui/kuali-separation-finalization.js";
import {
KualiFinalizationVariablesSchema
} from "../../../../src/models/ui/kuali-separation-finalization.js";
import { EidSchema,IsoInstantSchema } from "../../../../src/rules/identity/ids.js";

const VARIABLES: KualiFinalizationVariables = KualiFinalizationVariablesSchema.parse(kualiFinalizationVariablesInput());

const OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T10:18:00.000Z");

const TARGET: KualiFinalizationTarget = Object.freeze({
  actionId: "6a7a33b2ac106d428b3217e0",
  documentNumber: "4510",
  emplId: EidSchema.parse("10203262"),
  variables: VARIABLES,
});


const UNFINALIZED: KualiObservedFinalizationFields = Object.freeze(unfinalizedKualiFieldsInput());

describe("Kuali separation finalization — the probe verdict", () => {
  it("binds protected absence evidence to value identity without hashing the name or signer", () => {
    const first = { ...TARGET, protectedBindings: [{ kind: "protected-store" as const,
      inputPath: "timekeeperName" as const, name: "timekeeperName" as const,
      valueId: "00000000-0000-4000-8000-000000000001" }], variables: { ...VARIABLES,
      timekeeperName: "Synthetic First Operator", timekeeperComments: "Filed. -SFO 06/19/2026" } };
    const changedValue = { ...first, variables: { ...first.variables,
      timekeeperName: "Synthetic Second Operator", timekeeperComments: "Filed. -SSO 06/19/2026" } };
    assert.equal(kualiFinalizationQueryDigest(first), kualiFinalizationQueryDigest(changedValue));
    assert.notEqual(kualiFinalizationQueryDigest(first), kualiFinalizationQueryDigest({ ...first,
      protectedBindings: [{ ...first.protectedBindings[0], valueId: "00000000-0000-4000-8000-000000000002" }] }));
    assert.notEqual(kualiFinalizationQueryDigest(first), kualiFinalizationQueryDigest({ ...first,
      variables: { ...first.variables, timekeeperComments: "Different transaction prose. -SFO 06/19/2026" } }));
  });

  it("keeps canary projection identity separate from permanent duplicate-write identity", () => {
    const binding = { kind: "test-data-local" as const, inputPath: "documentNumber" as const,
      name: "separationsKualiFinalizationCanaryDocumentNumber" as const,
      sourceId: "00000000-0000-4000-8000-000000000011" };
    const first = { ...TARGET, protectedBindings: [binding] };
    const rotated = { ...first, protectedBindings: [{ ...binding, sourceId: "00000000-0000-4000-8000-000000000012" }] };
    assert.equal(kualiFinalizationIdempotencyKey(first), kualiFinalizationIdempotencyKey(rotated));
    assert.notEqual(kualiFinalizationQueryDigest(first), kualiFinalizationQueryDigest(rotated));
    const differentValue = { ...first, documentNumber: "4998" };
    assert.equal(kualiFinalizationQueryDigest(first), kualiFinalizationQueryDigest(differentValue));
    assert.notEqual(kualiFinalizationIdempotencyKey(first), kualiFinalizationIdempotencyKey(differentValue));
  });

  it("sources an absence from the transaction-number observation and binds it to the variables", () => {
    const verdict = kualiFinalizationVerdict(TARGET, {
      state: "absent",
      actionId: TARGET.actionId,
      documentNumber: TARGET.documentNumber,
      observedEid: TARGET.emplId,
      observedFields: UNFINALIZED,
      mismatches: [{ field: "transactionNumber", expected: "T002209631", observed: "<empty>" }],
      observedAt: OBSERVED_AT,
    });
    assert.equal(verdict.state, "absent");
    if (verdict.state !== "absent") return;
    assert.equal(verdict.evidence.source, "kuali.rrss-document.displayed-transaction-number");
    assert.equal(verdict.evidence.sourceState, "kuali.rrss-document.ready");
    // The query digest binds to every staged value, not just to the key: an
    // absence gathered for a different field set answered a different question.
    const other = kualiFinalizationVerdict(
      { ...TARGET, variables: { ...VARIABLES, payrollTitle: "STDT 3" } },
      {
        state: "absent",
        actionId: TARGET.actionId,
        documentNumber: TARGET.documentNumber,
        observedEid: TARGET.emplId,
        observedFields: UNFINALIZED,
        mismatches: [{ field: "transactionNumber", expected: "T002209631", observed: "<empty>" }],
        observedAt: OBSERVED_AT,
      },
    );
    assert.equal(other.state, "absent");
    if (other.state !== "absent") return;
    assert.notEqual(other.evidence.queryDigest, verdict.evidence.queryDigest);
    // …while the KEY is unchanged, because it is the same external transaction.
    assert.equal(other.evidence.idempotencyKeyDigest, verdict.evidence.idempotencyKeyDigest);
  });

  it("keeps a failed check as `unknown`; it can never become an absence", () => {
    const verdict = kualiFinalizationVerdict(TARGET, {
      state: "unknown",
      reason: "Kuali finalization reload read-back failed: the document route never rendered",
      observedAt: OBSERVED_AT,
    });
    assert.equal(verdict.state, "unknown");
  });
});
