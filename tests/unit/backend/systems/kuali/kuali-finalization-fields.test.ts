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
import { EidSchema, IsoInstantSchema } from "../../../../../src/domain/ids.js";
import { kualiFinalizationIdempotencyKey } from "../../../../../src/domain/contracts/kuali/save-separation-finalization.js";
import {
  KUALI_FINALIZATION_ASSERTIONS,
  KUALI_FINALIZATION_FIELD_NAMES,
  KUALI_RRSS_FINALIZATION_FORM_KEYS,
  KualiFinalizationVariablesSchema,
  compareKualiFinalizationFields,
  kualiFinalizationFields,
  kualiFinalizationFormKeysMissing,
  KUALI_RRSS_FINALIZATION_WIRE_ASSERTED,
  kualiFinalizationWireUnasserted,
} from "../../../../../src/domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationTarget,
  KualiFinalizationVariables,
  KualiObservedFinalizationFields,
} from "../../../../../src/domain/ui/kuali-separation-finalization.js";
import { kualiFinalizationQueryDigest, kualiFinalizationVerdict } from "../../../../../src/backend/systems/kuali/finalization-verdict.js";

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

const OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T10:18:00.000Z");

const TARGET: KualiFinalizationTarget = Object.freeze({
  actionId: "6a7a33b2ac106d428b3217e0",
  documentNumber: "4510",
  emplId: EidSchema.parse("10001799"),
  variables: VARIABLES,
});

/**
 * Live doc 4502's shape: five blanks and the `- - -` sentinel (2026-08-12), plus
 * the two date write-backs §4e's 2026-08-14 amendment added — blank here so the
 * comparison below can name every one of the twelve.
 */
const UNFINALIZED: KualiObservedFinalizationFields = Object.freeze({
  department: "- - -",
  payrollTitleCode: "",
  payrollTitle: "",
  requestAcknowledged: false,
  timekeeperName: "",
  lastDayWorked: "",
  separationDate: "",
  terminationEffectiveDate: "",
  submittedTerminationTemplate: false,
  transactionNumber: "",
  finalPay: null,
  timekeeperComments: "",
});

