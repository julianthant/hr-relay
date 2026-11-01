import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import type { ScreenId } from "../../../src/rules/identity/ids.js";
import { UiVerificationEvidenceManifestSchema } from "../../../src/models/ui/contracts.js";
import {
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../src/models/ui/ucpath-person-org.js";
import { UCPATH_SS_SMART_HR_TRANSACTION_SCREEN } from "../../../src/models/ui/ucpath-ss-smart-hr.js";
import { UCPATH_PERSON_ORG_OPERATION_ELEMENTS } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { UCPATH_UI_REGISTRY } from "../../../src/backend/systems/ucpath/driver/ui-registry.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const OPERATION_PATH = resolve(REPO_ROOT, "src/backend/systems/ucpath/driver/person-org-operation.ts");

export function auditStrictPersonOrgSource(source: string): readonly string[] {
  const issues: string[] = [];
  const forbidden = [
    ["body-name scan", /querySelectorAll\s*\(\s*["'`]span,\s*div/u],
    ["observed-EID overwrite", /\{\s*\.\.\.[A-Za-z_$][\w$]*,\s*emplId\b/u],
    ["extraction-error empty fallback", /\.catch\s*\(\s*\(\)\s*=>\s*\[\]\s*\)/u],
    ["swallowed field clear", /\.fill\(\s*""\s*\)\.catch/u],
    ["drill-failure null fallback", /drill[\s\S]{0,180}\.catch\s*\([\s\S]{0,80}null/u],
    ["missing-grid not-found fallback", /resultsGrid[\s\S]{0,160}count\([\s\S]{0,160}not-found/u],
  ] as const;
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) issues.push(label);
  }
  for (const [label, required] of [
    ["row-to-detail subject proof", "detail.observedEid !== row.emplId"],
    ["query-to-observation subject proof", "candidate.emplId !== input.emplId"],

    ["positive no-results marker", "bannerText.includes(NO_RESULTS_TEXT)"],
    ["empty results grid failure", "results grid rendered without rows; refusing to report not-found"],
    ["empty assignment failure", "detail has no parsed assignment rows"],
    ["Employment Instances expansion", "await ensureEmploymentInstancesExpanded(assertCurrent, page);"],
  ] as const) {
    if (!source.includes(required)) issues.push(`missing ${label}`);
  }
  const resultExpansions = source.match(/await ensureResultsExpanded\(assertCurrent, page\);/gu)?.length ?? 0;
  if (resultExpansions < 2) {
    issues.push("missing search-result expansion before extraction or after Return to Search");
  }
  const employmentExpansion = source.indexOf("await ensureEmploymentInstancesExpanded(assertCurrent, page);");
  const assignmentExtraction = source.indexOf("const rows = await resolveUcpathElement(");
  if (employmentExpansion === -1 || assignmentExtraction === -1 || employmentExpansion > assignmentExtraction) {
    issues.push("Employment Instances expansion must precede assignment extraction");
  }
  return issues;
}

describe("strict UCPath Person Org operation", () => {
  it("preserves fail-loud outcomes and both subject checks", () => {
    assert.deepEqual(auditStrictPersonOrgSource(readFileSync(OPERATION_PATH, "utf8")), []);
  });

  it("keeps every raw operation locator behind an exact semantic registry element", () => {

    const personOrgScreens = new Set<ScreenId>([
      UCPATH_PERSON_ORG_SEARCH_SCREEN,
      UCPATH_PERSON_ORG_DETAIL_SCREEN,
    ]);
    assert.deepEqual(
      [...UCPATH_PERSON_ORG_OPERATION_ELEMENTS].sort(),
      UCPATH_UI_REGISTRY.elements
        .filter(({ screen }) => personOrgScreens.has(screen))
        .map(({ id }) => id)
        .sort(),
    );
  });

  it("keeps the SS Smart HR receipt family out of the Person Org operation", () => {

    const receiptElements = UCPATH_UI_REGISTRY.elements
      .filter(({ screen }) => screen === UCPATH_SS_SMART_HR_TRANSACTION_SCREEN)
      .map(({ id }) => id);
    assert.deepEqual(receiptElements.sort(), [
      "ucpath.ss-smart-hr.approval-status-display",
      "ucpath.ss-smart-hr.receipt-display",
    ]);
    for (const id of receiptElements) {
      assert.equal(UCPATH_PERSON_ORG_OPERATION_ELEMENTS.includes(id), false);
    }
  });

  it("records current-live zero-match legacy accessible-name recipes as rejected", () => {
    const evidence = UiVerificationEvidenceManifestSchema.parse(JSON.parse(readFileSync(
      resolve(REPO_ROOT, "tests/support/fixtures/ui/ucpath/person-org.live.json"),
      "utf8",
    )));
    assert.deepEqual(evidence.rejectedCandidates, [
      {
        legacyKey: "personOrgSummary.emplIdInput()",
        candidateDescription: "exact textbox accessible name Empl ID",
        reason: "zero-live-matches",
        matchedCount: 0,
        replacementSemanticId: "ucpath.person-org.eid-input",
      },
      {
        legacyKey: "personOrgSummary.nameInput()",
        candidateDescription: "exact textbox accessible name Name",
        reason: "zero-live-matches",
        matchedCount: 0,
        replacementSemanticId: "ucpath.person-org.given-name-input",
      },
    ]);
  });

  it("proves the guard catches every rejected legacy fallback category", () => {
    const unsafe = `
      querySelectorAll("span, div");
      const wrong = { ...result, emplId };
      extract().catch(() => []);
      input.fill("").catch(ignore);
      drill(row).catch(() => null);
      if (await resultsGrid.count() === 0) return { kind: "not-found" };
    `;
    const issues = auditStrictPersonOrgSource(unsafe).join("\n");
    for (const label of [
      "body-name scan",
      "observed-EID overwrite",
      "extraction-error empty fallback",
      "swallowed field clear",
      "drill-failure null fallback",
      "missing-grid not-found fallback",
    ]) assert.match(issues, new RegExp(label));
  });

  it("catches pagination extraction that omits either required expansion boundary", () => {
    const withoutExpansion = readFileSync(OPERATION_PATH, "utf8")
      .replaceAll("await ensureResultsExpanded(assertCurrent, page);", "")
      .replace("await ensureEmploymentInstancesExpanded(assertCurrent, page);", "");
    const issues = auditStrictPersonOrgSource(withoutExpansion).join("\n");
    assert.match(issues, /search-result expansion/);
    assert.match(issues, /Employment Instances expansion/);
  });
});
