import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT, repoRelative } from "./helpers/guard-files.js";

const MUTATORS = new Set([
  "enqueue", "claimNext", "claimEligible", "renewClaim", "transition", "resume", "requeue",
  "sweepExpiredClaims", "requestCancellation", "advanceRevision", "bumpPriority", "updatePresentation",
  "injectCheckpointPatches", "delete", "terminalizeFailure", "terminalizeSuccess",
]);

function ancestor(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (predicate(current)) return true;
  }
  return false;
}

function repositoryMutator(declaration: ts.Declaration | undefined): boolean {
  if (declaration === undefined || repoRelative(declaration.getSourceFile().fileName) !== "src/infra/sqlite/authority-database.ts") return false;
  if (!(ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration))) return false;
  const name = declaration.name.getText();
  return MUTATORS.has(name) && ancestor(declaration, (node) =>
    (ts.isTypeAliasDeclaration(node) && node.name.text === "RunRepository")
    || (ts.isClassDeclaration(node) && node.name?.text === "AuthorityDatabase"
      && ["terminalizeFailure", "terminalizeSuccess"].includes(name)));
}

function audit(extraSource?: string): readonly string[] {
  // Scan every core helper: moving a forbidden call into another core module cannot hide it.
  const roots = gitVisibleFiles(["src/core", "src/server/worker"])
    .filter((file) => file.endsWith(".ts") && !["src/core/command-kernel.ts", "src/core/run-fan-out.ts"].includes(file));
  roots.push("src/server/dashboard/compose.ts");
  const fixture = resolve(REPO_ROOT, "src/core/worker-mutator-proof.ts");
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  host.readFile = (file) => file === fixture && extraSource !== undefined ? extraSource : originalRead(file);
  const program = ts.createProgram([...roots.map((file) => resolve(REPO_ROOT, file)),
    ...(extraSource === undefined ? [] : [fixture])], options, host);
  const checker = program.getTypeChecker();
  const violations: string[] = [];
  let visited = 0;
  for (const file of [...roots, ...(extraSource === undefined ? [] : [repoRelative(fixture)])]) {
    const source = program.getSourceFile(resolve(REPO_ROOT, file));
    assert.ok(source, `guard source missing: ${file}`);
    const visit = (node: ts.Node): void => {
      // The canonical service owns its repository mutations, but its exported port/sweep helpers do not.
      if (file === "src/core/run-record-service.ts" && ts.isClassDeclaration(node)
        && node.name?.text === "RunRecordService") return;
      // Task 4 retains the two negative-resolution paths; positive recovery/present remain scanned.
      if (file === "src/core/write-recovery.ts"
        && ((ts.isMethodDeclaration(node) && node.name.getText() === "resolveAbsent")
          || (ts.isIfStatement(node) && node.expression.getText() === 'evaluation.state === "safe-to-retry"'))) return;
      if (file === "src/server/dashboard/compose.ts") {
        if (!ancestor(node, (parent) => ts.isCallExpression(parent)
          && parent.expression.getText() === "createWriteResolutionExecutor")) {
          ts.forEachChild(node, visit);
          return;
        }
      }
      visited++;
      const declarations = ts.isPropertyAccessExpression(node)
        ? checker.getSymbolAtLocation(node.name)?.declarations : undefined;
      const signature = ts.isCallExpression(node) ? checker.getResolvedSignature(node)?.declaration : undefined;
      if (repositoryMutator(signature) || declarations?.some(repositoryMutator)) {
        violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText().slice(0, 100)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(visited > 0 && roots.includes("src/core/write-sequencer.ts") && roots.includes("src/core/write-recovery.ts"));
  return violations;
}

describe("worker-loop-writes-only-through-the-service", () => {
  it("rejects direct lifecycle access throughout the worker and shared continuation seam", () => {
    assert.deepEqual(audit(), []);
  });

  it("detects a relocated helper and aliased repository mutators", () => {
    const violations = audit(`
      import type { AuthorityRepositories, AuthorityDatabase } from "../unit/infra/sqlite/authority-database.js";
      export function relocated(repositories: AuthorityRepositories, database: AuthorityDatabase) {
        repositories.runs.transition({});
        const resume = repositories.runs.resume;
        resume({});
        database.terminalizeSuccess({});
      }
    `);
    assert.ok(violations.some((entry) => entry.includes("repositories.runs.transition")));
    assert.ok(violations.some((entry) => entry.includes("resume({})")));
    assert.ok(violations.some((entry) => entry.includes("database.terminalizeSuccess")));
  });

  it("keeps the worker capability closed to its five admitted operations", () => {
    const source = readFileSync(resolve(REPO_ROOT, "src/core/run-record-service.ts"), "utf8");
    const port = source.slice(source.indexOf("export type WorkerRunLifecyclePort"), source.indexOf("export interface RunContinuationPort"));
    assert.deepEqual([...port.matchAll(/"([a-zA-Z]+)"/gu)].map((match) => match[1]).sort(),
      ["claimNext", "renewClaim", "workerTransition", "terminalize", "requeue"].sort());
  });
});
