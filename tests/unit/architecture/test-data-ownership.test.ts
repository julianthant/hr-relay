/**
 * D341 — test inputs have one owner each and the private half never leaks.
 *
 * 1. Cross-tier code never imports unit-only fixtures or helpers.
 * 2. Shared fixtures and helpers import no private-input, credential, `.env`,
 *    database or browser seam, so importing one stays pure.
 * 3. The tracked shared inputs are visible to git, the private file is ignored,
 *    the example carries placeholders only, and every declared shared file is a
 *    tracked file inside the repository.
 * 4. The shared-fixture README names every shared module, so the interface stays discoverable.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import { TEST_DATA_CONFIG_PATH, TEST_DATA_LOCAL_CONFIG_PATH, TEST_DATA_LOCAL_EXAMPLE_PATH } from "../../../src/domain/test-data.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

const UNIT_ONLY_ROOTS = ["tests/unit/fixtures/", "tests/unit/helpers/"];
const ARCHITECTURE_HELPERS_ROOT = "tests/unit/architecture/helpers/";
/**
 * The cross-tier importers of architecture helpers that tests/fixtures/README.md records. They
 * predate D341 and stay until `descriptor-fixtures` moves with its owner; any other importer,
 * or a recorded one that disappears, fails here so the README never understates the consumers.
 */
const RECORDED_ARCHITECTURE_HELPER_IMPORTS: readonly { importer: string; module: string }[] = [
  { importer: "tests/fixtures/intake-workflow-fixture.ts", module: "tests/unit/architecture/helpers/descriptor-fixtures" },
  { importer: "tests/scenario/fixture-graph.scenario.test.ts", module: "tests/unit/architecture/helpers/descriptor-fixtures" },
  { importer: "tests/scenario/operator-lifecycle.walk.test.ts", module: "tests/unit/architecture/helpers/descriptor-fixtures" },
];
const SHARED_ROOTS = ["tests/fixtures", "tests/helpers"];
const CROSS_TIER_ROOTS = ["tests/scenario", "tests/integration", "tests/parity", "tests/fixtures", "tests/helpers", "scripts", "src"];
/** Seams a shared fixture may never touch at import time. */
const FORBIDDEN_SHARED_IMPORTS: readonly RegExp[] = [
  /src\/control\/test-data\.js$/u,
  /src\/infra\/config\/credential-store\.js$/u,
  /src\/infra\/config\/credential-test-data-migration\.js$/u,
  /secure-env-bootstrap/u,
  /^dotenv/u,
  /^playwright/u,
  /^node:sqlite$/u,
];
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/gu;

function sourceFiles(roots: readonly string[]): string[] {
  return gitVisibleFiles(roots).filter((path) => /\.(?:ts|tsx|mts|js|mjs)$/u.test(path) && !path.endsWith(".d.ts"));
}

