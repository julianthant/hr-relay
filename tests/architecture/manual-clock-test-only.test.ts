import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

export function findManualClockReferences(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    const dynamicProperty = ts.isStringLiteralLike(node)
      && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node;
    if ((ts.isIdentifier(node) || dynamicProperty) && node.text === "manualClock") {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${path}:${position.line + 1}:${position.character + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

describe("manual clock test-only boundary", () => {
  it("keeps the manual clock definition out of every production module", () => {
    const violations = gitVisibleFiles(["src"])
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && path !== "src/domain/clock.ts")
      .flatMap((path) => findManualClockReferences(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });

  it("detects imports, calls, re-exports, and dynamic property access", () => {
    assert.equal(findManualClockReferences("fixture.ts", [
      'import { manualClock } from "./clock.js";',
      "manualClock(new Date());",
      'export { manualClock } from "./clock.js";',
      'void import("./clock.js").then((module) => module["manualClock"]);',
    ].join("\n")).length, 4);
  });

  it("ignores source-shaped strings and comments", () => {
    assert.deepEqual(findManualClockReferences("fixture.ts", [
      "// manualClock()",
      "const example = 'manualClock';",
    ].join("\n")), []);
  });
});
