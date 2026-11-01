import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { gitVisibleFiles, REPO_ROOT } from "./support/helpers/guard-files.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html", ".sh"]);
const MAPPING_EXCEPTIONS = /^tests\/(?:architecture|parity|perf|types|support)\//u;
const TEST_SUFFIX = /(?:^|\/)(?:test|spec)\.[^/]+$|[._-](?:tests?|spec)(?:-d)?\.[^/]+$/u;
const TEST_PREFIX = /(?:^|\/)(?:test|spec)[_-][^/]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const HELPER_ROOT = /^tests\/(?:support\/(?:helpers|fixtures)|architecture\/(?:[^/]+\/)*(?:helpers|fixtures))\//u;

function sourceStem(path: string): string {
  return path.replace(/^src\//u, "").slice(0, -extname(path).length);
}

function matchesModule(stem: string, module: string): boolean {
  return stem === module || (stem.startsWith(`${module}.`)
    && /^[\w-]+(?:\.[\w-]+)*$/u.test(stem.slice(module.length + 1)));
}

function declaresTests(path: string, content: string): boolean {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const bindings = new Set<string>();
  const namespaces = new Set<string>();
  const registrations = new Set(["it", "test", "describe", "suite"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !["vitest", "node:test", "@playwright/test"].includes(statement.moduleSpecifier.text) || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    if (statement.moduleSpecifier.text === "node:test" && clause?.name) bindings.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly && registrations.has((element.propertyName ?? element.name).text)) bindings.add(element.name.text);
      }
    }
  }
  let declared = false;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      let expression = node.expression;
      let member: string | undefined;
      while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
        || ts.isCallExpression(expression)) {
        if (ts.isPropertyAccessExpression(expression)) member = expression.name.text;
        if (ts.isElementAccessExpression(expression) && expression.argumentExpression
          && ts.isStringLiteralLike(expression.argumentExpression)) member = expression.argumentExpression.text;
        expression = expression.expression;
      }
      if (ts.isIdentifier(expression) && (bindings.has(expression.text)
        || (namespaces.has(expression.text) && member !== undefined && registrations.has(member)))) declared = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return declared;
}

