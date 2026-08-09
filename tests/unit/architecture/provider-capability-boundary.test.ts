import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import { ConfigSchema, PROVIDER_CAPABILITY_CONFIG_KEYS, providerBudget } from "../../../src/domain/config/schema.js";
import { ProviderCapabilityIdSchema } from "../../../src/domain/ids.js";
import { PROVIDER_ADAPTER_SPECS, ProviderIdSchema } from "../../../src/domain/runtime-dependencies.js";
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
  // 2i-F/D175: the phone bundle is a SECOND browser bundle, and it may not
  // import the operator client (dashboard-wire-boundary §14 proves it does
  // not), so it needs a transport owner of its own. The principle is unchanged
  // — one owner per bundle — so this is ONE named file rather than the whole
  // `src/dashboard/phone/**` subtree: a component that reached for fetch
  // directly would still fail, which is the point.
  if (path === "src/dashboard/phone/capture-client.ts") return true;
  // Doc 13 §0: the in-process BFF binds loopback node:http; exactly one host
  // module owns that listener.
  return path === "src/server/dashboard/http-server.ts";
}

function isProviderConsumer(path: string): boolean {
  return path.startsWith("src/stores/") || path.startsWith("src/workflows/");
}

/**
 * D162 (doc 06 §4.11): the admission kernel's ONE production consumer is the
 * run executor — it mints admitted clients per task invocation — and the
 * worker composition root supplies the kernel's ingredients. These allowlists
 * are the deliberate relaxation of the "consumers remain absent until Phase
 * 2h" arms; everything else (stores, workflows, services, dashboard) still
 * may not import the admission module, call the mint, or type a client.
 */
const PROVIDER_CLIENT_TYPE_OWNERS: ReadonlySet<string> = new Set([
  "src/base/providers.ts",
  "src/core/provider-admission.ts",
  "src/core/run-executor.ts",
  // D178. Doc 12 §4.4's advisory is the first provider consumer OUTSIDE a run
  // task: a task receives its clients through `ctx.providers` and never names
  // the type, but an on-demand operator advisory has no task context to
  // inherit. It still obtains its client from the kernel
  // (`createAdvisoryProviderClient`) — this entry lets it declare what it was
  // handed, not mint one.
  "src/services/trust/advisory.ts",
]);
const ADMITTED_CLIENT_MINT_CALLERS: ReadonlySet<string> = new Set([
  "src/core/provider-admission.ts",
  "src/core/run-executor.ts",
]);
// D184: the admission module itself was listed here and could never suppress
// an issue — `resolveLocal` resolves an IMPORT, and no module imports itself —
// so it was an allowlist entry that looked like a relaxation and was not one.
// An allowlist that carries dead names cannot be read as the reviewed set of
// exceptions, which is the only thing an allowlist is for.
const ADMISSION_MODULE_IMPORTERS: ReadonlySet<string> = new Set([
  "src/core/run-executor.ts",
  "src/server/worker/compose.ts",
  // D178. The dashboard process became a second admitted-provider consumer
  // when doc 12 §4.4's on-demand advisory landed: it composes the pool and
  // mints the client through the kernel's `createAdvisoryProviderClient`,
  // exactly as the worker root does for a run. A composition root is the ONE
  // place this may happen — the query it hands the closure to names no
  // provider type at all.
  "src/server/dashboard/compose.ts",
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
      if (resolveLocal(path, specifier) === "src/core/provider-admission.ts"
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
      [
        "src/infra/providers/deterministic-provider.ts",
        "src/infra/providers/gemini-advisory.ts",
        "src/infra/providers/gemini-ocr-extract.ts",
        "src/infra/providers/gemini-transport.ts",
        "src/infra/providers/geocode-adapters.ts",
        "src/infra/providers/provider-pool.ts",
      ].sort(),
      "the deterministic harness, the D161 gemini ocr.extract adapter, the D178 gemini ai.advisory"
        + " adapter and the transport half they share, the D165 census/nominatim geocode adapters,"
        + " and the D165 rotation pool; a new production adapter joins this list deliberately, in"
        + " the same commit that reviews it",
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
      gemini: [
        "src/infra/providers/gemini-ocr-extract.ts",
        "src/infra/providers/gemini-advisory.ts",
        "src/infra/providers/gemini-transport.ts",
      ],
      census: ["src/infra/providers/geocode-adapters.ts"],
      nominatim: ["src/infra/providers/geocode-adapters.ts"],
    };
    const DECLARED_WITHOUT_ADAPTER: Readonly<Record<string, string>> = {
      groq: "Legacy OCR/LLM key family carried forward as ENV inventory only; D161 built the gemini adapter alone and the pool rotates gemini keys. A groq adapter is a 2h-shaped piece of work nobody has scheduled.",
      mistral: "Same as groq — declared endpoint plus key family, no adapter module.",
      openrouter: "Same as groq — declared endpoint plus key family, no adapter module.",
      sambanova: "Same as groq — declared endpoint plus key family, no adapter module.",
    };
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
      assert.match(issues, /only the admission kernel and the run executor's D162 wiring type ProviderClient/);
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
        /admission client imports are confined to the run executor and the worker composition root/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
