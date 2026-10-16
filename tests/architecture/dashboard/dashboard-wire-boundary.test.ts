import { createRetainedDashboardMockFixtures } from "../../support/helpers/retained-dashboard-mock-fixtures.js";

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { REPO_ROOT, repoRelative, walkFiles } from "../support/helpers/guard-files.js";

const { RETAINED_MOCK_SITES, retainedLiteralSite, RETAINED_MOCK_LITERALS } = createRetainedDashboardMockFixtures();


const literalSites = new WeakMap<ts.SourceFile, { ids: string; values: readonly string[] }>();

function workflowLiteralIssues(sources: ReadonlyMap<string, string>, ids: readonly string[]): readonly string[] {
  const violations: string[] = [];
  const key = JSON.stringify(ids);
  for (const path of Object.keys(RETAINED_MOCK_LITERALS)) if (!sources.has(path)) violations.push(`${path}: missing retained fixture owner`);
  for (const [path, content] of sources) {
    const source = parseContent(path, content);
    let cached = literalSites.get(source);
    if (cached?.ids !== key) {
      const values: string[] = [];
      visit(source, node => { if (ts.isStringLiteralLike(node) && ids.includes(node.text)) values.push(retainedLiteralSite(node, source)); });
      cached = { ids: key, values };
      literalSites.set(source, cached);
    }
    const values = cached.values;
    const expected = RETAINED_MOCK_SITES[path];
    if (expected !== undefined && JSON.stringify(values) === JSON.stringify(expected)) continue;
    if (values.length > 0 || expected !== undefined) violations.push(`${path}: unadmitted workflow literals ${values.join(", ")}`);
  }
  return violations;
}

const DASHBOARD_ROOT = resolve(REPO_ROOT, "src/dashboard");

/** The `@` alias in `vite.dashboard.config.ts` — kept in sync by the arm below. */
const DASHBOARD_ALIAS = "@/";

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
}

// Type-only imports and exports disappear from the browser bundle.
function bundledSpecifiers(file: string, source: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  visit(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly === true) return;
      const bindings = clause?.namedBindings;
      const everyBindingIsType = clause?.name === undefined
        && bindings !== undefined
        && ts.isNamedImports(bindings)
        && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly);
      if (everyBindingIsType) return;
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
  });
  return specifiers.map((specifier) => specifier.startsWith(DASHBOARD_ALIAS)
    ? `${repoRelative(DASHBOARD_ROOT)}/${specifier.slice(DASHBOARD_ALIAS.length)}`
    : specifier)
    .filter((specifier) => specifier !== file);
}

// verbatimModuleSyntax uses .js specifiers for .ts and .tsx sources.
function resolveSourceFile(fromFile: string, specifier: string): string | undefined {
  const base = specifier.startsWith(".")
    ? resolve(fromFile, "..", specifier)
    : specifier.startsWith("src/") ? join(REPO_ROOT, specifier) : undefined;
  if (base === undefined) return undefined;
  const candidates = base.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Every Node built-in the entry's bundled-import closure can reach, with the chain that got there. */
function nodeBuiltinReach(entry: string): readonly string[] {
  const violations: string[] = [];
  const parents = new Map<string, string>();
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = parse(file);
    for (const specifier of bundledSpecifiers(file, source)) {
      if (isNodeBuiltin(specifier)) {
        const chain = [repoRelative(file)];
        for (let cursor = parents.get(file); cursor !== undefined; cursor = parents.get(cursor)) {
          chain.push(repoRelative(cursor));
        }
        violations.push(`${repoRelative(file)}: imports Node built-in "${specifier}" — reached from ${entry} via ${chain.reverse().join(" -> ")}`);
        continue;
      }
      const target = resolveSourceFile(file, specifier);
      if (target === undefined || seen.has(target)) continue;
      parents.set(target, file);
      pending.push(target);
    }
  }
  return violations.sort();
}


