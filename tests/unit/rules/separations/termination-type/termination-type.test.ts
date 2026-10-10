
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  KUALI_TERMINATION_TYPE_OPTIONS,
  auditTerminationTypeMapCoverage,
  auditTerminationTypeOptionList,
  resolveTerminationType,
} from "../../../../../src/rules/separations/termination-type.js";

describe("separations termination-type map (§4a)", () => {
  it("is exhaustive over the captured termination-type options in both directions", () => {
    assert.deepEqual(auditTerminationTypeMapCoverage(), []);
    // 16 real options plus Kuali's `- - -` sentinel, identical on documents
    // 4510, 4502 and 4495 — three documents at two different workflow steps.
    assert.equal(KUALI_TERMINATION_TYPE_OPTIONS.length, 17);
  });

  it("every captured option either resolves or refuses — nothing falls through", () => {
    for (const option of KUALI_TERMINATION_TYPE_OPTIONS) {
      const resolution = resolveTerminationType(option);
      assert.ok(
        resolution.state === "resolved" || resolution.state === "refused",
        `${option} produced neither a resolution nor a refusal`,
      );
      if (resolution.state === "resolved") {
        assert.equal(resolution.terminationType, option);
        assert.equal(
          resolution.template,
          resolution.classification === "voluntary" ? "UC_VOL_TERM" : "UC_INVOL_TERM",
        );
      }
    }
  });

  it("the three involuntary types are exactly legacy's three names", () => {
    const involuntary = KUALI_TERMINATION_TYPE_OPTIONS.filter((option) => {
      const resolution = resolveTerminationType(option);
      return resolution.state === "resolved" && resolution.classification === "involuntary";
    });
    assert.deepEqual(involuntary, [
      "Never Started Employment",
      "Graduated/No longer a Student",
      "Appointment Expired",
    ]);
  });

  it("`Never Started Employment` files INVOL_TERM / NSE — not legacy's voluntary default", () => {

    const resolution = resolveTerminationType("Never Started Employment");
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.classification, "involuntary");
    assert.equal(resolution.template, "UC_INVOL_TERM");
    assert.equal(resolution.reasonCode, "NSE");
    assert.notEqual(resolution.reasonCode, "Resign - No Reason Given");
  });

  it("`unmapped-termination-type` is a DATA state of the table, not a dead arm", () => {

    const unmapped = KUALI_TERMINATION_TYPE_OPTIONS.filter((option) => {
      const resolution = resolveTerminationType(option);
      return resolution.state === "refused" && resolution.code === "unmapped-termination-type";
    });
    assert.deepEqual(unmapped, []);
  });

  it("refuses the blank sentinel rather than defaulting to a voluntary resignation", () => {
    const resolution = resolveTerminationType("- - -");
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "blank-termination-type");
  });

  it("does not substring-match Other and Accepted Another Job", () => {

    for (const probe of ["Other", "other", "Job", "Resign", "Attend", "Retire"]) {
      const resolution = resolveTerminationType(probe);
      assert.equal(resolution.state, "refused", `${probe} matched something`);
      if (resolution.state !== "refused") continue;
      assert.equal(resolution.code, "unknown-termination-type");
    }
  });

  it("does not normalize before matching — trimming or casing is a quieter fuzzy match", () => {
    for (const probe of [" Retirement", "Retirement ", "retirement", "RETIREMENT"]) {
      assert.equal(resolveTerminationType(probe).state, "refused", `${probe} matched something`);
    }
    assert.equal(resolveTerminationType("Retirement").state, "resolved");
  });

  it("`Death` is not an option on this form at all", () => {

    assert.ok(!KUALI_TERMINATION_TYPE_OPTIONS.includes("Death"));
    assert.equal(resolveTerminationType("Death").state, "refused");
  });

  it("`Retirement` IS mapped — §4f4's retiree case is not unmapped", () => {
    const resolution = resolveTerminationType("Retirement");
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.template, "UC_VOL_TERM");
    assert.equal(resolution.reasonCode, "Voluntary Separation Program");
  });

  describe("option-list drift (§4a's accepted operational cost)", () => {
    it("accepts the captured list unchanged", () => {
      assert.deepEqual(
        auditTerminationTypeOptionList([...KUALI_TERMINATION_TYPE_OPTIONS]),
        { state: "matches" },
      );
    });

    it("reports an ADDED option — the first run to see it refuses, not the first to select it", () => {
      const audit = auditTerminationTypeOptionList([...KUALI_TERMINATION_TYPE_OPTIONS, "Death"]);
      assert.deepEqual(audit, { state: "drifted", added: ["Death"], removed: [], reordered: false });
    });

    it("reports a REMOVED option", () => {
      const audit = auditTerminationTypeOptionList(
        KUALI_TERMINATION_TYPE_OPTIONS.filter((option) => option !== "Retirement"),
      );
      assert.deepEqual(audit, { state: "drifted", added: [], removed: ["Retirement"], reordered: false });
    });

    it("reports a pure REORDER — the control was republished even if nothing was added", () => {
      const audit = auditTerminationTypeOptionList([...KUALI_TERMINATION_TYPE_OPTIONS].reverse());
      assert.deepEqual(audit, { state: "drifted", added: [], removed: [], reordered: true });
    });
  });
});
