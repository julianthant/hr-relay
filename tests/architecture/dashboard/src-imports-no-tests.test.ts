import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

function moduleSpecifiers(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

/** Specifiers in `content` that reach `tests/` or a path segment named `mocks` from a module under src/. */
export function srcTestReaches(path: string, content: string): readonly string[] {
  return moduleSpecifiers(path, content).filter((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const target = relative(REPO_ROOT, normalize(join(REPO_ROOT, dirname(path), specifier))).replaceAll("\\", "/");
    return target === "tests" || target.startsWith("tests/") || target.split("/").includes("mocks");
  }).map((specifier) => `${path}: ${specifier}`);
}

describe("src imports no tests or mocks", () => {
  it("keeps every module under src/ free of imports from tests/ and from any path named mocks", () => {
    const violations = gitVisibleFiles(["src"])
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
      .flatMap((path) => srcTestReaches(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });

  it("detects static, re-exported and dynamic reaches into tests/ and mocks paths", () => {
    assert.equal(srcTestReaches("src/dashboard/app/a.tsx", [
      'import { x } from "../../../tests/mocks/workflows/x.js";',
      'export { y } from "../../../tests/support/y.js";',
      'void import("../surfaces/workflows/mocks/z.js");',
    ].join("\n")).length, 3);
  });

  it("ignores ordinary imports and path-shaped strings", () => {
    assert.deepEqual(srcTestReaches("src/dashboard/app/a.tsx", [
      'import { x } from "../surfaces/queue/queue.js";',
      'const fixture = "tests/support/fixtures/ui/crm/onboarding.fixture.json";',
    ].join("\n")), []);
  });
});