function importsOf(path: string): { specifier: string; resolved: string }[] {
  const text = readFileSync(join(REPO_ROOT, path), "utf8");
  const found: { specifier: string; resolved: string }[] = [];
  for (const match of text.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? "";
    const resolved = specifier.startsWith(".") ? relative(REPO_ROOT, resolve(REPO_ROOT, dirname(path), specifier)) : specifier;
    found.push({ specifier, resolved });
  }
  return found;
}

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("D341 test-data ownership", () => {
  it("no cross-tier module imports a unit-only fixture or helper", () => {
    const violations: string[] = [];
    for (const path of sourceFiles(CROSS_TIER_ROOTS)) {
      for (const { resolved } of importsOf(path)) {
        if (UNIT_ONLY_ROOTS.some((root) => resolved.startsWith(root))) violations.push(`${path} -> ${resolved}`);
      }
    }
    assert.deepEqual(violations, [], "move the fixture to tests/fixtures or tests/helpers and record it in tests/fixtures/README.md");
  });

  it("cross-tier imports of architecture helpers are exactly the recorded set", () => {
    const observed: { importer: string; module: string }[] = [];
    for (const path of sourceFiles(CROSS_TIER_ROOTS)) {
      for (const { resolved } of importsOf(path)) {
        if (resolved.startsWith(ARCHITECTURE_HELPERS_ROOT)) observed.push({ importer: path, module: resolved.replace(/\.js$/u, "") });
      }
    }
    const key = (entry: { importer: string; module: string }) => `${entry.importer} -> ${entry.module}`;
    assert.deepEqual(observed.map(key).toSorted(), RECORDED_ARCHITECTURE_HELPER_IMPORTS.map(key).toSorted(),
      "record the importer in tests/fixtures/README.md and RECORDED_ARCHITECTURE_HELPER_IMPORTS, or drop the stale record");
    const readme = readFileSync(join(REPO_ROOT, "tests/fixtures/README.md"), "utf8");
    for (const entry of RECORDED_ARCHITECTURE_HELPER_IMPORTS) {
      assert.ok(readme.includes(entry.importer), `tests/fixtures/README.md must name ${entry.importer}`);
    }
  });

  it("shared fixtures and helpers stay pure at import", () => {
    const files = sourceFiles(SHARED_ROOTS);
    assert.ok(files.length > 10, "shared fixtures exist");
    const violations: string[] = [];
    for (const path of files) {
      for (const { specifier, resolved } of importsOf(path)) {
        if (FORBIDDEN_SHARED_IMPORTS.some((pattern) => pattern.test(resolved) || pattern.test(specifier))) violations.push(`${path} -> ${specifier}`);
      }
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.equal(/test-data\.local\.json|\.tracker\/credentials|process\.env\.HRAUTO_/u.test(text), false, `${path} names a private seam`);
    }
    assert.deepEqual(violations, []);
  });

  it("tracks the shared inputs, ignores the private file and keeps the example value-free", () => {
    const visible = new Set(gitVisibleFiles(["config", "tests/fixtures/documents"]));
    assert.ok(visible.has(TEST_DATA_CONFIG_PATH), `${TEST_DATA_CONFIG_PATH} must be visible to git`);
    assert.ok(visible.has(TEST_DATA_LOCAL_EXAMPLE_PATH), `${TEST_DATA_LOCAL_EXAMPLE_PATH} must be visible to git`);
    assert.equal(visible.has(TEST_DATA_LOCAL_CONFIG_PATH), false, `${TEST_DATA_LOCAL_CONFIG_PATH} must never be visible to git`);
    assert.equal(isIgnored(TEST_DATA_LOCAL_CONFIG_PATH), true, `${TEST_DATA_LOCAL_CONFIG_PATH} must be gitignored`);
    assert.equal(isIgnored(`${dirname(TEST_DATA_LOCAL_CONFIG_PATH)}/.test-data.local.00000000-0000-4000-8000-000000000000.tmp`), true, "an orphaned private staging file must be gitignored");
    assert.equal(isIgnored(TEST_DATA_CONFIG_PATH), false);
    assert.equal(isIgnored(TEST_DATA_LOCAL_EXAMPLE_PATH), false);

    const example = JSON.parse(readFileSync(join(REPO_ROOT, TEST_DATA_LOCAL_EXAMPLE_PATH), "utf8")) as { inputs: Record<string, { value: unknown }>; files: Record<string, string> };
    for (const [name, entry] of Object.entries(example.inputs)) {
      assert.match(String(entry.value), /^<[^<>]+>$/u, `example input ${name} must be a <placeholder>`);
    }
    for (const [name, path] of Object.entries(example.files)) {
      assert.match(path, /^<[^<>]+>$/u, `example file ${name} must be a <placeholder>`);
    }

    const shared = JSON.parse(readFileSync(join(REPO_ROOT, TEST_DATA_CONFIG_PATH), "utf8")) as { files: Record<string, { path: string }> };
    const repoReal = realpathSync(REPO_ROOT);
    for (const [name, file] of Object.entries(shared.files)) {
      const declared = resolve(REPO_ROOT, dirname(TEST_DATA_CONFIG_PATH), file.path);
      assert.ok(existsSync(declared), `declared file ${name} must exist`);
      const real = realpathSync(declared);
      assert.ok(real.startsWith(`${repoReal}/`), `declared file ${name} must resolve inside the repository`);
      const rel = relative(repoReal, real);
      assert.ok(visible.has(rel), `declared file ${name} (${rel}) must be visible to git`);
      assert.equal(isIgnored(rel), false, `declared file ${name} must not be ignored`);
    }
  });

  it("the shared-fixture README names every shared module", () => {
    const readme = readFileSync(join(REPO_ROOT, "tests/fixtures/README.md"), "utf8");
    const missing = sourceFiles(SHARED_ROOTS)
      .map((path) => path.replace(/^tests\/(?:fixtures|helpers)\//u, "").replace(/\.(?:ts|tsx)$/u, ""))
      .filter((stem) => !stem.includes("/"))
      .filter((stem) => !readme.includes(stem) && !isCoveredByFamily(readme, stem));
    assert.deepEqual(missing, [], "add the module to the ownership map in tests/fixtures/README.md");
  });
});

/** Seam modules are listed as a family ("seams", "documents") rather than one by one. */
function isCoveredByFamily(readme: string, stem: string): boolean {
  if (stem.endsWith("-seams")) return readme.includes("seams");
  return false;
}
