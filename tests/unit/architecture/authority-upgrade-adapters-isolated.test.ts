import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { walkFiles } from "./helpers/guard-files.js";

/** Guards §5.2 A0/A1 until their planned Phase-2.6 deletion guard activates. */
const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const STORAGE_COMPOSE = "src/server/storage/compose.ts";
const STORAGE_UPGRADE = "src/server/storage/upgrade.ts";
const SECURE_BOOTSTRAP = "scripts/secure-env-bootstrap.ts";
const CLI = "src/cli.ts";

const UPGRADE_ADAPTERS = [
  "src/infra/compat/upgrade-sources.ts",
  "src/infra/compat/settings-source-recovery.ts",
  "src/infra/compat/pre-floor-settings.ts",
  "src/infra/compat/settings-database-upgrade.ts",
] as const;

const ORDINARY_RUNTIME_ROOTS = [
  "src/server/dashboard/compose.ts",
  "src/server/worker/compose.ts",
  "src/server/dry-run-scenario/compose.ts",
  "src/server/dry-run-scenario/runtime.ts",
  "src/server/activity-person-pseudonym-backfill/compose.ts",
  "scripts/live-browser-login-smoke.ts",
  "scripts/smoke-test-target-document-number.ts",
] as const;

type ImportKind = "dynamic" | "static" | "type";

interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: ImportKind;
}

interface SourceGraph {
  readonly sources: ReadonlyMap<string, ts.SourceFile>;
  readonly edges: readonly ImportEdge[];
}

function parse(path: string, text: string): ts.SourceFile {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => {
    visit(child, callback);
  });
}

function literalValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function importDeclarationKind(node: ts.ImportDeclaration): ImportKind {
  const clause = node.importClause;
  if (clause?.isTypeOnly === true) return "type";
  const bindings = clause?.namedBindings;
  if (clause?.name === undefined && bindings !== undefined && ts.isNamedImports(bindings)
    && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)) {
    return "type";
  }
  return "static";
}

function localImportCandidates(root: string, from: string, specifier: string): readonly string[] {
  if (!specifier.startsWith(".")) return [];
  const withoutRuntimeExtension = specifier.replace(/\.(?:[cm]?js|jsx)$/u, "");
  const base = resolve(root, dirname(from), withoutRuntimeExtension);
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ].map((candidate) => relative(root, candidate).replaceAll("\\", "/"));
}

function buildSourceGraph(root: string): SourceGraph {
  const files = ["src", "scripts"].flatMap((directory) =>
    walkFiles(resolve(root, directory), { missing: "planned-empty" })
  );
  const sources = new Map(files.map((absolute) => {
    const path = relative(root, absolute).replaceAll("\\", "/");
    return [path, parse(path, readFileSync(absolute, "utf8"))] as const;
  }));
  const edges: ImportEdge[] = [];
  const add = (from: string, specifier: string, kind: ImportKind): void => {
    const target = localImportCandidates(root, from, specifier).find((candidate) => sources.has(candidate));
    if (target !== undefined) edges.push({ from, to: target, kind });
  };
  for (const [path, source] of sources) {
    visit(source, (node) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = literalValue(node.moduleSpecifier);
        if (specifier !== undefined) add(path, specifier, importDeclarationKind(node));
      }
      if (ts.isExportDeclaration(node)) {
        const specifier = literalValue(node.moduleSpecifier);
        if (specifier !== undefined) add(path, specifier, node.isTypeOnly ? "type" : "static");
      }
      if (ts.isCallExpression(node)
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        const specifier = literalValue(node.arguments[0]);
        if (specifier !== undefined) {
          add(path, specifier, node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic" : "static");
        }
      }
    });
  }
  return { sources, edges };
}

function edgeKey(edge: Pick<ImportEdge, "from" | "to">): string {
  return `${edge.from}\0${edge.to}`;
}