function dashboardHtmlFiles(): readonly string[] {
  const files = readdirSync(DASHBOARD_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort();
  expect(files.length, "src/dashboard declares at least one HTML entry").toBeGreaterThan(0);
  return files;
}

function dashboardEntries(): readonly string[] {
  const entries = dashboardHtmlFiles().flatMap((file) => {
    const html = readFileSync(join(DASHBOARD_ROOT, file), "utf8");
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
      .map((match) => `src/dashboard${match[1] ?? ""}`);
    expect(scripts.length, `${file} declares a module entry`).toBeGreaterThan(0);
    return scripts;
  });
  expect(entries.length).toBeGreaterThan(0);
  return entries;
}

/** Every project-internal source file an entry's bundled-import closure reaches. */
function bundleClosure(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of bundledSpecifiers(file, parse(file))) {
      if (isNodeBuiltin(specifier)) continue;
      const target = resolveSourceFile(file, specifier);
      if (target !== undefined && !seen.has(target)) pending.push(target);
    }
  }
  return new Set([...seen].map((file) => repoRelative(file)));
}

const parsedSources = new Map<string, ts.SourceFile>();

function parseContent(file: string, content: string): ts.SourceFile {
  const cached = parsedSources.get(file);
  if (cached?.text === content) return cached;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  parsedSources.set(file, source);
  return source;
}

