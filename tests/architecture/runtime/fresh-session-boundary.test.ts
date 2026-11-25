// Session replacement is authored or identity-forced and requires proven closure before opening.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

/** The closed set of modules allowed to name the boundary close reason. */
const BOUNDARY_REASON_OWNERS = new Set([
  "src/workflow-kit/session.ts",
  "src/backend/runtime/workers/worker-sessions.ts",
  "src/backend/runtime/workers/worker-loop.ts",
]);

function sourceFiles(): readonly { path: string; content: string }[] {
  return walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
    .map((file) => ({
      path: relative(REPO_ROOT, file).replaceAll("\\", "/"),
      content: readFileSync(file, "utf8"),
    }));
}


function computedSessionFields(): readonly string[] {
  const violations: string[] = [];
  for (const { path, content } of sourceFiles()) {
    if (!/^src\/(?:stores\/[a-z0-9-]+\/tasks|backend\/workflow-tasks\/[a-z0-9-]+\/tasks|workflows)\//u.test(path)) continue;
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)
        && ts.isIdentifier(node.name)
        && node.name.text === "session"
        && !ts.isStringLiteralLike(node.initializer)) {
        violations.push(`${path}: session need is computed, not authored`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

describe("fresh session boundary", () => {
  it("keeps the boundary close reason inside the session-ownership modules", () => {
    const violations = sourceFiles()
      .filter(({ path, content }) =>
        content.includes("\"fresh-boundary\"") && !BOUNDARY_REASON_OWNERS.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "a boundary was minted outside worker session ownership");
    const manager = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-sessions.ts"), "utf8");
    assert.match(
      manager,
      /need\.session === "fresh"/u,
      "the authored-fresh branch must exist for the scans above to mean anything",
    );
    const resetCallers = sourceFiles()
      .filter(({ content }) => content.includes("\"profile-reset\""))
      .map(({ path }) => path)
      .sort();
    assert.deepEqual(resetCallers, [
      "src/backend/runtime/browser/native-browser.ts",
      "src/workflow-kit/session.ts",
    ]);
    const loop = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-loop.ts"), "utf8");
    assert.doesNotMatch(loop, /profile-reset/u);
    assert.match(loop, /event\.reason === "fresh-boundary"/u);
  });

  it("authors every session need as a literal, never a computed one", () => {
    assert.deepEqual(computedSessionFields(), []);
    // Negative control: the same audit on a synthetic computed need must fail.
    const synthetic = ts.createSourceFile(
      "src/backend/systems/ucpath/tasks/bad.ts",
      "export const t = { sessions: [{ system: \"ucpath\", session: attempt > 1 ? \"fresh\" : \"reuse-worker\" }] };",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let caught = false;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)
        && node.name.text === "session" && !ts.isStringLiteralLike(node.initializer)) caught = true;
      ts.forEachChild(node, visit);
    };
    visit(synthetic);
    assert.equal(caught, true, "the computed-session audit must catch a computed need");
  });
});