function valueReach(
  graph: SourceGraph,
  roots: readonly string[],
  cutEdges: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>();
  const pending = roots.map((path) => ({ path, chain: [path] as readonly string[] }));
  while (pending.length > 0) {
    const next = pending.shift();
    if (next === undefined || chains.has(next.path) || !graph.sources.has(next.path)) continue;
    chains.set(next.path, next.chain);
    for (const edge of graph.edges) {
      if (edge.from !== next.path || edge.kind === "type" || cutEdges.has(edgeKey(edge))) continue;
      if (!chains.has(edge.to)) pending.push({ path: edge.to, chain: [...next.chain, edge.to] });
    }
  }
  return chains;
}

function adapterReachabilityIssues(
  graph: SourceGraph,
  roots: readonly string[],
  cutEdges: ReadonlySet<string>,
): readonly string[] {
  const issues: string[] = [];
  for (const root of roots) {
    const reach = valueReach(graph, [root], cutEdges);
    for (const adapter of UPGRADE_ADAPTERS) {
      const chain = reach.get(adapter);
      if (chain !== undefined) {
        issues.push(`${root}: ordinary runtime reaches upgrade adapter ${adapter} via ${chain.join(" -> ")}`);
      }
    }
  }
  return issues;
}

function containsCall(source: ts.SourceFile, name: string): boolean {
  let found = false;
  visit(source, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found = true;
    }
  });
  return found;
}

function storageRegistrationDispatches(source: ts.SourceFile): boolean {
  let dispatches = false;
  visit(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)
      || node.expression.text !== "registerStorageComposer") return;
    for (const argument of node.arguments) {
      visit(argument, (child) => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)
          && child.expression.text === "composeStorageCommand") dispatches = true;
      });
    }
  });
  return dispatches;
}

function storageBoundaryIssues(graph: SourceGraph): readonly string[] {
  const issues: string[] = [];
  const boundaryEdges = graph.edges.filter(({ from, to }) => from === STORAGE_COMPOSE && to === STORAGE_UPGRADE);
  if (boundaryEdges.length === 0) {
    issues.push(`${STORAGE_COMPOSE}: stopped storage upgrade boundary is missing`);
  }
  if (boundaryEdges.some(({ kind }) => kind !== "dynamic")) {
    issues.push(`${STORAGE_COMPOSE}: storage upgrade must remain behind a dynamic stopped-command boundary`);
  }
  const bootstrap = graph.sources.get(SECURE_BOOTSTRAP);
  const cli = graph.sources.get(CLI);
  if (bootstrap === undefined || cli === undefined) {
    issues.push("secure bootstrap and CLI sources must both exist");
    return issues;
  }
  const bootstrapReach = valueReach(graph, [SECURE_BOOTSTRAP], new Set([edgeKey({
    from: STORAGE_COMPOSE,
    to: STORAGE_UPGRADE,
  })]));
  if (!bootstrapReach.has(CLI) || !bootstrapReach.has(STORAGE_COMPOSE)) {
    issues.push(`${SECURE_BOOTSTRAP}: secure bootstrap must dispatch the CLI storage composer`);
  }
  if (!containsCall(bootstrap, "runCli")) {
    issues.push(`${SECURE_BOOTSTRAP}: secure bootstrap must invoke runCli`);
  }
  if (!storageRegistrationDispatches(cli)) {
    issues.push(`${CLI}: registerStorageComposer must dispatch composeStorageCommand`);
  }
  return issues;
}

