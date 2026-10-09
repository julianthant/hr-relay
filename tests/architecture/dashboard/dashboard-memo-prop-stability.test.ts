
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const CALLER_ROOTS = ["src/dashboard"] as const;
const FIXTURE_ROOT = "tests/architecture/dashboard/fixtures";

/** The elements whose `memo` this guard protects. */
export const MEMOIZED_ELEMENTS = ["QueuePanel", "WorkspaceRail", "LogPanel"] as const;

const UNSTABLE: ReadonlyArray<readonly [(node: ts.Node) => boolean, string]> = [
  [ts.isArrayLiteralExpression, "an array literal"],
  [ts.isArrowFunction, "an arrow function"],
  [ts.isFunctionExpression, "a function expression"],
  [ts.isNewExpression, "a `new` expression"],
];

// JSX spread containers disappear; judge their property values for reference stability.
function unstableConstructs(expr: ts.Expression, container: boolean): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node, inContainer: boolean): void => {
    if (ts.isObjectLiteralExpression(node)) {
      if (!inContainer) {
        found.push("an object literal");
        return;
      }
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) visit(property.initializer, false);
        else if (ts.isSpreadAssignment(property)) visit(property.expression, true);
        // A shorthand (`{ filter }`) or a method is an identifier or a function;
        // the former is stable, the latter is caught by the arms below.
        else if (ts.isMethodDeclaration(property)) found.push("a function expression");
      }
      return;
    }
    for (const [is, label] of UNSTABLE) {
      if (is(node)) {
        found.push(label);
        return;
      }
    }
    // The container reading survives exactly the forms that wrap a value
    // without becoming one: parentheses, `cond ? a : b`, and `a ?? b`.
    const carries = ts.isParenthesizedExpression(node)
      || ts.isConditionalExpression(node)
      || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);
    node.forEachChild((child) => { visit(child, carries && inContainer); });
  };
  visit(expr, container);
  return found;
}

/** Every prop slot of a memoized element in `text` that cannot compare equal. */
export function memoPropStabilityViolations(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const named = new Set<string>(MEMOIZED_ELEMENTS);

  const judgeOpening = (opening: ts.JsxOpeningLikeElement): void => {
    const tag = opening.tagName;
    if (!ts.isIdentifier(tag) || !named.has(tag.text)) return;
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        for (const found of unstableConstructs(attribute.expression, true)) {
          out.push(`<${tag.text}> spread: ${found} is a new reference every render`);
        }
        continue;
      }
      const { initializer } = attribute;
      if (initializer === undefined || !ts.isJsxExpression(initializer)) continue;
      if (initializer.expression === undefined) continue;
      const slot = ts.isIdentifier(attribute.name) ? attribute.name.text : String(attribute.name.getText(sf));
      for (const found of unstableConstructs(initializer.expression, false)) {
        out.push(`<${tag.text}> \`${slot}\`: ${found} is a new reference every render, so \`memo\` can never compare equal`);
      }
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node)) judgeOpening(node);
    else if (ts.isJsxElement(node)) judgeOpening(node.openingElement);
    node.forEachChild(walk);
  };
  walk(sf);
  return out;
}

function callerFiles(): string[] {
  return CALLER_ROOTS.flatMap(root => walkFiles(join(REPO_ROOT, root), { extensions: [".tsx"] }).map(file => relative(REPO_ROOT, file)));
}

describe("dashboard memo prop stability", () => {
  it("the three memoized panels are handed no provably-fresh prop", () => {
    const files = callerFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("src/dashboard/surfaces/workflows/mocks/workflow-mock-queue.tsx");
    expect(files).toContain("src/dashboard/app/dashboard-app.tsx");
    const report = files.flatMap((file) =>
      memoPropStabilityViolations(file, readFileSync(join(REPO_ROOT, file), "utf8"))
        .map((violation) => `${file}: ${violation}`));
    expect(report).toEqual([]);
  });

  it("the three panels really are `memo`'d, so this guard is not protecting nothing", () => {
    for (const element of MEMOIZED_ELEMENTS) {
      const source = readFileSync(
        join(REPO_ROOT, "src/dashboard/surfaces", element === "QueuePanel" ? "queue/queue.tsx" : element === "WorkspaceRail" ? "shell/workspace-rail.tsx" : "run-detail/log-panel.tsx"),
        "utf8",
      );
      expect(source).toContain(`export const ${element} = memo(function ${element}(`);
    }
  });

  it("catches the violating fixture in every way the rule can break, and passes the clean one", () => {
    const bad = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "memo-prop-stability-violation.tsx"), "utf8");
    expect(memoPropStabilityViolations("memo-prop-stability-violation.tsx", bad)).toEqual([
      "<WorkspaceRail> `daySurfaces`: an array literal is a new reference every render, so `memo` can never compare equal",
      "<WorkspaceRail> `onDay`: an arrow function is a new reference every render, so `memo` can never compare equal",
      "<WorkspaceRail> `nav`: an object literal is a new reference every render, so `memo` can never compare equal",
      "<QueuePanel> `handlers`: an object literal is a new reference every render, so `memo` can never compare equal",
      "<LogPanel> `onDetailEdited`: a function expression is a new reference every render, so `memo` can never compare equal",
      "<LogPanel> `surface`: a `new` expression is a new reference every render, so `memo` can never compare equal",
    ]);
    const clean = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "memo-prop-stability-clean.tsx"), "utf8");
    expect(memoPropStabilityViolations("memo-prop-stability-clean.tsx", clean)).toEqual([]);
  });
});
