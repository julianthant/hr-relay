// The dashboard's visual rules, one test each: a failure names the primitive or token to use instead.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  applyExceptions, bespokeControlViolations, cssClassSelectors, dashboardFiles, dateFormatterViolations, fontSizeViolations,
  fontWeightViolations, fractionalPxViolations, keyboardUnreachableClicks, monoTimeAndIdViolations, rawHexViolations,
  readRepoFile, unreferencedClasses, DASHBOARD_ALL, DASHBOARD_ROOTS, TIME_AND_ID_ROOTS, type KeptException, type RuleScan,
} from "./helpers/design-rules.js";

const FIXTURES = "tests/architecture/dashboard/fixtures";
const cleanCss = readRepoFile(`${FIXTURES}/design-rules-clean.css`);
const badCss = readRepoFile(`${FIXTURES}/design-rules-violation.css`);
const cleanTsx = readRepoFile(`${FIXTURES}/design-rules-clean.tsx`);
const badTsx = readRepoFile(`${FIXTURES}/design-rules-violation.tsx`);

const DUO_SETUP_FILES = ["src/dashboard/surfaces/shell/onboarding-setup.tsx", "src/dashboard/surfaces/shell/onboarding.tsx"] as const;
const SOURCE_EXTENSIONS = [".css", ".ts", ".tsx"] as const;
const scanTree = (scan: RuleScan, roots: readonly string[] = DASHBOARD_ROOTS): string[] =>
  dashboardFiles(roots, SOURCE_EXTENSIONS).flatMap((path) => scan(path, readRepoFile(path)));

/** Kept exceptions per rule. Empty unless an entry names its file, the exact text and its reason. */
const KEPT: Readonly<Record<string, readonly KeptException[]>> = {
  fractionalPx: [
    { file: "src/dashboard/surfaces/shell/assistant-mark.css", match: "8.5px", reason: "SVG user-unit offset of the mark's packet on a 24-unit glyph grid, not a layout length" },
    { file: "src/dashboard/surfaces/shell/assistant-mark.css", match: "11.75px", reason: "SVG user-unit offset of the mark's packet on a 24-unit glyph grid, not a layout length" },
    { file: "src/dashboard/surfaces/shell/assistant-mark.css", match: "18.5px", reason: "SVG user-unit offset of the mark's packet on a 24-unit glyph grid, not a layout length" },
  ],
  rawHex: [
    { file: "src/dashboard/surfaces/shell/app-logo.ts", match: "#245d9e", reason: "the desktop icon and favicon are standalone SVG files that cannot read CSS variables" },
    { file: "src/dashboard/surfaces/shell/app-logo.ts", match: "#ffffff", reason: "the glyph colour inside the same standalone icon SVG" },
  ],
};

function ruleSuite(name: string, scan: RuleScan, cleanCount: { css: number; tsx: number }, badCount: { css: number; tsx: number }, kept: readonly KeptException[] = []): void {
  describe(name, () => {
    it("passes the clean fixtures", () => {
      assert.equal(scan("fixtures/clean.css", cleanCss).length, cleanCount.css);
      assert.equal(scan("fixtures/clean.tsx", cleanTsx).length, cleanCount.tsx);
    });
    it("fails the violating fixtures", () => {
      assert.equal(scan("fixtures/violation.css", badCss).length, badCount.css, scan("fixtures/violation.css", badCss).join("\n"));
      assert.equal(scan("fixtures/violation.tsx", badTsx).length, badCount.tsx, scan("fixtures/violation.tsx", badTsx).join("\n"));
    });
    it("holds on the dashboard tree", () => {
      assert.deepEqual(applyExceptions(scanTree(scan), kept), []);
    });
  });
}

ruleSuite("font weight stays 400, 500 or 600", fontWeightViolations, { css: 0, tsx: 0 }, { css: 2, tsx: 3 });
ruleSuite("font size stays on the type scale", fontSizeViolations, { css: 0, tsx: 0 }, { css: 2, tsx: 2 });
ruleSuite("no fractional px value", fractionalPxViolations, { css: 0, tsx: 0 }, { css: 1, tsx: 0 }, KEPT.fractionalPx);
ruleSuite("raw hex colours live in ds/theme only", rawHexViolations, { css: 0, tsx: 0 }, { css: 2, tsx: 1 }, KEPT.rawHex);
ruleSuite("dates format through lib/date-format.ts only", dateFormatterViolations, { css: 0, tsx: 0 }, { css: 0, tsx: 2 });
ruleSuite("no bespoke button, modal or field rule", bespokeControlViolations, { css: 0, tsx: 0 }, { css: 4, tsx: 0 });

describe("monospace stays off times and ids in Logs and the queue", () => {
  it("passes the clean fixtures and fails the violating one", () => {
    assert.equal(monoTimeAndIdViolations("fixtures/clean.css", cleanCss).length, 0);
    assert.equal(monoTimeAndIdViolations("fixtures/violation.css", badCss).length, 1);
    assert.equal(monoTimeAndIdViolations("fixtures/violation.tsx", badTsx).length, 1);
  });
  it("holds in Logs and the queue", () => {
    assert.deepEqual(scanTree(monoTimeAndIdViolations, TIME_AND_ID_ROOTS), []);
  });
});

describe("every CSS class selector is named by a .ts, .tsx or .html", () => {
  it("passes a referenced class and fails an orphan", () => {
    assert.deepEqual(unreferencedClasses("clean.css", cleanCss, "queue-row queue-title"), []);
    const orphans = unreferencedClasses("violation.css", badCss, "hub-btn btn hub-modal hub-field log-time");
    assert.equal(orphans.length, 1);
    assert.match(orphans[0], /\.orphan-rule/);
  });
  it("reads selectors without picking up numbers, keyframe steps or strings", () => {
    assert.deepEqual(cssClassSelectors(cleanCss).map((entry) => entry.name), ["queue-row", "queue-row", "queue-title"]);
  });
  it("holds on the dashboard tree", () => {
    const references = dashboardFiles([DASHBOARD_ALL], [".ts", ".tsx", ".html"]).map(readRepoFile).join("\n");
    const violations = dashboardFiles(DASHBOARD_ROOTS, [".css"]).flatMap((path) => unreferencedClasses(path, readRepoFile(path), references));
    assert.deepEqual(violations, []);
  });
});

describe("the Duo setup window is reachable by keyboard", () => {
  it("fails a clickable div and passes buttons", () => {
    assert.equal(keyboardUnreachableClicks("fixtures/violation.tsx", badTsx).length, 1);
    assert.deepEqual(keyboardUnreachableClicks("fixtures/clean.tsx", cleanTsx), []);
  });
  it("holds in the setup window and the sign-up page it follows", () => {
    const violations = DUO_SETUP_FILES.flatMap((path) => keyboardUnreachableClicks(path, readRepoFile(path)));
    assert.deepEqual(violations, []);
  });
});

describe("no Updating text", () => {
  it("shows a refresh as a spinner only, never the word Updating", () => {
    const violations = scanTree((path, text) => /\bUpdating\b/.test(text) ? [path] : [], [DASHBOARD_ALL]);
    assert.deepEqual(violations, []);
  });
});
