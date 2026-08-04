import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import { ConfigSchema, PROVIDER_CAPABILITY_CONFIG_KEYS, providerBudget } from "../../../src/domain/config/schema.js";
import { ProviderCapabilityIdSchema } from "../../../src/domain/ids.js";
import { createDeterministicProviderHarness } from "../../../src/infra/providers/deterministic-provider.js";
import { gitVisibleFiles, REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

const NETWORK_MODULE_PATTERN = /^(?:node:)?(?:http|https|http2)$|^(?:axios|got|undici|openai)$/u;

function moduleText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function isNetworkOwner(path: string): boolean {
  if (path.startsWith("src/infra/providers/")) return true;
  // Doc 13 §2: `src/dashboard/client/**` is the ONE fetch/EventSource owner —
  // the same single-owner principle this guard enforces for providers, applied
  // to the frontend transport. No other dashboard module may touch fetch.
  if (path.startsWith("src/dashboard/client/")) return true;
  // Doc 13 §0: the in-process BFF binds loopback node:http; exactly one host
  // module owns that listener.
  return path === "src/server/dashboard/http-server.ts";
}

function isProviderConsumer(path: string): boolean {
  return path.startsWith("src/stores/") || path.startsWith("src/workflows/");
}

export function auditProviderCapabilityBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  const files = walkFiles(resolve(root, "src"), { missing: "planned-empty" });
  const imports = new Map<string, readonly string[]>();
  for (const absolute of files) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const source = ts.createSourceFile(
      path,
      readFileSync(absolute, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const localImports: string[] = [];
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) {
        const module = moduleText(node.moduleSpecifier);
        if (module !== undefined) localImports.push(module);
      }
      if (!isNetworkOwner(path) && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && NETWORK_MODULE_PATTERN.test(moduleText(node.moduleSpecifier) ?? "")) {
        issues.push(`${path}: raw network/provider module is confined to infra/providers`);
      }
      if (!isNetworkOwner(path) && ts.isCallExpression(node)
        && ((node.expression.kind === ts.SyntaxKind.ImportKeyword
            || ts.isIdentifier(node.expression) && node.expression.text === "require")
          && NETWORK_MODULE_PATTERN.test(moduleText(node.arguments[0]) ?? ""))) {
        issues.push(`${path}: dynamic raw network/provider module is confined to infra/providers`);
      }
      if (!isNetworkOwner(path) && ts.isIdentifier(node) && node.text === "fetch") {
        issues.push(`${path}: raw fetch is confined to infra/providers`);
      }
      if (((ts.isTypeReferenceNode(node) && node.typeName.getText(source) === "ProviderAdapter")
          || (ts.isExpressionWithTypeArguments(node) && node.expression.getText(source) === "ProviderAdapter"))
        && path !== "src/base/providers.ts"
        && path !== "src/core/provider-admission.ts"
        && !path.startsWith("src/infra/providers/")) {
        issues.push(`${path}: ProviderAdapter implementations are confined to infra/providers`);
      }
      if (ts.isTypeReferenceNode(node) && node.typeName.getText(source) === "ProviderClient"
        && path !== "src/base/providers.ts" && path !== "src/core/provider-admission.ts") {
        issues.push(`${path}: only the admission kernel constructs ProviderClient`);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === "createAdmittedProviderClient"
        && path !== "src/core/provider-admission.ts") {
        issues.push(`${path}: production provider consumers remain absent until Phase 2h`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    imports.set(path, localImports);
  }

  function resolveLocal(fromPath: string, specifier: string): string | undefined {
    if (!specifier.startsWith(".")) return undefined;
    const raw = resolve(root, dirname(fromPath), specifier.replace(/\.js$/u, ""));
    for (const candidate of [`${raw}.ts`, `${raw}.tsx`, resolve(raw, "index.ts")]) {
      if (existsSync(candidate)) return relative(root, candidate).replaceAll("\\", "/");
    }
    return undefined;
  }
  for (const [path, specifiers] of imports) {
    for (const specifier of specifiers) {
      if (resolveLocal(path, specifier) === "src/core/provider-admission.ts"
        && path !== "src/core/provider-admission.ts") {
        issues.push(`${path}: production provider consumers remain absent until Phase 2h; admission client imports are forbidden`);
      }
    }
  }
  for (const path of [...imports.keys()].filter(isProviderConsumer)) {
    const visited = new Set<string>();
    const stack = (imports.get(path) ?? []).flatMap((specifier) => {
      const target = resolveLocal(path, specifier);
      return target === undefined ? [] : [target];
    });
    while (stack.length > 0) {
      const dependency = stack.pop();
      if (dependency === undefined || visited.has(dependency)) continue;
      visited.add(dependency);
      if (dependency.startsWith("src/infra/providers/")) {
        issues.push(`${path}: task import graph reaches infra provider adapter ${dependency}`);
        continue;
      }
      for (const specifier of imports.get(dependency) ?? []) {
        const target = resolveLocal(dependency, specifier);
        if (target !== undefined) stack.push(target);
      }
    }
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
    assert.deepEqual(Object.keys(PROVIDER_CAPABILITY_CONFIG_KEYS).sort(), [...ProviderCapabilityIdSchema.options].sort());
    assert.equal(new Set(Object.values(PROVIDER_CAPABILITY_CONFIG_KEYS)).size, ProviderCapabilityIdSchema.options.length);
    const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
    for (const capability of ProviderCapabilityIdSchema.options) {
      assert.doesNotThrow(() => providerBudget(config, capability));
      assert.equal(createDeterministicProviderHarness(capability, [{
        kind: "throw",
        estimate: { maximumCostUsdMicros: 0 },
        message: "deterministic capability fixture",
      }]).adapter.capability, capability);
    }
    assert.deepEqual(
      gitVisibleFiles(["src/infra/providers"]).map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/")),
      ["src/infra/providers/deterministic-provider.ts"],
      "Phase 1f has only the deterministic adapter/observation harness; production modules remain Phase 2h",
    );
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

  it("catches transitive adapter reachability and client construction hidden behind helpers", () => {
    const root = resolve(tmpdir(), `hrauto-provider-transitive-${process.pid}-${Date.now()}`);
    const taskPath = resolve(root, "src/stores/ocr/tasks/bad.ts");
    const helperPath = resolve(root, "src/services/provider-helper.ts");
    const adapterPath = resolve(root, "src/infra/providers/bad-adapter.ts");
    try {
      mkdirSync(dirname(taskPath), { recursive: true });
      mkdirSync(dirname(helperPath), { recursive: true });
      mkdirSync(dirname(adapterPath), { recursive: true });
      writeFileSync(taskPath, 'import { hidden } from "../../../services/provider-helper.js";\nvoid hidden;\n');
      writeFileSync(helperPath, 'import { adapter } from "../infra/providers/bad-adapter.js";\nimport type { ProviderClient } from "../base/providers.js";\nexport const hidden: ProviderClient<"ocr.extract"> = adapter;\n');
      writeFileSync(adapterPath, 'export const adapter = { capability: "ocr.extract" };\n');
      const issues = auditProviderCapabilityBoundary(root).join("\n");
      assert.match(issues, /task import graph reaches infra provider adapter/);
      assert.match(issues, /only the admission kernel constructs ProviderClient/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches an aliased admission-client import hidden behind a helper", () => {
    const root = resolve(tmpdir(), `hrauto-provider-client-alias-${process.pid}-${Date.now()}`);
    const helperPath = resolve(root, "src/services/provider-helper.ts");
    const kernelPath = resolve(root, "src/core/provider-admission.ts");
    try {
      mkdirSync(dirname(helperPath), { recursive: true });
      mkdirSync(dirname(kernelPath), { recursive: true });
      writeFileSync(kernelPath, "export function createAdmittedProviderClient() { return {}; }\n");
      writeFileSync(
        helperPath,
        'import { createAdmittedProviderClient as hiddenFactory } from "../core/provider-admission.js";\nexport const hidden = hiddenFactory;\n',
      );
      assert.match(
        auditProviderCapabilityBoundary(root).join("\n"),
        /admission client imports are forbidden/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