function auditUpgradeAdapterIsolation(root: string): readonly string[] {
  const graph = buildSourceGraph(root);
  const issues: string[] = [];
  for (const path of [...ORDINARY_RUNTIME_ROOTS, STORAGE_COMPOSE, STORAGE_UPGRADE, SECURE_BOOTSTRAP, CLI]) {
    if (!graph.sources.has(path)) issues.push(`${path}: required production composition root is missing`);
  }
  for (const path of UPGRADE_ADAPTERS) {
    if (!graph.sources.has(path)) issues.push(`${path}: active A0/A1 adapter is missing before Phase 2.6 retirement`);
  }

  const allowedParents = new Map<string, ReadonlySet<string>>([
    [UPGRADE_ADAPTERS[0], new Set([STORAGE_UPGRADE, UPGRADE_ADAPTERS[3]])],
    [UPGRADE_ADAPTERS[1], new Set([UPGRADE_ADAPTERS[0]])],
    [UPGRADE_ADAPTERS[2], new Set([UPGRADE_ADAPTERS[0]])],
    [UPGRADE_ADAPTERS[3], new Set([STORAGE_UPGRADE])],
  ]);
  for (const adapter of UPGRADE_ADAPTERS) {
    const incoming = graph.edges.filter(({ to }) => to === adapter);
    if (incoming.length === 0) issues.push(`${adapter}: adapter has no owning upgrade import`);
    for (const edge of incoming) {
      if (allowedParents.get(adapter)?.has(edge.from) !== true) {
        issues.push(`${edge.from}: imports ${adapter} outside stopped ${STORAGE_UPGRADE}`);
      }
    }
  }

  const stoppedReach = valueReach(graph, [STORAGE_UPGRADE]);
  for (const adapter of UPGRADE_ADAPTERS) {
    if (!stoppedReach.has(adapter)) {
      issues.push(`${STORAGE_UPGRADE}: stopped upgrade no longer reaches owned adapter ${adapter}`);
    }
  }

  const stoppedBoundary = new Set([edgeKey({ from: STORAGE_COMPOSE, to: STORAGE_UPGRADE })]);
  issues.push(...adapterReachabilityIssues(graph, ORDINARY_RUNTIME_ROOTS, stoppedBoundary));
  issues.push(...adapterReachabilityIssues(graph, [SECURE_BOOTSTRAP], stoppedBoundary));
  issues.push(...storageBoundaryIssues(graph));
  return [...new Set(issues)].sort();
}

describe("authority-upgrade-adapters-isolated", () => {
  it("keeps A0/A1 reachable only through the stopped storage upgrade command", () => {
    assert.deepEqual(auditUpgradeAdapterIsolation(REPO_ROOT), []);
  });

  it("catches an ordinary composition root reaching A0 through one helper hop", () => {
    const root = resolve(tmpdir(), `hrauto-upgrade-adapter-guard-${String(process.pid)}-${String(Date.now())}`);
    const write = (path: string, body: string): void => {
      const absolute = resolve(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body);
    };
    try {
      write("src/server/dashboard/compose.ts", 'import "./helper.js";\n');
      write("src/server/dashboard/helper.ts", 'import "../../infra/compat/upgrade-sources.js";\n');
      write("src/infra/compat/upgrade-sources.ts", "export const adapter = true;\n");
      const graph = buildSourceGraph(root);
      const issues = adapterReachabilityIssues(
        graph,
        ["src/server/dashboard/compose.ts"],
        new Set(),
      ).join("\n");
      assert.match(
        issues,
        /dashboard\/compose\.ts -> src\/server\/dashboard\/helper\.ts -> src\/infra\/compat\/upgrade-sources\.ts/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an eager upgrade edge and a CLI registration that does not dispatch storage", () => {
    const staticGraph: SourceGraph = {
      sources: new Map([
        [STORAGE_COMPOSE, parse(STORAGE_COMPOSE, 'import "./upgrade.js";')],
        [STORAGE_UPGRADE, parse(STORAGE_UPGRADE, "export const upgrade = true;")],
        [SECURE_BOOTSTRAP, parse(SECURE_BOOTSTRAP, "runCli();")],
        [CLI, parse(CLI, "registerStorageComposer(() => undefined);")],
      ]),
      edges: [{ from: STORAGE_COMPOSE, to: STORAGE_UPGRADE, kind: "static" }],
    };
    const issues = storageBoundaryIssues(staticGraph).join("\n");
    assert.match(issues, /dynamic stopped-command boundary/u);
    assert.match(issues, /secure bootstrap must dispatch the CLI storage composer/u);
    assert.match(issues, /registerStorageComposer must dispatch composeStorageCommand/u);
  });
});
