/**
 * D253 (ref frontend-backend-integration §"D253") — every browser surface settles a command result
 * through the ONE exhaustive fold.
 *
 * `CommandResultSchema` has three arms and TWO of them are refusals. A surface
 * that reads `result.state === "rejected"` and nothing else lets a CAS
 * `conflict` fall through to whatever it does on success — which is exactly
 * how the Context rail came to close its editor, discard the operator's drafts
 * and report a correction saved that the kernel had refused, and how the
 * notification bell came to swallow a stale-revision refusal in silence.
 *
 * There is no fallback written in either place. An unhandled union arm IS the
 * fallback, and it is the most dangerous kind this program has: a false
 * "submitted" on a surface whose whole job is telling the operator what
 * happened. So the rule is structural rather than a review habit —
 * `settleCommandResult` switches over the discriminant, TypeScript refuses an
 * unhandled arm inside it, and this guard refuses a surface that decides
 * settlement for itself.
 *
 * Scope is `src/dashboard/**` — the browser bundle, where a command result is
 * turned into something an operator reads. The fold's own module is exempt
 * (it is the thing being enforced), and so is the client transport, whose job
 * is to PARSE the union rather than to act on it.
 *
 * **Track D row D3 closed the hole the first rule could not see.** "One arm
 * without the other" is trivially satisfied by a module that names NEITHER —
 * it posts a command, ignores the answer entirely, and every refusal lands on
 * the success path in silence. All nine command-issuing surfaces now call the
 * fold, so the rule can be stated the strong way: a module that posts through
 * `executeCommand` must settle its answer through `settleCommandResult`. That
 * is the second arm, and it is why the first one survives rather than being
 * replaced — the first governs a module that HOLDS a result (a banner, a
 * refusal notice) without posting one itself.
 *
 * **The second arm's own follow-up: MODULE granularity is not CALL-SITE
 * granularity.** Checking whether a module imports the fold at all is
 * satisfied by a module with two `.executeCommand(` dispatches that folds
 * only one, and by a module that imports the fold's TYPE with nothing ever
 * called. Both read as "imports the fold" and neither settles every command.
 * The arm now counts real `ts.CallExpression` sites off the AST —
 * `.executeCommand(` calls versus `settleCommandResult(` calls — and refuses
 * a module whose fold count is short, which answers both holes without a
 * special case for `import type`: a type-only import produces zero calls.
 *
 * Every arm runs against the real tree AND against checked-in violating
 * fixtures, so the walkers prove they can see the patterns they forbid.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { REPO_ROOT } from "./helpers/guard-files.js";

const SCAN_ROOT = "src/dashboard";
const FIXTURE = "tests/unit/architecture/fixtures/command-result-unhandled-conflict.ts";
const FIXTURE_UNFOLDED = "tests/unit/architecture/fixtures/command-result-unfolded-dispatch.ts";
const FIXTURE_PARTIAL_FOLD = "tests/unit/architecture/fixtures/command-result-partial-fold.ts";

/**
 * The fold itself, and the transport that parses the wire. Neither turns a
 * result into an operator-facing outcome; every other module in the bundle
 * that names an arm does.
 */
const EXEMPT = new Set([
  "src/dashboard/app/command-result.ts",
  "src/dashboard/client/commands.ts",
]);

/**
 * Admitted forwarding layers: modules that forward executeCommand without
 * deciding settlement, returning the unhandled Promise to their callers.
 * The guard proves both that these layers forward rather than swallow the result,
 * and that all callers in src/dashboard consume it with settleCommandResult.
 */
const FORWARDING_LAYERS = new Set([
  "src/dashboard/client/index.ts",
  "src/dashboard/app/run-launch-model.ts",
]);

function sourceFiles(root: string): readonly string[] {
  const absolute = join(REPO_ROOT, root);
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(path);
    }
  };
  walk(absolute);
  return found;
}