describe("Kuali separation finalization — the staged-variables fold", () => {
  it("composes the twelve written fields from nine variables and three ratified assertions", () => {
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
    // §4e's 2026-08-14 amendment: the two date write-backs are Kuali form dates
    // like the effective date, so an ISO spelling or a blank refuses before a
    // control is touched. A blank one is the state legacy would have written.
    assert.ok(bad({ lastDayWorked: "2026-06-09" }));
    assert.ok(bad({ separationDate: "" }));
    assert.ok(bad({ separationDate: "6/10/2026" }));
  });

  it("stages the two date write-backs UNCONDITIONALLY, from the reconciled variables", () => {
    // §4e's amendment: legacy writes these back only when reconciliation moved
    // them, which is a property of its incremental drafts. Under one-pass
    // staging the staged set IS the finalized state, so both are always there.
    const moved = kualiFinalizationFields(VARIABLES);
    assert.equal(moved.lastDayWorked, VARIABLES.lastDayWorked);
    assert.equal(moved.separationDate, VARIABLES.separationDate);

    // The ordinary case — nothing moved, so the reconciled value equals what
    // the document already carries and the save writes the same string back.
    // The FIELD SET is the same shape either way; there is no conditional arm
    // for the read-back to have to know about.
    const unmoved = kualiFinalizationFields(KualiFinalizationVariablesSchema.parse({
      ...VARIABLES,
      lastDayWorked: "06/10/2026",
      separationDate: "06/10/2026",
    }));
    assert.deepEqual(Object.keys(unmoved), Object.keys(moved));
    assert.equal(unmoved.lastDayWorked, "06/10/2026");
    assert.equal(unmoved.separationDate, "06/10/2026");

    // The two folds differ in exactly the field whose VALUE differs, and in
    // nothing else: the amendment changes the staged set, not the fold. The
    // separation date is equal in both, so it reports no mismatch — which is
    // what makes an unconditional stage of an unchanged value harmless.
    assert.deepEqual(
      compareKualiFinalizationFields(moved, unmoved).map((entry) => entry.field),
      ["lastDayWorked"],
    );
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
      lastDayWorked: expected.lastDayWorked,
      separationDate: expected.separationDate,
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

  it("names a stale date write-back — §9.14's doc 4524, where the separation date genuinely moved", () => {
    // Live 2026-08-14: doc 4524 carried `06/18/2026` and the reconciliation
    // moved the separation date forward to `07/03/2026` on a holiday, while the
    // Kuali document kept the stale date. That is the case §4e's amendment
    // exists for, and it must be an `absent` naming the field — never absorbed.
    const expected = kualiFinalizationFields(KualiFinalizationVariablesSchema.parse({
      ...VARIABLES,
      lastDayWorked: "06/18/2026",
      separationDate: "07/03/2026",
      terminationEffectiveDate: "07/04/2026",
    }));
    const stillStale = compareKualiFinalizationFields(expected, {
      ...UNFINALIZED,
      department: expected.department,
      payrollTitleCode: expected.payrollTitleCode,
      payrollTitle: expected.payrollTitle,
      requestAcknowledged: expected.requestAcknowledged,
      timekeeperName: expected.timekeeperName,
      lastDayWorked: "06/18/2026",
      // What the document still holds — the value the write-back replaces.
      separationDate: "06/18/2026",
      terminationEffectiveDate: expected.terminationEffectiveDate,
      submittedTerminationTemplate: expected.submittedTerminationTemplate,
      transactionNumber: expected.transactionNumber,
      finalPay: expected.finalPay,
      timekeeperComments: expected.timekeeperComments,
    });
    assert.deepEqual(stillStale, [
      { field: "separationDate", expected: "07/03/2026", observed: "06/18/2026" },
    ]);
    // A blank date control is `<empty>`, distinguishable from a wrong one.
    const blank = compareKualiFinalizationFields(expected, UNFINALIZED)
      .filter((entry) => entry.field === "lastDayWorked" || entry.field === "separationDate");
    assert.deepEqual(blank.map((entry) => entry.observed), ["<empty>", "<empty>"]);
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

  it("pins all TWELVE formKeys captured live, and the five the wire check may assert", () => {
    // Ten captured live 2026-08-14 (chunk 5c, §9.12) and the two date write-backs
    // §4e's amendment added captured the same day by chunk 6b (§9.16) — both off
    // Kuali's own `ActionPage` query, the read the app itself issues when a
    // document route opens, observed passively with nothing extra sent.
    assert.deepEqual({ ...KUALI_RRSS_FINALIZATION_FORM_KEYS }, {
      department: "JPYGckVxcf",
      payrollTitleCode: "2FlOeR5pd9",
      payrollTitle: "sVmpq6tG9X",
      requestAcknowledged: "xKRU6vmYSY",
      timekeeperName: "QGJ63YrCom",
      lastDayWorked: "ER1WhBzjcm",
      separationDate: "oEcp1xtQkj",
      terminationEffectiveDate: "DoWSfJhpRm",
      submittedTerminationTemplate: "6Ejy-1rfQJ",
      transactionNumber: "wPyuyY0wT0",
      finalPay: "8CXaCSIvx5",
      timekeeperComments: "J_upFRq074",
    });
    // The to-do list is empty, and it stays DERIVED — a hand-written second list
    // is one that can disagree with the table it describes.
    assert.deepEqual(kualiFinalizationFormKeysMissing(), []);
    // A missing key is a strict subset of the unasserted set — a field whose key
    // is unknown can never be on the asserted list. Vacuously true today, and
    // the invariant is what matters if a thirteenth field ever lands.
    for (const field of kualiFinalizationFormKeysMissing()) {
      assert.ok(!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field));
    }
    // A captured key is NOT a captured wire shape: both dates stay unasserted,
    // because a `Date` gadget's model value is epoch ms and the staged value is
    // `MM/DD/YYYY`. Only the controlled commit's real payload settles them.
    for (const field of ["lastDayWorked", "separationDate"] as const) {
      assert.ok(!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field), field);
    }
    // The extraction is validated by the one key this repository already knew:
    // `timekeeperName` came back byte-identical to the 2026-08-04 capture that
    // D135 then confirmed on the WIRE — and is still not the DOM id.
    assert.equal(KUALI_RRSS_FINALIZATION_FORM_KEYS.timekeeperName, "QGJ63YrCom");
    assert.notEqual(KUALI_RRSS_FINALIZATION_FORM_KEYS.timekeeperName, "BWmkKqx40");
    // Every key is distinct: two fields sharing one key would silently make the
    // wire check assert one field twice and the other never.
    const keys = Object.values(KUALI_RRSS_FINALIZATION_FORM_KEYS)
      .filter((key): key is string => key !== null);
    assert.equal(new Set(keys).size, keys.length);

    // A key is not an expectation. `submitDocumentV2` sends the document MODEL,
    // and only a Text/Textarea gadget holds the staged string there — a Date
    // holds epoch ms, a Dropdown/Radios holds `{id,label}`, Checkboxes an array
    // of them (all observed live on real docs 4510/4495/4502).
    assert.deepEqual([...KUALI_RRSS_FINALIZATION_WIRE_ASSERTED], [
      "payrollTitleCode",
      "payrollTitle",
      "timekeeperName",
      "transactionNumber",
      "timekeeperComments",
    ]);
    assert.deepEqual(kualiFinalizationWireUnasserted(), [
      "department",
      "requestAcknowledged",
      "lastDayWorked",
      "separationDate",
      "terminationEffectiveDate",
      "submittedTerminationTemplate",
      "finalPay",
    ]);
    // The two halves partition the field set — a field in neither would be
    // silently unchecked with nothing naming it.
    assert.equal(
      KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.length + kualiFinalizationWireUnasserted().length,
      Object.keys(KUALI_RRSS_FINALIZATION_FORM_KEYS).length,
    );
  });
});

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
