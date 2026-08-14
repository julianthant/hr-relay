/**
 * The pure half of separations chunk 5a — the Kuali finalization's staged
 * variables, the fold that turns them into the field set one save writes, and
 * the comparison the reload read-back is built on.
 *
 * These are the pieces a live run cannot falsify cheaply, so they are pinned
 * here rather than left to a scenario: §4g's ratified constant, the exact-match
 * rule the read-back depends on, the permanent key's exact shape, and the
 * `formKey` table's honest holes.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema, IsoInstantSchema } from "../../src/domain/ids.js";
import { kualiFinalizationIdempotencyKey } from "../../src/domain/contracts/kuali/save-separation-finalization.js";
import {
  KUALI_FINALIZATION_ASSERTIONS,
  KUALI_FINALIZATION_FIELD_NAMES,
  KUALI_RRSS_FINALIZATION_FORM_KEYS,
  KualiFinalizationVariablesSchema,
  compareKualiFinalizationFields,
  kualiFinalizationFields,
  kualiFinalizationFormKeysMissing,
} from "../../src/domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationTarget,
  KualiFinalizationVariables,
  KualiObservedFinalizationFields,
} from "../../src/domain/ui/kuali-separation-finalization.js";
import { kualiFinalizationVerdict } from "../../src/stores/kuali/finalization-verdict.js";

const VARIABLES: KualiFinalizationVariables = KualiFinalizationVariablesSchema.parse({
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Julian Zaw",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T002209631",
  timekeeperComments: "Termination effective date set from the reconciled separation date.",
  observedExistingComments: "",
});

const OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T10:18:00.000Z");

const TARGET: KualiFinalizationTarget = Object.freeze({
  actionId: "6a7a33b2ac106d428b3217e0",
  documentNumber: "4510",
  emplId: EidSchema.parse("10001799"),
  variables: VARIABLES,
});

/** Live doc 4502's shape: five blanks and the `- - -` sentinel (2026-08-12). */
const UNFINALIZED: KualiObservedFinalizationFields = Object.freeze({
  department: "- - -",
  payrollTitleCode: "",
  payrollTitle: "",
  requestAcknowledged: false,
  timekeeperName: "",
  terminationEffectiveDate: "",
  submittedTerminationTemplate: false,
  transactionNumber: "",
  finalPay: null,
  timekeeperComments: "",
});

describe("Kuali separation finalization — the staged-variables fold", () => {
  it("composes the ten written fields from seven variables and three ratified assertions", () => {
    const fields = kualiFinalizationFields(VARIABLES);
    assert.deepEqual(Object.keys(fields).sort(), [...KUALI_FINALIZATION_FIELD_NAMES].sort());
    // §4g, operator-ratified 2026-08-12: the final-pay radio is an
    // unconditional business assertion with no data behind it, and S58's actual
    // objection was that legacy carries it with no comment and no test. This
    // assertion is that test — it fails the day somebody quietly changes it.
    assert.equal(fields.finalPay, "does-not-need-final-pay-student");
    assert.equal(KUALI_FINALIZATION_ASSERTIONS.finalPay, "does-not-need-final-pay-student");
    assert.equal(fields.requestAcknowledged, true);
    assert.equal(fields.submittedTerminationTemplate, true);
    // The variables pass through untouched — nothing is recomputed at fill time.
    assert.equal(fields.department, VARIABLES.department);
    assert.equal(fields.transactionNumber, VARIABLES.transactionNumber);
    assert.equal(fields.timekeeperComments, VARIABLES.timekeeperComments);
    // `observedExistingComments` is a REFUSAL input, never a written value.
    assert.ok(!Object.keys(fields).includes("observedExistingComments"));
  });

  it("refuses a variable set that could only produce a plausible-but-wrong document", () => {
    const bad = (patch: Record<string, unknown>): boolean =>
      !KualiFinalizationVariablesSchema.safeParse({ ...VARIABLES, ...patch }).success;
    // Kuali's blank sentinel is an UNSET field, never a department (S55).
    assert.ok(bad({ department: "- - -" }));
    // A padded value would make "what we staged" and "what the page reads back"
    // unequal by construction, because every read trims.
    assert.ok(bad({ payrollTitle: " STDT 2" }));
    // S57 cannot arise: an empty or malformed transaction number never reaches
    // the page, so there is no "save it blank for manual entry" path at all.
    assert.ok(bad({ transactionNumber: "" }));
    assert.ok(bad({ transactionNumber: "pending" }));
    assert.ok(bad({ terminationEffectiveDate: "2026-06-11" }));
    assert.ok(bad({ timekeeperComments: "" }));
  });
});

