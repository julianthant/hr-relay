/**
 * Guard (doc 05 §4 · doc 09 fail-loud): a browser session's authentication is
 * never CONCLUDED from a URL, and its verification is never skippable.
 *
 * ## Why this guard exists
 *
 * On 2026-08-03 a live UCPath login smoke reported success in ~3 seconds having
 * never authenticated. Two independent production defects, both failing OPEN:
 *
 * 1. the login recipe read `page.url()`, matched a host SUBSTRING, and returned
 *    `already-authenticated` on the PUBLIC UCPath portal — and that early
 *    return also skipped the recipe's own second fact; and
 * 2. the neutral reset validated a reused session with `isAuthenticatedUrl`
 *    alone, so PeopleSoft's signon page — same host, same route shape — passed
 *    as the authenticated application.
 *
 * A person lookup on that session would have scraped a sign-in page and
 * reported it as authenticated HR data. Unit tests pin the CURRENT recipes;
 * this guard pins the SHAPE, so the next system's recipe cannot rebuild the
 * defect from scratch.
 *
 * ## What is enforced, structurally
 *
 * - every store login recipe is produced by `defineVerifiedLoginRecipe`, whose
 *   wrapper runs the proof AFTER the flow on every return path;
 * - no store login recipe reaches its own `return "already-authenticated"` /
 *   `"logged-in"` outside that wrapper;
 * - `BrowserSystemBinding` exposes a VERIFIER, not a URL predicate, and every
 *   landed binding supplies one; and
 * - the browser-session factory's reset asserts through
 *   `assertAuthenticatedApplication` rather than calling a URL predicate.
 *
 * Each arm is executed against a violating fixture below, so a scanner that
 * stopped working cannot stand in for enforcement.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { BROWSER_SYSTEM_BINDINGS } from "../../../src/infra/browser/system-bindings.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

const WRAPPER = "defineVerifiedLoginRecipe";
const RESET_ASSERTION = "assertAuthenticatedApplication";
const FACTORY = "src/infra/browser/browser-session-factory.ts";

function parse(path: string, content: string): ts.SourceFile {
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => { visit(child, callback); });
}

/** The one place a recipe is allowed to name a `LoginResult` is inside the wrapper. */
function isInsideWrapperCall(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && current.expression.text === WRAPPER) return true;
  }
  return false;
}

export function auditLoginRecipeShape(path: string, content: string): readonly string[] {
  const violations: string[] = [];
  const source = parse(path, content);
  visit(source, (node) => {
    // `export const <x>LoginRecipe = ...` must be the wrapper's product.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && /LoginRecipe$/.test(node.name.text)) {
      const initializer = node.initializer;
      const built = initializer !== undefined && ts.isCallExpression(initializer)
        && ts.isIdentifier(initializer.expression) && initializer.expression.text === WRAPPER;
      if (!built) {
        violations.push(`${path}: ${node.name.text} is not built by ${WRAPPER}; its verification would be skippable`);
      }
    }
    // A LoginResult produced anywhere else escaped the wrapper's proof.
    if (ts.isStringLiteral(node)
      && (node.text === "already-authenticated" || node.text === "logged-in")
      && !isInsideWrapperCall(node)) {
      violations.push(`${path}: login result "${node.text}" is produced outside ${WRAPPER}`);
    }
  });
  return violations;
}

export function auditResetVerification(path: string, content: string): readonly string[] {
  const violations: string[] = [];
  if (/isAuthenticatedUrl/.test(content)) {
    violations.push(`${path}: reuse is validated by a URL predicate (isAuthenticatedUrl); it must run the system's verifier`);
  }
  if (!content.includes(RESET_ASSERTION)) {
    violations.push(`${path}: the neutral reset must assert through ${RESET_ASSERTION}`);
  }
  return violations;
}

function storeSessionFiles(): readonly string[] {
  return gitVisibleFiles(["src/stores"]).filter((path) => /\/session\.ts$/.test(path));
}

describe("authentication is never concluded from a URL", () => {
  it("scans a non-vacuous set of store login recipes", () => {
    const files = storeSessionFiles();
    assert.ok(files.length >= 2, "expected at least the ucpath and crm session owners");
    const withRecipes = files.filter((path) =>
      readFileSync(join(REPO_ROOT, path), "utf8").includes("LoginRecipe"));
    assert.deepEqual(
      withRecipes.sort(),
      [
        "src/stores/crm/session.ts",
        "src/stores/kuali/session.ts",
        "src/stores/new-kronos/session.ts",
        "src/stores/ucpath/session.ts",
      ],
      "a landed login recipe must be scanned by this guard",
    );
  });

  it("builds every login recipe through the unskippable verification wrapper", () => {
    const violations = storeSessionFiles().flatMap((path) =>
      auditLoginRecipeShape(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });

  it("catches a recipe that returns a login result on its own authority", () => {
    assert.match(
      auditLoginRecipeShape("src/stores/onbase/session.ts", [
        'import type { SystemLoginRecipe } from "../../infra/browser/login-contract.js";',
        "export const onbaseLoginRecipe: SystemLoginRecipe = async (context) => {",
        '  if (context.page.url().includes("hylandcloud.com")) return "already-authenticated";',
        '  return "logged-in";',
        "};",
      ].join("\n")).join("\n"),
      /not built by defineVerifiedLoginRecipe[\s\S]*produced outside/,
    );
  });

  it("keeps every landed binding on a verifier rather than a URL predicate", () => {
    const bindings = Object.entries(BROWSER_SYSTEM_BINDINGS);
    assert.ok(bindings.length > 0);
    for (const [system, binding] of bindings) {
      assert.ok(binding, system);
      assert.equal(typeof binding.verifyAuthenticated, "function", `${system} must supply a verifier`);
      assert.equal("isAuthenticatedUrl" in binding, false, `${system} must not carry a URL-only predicate`);
    }
  });

  it("keeps the neutral reset on the same assertion the login must pass", () => {
    assert.deepEqual(
      auditResetVerification(FACTORY, readFileSync(join(REPO_ROOT, FACTORY), "utf8")),
      [],
    );
    assert.match(
      auditResetVerification("src/infra/browser/factory.ts", [
        "const observed = page.url();",
        "if (!binding.isAuthenticatedUrl(observed)) throw new Error('not reusable');",
      ].join("\n")).join("\n"),
      /URL predicate[\s\S]*must assert through/,
    );
  });
});