function parse(file: string): ts.SourceFile {
  return parseContent(file, readFileSync(file, "utf8"));
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

describe("dashboard wire boundary (ref frontend-backend-integration)", () => {
  const files = walkFiles(DASHBOARD_ROOT);

  it("scans a non-vacuous dashboard tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("declares no handwritten mirror of a *Wire contract under src/dashboard", () => {
    const violations: string[] = [];
    for (const file of files) {
      visit(parse(file), (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith("Wire")) {
          violations.push(`${repoRelative(file)}: interface ${node.name.text} mirrors a wire contract; import the schema-inferred type`);
        }
        if (
          ts.isTypeAliasDeclaration(node)
          && node.name.text.endsWith("Wire")
          && ts.isTypeLiteralNode(node.type)
        ) {
          violations.push(`${repoRelative(file)}: type ${node.name.text} mirrors a wire contract; import the schema-inferred type`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("reaches no Node built-in from ANY dashboard bundle entry", () => {
    const entries = dashboardEntries();

    expect(dashboardHtmlFiles()).toContain("index.html");
    expect(dashboardHtmlFiles()).toContain("kit.html");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // The `@` alias the walker rewrites must be the one the bundler resolves.
    const viteConfig = readFileSync(join(REPO_ROOT, "vite.dashboard.config.ts"), "utf8");
    expect(viteConfig).toContain('"@": resolve(import.meta.dirname, "src/dashboard")');
    // Match the Rollup input declaration; a path mentioned only in a comment is not a built entry.
    for (const file of dashboardHtmlFiles()) {
      const key = file.replace(/\.html$/, "");
      const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inputPattern = new RegExp(
        `\\b${key}\\s*:\\s*resolve\\(\\s*import\\.meta\\.dirname\\s*,\\s*"src/dashboard/${escapedFile}"\\s*\\)`,
      );
      expect(inputPattern.test(viteConfig), `${file} is a rollup input (as "${key}: resolve(...)")`).toBe(true);
    }
    for (const entry of entries) {
      expect(nodeBuiltinReach(entry), entry).toEqual([]);
    }

    const breach = nodeBuiltinReach("src/backend/app/config/resolve.ts");
    expect(breach.some((violation) => violation.includes('"node:crypto"'))).toBe(true);
    expect(breach.some((violation) =>
      violation.includes("src/backend/app/config/runtime-paths.ts") && violation.includes('"node:path"'))).toBe(true);
  });

  it("keeps executable preflight registry composition out of the bootstrap wire closure", () => {
    const closure = bundleClosure("src/models/dashboard/bootstrap.ts");
    expect(closure).toContain("src/models/preflight/preflight-contract.ts");
    expect(closure).not.toContain("src/models/runtime/runtime-dependencies.ts");
    expect(closure).not.toContain("src/models/runtime/runtime-environment.ts");
    expect(closure).not.toContain("src/models/config/secrets.ts");
  });

  it("keeps the rerun client on the strict browser-safe preflight contract", () => {
    const closure = bundleClosure("src/dashboard/client/queries.ts");
    expect(closure).toContain("src/models/preflight/preflight-contract.ts");
    expect(closure).toContain("src/rules/preflight/preflight-semantics.ts");
    expect(closure).not.toContain("src/models/preflight/preflight.ts");
    expect(closure).not.toContain("src/models/runtime/runtime-dependencies.ts");
  });


  it("reaches no operator surface, client, state or app module from the specimen entry", () => {
    const forbidden = [
      "src/dashboard/surfaces/",
      "src/dashboard/client/",
      "src/dashboard/state/",
      "src/dashboard/app/",
    ];
    const closure = bundleClosure("src/dashboard/kit/main.tsx");
    // Non-vacuous: the walker really is resolving the specimen's own modules
    // and the barrel it draws every primitive from.
    expect(closure).toContain("src/dashboard/kit/kit-page.tsx");
    expect(closure).toContain("src/dashboard/ds/ui.tsx");
    expect(closure).toContain("src/dashboard/ds/primitives/primitives-status.tsx");
    const violations = [...closure]
      .filter((file) => forbidden.some((root) => file.startsWith(root)))
      .sort();
    expect(violations, "the specimen bundle may not reach an operator module").toEqual([]);

    // Require a non-entry app module; matching the entry itself would pass with a broken closure walker.
    const operator = bundleClosure("src/dashboard/app/main.tsx");
    for (const root of forbidden) {
      if (root === "src/dashboard/app/") {
        expect(operator, root).toContain("src/dashboard/app/dashboard-app.tsx");
        continue;
      }
      expect([...operator].some((file) => file.startsWith(root)), root).toBe(true);
    }
  });

  it("reaches no workflow registry from any dashboard entry", () => {

    const forbidden = ["src/workflows/", "src/backend/app/registries/workflow-registry.ts"];
    const violations: string[] = [];
    for (const entry of dashboardEntries()) {
      for (const file of bundleClosure(entry)) {
        if (forbidden.some((root) => file.startsWith(root))) {
          violations.push(`${entry}: reaches ${file}`);
        }
      }
    }
    expect(violations.sort(), "no dashboard bundle may carry the workflow registry").toEqual([]);


    const registry = bundleClosure("src/workflows/descriptor-registry.ts");
    expect([...registry].filter((file) => file.startsWith("src/workflows/")).length)
      .toBeGreaterThan(1);
  });

  it("bounds retained fixture literals exactly and refuses served or sibling workflow branches", () => {
    const ids = WORKFLOW_DESCRIPTORS.map(descriptor => String(descriptor.id));
    const sources = new Map(files.map(file => [repoRelative(file), readFileSync(file, "utf8")]));
    expect(Object.values(RETAINED_MOCK_LITERALS).flat()).toHaveLength(27);
    expect(workflowLiteralIssues(sources, ids)).toEqual([]);
    for (const path of ["src/dashboard/client/queries/day-queries.ts", "src/dashboard/surfaces/workflows/mocks/new-sibling.ts", "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx", ...Object.keys(RETAINED_MOCK_LITERALS)]) {
      const changed = new Map(sources);
      changed.set(path, `${sources.get(path) ?? ""}\nconst injected = (id: string) => id === "person-lookup";`);
      expect(workflowLiteralIssues(changed, ids).some(issue => issue.startsWith(`${path}:`))).toBe(true);
    }
    const repurposedPath = "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts";
    const repurposed = new Map(sources);
    const original = sources.get(repurposedPath)!;
    repurposed.set(repurposedPath, original.replace('"separations"', '(unknownId === "separations" ? unknownId : unknownId)'));
    expect(workflowLiteralIssues(repurposed, ids).some(issue => issue.startsWith(`${repurposedPath}:`))).toBe(true);
    const missing = new Map(sources); missing.delete(Object.keys(RETAINED_MOCK_LITERALS)[0]);
    expect(workflowLiteralIssues(missing, ids).length).toBeGreaterThan(0);
  });

  it("branches on no concrete workflow id anywhere under src/dashboard", () => {
    const ids = WORKFLOW_DESCRIPTORS.map((descriptor) => String(descriptor.id));
    expect(ids.length).toBeGreaterThan(0);
    const sources = new Map(files.map(file => [repoRelative(file), readFileSync(file, "utf8")]));
    const violations = workflowLiteralIssues(sources, ids);
    expect(violations).toEqual([]);
  });
});
