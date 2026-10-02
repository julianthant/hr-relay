/**
 * Track D row D4 (ref frontend-backend-integration §7.4; audit finding P1) —
 * a `memo` is only as real as the props handed to it.
 *
 * `QueuePanel`, `TopBar` and `LogPanel` are `memo`'d. `memo` compares props by
 * `Object.is`, so ONE prop slot that mints a fresh reference every render turns
 * the whole wrapper into pure overhead — the panel re-renders exactly as often
 * as before, every gate stays green, and nothing on any surface looks wrong.
 * That is the failure mode this guard exists for: it is invisible to the type
 * checker, invisible to the unit lane (this tree renders no React there — the
 * D237/D238 lesson), and invisible to the parity corpus, which photographs a
 * settled screen and cannot see how many times it was drawn.
 *
 * The rule: inside a prop expression of one of those three elements, in
 * `src/dashboard/app/*.tsx`, there may be no object literal, array literal,
 * arrow function, function expression or `new` — the five constructs that are
 * PROVABLY a new reference on every evaluation. Every one of them shipped in
 * `dashboard-app.tsx` before D4: an inline `nav={{…}}`, an inline
 * `handlers={{…}}` holding five closures, `dayWire?.queueSurfaces ?? []`, an
 * inline `onDay={(next) => …}`.
 *
 * **What this guard deliberately does NOT claim.** It says nothing about a
 * CALL in a prop slot (`workflowLabelOf(activeWorkflowId)`), because a call is
 * not provably unstable — it may return a primitive, or the very same
 * reference each time, and only its body can say which. Judging calls would
 * mean either an allowlist that rots or a refusal of honest primitive-returning
 * helpers. So the guard holds the half that can be decided from the syntax
 * alone and states the other half here rather than pretending to cover it.
 *
 * A JSX SPREAD is judged through, not at: `{...(cond ? {} : { filter: x })}`
 * spreads keys into props, so the literal is a container that is destructured
 * away and never becomes a prop value — its property VALUES are what get
 * judged, by the same rules.
 *
 * Both arms run against checked-in fixtures — one violating in every way the
 * rule can break, one clean — so a walker that resolved nothing could not pass.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

const APP_ROOT = "src/dashboard/app";
const FIXTURE_ROOT = "tests/architecture/dashboard/fixtures";

/** The elements whose `memo` this guard protects. */
export const MEMOIZED_ELEMENTS = ["QueuePanel", "TopBar", "LogPanel"] as const;

const UNSTABLE: ReadonlyArray<readonly [(node: ts.Node) => boolean, string]> = [
  [ts.isArrayLiteralExpression, "an array literal"],
  [ts.isArrowFunction, "an arrow function"],
  [ts.isFunctionExpression, "a function expression"],
  [ts.isNewExpression, "a `new` expression"],
];

/**
 * Walks one prop expression for the five provably-fresh constructs.
 *
 * `container` is true only while descending a JSX spread, where an object
 * literal is destructured away rather than becoming a prop value; its property
 * initializers are then judged on their own, as containers no longer.
 */
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

function appFiles(): string[] {
  return readdirSync(join(REPO_ROOT, APP_ROOT))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => join(APP_ROOT, file));
}

describe("dashboard memo prop stability (Track D D4, ref frontend-backend-integration §7.4)", () => {
  it("the three memoized panels are handed no provably-fresh prop", () => {
    const files = appFiles();
    expect(files.length).toBeGreaterThan(0);
    const report = files.flatMap((file) =>
      memoPropStabilityViolations(file, readFileSync(join(REPO_ROOT, file), "utf8"))
        .map((violation) => `${file}: ${violation}`));
    expect(report).toEqual([]);
  });

  it("the three panels really are `memo`'d, so this guard is not protecting nothing", () => {
    for (const element of MEMOIZED_ELEMENTS) {
      const source = readFileSync(
        join(REPO_ROOT, "src/dashboard/surfaces", `${element === "QueuePanel" ? "queue" : element === "TopBar" ? "top-bar" : "log-panel"}.tsx`),
        "utf8",
      );
      expect(source).toContain(`export const ${element} = memo(function ${element}(`);
    }
  });

  it("catches the violating fixture in every way the rule can break, and passes the clean one", () => {
    const bad = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "memo-prop-stability-violation.tsx"), "utf8");
    expect(memoPropStabilityViolations("memo-prop-stability-violation.tsx", bad)).toEqual([
      "<TopBar> `daySurfaces`: an array literal is a new reference every render, so `memo` can never compare equal",
      "<TopBar> `onDay`: an arrow function is a new reference every render, so `memo` can never compare equal",
      "<TopBar> `nav`: an object literal is a new reference every render, so `memo` can never compare equal",
      "<QueuePanel> `handlers`: an object literal is a new reference every render, so `memo` can never compare equal",
      "<LogPanel> `onDetailEdited`: a function expression is a new reference every render, so `memo` can never compare equal",
      "<LogPanel> `surface`: a `new` expression is a new reference every render, so `memo` can never compare equal",
    ]);
    const clean = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "memo-prop-stability-clean.tsx"), "utf8");
    expect(memoPropStabilityViolations("memo-prop-stability-clean.tsx", clean)).toEqual([]);
  });
});