describe("Kuali separation finalization — the read-back comparison", () => {
  it("is exact on every field and has no tolerance arm", () => {
    const expected = kualiFinalizationFields(VARIABLES);
    const landed: KualiObservedFinalizationFields = {
      department: expected.department,
      payrollTitleCode: expected.payrollTitleCode,
      payrollTitle: expected.payrollTitle,
      requestAcknowledged: expected.requestAcknowledged,
      timekeeperName: expected.timekeeperName,
      terminationEffectiveDate: expected.terminationEffectiveDate,
      submittedTerminationTemplate: expected.submittedTerminationTemplate,
      transactionNumber: expected.transactionNumber,
      finalPay: expected.finalPay,
      timekeeperComments: expected.timekeeperComments,
    };
    assert.deepEqual(compareKualiFinalizationFields(expected, landed), []);

    // A department option that merely CONTAINS the code is a different
    // department, and a save that kept only a prefix of the comments has
    // dropped somebody's note. Neither may be absorbed.
    const nearMisses = compareKualiFinalizationFields(expected, {
      ...landed,
      department: "000412",
      timekeeperComments: expected.timekeeperComments.slice(0, 20),
    });
    assert.deepEqual(nearMisses.map((entry) => entry.field), ["department", "timekeeperComments"]);
  });

  it("names every disagreeing field, in declaration order, and renders each state distinguishably", () => {
    const expected = kualiFinalizationFields(VARIABLES);
    const mismatches = compareKualiFinalizationFields(expected, UNFINALIZED);
    assert.deepEqual(mismatches.map((entry) => entry.field), [...KUALI_FINALIZATION_FIELD_NAMES]);
    const byField = new Map(mismatches.map((entry) => [entry.field, entry]));
    // An empty control, an unchecked box and an unselected radio are three
    // different observations and must not all render as "".
    assert.equal(byField.get("payrollTitle")?.observed, "<empty>");
    assert.equal(byField.get("requestAcknowledged")?.observed, "unchecked");
    assert.equal(byField.get("requestAcknowledged")?.expected, "checked");
    assert.equal(byField.get("finalPay")?.observed, "<none selected>");
    assert.equal(byField.get("department")?.observed, "- - -");
  });
});

describe("Kuali separation finalization — the permanent key and the formKey table", () => {
  it("keys on the document and the transaction number, and on nothing else", () => {
    assert.equal(kualiFinalizationIdempotencyKey(TARGET), "kuali:4510|finalization|T002209631");
    // The action id names a workflow STEP, not a document (D129). Keying on it
    // would mint a second key for the same external transaction.
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

  it("pins the ONE observed formKey and names the nine chunk 5c still owes", () => {
    // Live 2026-08-04, off Kuali's own `ActionPage` query for docs 4489/4490.
    assert.equal(KUALI_RRSS_FINALIZATION_FORM_KEYS.timekeeperName, "QGJ63YrCom");
    // The rest are `null` rather than guessed: a fabricated key would make the
    // commit's wire proof a check that cannot fail.
    assert.deepEqual(kualiFinalizationFormKeysMissing(), [
      "department",
      "payrollTitleCode",
      "payrollTitle",
      "requestAcknowledged",
      "terminationEffectiveDate",
      "submittedTerminationTemplate",
      "transactionNumber",
      "finalPay",
      "timekeeperComments",
    ]);
  });
});

describe("Kuali separation finalization — the probe verdict", () => {
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
