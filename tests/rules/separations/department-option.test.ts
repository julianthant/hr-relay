
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { UcpathJobCell } from "../../../src/models/ui/ucpath-job-summary.js";
import {
kualiDepartmentOptionCode,
kualiDepartmentOptionDescription,
resolveKualiDepartmentOption,
sameDepartmentCode,
} from "../../../src/rules/separations/department-option.js";

/** The department list preserves `000719`'s double space. */
const LIVE_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "000141 - Early Childhood Education Center",
  "000412 - Housing/Dining/Hospitality",
  "000414 - Bookstore",
  "000422 - Triton Print & Digital Media",
  "000719 -  Supply Chain Services",
]);

const present = (value: string): UcpathJobCell => ({ state: "present", value });
const absent = (reason: string): UcpathJobCell => ({ state: "absent", reason });

function resolve(
  deptId: UcpathJobCell,
  department: UcpathJobCell = present("HOUSING/DINING/HOSPITALITY"),
  observedOptions: readonly string[] = LIVE_OPTIONS,
) {
  return resolveKualiDepartmentOption({ deptId, department, observedOptions });
}

describe("kuali department option — the parts", () => {
  it("reads the code and the description out of the live option shape", () => {
    assert.equal(kualiDepartmentOptionCode("000412 - Housing/Dining/Hospitality"), "000412");
    assert.equal(
      kualiDepartmentOptionDescription("000412 - Housing/Dining/Hospitality"),
      "Housing/Dining/Hospitality",
    );
    // The double-space option: the description survives, the raw text is what
    // the caller stages.
    assert.equal(kualiDepartmentOptionCode("000719 -  Supply Chain Services"), "000719");
    assert.equal(
      kualiDepartmentOptionDescription("000719 -  Supply Chain Services"),
      "Supply Chain Services",
    );
    // Kuali's blank sentinel carries no code, which is exactly why it can never
    // be matched into a staged value.
    assert.equal(kualiDepartmentOptionCode("- - -"), "");
  });

  it("compares codes as numbers and nothing else", () => {
    assert.equal(sameDepartmentCode("000412", "000412"), true);
    assert.equal(sameDepartmentCode("000412", "412"), true, "zero padding is a rendering choice");
    assert.equal(sameDepartmentCode("000412", "000414"), false);
    assert.equal(sameDepartmentCode("", "000412"), false);
    assert.equal(sameDepartmentCode("HDH", "HDH"), false, "a non-numeric code matches nothing");
    assert.equal(sameDepartmentCode("0", "000"), true);
  });
});

describe("resolveKualiDepartmentOption", () => {
  it("resolves the live case and returns the option text VERBATIM", () => {
    const resolution = resolve(present("000412"));
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.option, "000412 - Housing/Dining/Hospitality");
    assert.equal(resolution.departmentCode, "000412");
    assert.equal(resolution.optionDescription, "Housing/Dining/Hospitality");
    // The description is EVIDENCE: UCPath's spelling is carried beside Kuali's,
    // and nothing compared them.
    assert.equal(resolution.ucpathDepartment, "HOUSING/DINING/HOSPITALITY");
    assert.equal(resolution.observedOptionCount, LIVE_OPTIONS.length);
  });

  it("returns the double-space option byte-for-byte, never a reconstruction", () => {
    const resolution = resolve(present("000719"), present("SUPPLY CHAIN SERVICES"));
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    // Rebuilding `<code> - <description>` would produce a single space here and
    // the driver would then refuse the very option it is standing in front of.
    assert.equal(resolution.option, "000719 -  Supply Chain Services");
    assert.ok(LIVE_OPTIONS.includes(resolution.option));
  });

  it("matches a differently-padded dept id", () => {
    const resolution = resolve(present("412"));
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.option, "000412 - Housing/Dining/Hospitality");
  });

  it("refuses an unreadable Dept ID and names the cell's own reason", () => {
    const resolution = resolve(absent("the grid rendered this cell empty"));
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "department-code-unreadable");
    assert.match(resolution.reason, /the grid rendered this cell empty/u);
    // The description it DID show is quoted — and explicitly not matched on.
    assert.match(resolution.reason, /HOUSING\/DINING\/HOSPITALITY/u);
  });

  it("refuses a Dept ID that is not a numeric code", () => {
    const resolution = resolve(present("HDH-412"));
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "department-code-unreadable");
  });

  it("refuses a code the control does not offer, recording every option it did (§3.2)", () => {
    const resolution = resolve(present("000999"));
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "department-code-not-offered");
    for (const option of LIVE_OPTIONS) assert.ok(resolution.reason.includes(option), option);
  });

  it("NEVER falls back to the description — the deleted fuzzy tier stays deleted", () => {

    const misfiled = ["- - -", "000141 - Housing/Dining/Hospitality"];
    const resolution = resolve(present("000412"), present("HOUSING/DINING/HOSPITALITY"), misfiled);
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "department-code-not-offered");
  });

  it("is not confused by two options sharing a description — the code decides", () => {
    const twins = [
      "- - -",
      "000141 - Housing/Dining/Hospitality",
      "000412 - Housing/Dining/Hospitality",
    ];
    const resolution = resolve(present("000412"), present("HOUSING/DINING/HOSPITALITY"), twins);
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.option, "000412 - Housing/Dining/Hospitality");
  });

  it("refuses when TWO options carry the same code", () => {
    const duplicated = [
      "- - -",
      "000412 - Housing/Dining/Hospitality",
      "000412 - Housing Dining Hospitality (legacy)",
    ];
    const resolution = resolve(present("000412"), present("HOUSING/DINING/HOSPITALITY"), duplicated);
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "department-option-ambiguous");
    assert.match(resolution.reason, /legacy/u);
  });

  it("can never resolve to Kuali's blank sentinel", () => {
    const resolution = resolve(present("000412"), present("HOUSING/DINING/HOSPITALITY"), ["- - -"]);
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    // The sentinel has no code, so it never even reaches the staged-value
    // schema's own refusal of it.
    assert.equal(resolution.code, "department-code-not-offered");
  });

  it("refuses an option whose text cannot be staged", () => {
    for (const [option, expectation] of [
      ["  000412 - Housing/Dining/Hospitality  ", /whitespace-padded/u],
      ["000412 - Housing–Dining", /printable ASCII/u],
    ] as const) {
      const resolution = resolve(present("000412"), present("HOUSING/DINING/HOSPITALITY"), [option]);
      assert.equal(resolution.state, "refused", option);
      if (resolution.state !== "refused") continue;
      assert.equal(resolution.code, "department-option-unusable", option);
      assert.match(resolution.reason, expectation, resolution.reason);
    }
  });

  it("refuses an option that is a code with no department name", () => {
    const resolution = resolve(present("000412"), present("HOUSING/DINING/HOSPITALITY"), ["000412 -"]);
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "department-option-unusable");
    assert.match(resolution.reason, /no department name/u);
  });

  it("resolves on the code alone when UCPath could not render the description", () => {
    const resolution = resolve(present("000412"), absent("the grid rendered this cell empty"));
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.option, "000412 - Housing/Dining/Hospitality");

    assert.equal(resolution.ucpathDepartment, "(unreadable: the grid rendered this cell empty)");
  });
});
