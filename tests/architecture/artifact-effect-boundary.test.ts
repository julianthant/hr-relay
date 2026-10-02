import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { ArtifactRefSchema } from "../../src/domain/artifacts.js";
import { gitVisibleFiles, REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

const MUTABLE_FILE_MODULES = new Set(["node:fs", "node:fs/promises", "fs", "fs/promises"]);
const MUTABLE_FILE_CALLS = new Set([
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "rename",
  "renameSync",
  "writeFile",
  "writeFileSync",
]);

function moduleText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function isTaskImplementation(path: string): boolean {
  return /^src\/stores\/.+\/tasks\/.+\.ts$/u.test(path)
    || /^src\/backend\/workflow-tasks\/.+\/tasks\/.+\.ts$/u.test(path)
    || /^src\/backend\/processing\/.+\/tasks\/.+\.ts$/u.test(path)
    || /^src\/workflows\/.+\.ts$/u.test(path);
}

export function auditArtifactEffectBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  for (const absolute of walkFiles(resolve(root, "src"), { missing: "planned-empty" })) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (!isTaskImplementation(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(absolute, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) && MUTABLE_FILE_MODULES.has(moduleText(node.moduleSpecifier) ?? "")) {
        issues.push(`${path}: task implementation imports mutable filesystem access`);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && MUTABLE_FILE_CALLS.has(node.expression.name.text)) {
        issues.push(`${path}: task implementation calls mutable filesystem primitive ${node.expression.name.text}`);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && MUTABLE_FILE_CALLS.has(node.expression.text)) {
        issues.push(`${path}: task implementation calls mutable filesystem primitive ${node.expression.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...new Set(issues)];
}

describe("content-addressed artifact boundary", () => {
  it("keeps task implementations away from mutable filesystem primitives", () => {
    assert.deepEqual(auditArtifactEffectBoundary(REPO_ROOT), []);
    assert.ok(gitVisibleFiles(["src/base/artifacts.ts", "src/infra/artifacts"]).length >= 2);
    const refKeys = Object.keys(ArtifactRefSchema.shape).sort();
    assert.deepEqual(refKeys, ["bytes", "id", "mediaType", "sha256"]);
    assert.equal(refKeys.some((key) => /path|root|fileName/iu.test(key)), false);
    const writer = readFileSync(
      resolve(REPO_ROOT, "src/backend/storage/artifacts/content-addressed-artifact-writer.ts"),
      "utf8",
    );
    let cursor = -1;
    const durabilitySequence = [
      "handle.writeFile",
      "handle.sync",
      "link(tempPath, finalPath)",
      "unlink(tempPath)",
      "syncDirectory(root)",
    ].map((token) => {
      cursor = writer.indexOf(token, cursor + 1);
      return cursor;
    });
    assert.equal(durabilitySequence.every((index) => index >= 0), true);
    assert.deepEqual([...durabilitySequence].sort((left, right) => left - right), durabilitySequence);
  });

  it("catches direct mutable filesystem writes in a task implementation", () => {
    const root = resolve(tmpdir(), `hrauto-artifact-boundary-${process.pid}-${Date.now()}`);
    const path = resolve(root, "src/backend/processing/extraction/tasks/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import { writeFile } from "node:fs/promises";\nexport async function bad() { await writeFile("output.xlsx", "unsafe"); }\n',
      );
      assert.match(auditArtifactEffectBoundary(root).join("\n"), /mutable filesystem/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches direct mutable filesystem writes in a workflow-task implementation", () => {
    const root = resolve(tmpdir(), `hrauto-workflow-task-artifact-boundary-${process.pid}-${Date.now()}`);
    const path = resolve(root, "src/backend/workflow-tasks/person-lookup/tasks/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import { writeFile } from "node:fs/promises";\nexport async function bad() { await writeFile("output.xlsx", "unsafe"); }\n',
      );
      assert.match(auditArtifactEffectBoundary(root).join("\n"), /mutable filesystem/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
