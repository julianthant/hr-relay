import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { UiVerificationEvidenceManifestSchema } from "../../../src/domain/ui/contracts.js";
import {
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../src/domain/ui/ucpath-person-org.js";
import { UCPATH_SS_SMART_HR_TRANSACTION_SCREEN } from "../../../src/domain/ui/ucpath-ss-smart-hr.js";
import { UCPATH_PERSON_ORG_OPERATION_ELEMENTS } from "../../../src/stores/ucpath/driver/person-org-operation.js";
import { UCPATH_UI_REGISTRY } from "../../../src/stores/ucpath/driver/ui-registry.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const OPERATION_PATH = resolve(REPO_ROOT, "src/stores/ucpath/driver/person-org-operation.ts");

const REQUIRED_PROVENANCE = Object.freeze([
  "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc",
  "601d3a2407e9c6cd79f2383c240be8a9ca7261db",
  "b29f57105699e4e1ca96e1186035783ba98a414d",
  "454320b59d280ff8ccfa24b6b0235ad49a86ae2d",
  "695d88fcc7a108f262b91b45eb1b9a276deaf427",
]);

export function auditStrictPersonOrgSource(source: string): readonly string[] {
  const issues: string[] = [];
  for (const revision of REQUIRED_PROVENANCE) {
    if (!source.includes(revision)) issues.push(`missing exact legacy provenance ${revision}`);
  }
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
    ["positive no-results marker", "text.includes(NO_RESULTS_TEXT)"],
    ["empty results grid failure", "results grid rendered without rows; refusing to report not-found"],
    ["empty assignment failure", "detail has no parsed assignment rows"],
    ["Employment Instances expansion", "await ensureEmploymentInstancesExpanded(page);"],
  ] as const) {
    if (!source.includes(required)) issues.push(`missing ${label}`);
  }
  const resultExpansions = source.match(/await ensureResultsExpanded\(page\);/gu)?.length ?? 0;
  if (resultExpansions < 2) {
    issues.push("missing search-result expansion before extraction or after Return to Search");
  }
  const employmentExpansion = source.indexOf("await ensureEmploymentInstancesExpanded(page);");
  const assignmentExtraction = source.indexOf("const rows = await resolveUcpathElement(");
  if (employmentExpansion === -1 || assignmentExtraction === -1 || employmentExpansion > assignmentExtraction) {
    issues.push("Employment Instances expansion must precede assignment extraction");
  }
  return issues;
}

describe("strict UCPath Person Org port", () => {
  it("pins exact legacy provenance, fail-loud outcomes, and both subject checks", () => {
    assert.deepEqual(auditStrictPersonOrgSource(readFileSync(OPERATION_PATH, "utf8")), []);
  });

  it("keeps every raw operation locator behind an exact semantic registry element", () => {
    // Scoped to the two Person Org screens on purpose. The UCPath registry is
    // no longer single-family — the 2026-08-04 receipt probe added the
    // SS Smart HR transaction screen — so equality against EVERY registry
    // element would make an unrelated family's growth fail this guard while
    // saying nothing about Person Org. The invariant that matters is
    // unchanged: this operation's raw locators and the Person Org screens'
    // registered elements are the SAME set, in both directions.
    const personOrgScreens = new Set([
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
    // The other direction of the same fence: a receipt element must never be
    // reachable from the Person Org read, and the receipt family must never be
    // silently empty (which would make the scoped assertion above vacuous).
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
      resolve(REPO_ROOT, "evidence/ui/ucpath/person-org.live.json"),
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
      .replaceAll("await ensureResultsExpanded(page);", "")
      .replace("await ensureEmploymentInstancesExpanded(page);", "");
    const issues = auditStrictPersonOrgSource(withoutExpansion).join("\n");
    assert.match(issues, /search-result expansion/);
    assert.match(issues, /Employment Instances expansion/);
  });
});
