import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { gitVisibleFiles, REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

const NETWORK_MODULE_PATTERN = /^(?:node:)?(?:http|https|http2)$|^(?:axios|got|undici|openai)$/u;

function moduleText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function isProviderOwner(path: string): boolean {
  return path === "src/base/providers.ts" || path.startsWith("src/infra/providers/");
}

function isProviderConsumer(path: string): boolean {
  return /^src\/stores\/.+\/tasks\/.+\.ts$/u.test(path) || /^src\/workflows\/.+\.ts$/u.test(path);
}

export function auditProviderCapabilityBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  for (const absolute of walkFiles(resolve(root, "src"), { missing: "planned-empty" })) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (isProviderOwner(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(absolute, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node: ts.Node): void {
      if (isProviderConsumer(path) && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && NETWORK_MODULE_PATTERN.test(moduleText(node.moduleSpecifier) ?? "")) {
        issues.push(`${path}: raw network/provider module is confined to infra/providers`);
      }
      if (isProviderConsumer(path) && ts.isCallExpression(node)
        && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        issues.push(`${path}: raw fetch is confined to infra/providers`);
      }
      if ((ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node))
        && node.getText(source).includes("ProviderAdapter")) {
        issues.push(`${path}: ProviderAdapter implementations are confined to infra/providers`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...new Set(issues)];
}

describe("provider capability boundary", () => {
  it("keeps raw provider I/O behind bounded adapters and pins compile-time client narrowing", () => {
    assert.deepEqual(auditProviderCapabilityBoundary(REPO_ROOT), []);
    assert.ok(gitVisibleFiles(["src/base/providers.ts", "src/infra/providers"]).length >= 2);
    const fixture = readFileSync(resolve(REPO_ROOT, "tests/types/task-contracts.typecheck.ts"), "utf8");
    assert.match(fixture, /provider clients are narrowed to the declared capability/u);
    assert.match(fixture, /ctx\.providers\["ocr\.extract"\]/u);
  });

  it("catches direct network use and adapter forgery outside infra providers", () => {
    const root = resolve(tmpdir(), `hrauto-provider-boundary-${process.pid}-${Date.now()}`);
    const path = resolve(root, "src/stores/ocr/tasks/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import "node:https";\nimport type { ProviderAdapter } from "../../../base/providers.js";\nconst forged = {} satisfies ProviderAdapter<"ocr.extract">;\nexport async function bad() { return fetch("https://example.invalid"); }\nvoid forged;\n',
      );
      const issues = auditProviderCapabilityBoundary(root).join("\n");
      assert.match(issues, /raw network\/provider module/);
      assert.match(issues, /raw fetch/);
      assert.match(issues, /ProviderAdapter implementations/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
