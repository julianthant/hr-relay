import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { describe, it } from "vitest";
import frozenPresentationFiles from "./fixtures/dashboard-presentation-file-set.json" with { type: "json" };
import { REPO_ROOT } from "../support/helpers/guard-files.js";

const DASHBOARD_ROOT = "src/dashboard";
const PRESENTATION_FREEZE_BRIEF = "src/dashboard/PARITY.md";
const COMPONENT_CHANGE_INSTRUCTION =
  "components are fixed; ask the operator before adding or removing one";
const STYLESHEET_EXTENSIONS = new Set([
  ".css",
  ".pcss",
  ".postcss",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".stylus",
]);
const DESIGN_TOKEN_EXTENSIONS = new Set([
  ...STYLESHEET_EXTENSIONS,
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
]);
const DESIGN_TOKEN_BASENAME =
  /^(?:tokens?|design[-.]?tokens?)(?:\.[^.]+)*$|^[^.]+\.tokens?(?:\.[^.]+)*$/iu;

function allFiles(root: string): string[] {
  if (!existsSync(root)) throw new Error("Dashboard presentation scan root does not exist: " + root);

  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...allFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function isPresentationFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const extension = extname(normalized).toLowerCase();
  const isComponent =
    extension === ".tsx" &&
    (normalized.startsWith("src/dashboard/surfaces/") ||
      normalized.startsWith("src/dashboard/ds/"));
  const isStylesheet = STYLESHEET_EXTENSIONS.has(extension);
  const isThemeTokenSource =
    DESIGN_TOKEN_EXTENSIONS.has(extension) &&
    normalized.startsWith("src/dashboard/ds/theme/") &&
    normalized !== "src/dashboard/ds/theme/theme.ts";
  const isDesignToken =
    DESIGN_TOKEN_EXTENSIONS.has(extension) &&
    DESIGN_TOKEN_BASENAME.test(normalized.slice(normalized.lastIndexOf("/") + 1));
  return isComponent || isStylesheet || isThemeTokenSource || isDesignToken;
}

export function discoverDashboardPresentationFiles(root: string): string[] {
  return allFiles(join(root, DASHBOARD_ROOT))
    .map((file) => relative(root, file).replaceAll("\\", "/"))
    .filter(isPresentationFile)
    .sort();
}

export function dashboardPresentationInventoryViolations(
  root: string,
  expectedFiles: readonly string[],
): string[] {
  const actual = discoverDashboardPresentationFiles(root);
  const expected = new Set(expectedFiles);
  const actualSet = new Set(actual);
  const added = actual.filter((file) => !expected.has(file));
  const removed = expectedFiles.filter((file) => !actualSet.has(file));
  if (added.length === 0 && removed.length === 0) return [];

  return [
      "Presentation freeze violation; added: " +
      JSON.stringify(added) +
      "; removed: " +
      JSON.stringify(removed) +
      "; " +
      COMPONENT_CHANGE_INSTRUCTION +
      "; evidence: " +
      PRESENTATION_FREEZE_BRIEF +
      ".",
  ];
}

function writeFixtureFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function seedPresentationFixture(root: string): void {
  for (const path of frozenPresentationFiles) writeFixtureFile(root, path, "baseline\n");
}

function temporaryRoot(): string {
  return mkdtempSync(join(tmpdir(), "hrauto-dashboard-presentation-"));
}

describe("dashboard presentation freeze", () => {
  it("pins every current presentation component, stylesheet, and design-token file", () => {
    assert.equal(new Set(frozenPresentationFiles).size, frozenPresentationFiles.length);
    assert.equal(frozenPresentationFiles.length, 131);

    const actual = discoverDashboardPresentationFiles(REPO_ROOT);
    assert.equal(actual.filter((file) => file.endsWith(".tsx")).length, 107);
    assert.equal(
      actual.filter((file) => STYLESHEET_EXTENSIONS.has(extname(file).toLowerCase())).length,
      22,
    );
    assert.ok(actual.includes("src/dashboard/ds/theme/tokens.ts"));
    assert.ok(actual.includes("src/dashboard/ds/theme/tokens.css"));
    assert.ok(actual.includes("src/dashboard/ds/theme/dashboard-theme.css"));
    assert.ok(!actual.includes("src/dashboard/ds/theme/theme.ts"));
    assert.deepEqual(actual, frozenPresentationFiles);
    assert.deepEqual(dashboardPresentationInventoryViolations(REPO_ROOT, frozenPresentationFiles), []);
  });

  it("fails for additions and deletions, reports paths, and allows content-only edits", () => {
    const root = temporaryRoot();
    try {
      seedPresentationFixture(root);
      assert.deepEqual(dashboardPresentationInventoryViolations(root, frozenPresentationFiles), []);

      const additions = [
        "src/dashboard/surfaces/freeze-probe.tsx",
        "src/dashboard/app/freeze-probe.scss",
        "src/dashboard/ds/theme/palette.ts",
        "src/dashboard/ds/theme/palette.js",
        "src/dashboard/ds/theme/palette.json",
        "src/dashboard/lib/freeze-probe.tokens.ts",
      ];
      for (const path of additions) {
        writeFixtureFile(root, path, "new presentation file\n");
        const violations = dashboardPresentationInventoryViolations(root, frozenPresentationFiles);
        assert.equal(violations.length, 1);
        assert.ok(violations[0]?.includes("added:"));
        assert.ok(violations[0]?.includes(path));
        assert.ok(violations[0]?.includes(PRESENTATION_FREEZE_BRIEF));
        assert.ok(violations[0]?.includes(COMPONENT_CHANGE_INSTRUCTION));
        unlinkSync(join(root, path));
        assert.deepEqual(dashboardPresentationInventoryViolations(root, frozenPresentationFiles), []);
      }

      const deletions = [
        "src/dashboard/ds/primitives/primitives-core.tsx",
        "src/dashboard/app/index.css",
        "src/dashboard/ds/theme/tokens.ts",
      ];
      for (const path of deletions) {
        unlinkSync(join(root, path));
        const violations = dashboardPresentationInventoryViolations(root, frozenPresentationFiles);
        assert.equal(violations.length, 1);
        assert.ok(violations[0]?.includes("removed:"));
        assert.ok(violations[0]?.includes(path));
        writeFixtureFile(root, path, "content changed without changing the frozen path\n");
        assert.deepEqual(dashboardPresentationInventoryViolations(root, frozenPresentationFiles), []);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not freeze unrelated dashboard files", () => {
    const root = temporaryRoot();
    try {
      seedPresentationFixture(root);
      writeFixtureFile(root, "src/dashboard/lib/presentation-helper.ts", "export {};\n");
      writeFixtureFile(root, "src/dashboard/public/metadata.json", "{}\n");
      assert.deepEqual(dashboardPresentationInventoryViolations(root, frozenPresentationFiles), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
