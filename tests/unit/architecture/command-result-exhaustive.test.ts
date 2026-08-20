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
 * Both arms run: the rule is asserted over the real tree, and a violating
 * fixture proves the walker can actually see the pattern it forbids.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./helpers/guard-files.js";

const SCAN_ROOT = "src/dashboard";
const FIXTURE = "tests/unit/architecture/fixtures/command-result-unhandled-conflict.ts";

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

  it("the fold's own module is the only place the arms are enumerated for a verdict", () => {
    const fold = readFileSync(join(REPO_ROOT, "src/dashboard/app/command-result.ts"), "utf8");
    for (const arm of ["applied", "already-applied", "conflict", "rejected"]) {
      expect(fold, `settleCommandResult must handle ${arm}`).toContain(`case "${arm}"`);
    }
  });
});
