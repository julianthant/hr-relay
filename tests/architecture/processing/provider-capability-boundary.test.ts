import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { defaultRuntimePaths } from "../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema, PROVIDER_CAPABILITY_CONFIG_KEYS, providerBudget } from "../../../src/models/config/schema.js";
import { ProviderCapabilityIdSchema } from "../../../src/rules/identity/ids.js";
import { PROVIDER_ADAPTER_SPECS, ProviderIdSchema } from "../../../src/models/runtime/runtime-dependencies.js";
import { createDeterministicProviderHarness } from "../../../src/backend/processing/providers/deterministic-provider.js";
import { gitVisibleFiles, REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const NETWORK_MODULE_PATTERN = /^(?:node:)?(?:http|https|http2)$|^(?:axios|got|undici|openai)$/u;

function moduleText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function isNetworkOwner(path: string): boolean {
  if (path.startsWith("src/backend/processing/providers/")) return true;
  // The local Vite probe checks the dashboard's owned development server; it
  // is a host resource, not a provider adapter.
  if (path === "src/backend/app/host/local-vite-probe.ts") return true;
  // Ref frontend-backend-integration §2: `src/dashboard/client/**` is the ONE fetch/EventSource owner —
  // the same single-owner principle this guard enforces for providers, applied
  // to the frontend transport. No other dashboard module may touch fetch.
  if (path.startsWith("src/dashboard/client/")) return true;
  // Ref frontend-backend-integration §0: the in-process BFF binds loopback node:http; exactly one host
  // module owns that listener.
  return path === "src/backend/transports/http/http-server.ts";
}

function isProviderConsumer(path: string): boolean {
  return path.startsWith("src/stores/")
    || path.startsWith("src/workflows/")
    || (path.startsWith("src/backend/processing/") && !path.startsWith("src/backend/processing/providers/"))
    || path.startsWith("src/backend/systems/")
    || path.startsWith("src/workflows/");
}

/**
 * D162 (ref data-intake-and-edit-data §4.11): the admission kernel's ONE production consumer is the
 * run executor — it mints admitted clients per task invocation — and the
 * worker composition root supplies the kernel's ingredients. These allowlists
 * are the deliberate relaxation of the "consumers remain absent until Phase
 * 2h" arms; everything else (stores, workflows, services, dashboard) still
 * may not import the admission module, call the mint, or type a client.
 */
const PROVIDER_CLIENT_TYPE_OWNERS: ReadonlySet<string> = new Set([
  "src/workflow-kit/providers.ts",
  "src/backend/runs/start/provider-admission.ts",
  "src/backend/runtime/execution/run-executor.ts",
]);
const ADMITTED_CLIENT_MINT_CALLERS: ReadonlySet<string> = new Set([
  "src/backend/runs/start/provider-admission.ts",
  "src/backend/runtime/execution/run-executor.ts",
]);
// D184: the admission module itself was listed here and could never suppress
// an issue — `resolveLocal` resolves an IMPORT, and no module imports itself —
// so it was an allowlist entry that looked like a relaxation and was not one.
// An allowlist that carries dead names cannot be read as the reviewed set of
// exceptions, which is the only thing an allowlist is for.
const ADMISSION_MODULE_IMPORTERS: ReadonlySet<string> = new Set([
  "src/backend/runtime/execution/run-executor.ts",
  "src/backend/app/composition/worker-compose.ts",
]);

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
        issues.push(`${path}: raw network/provider module is confined to declared network owners`);
      }
      if (!isNetworkOwner(path) && ts.isCallExpression(node)
        && ((node.expression.kind === ts.SyntaxKind.ImportKeyword
            || ts.isIdentifier(node.expression) && node.expression.text === "require")
          && NETWORK_MODULE_PATTERN.test(moduleText(node.arguments[0]) ?? ""))) {
        issues.push(`${path}: dynamic raw network/provider module is confined to declared network owners`);
      }
      if (!isNetworkOwner(path) && ts.isIdentifier(node) && node.text === "fetch") {
        issues.push(`${path}: raw fetch is confined to declared network owners`);
      }
      if (((ts.isTypeReferenceNode(node) && node.typeName.getText(source) === "ProviderAdapter")
          || (ts.isExpressionWithTypeArguments(node) && node.expression.getText(source) === "ProviderAdapter"))
        && path !== "src/workflow-kit/providers.ts"
        && path !== "src/backend/runs/start/provider-admission.ts"
        && !path.startsWith("src/backend/processing/providers/")) {
        issues.push(`${path}: ProviderAdapter implementations are confined to backend/processing/providers`);
      }
      if (ts.isTypeReferenceNode(node) && node.typeName.getText(source) === "ProviderClient"
        && !PROVIDER_CLIENT_TYPE_OWNERS.has(path)) {
        issues.push(`${path}: only the admission kernel and the run executor's D162 wiring type ProviderClient`);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === "createAdmittedProviderClient"
        && !ADMITTED_CLIENT_MINT_CALLERS.has(path)) {
        issues.push(`${path}: admitted provider clients are minted only by the kernel and the run executor (D162)`);
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
      if (resolveLocal(path, specifier) === "src/backend/runs/start/provider-admission.ts"
        && !ADMISSION_MODULE_IMPORTERS.has(path)) {
        issues.push(`${path}: admission client imports are confined to the run executor and the worker composition root (D162)`);
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
      if (dependency.startsWith("src/backend/processing/providers/")) {
        issues.push(`${path}: task import graph reaches processing provider adapter ${dependency}`);
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
    assert.ok(gitVisibleFiles(["src/workflow-kit/providers.ts", "src/backend/processing/providers"]).length >= 2);
    const fixture = readFileSync(resolve(REPO_ROOT, "tests/types/task-contracts.typecheck.ts"), "utf8");
    assert.match(fixture, /provider clients are narrowed to the declared capability/u);
    assert.match(fixture, /ctx\.providers\["ocr\.extract"\]/u);
    assert.deepEqual(Object.keys(PROVIDER_CAPABILITY_CONFIG_KEYS).sort(), ProviderCapabilityIdSchema.options.filter(capability => capability !== "ocr.extract").sort());
    assert.equal(new Set(Object.values(PROVIDER_CAPABILITY_CONFIG_KEYS)).size, ProviderCapabilityIdSchema.options.length - 1);
    const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
    for (const capability of ProviderCapabilityIdSchema.options) {
      if (capability !== "ocr.extract") assert.doesNotThrow(() => providerBudget(config, capability));
      assert.equal(createDeterministicProviderHarness(capability, [{
        kind: "throw",
        estimate: { maximumCostUsdMicros: 0 },
        message: "deterministic capability fixture",
      }]).adapter.capability, capability);
    }
    assert.deepEqual(
      gitVisibleFiles(["src/backend/processing/providers"]).map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/")),
      [
        "src/backend/processing/providers/deterministic-provider.ts",
        "src/backend/processing/providers/geocode-adapters.ts",
      ].sort(),
      "the deterministic harness and Census/Nominatim adapters are the complete provider modules",
    );
    assert.deepEqual(
      gitVisibleFiles(["src/backend/app/host/local-vite-probe.ts"])
        .map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/")),
      ["src/backend/app/host/local-vite-probe.ts"],
      "the dashboard loopback HTTP probe belongs to the app host",
    );
  });

  it("keeps every allowlisted name and every declared provider resolvable (D184)", () => {
    // An allowlist entry that names nothing is indistinguishable from a
    // relaxation nobody reviewed, so every name resolves or the guard fails.
    const visible = new Set(
      gitVisibleFiles(["src"]).map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/")),
    );
    for (const [name, allowlist] of Object.entries({
      PROVIDER_CLIENT_TYPE_OWNERS,
      ADMITTED_CLIENT_MINT_CALLERS,
      ADMISSION_MODULE_IMPORTERS,
    })) {
      for (const path of allowlist) {
        assert.ok(visible.has(path), `${name} names ${path}, which is not a git-visible module`);
      }
    }

    // The D68 runtime-dependency inventory declares which PROVIDERS serve
    // which capability — endpoints, secret families, model env names. It is
    // not the same question as "does an adapter module exist", and the two
    // drifted apart silently: four declared providers have no adapter at all.
    // Reconciling them both ways makes adding a fifth a deliberate act.
    const BUILT_PROVIDER_ADAPTERS: Readonly<Record<string, readonly string[]>> = {
      census: ["src/backend/processing/providers/geocode-adapters.ts"],
      nominatim: ["src/backend/processing/providers/geocode-adapters.ts"],
    };
    const DECLARED_WITHOUT_ADAPTER: Readonly<Record<string, string>> = {};
    for (const provider of ProviderIdSchema.options) {
      const built = BUILT_PROVIDER_ADAPTERS[provider];
      const declaredOnly = DECLARED_WITHOUT_ADAPTER[provider];
      assert.equal(
        (built === undefined) !== (declaredOnly === undefined),
        true,
        `provider ${provider} must have exactly one of a built adapter module list or a reviewed declared-without-adapter reason`,
      );
      for (const path of built ?? []) {
        assert.ok(visible.has(path), `provider ${provider} names adapter module ${path}, which does not exist`);
      }
      assert.ok((declaredOnly ?? "x").trim().length > 0, `provider ${provider}: the declared-without-adapter reason must be non-empty`);
    }
    for (const provider of [...Object.keys(BUILT_PROVIDER_ADAPTERS), ...Object.keys(DECLARED_WITHOUT_ADAPTER)]) {
      assert.ok(
        (ProviderIdSchema.options as readonly string[]).includes(provider),
        `${provider} is reviewed here but is not a declared ProviderId — delete the entry`,
      );
      assert.ok(
        PROVIDER_ADAPTER_SPECS.some((spec) => spec.provider === provider),
        `${provider} is reviewed here but has no PROVIDER_ADAPTER_SPECS entry`,
      );
    }
  });

  it("catches direct network use and adapter forgery outside network owners", () => {
    const root = resolve(tmpdir(), `hrauto-provider-boundary-${process.pid}-${Date.now()}`);
    const path = resolve(root, "src/backend/processing/ocr/tasks/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import "node:https";\nimport type { ProviderAdapter } from "../../../../base/providers.js";\nconst forged = {} satisfies ProviderAdapter<"ocr.extract">;\nexport async function bad() { return fetch("https://example.invalid"); }\nvoid forged;\n',
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
    const taskPath = resolve(root, "src/backend/processing/ocr/tasks/bad.ts");
    const helperPath = resolve(root, "src/services/provider-helper.ts");
    const adapterPath = resolve(root, "src/backend/processing/providers/bad-adapter.ts");
    try {
      mkdirSync(dirname(taskPath), { recursive: true });
      mkdirSync(dirname(helperPath), { recursive: true });
      mkdirSync(dirname(adapterPath), { recursive: true });
      writeFileSync(taskPath, 'import { hidden } from "../../../../services/provider-helper.js";\nvoid hidden;\n');
      writeFileSync(helperPath, 'import { adapter } from "../backend/processing/providers/bad-adapter.js";\nimport type { ProviderClient } from "../base/providers.js";\nexport const hidden: ProviderClient<"ocr.extract"> = adapter;\n');
      writeFileSync(adapterPath, 'export const adapter = { capability: "ocr.extract" };\n');
      const issues = auditProviderCapabilityBoundary(root).join("\n");
      assert.match(issues, /task import graph reaches processing provider adapter/);
      assert.match(issues, /only the admission kernel and the run executor's D162 wiring type ProviderClient/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps workflow-task import graphs out of provider adapters", () => {
    const root = resolve(tmpdir(), `hrauto-workflow-provider-transitive-${process.pid}-${Date.now()}`);
    const taskPath = resolve(root, "src/workflows/person-lookup/tasks/bad.ts");
    const helperPath = resolve(root, "src/services/provider-helper.ts");
    const adapterPath = resolve(root, "src/backend/processing/providers/bad-adapter.ts");
    try {
      mkdirSync(dirname(taskPath), { recursive: true });
      mkdirSync(dirname(helperPath), { recursive: true });
      mkdirSync(dirname(adapterPath), { recursive: true });
      writeFileSync(taskPath, 'import { hidden } from "../../../services/provider-helper.js";\nvoid hidden;\n');
      writeFileSync(helperPath, 'import { adapter } from "../backend/processing/providers/bad-adapter.js";\nexport const hidden = adapter;\n');
      writeFileSync(adapterPath, 'export const adapter = { capability: "ocr.extract" };\n');
      assert.match(
        auditProviderCapabilityBoundary(root).join("\n"),
        /task import graph reaches processing provider adapter/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  it("catches an aliased admission-client import hidden behind a helper", () => {
    const root = resolve(tmpdir(), `hrauto-provider-client-alias-${process.pid}-${Date.now()}`);
    const helperPath = resolve(root, "src/services/provider-helper.ts");
    const kernelPath = resolve(root, "src/backend/runs/start/provider-admission.ts");
    try {
      mkdirSync(dirname(helperPath), { recursive: true });
      mkdirSync(dirname(kernelPath), { recursive: true });
      writeFileSync(kernelPath, "export function createAdmittedProviderClient() { return {}; }\n");
      writeFileSync(
        helperPath,
        'import { createAdmittedProviderClient as hiddenFactory } from "../backend/runs/start/provider-admission.js";\nexport const hidden = hiddenFactory;\n',
      );
      assert.match(
        auditProviderCapabilityBoundary(root).join("\n"),
        /admission client imports are confined to the run executor and the worker composition root/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