function testLayoutViolations(
  tests: readonly string[], tracked: readonly string[],
  readTest: (path: string) => string = (path) => readFileSync(resolve(REPO_ROOT, path), "utf8"),
): string[] {
  const modules = tracked.filter((path) => !path.startsWith("tests/") && SOURCE_EXTENSIONS.has(extname(path)))
    .map(sourceStem).sort((left, right) => right.length - left.length || left.localeCompare(right));
  const violations: string[] = [];
  for (const path of tests) {
    const namedSuffix = TEST_SUFFIX.test(path);
    if (!namedSuffix && (!TEST_PREFIX.test(path)
      || (HELPER_ROOT.test(path) && !declaresTests(path, readTest(path))))) continue;
    const canonical = path.endsWith(".test.ts") && !/(?:^|\/)test\.ts$/u.test(path);
    const integration = canonical ? path.endsWith(".integration.test.ts")
      : /\.integration\.(?:test|spec)(?:-d)?\.[^./]+$/u.test(path);
    const suffix = integration ? ".integration.test.ts" : ".test.ts";
    let stem = path.replace(/^tests\//u, "");
    stem = canonical ? stem.slice(0, -suffix.length)
      : stem.replace(/(?:\.integration)?[._-](?:tests?|spec)(?:-d)?\.[^./]+$/u, "").replace(/(^|\/)(test|spec)\.[^./]+$/u, "$1$2");
    if (!namedSuffix) stem = stem.replace(/(^|\/)(?:test|spec)[_-]([^/]+)\.[^./]+$/u, "$1$2");
    if (canonical && MAPPING_EXCEPTIONS.test(path)) continue;
    const module = modules.find((candidate) => matchesModule(stem, candidate));
    if (canonical && module !== undefined) continue;
    const movedStem = stem.replace(/^(?:unit|integration)\//u, "");
    const movedModule = modules.find((candidate) => matchesModule(movedStem, candidate));
    const owners = movedModule !== undefined ? [movedModule] : modules.filter((candidate) => matchesModule(basename(stem), basename(candidate))
      || candidate.startsWith(`${stem}.`));
    const expected = owners.length > 0
      ? owners.map((owner) => `tests/${owner}${suffix}`).join(" or ")
      : `tests/${stem}${suffix}`;
    violations.push(`${path}: expected ${expected}${owners.length === 0 && !MAPPING_EXCEPTIONS.test(path) ? " for an existing tracked source module" : ""}`);
  }
  return violations;
}

const TRACKED_CANARY_SOURCES = [
  "src/backend/a/thing.ts", "src/backend/a/test-thing.ts", "src/backend/a/thing-test.ts",
  "src/backend/a/thing.test.detail.ts", "src/backend/a/thing.integration.test.detail.ts",
  "src/dashboard/ds/theme/tokens.css", "src/example.ts",
  "scripts/test/artifact-policy.ts", "duo-autopilot/src/sign-count.js", "vite.dashboard.config.ts",
  "src/example.detail.ts",
];

describe("test layout", () => {
  it("mirrors existing tracked modules and uses only canonical test filenames", () => {
    const tracked = execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\0").filter((path) => path !== "" && existsSync(resolve(REPO_ROOT, path)));
    assert.ok(tracked.includes("src/cli.ts"), "tracked source inventory must contain the CLI entry point");
    const tests = gitVisibleFiles(["tests"]);
    assert.ok(tests.some((path) => path === "tests/cli.integration.test.ts"), "test inventory must contain the CLI contract");
    assert.deepEqual(testLayoutViolations(tests, tracked), []);
  });

  it("accepts source paths, retained full paths, CSS and dotted module topics", () => {
    assert.deepEqual(testLayoutViolations([
      "tests/backend/a/thing.test.ts", "tests/backend/a/thing.integration.test.ts",
      "tests/backend/a/thing.local.test.ts", "tests/backend/a/thing.local.integration.test.ts",
      "tests/backend/a/thing.topic.test.ts", "tests/dashboard/ds/theme/tokens.test.ts",
      "tests/backend/a/test-thing.test.ts", "tests/backend/a/test-thing.topic.integration.test.ts",
      "tests/backend/a/thing-test.test.ts", "tests/backend/a/thing-test.topic.integration.test.ts",
      "tests/backend/a/thing.test.detail.test.ts", "tests/backend/a/thing.test.detail.topic.integration.test.ts",
      "tests/backend/a/thing.integration.test.detail.test.ts", "tests/backend/a/thing.integration.test.detail.topic.test.ts",
      "tests/scripts/test/artifact-policy.test.ts", "tests/duo-autopilot/src/sign-count.test.ts",
      "tests/vite.dashboard.config.test.ts", "tests/vite.dashboard.config.topic.integration.test.ts",
      "tests/example.detail.topic.test.ts",
    ], TRACKED_CANARY_SOURCES), []);
  });

  it("names the concrete mirror for misplaced source, script, Duo and CSS tests", () => {
    for (const [path, expected] of [
      ["tests/unit/backend/a/thing.test.ts", "tests/backend/a/thing.test.ts"],
      ["tests/integration/backend/a/thing.integration.test.ts", "tests/backend/a/thing.integration.test.ts"],
      ["tests/artifact-policy.test.ts", "tests/scripts/test/artifact-policy.test.ts"],
      ["tests/sign-count.test.ts", "tests/duo-autopilot/src/sign-count.test.ts"],
      ["tests/tokens.test.ts", "tests/dashboard/ds/theme/tokens.test.ts"],
      ["tests/unit/example.detail.topic.test.ts", "tests/example.detail.test.ts"],
      ["tests/unit/backend/a/thing-test.test.ts", "tests/backend/a/thing-test.test.ts"],
      ["tests/unit/backend/a/thing.test.detail.test.ts", "tests/backend/a/thing.test.detail.test.ts"],
      ["tests/unit/backend/a/thing.integration.test.detail.test.ts", "tests/backend/a/thing.integration.test.detail.test.ts"],
    ]) assert.deepEqual(testLayoutViolations([path], TRACKED_CANARY_SOURCES), [`${path}: expected ${expected}`]);
  });

  it("rejects absent source modules and truncated dotted config names", () => {
    assert.deepEqual(testLayoutViolations(["tests/vite.test.ts"], TRACKED_CANARY_SOURCES), [
      "tests/vite.test.ts: expected tests/vite.dashboard.config.test.ts",
    ]);
    for (const path of ["tests/phantom.test.ts", "tests/example..topic.test.ts"]) {
      assert.deepEqual(testLayoutViolations([path], TRACKED_CANARY_SOURCES), [
        `${path}: expected ${path} for an existing tracked source module`,
      ]);
    }
    assert.deepEqual(testLayoutViolations(["tests/backend/a/thing.test.ts"], ["src/backend/a/other.ts"]), [
      "tests/backend/a/thing.test.ts: expected tests/backend/a/thing.test.ts for an existing tracked source module",
    ]);
  });

  it("exempts only the exact guard, parity, perf, type and support subtrees from mapping", () => {
    for (const subtree of ["architecture", "parity", "perf", "types", "support"]) {
      assert.deepEqual(testLayoutViolations([`tests/${subtree}/unmapped.test.ts`], []), []);
      for (const path of [`tests/${subtree}-extra/unmapped.test.ts`, `tests/backend/${subtree}/unmapped.test.ts`]) {
        assert.deepEqual(testLayoutViolations([path], []), [`${path}: expected ${path} for an existing tracked source module`]);
      }
    }
  });

  it("rejects conventional alternate test filenames while allowing helpers with no test registration", () => {
    for (const [name, expected] of [
      ["thing.spec.ts", "thing.test.ts"], ["thing.test.tsx", "thing.test.ts"],
      ["thing.test.js", "thing.test.ts"], ["thing.spec.js", "thing.test.ts"], ["thing.spec.tsx", "thing.test.ts"],
      ["thing.integration.spec.ts", "thing.integration.test.ts"],
      ["thing-test.ts", "thing.test.ts"], ["thing_test.ts", "thing.test.ts"],
      ["thing.tests.ts", "thing.test.ts"], ["test-thing.ts", "thing.test.ts"],
      ["test-thing.mts", "thing.test.ts"], ["test-thing.cts", "thing.test.ts"],
      ["thing.test-d.ts", "thing.test.ts"], ["thing.spec-d.ts", "thing.test.ts"],
      ["test.ts", "test.test.ts"], ["spec.ts", "spec.test.ts"],
    ]) {
      const path = `tests/architecture/${name}`;
      assert.deepEqual(testLayoutViolations([path], []), [`${path}: expected tests/architecture/${expected}`]);
    }
    assert.deepEqual(testLayoutViolations(["tests/types/flow-graph.ts"], []), []);
    const helper = "tests/support/helpers/test-data/test-data-source.ts";
    assert.deepEqual(testLayoutViolations([helper], [], () => "export function testDataInputSource() {}"), []);
    assert.deepEqual(testLayoutViolations([helper], [], () => '// it("comment", () => {});'), []);
    assert.deepEqual(testLayoutViolations([helper], [], () => 'import * as testing from "vitest"; testing.vi.fn();'), []);
    for (const helperPath of ["tests/support/helpers/test-thing.ts", "tests/architecture/tooling/helpers/test-thing.ts"]) {
      for (const content of [
        'import { it as check } from "vitest"; check("case", () => {});',
        'import * as testing from "vitest"; testing.test("case", () => {});',
        'import check from "node:test"; check("case", () => {});',
        'import { test as check } from "@playwright/test"; check("case", () => {});',
        'import * as testing from "@playwright/test"; testing.test.describe("suite", () => {});',
      ]) assert.deepEqual(testLayoutViolations([helperPath], [], () => content), [
        `${helperPath}: expected ${helperPath.replace("test-thing.ts", "thing.test.ts")}`,
      ]);
    }
    assert.deepEqual(testLayoutViolations(["tests/backend/a/test-thing.spec.ts"], TRACKED_CANARY_SOURCES), [
      "tests/backend/a/test-thing.spec.ts: expected tests/backend/a/test-thing.test.ts",
    ]);
    for (const source of ["thing-test", "thing.test.detail", "thing.integration.test.detail"]) {
      assert.deepEqual(testLayoutViolations([`tests/backend/a/${source}.spec.ts`], TRACKED_CANARY_SOURCES), [
        `tests/backend/a/${source}.spec.ts: expected tests/backend/a/${source}.test.ts`,
      ]);
    }
    const alternate = "tests/examples/thing-test.ts";
    assert.deepEqual(testLayoutViolations([alternate], ["src/examples/thing.ts"]), [
      `${alternate}: expected tests/examples/thing.test.ts`,
    ]);
  });
});