/**
 * A module DECIDES settlement when it tests one refusal arm without testing
 * the other. Naming both is legal — several surfaces predate the fold and read
 * `conflict || rejected` in one condition (or its negation, which `archive.tsx`
 * uses to return early), and both forms are exhaustive; what is forbidden is
 * naming one and leaving the other to fall through. Both comparison operators
 * count as naming the arm, because `!== "conflict"` decides the same question.
 */
function decidesSettlementAlone(text: string): boolean {
  const namesRejected = /state\s*[!=]==\s*"rejected"/u.test(text);
  const namesConflict = /state\s*[!=]==\s*"conflict"/u.test(text);
  return namesRejected !== namesConflict;
}

/**
 * A module POSTS a command when it calls `.executeCommand(` on the client. It
 * has SETTLED that command's answer only to the extent it calls
 * `settleCommandResult(` at least as many times as it posts.
 *
 * This is CALL-SITE granularity, not module granularity (Track D row D3's
 * follow-up). The first cut of this arm checked whether the module IMPORTED
 * `command-result.js` at all, and that check is satisfied by two things it
 * should not be: a module with two `.executeCommand(` dispatches that folds
 * only one of them (the import is present, the second refusal still falls
 * through in silence), and a module that imports the fold's TYPE alone
 * (`import type { CommandSettlement } from ".../command-result.js"` matches
 * the import text with nothing ever called). Counting actual call sites to
 * `settleCommandResult(` fixes both at once: a type-only import produces zero
 * calls, and a module posting N times must settle at least N times or it is
 * refused by name.
 *
 * Both counts are read off the real AST (the same `typescript` compiler API
 * `helpers/ratchet-arms.ts` already uses for this repo's other call-site
 * walkers), not a regex over source text — so a `.executeCommand(` or
 * `settleCommandResult(` spelled out in a comment or a string literal counts
 * for nothing, only an actual `ts.CallExpression` does.
 */
function isExecuteCommandCall(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "executeCommand";
}

/**
 * `settleCommandResult` is always a named import called directly
 * (`settleCommandResult(result)`), but a namespace-imported call
 * (`commandResult.settleCommandResult(result)`) settles the same command and
 * must count too — the invariant is "was the fold called", not "was it called
 * a particular way".
 */
function isSettleCommandResultCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "settleCommandResult";
  if (ts.isPropertyAccessExpression(callee)) {
    if (callee.name.text === "settleCommandResult") return true;
    if (callee.name.text === "then") {
      const fulfillment = node.arguments[0];
      if (fulfillment === undefined) return false;
      return (ts.isIdentifier(fulfillment) && fulfillment.text === "settleCommandResult")
        || (ts.isPropertyAccessExpression(fulfillment) && fulfillment.name.text === "settleCommandResult");
    }
  }
  return false;
}

