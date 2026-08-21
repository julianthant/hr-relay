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
 * Every arm runs against the real tree AND against a checked-in violating
 * fixture, so the walkers prove they can see the patterns they forbid.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./helpers/guard-files.js";

const SCAN_ROOT = "src/dashboard";
const FIXTURE = "tests/unit/architecture/fixtures/command-result-unhandled-conflict.ts";
const FIXTURE_UNFOLDED = "tests/unit/architecture/fixtures/command-result-unfolded-dispatch.ts";

/**
 * The fold itself, and the transport that parses the wire. Neither turns a
 * result into an operator-facing outcome; every other module in the bundle
 * that names an arm does.
 */
const EXEMPT = new Set([
  "src/dashboard/app/command-result.ts",
  "src/dashboard/client/commands.ts",
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
 * A module POSTS a command when it calls `executeCommand` on the client. It has
 * SETTLED that command's answer when it IMPORTS the fold's module.
 *
 * The import is what is checked, not a mention of the function's name: a
 * comment explaining why the fold matters would otherwise clear the module
 * that ignores it — which is how the negative-control fixture was written, and
 * it is the first thing this arm caught. An import that is never called is not
 * a hole either, because `eslint --max-warnings 0` refuses an unused binding.
 *
 * The pattern is textual for the same reason the arm above is: this guard
 * governs a bundle where the only thing a type check can see is that a
 * `CommandResult` was received, never what was concluded from it.
 */
const IMPORTS_FOLD = /from\s+"[^"]*\/command-result\.js"/u;

function postsWithoutFolding(text: string): boolean {
  return /\.executeCommand\s*\(/u.test(text) && !IMPORTS_FOLD.test(text);
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

  it("every dashboard module that POSTS a command settles it through the fold (D3)", () => {
    const offenders = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !EXEMPT.has(path))
      .filter((path) => postsWithoutFolding(readFileSync(join(REPO_ROOT, path), "utf8")));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the POSTS-without-folding walker sees its own violation (negative control)", () => {
    expect(postsWithoutFolding(readFileSync(join(REPO_ROOT, FIXTURE_UNFOLDED), "utf8"))).toBe(true);
    // A module that posts AND folds is clean, so the walker cannot be satisfied
    // by one that answers `true` for everything.
    expect(postsWithoutFolding(
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(request).then((r) => { if (settleCommandResult(r).kind === "refused") stop(); });',
    )).toBe(false);
    // And a module that posts nothing is out of this arm's scope entirely.
    expect(postsWithoutFolding("export const NOTHING_IS_POSTED = 1;")).toBe(false);
  });

  it("the fold's own module is the only place the arms are enumerated for a verdict", () => {
    const fold = readFileSync(join(REPO_ROOT, "src/dashboard/app/command-result.ts"), "utf8");
    for (const arm of ["applied", "already-applied", "conflict", "rejected"]) {
      expect(fold, `settleCommandResult must handle ${arm}`).toContain(`case "${arm}"`);
    }
  });
});