function countCallSites(source: ts.SourceFile, isMatch: (node: ts.CallExpression) => boolean): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isMatch(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function foldsFewerCommandsThanItPosts(path: string, text: string): boolean {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const posts = countCallSites(source, isExecuteCommandCall);
  if (posts === 0) return false;
  const settles = countCallSites(source, isSettleCommandResultCall);
  return settles < posts;
}

describe("command-result-exhaustive (D253)", () => {
  it("no dashboard module tests ONE refusal arm and lets the other fall through", () => {
    const offenders = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !EXEMPT.has(path))
      .filter((path) => decidesSettlementAlone(readFileSync(join(REPO_ROOT, path), "utf8")));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the walker SEES the pattern it forbids (negative control)", () => {
    const violating = readFileSync(join(REPO_ROOT, FIXTURE), "utf8");
    expect(decidesSettlementAlone(violating)).toBe(true);
    // And a module that names both arms in one condition is clean, so the
    // guard cannot be satisfied by a walker that answers `true` for everything.
    expect(decidesSettlementAlone(
      'if (result.state === "conflict" || result.state === "rejected") report(result.message);',
    )).toBe(false);
    // The negated early-return form is exhaustive too, and must read clean.
    expect(decidesSettlementAlone(
      'if (result.state !== "conflict" && result.state !== "rejected") return null;',
    )).toBe(false);
  });

  it("every dashboard module folds at least as many commands as it posts (D3)", () => {
    const offenders = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !EXEMPT.has(path) && !FORWARDING_LAYERS.has(path))
      .filter((path) => foldsFewerCommandsThanItPosts(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("proves admitted forwarding layers forward command execution and their callers settle them", () => {
    for (const path of FORWARDING_LAYERS) {
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      expect(decidesSettlementAlone(text), `${path} must not decide settlement alone`).toBe(false);
      expect(
        /return\s+(await\s+)?(commands|client)\.executeCommand|:\s*\(input.*?\)\s*=>\s*client\.executeCommand/u.test(text),
        `${path} must return or forward executeCommand`,
      ).toBe(true);
    }
    const runLaunchCallers = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !FORWARDING_LAYERS.has(path) && !EXEMPT.has(path))
      .filter((path) => {
        const text = readFileSync(join(REPO_ROOT, path), "utf8");
        return text.includes("createRunLaunchService") || text.includes("launchService.submit");
      });
    expect(runLaunchCallers.length).toBeGreaterThan(0);
    for (const callerPath of runLaunchCallers) {
      const text = readFileSync(join(REPO_ROOT, callerPath), "utf8");
      expect(text.includes("settleCommandResult"), `${callerPath} must consume forwarded command with settleCommandResult`).toBe(true);
    }
  });

  it("the call-site walker sees its own violations (negative control)", () => {
    // No import of the fold at all: every posted command falls straight
    // through to the success path.
    expect(foldsFewerCommandsThanItPosts(
      FIXTURE_UNFOLDED,
      readFileSync(join(REPO_ROOT, FIXTURE_UNFOLDED), "utf8"),
    )).toBe(true);
    // A REAL import of the fold, called on only ONE of two dispatches — the
    // shape the import-only check could not see.
    expect(foldsFewerCommandsThanItPosts(
      FIXTURE_PARTIAL_FOLD,
      readFileSync(join(REPO_ROOT, FIXTURE_PARTIAL_FOLD), "utf8"),
    )).toBe(true);
    // A `import type` of the fold, with the function's name only ever
    // mentioned in a comment: zero calls to `settleCommandResult(`, so the
    // one dispatch is unfolded regardless of what the import line says.
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import type { CommandSettlement } from "../app/command-result.js";\n'
      + '// settleCommandResult(result) would settle this, but nothing calls it.\n'
      + 'export function post(client: { executeCommand: (r: unknown) => Promise<CommandSettlement> }, r: unknown) {\n'
      + '  void client.executeCommand(r);\n'
      + '}\n',
    )).toBe(true);
    // A module that posts twice and folds both is clean, so the walker
    // cannot be satisfied by one that answers `true` for everything.
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(a).then((r) => { if (settleCommandResult(r).kind === "refused") stop(); });\n'
      + 'client.executeCommand(b).then((r) => { settleCommandResult(r); });',
    )).toBe(false);
    // Passing settleCommandResult directly as a .then callback settles the command.
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(a).then(settleCommandResult);\n',
    )).toBe(false);
    // Passing an un-settled callback to .then leaves the command unhandled (negative control).
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'client.executeCommand(a).then((res) => console.log(res));\n',
    )).toBe(true);
    // Passing settleCommandResult as second (rejection) argument to .then leaves the fulfillment unhandled (negative control).
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(a).then(() => toastSuccess(), settleCommandResult);\n',
    )).toBe(true);
    // And a module that posts nothing is out of this arm's scope entirely.
    expect(foldsFewerCommandsThanItPosts("fixture.ts", "export const NOTHING_IS_POSTED = 1;")).toBe(false);
  });

  it("the fold's own module is the only place the arms are enumerated for a verdict", () => {
    const fold = readFileSync(join(REPO_ROOT, "src/dashboard/app/command-result.ts"), "utf8");
    for (const arm of ["applied", "already-applied", "conflict", "rejected"]) {
      expect(fold, `settleCommandResult must handle ${arm}`).toContain(`case "${arm}"`);
    }
  });
});
