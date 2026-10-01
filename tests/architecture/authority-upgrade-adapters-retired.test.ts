import { storageRecoveryFixture, credentialTrap, storageTree } from "../integration/helpers/storage-recovery-fixture.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { readSettings } from "../../src/server/settings-runtime.js";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { walkFiles } from "./helpers/guard-files.js";

/** D332.9: expired settings imports are absent; supported recovery remains stopped. */
const REPO_ROOT = resolve(import.meta.dirname, "../..");

const STORAGE_COMPOSE = "src/backend/app/storage-compose.ts";
const HISTORICAL_RESTORE = "src/server/storage/historical-restore.ts";
const STORAGE_UPGRADE = "src/server/storage/upgrade.ts";
const STORAGE_RELOCATE = "src/server/storage/relocate.ts";
const STOPPED_CONVERTER = "src/infra/sqlite/stopped-database-conversion.ts";
const SECURE_BOOTSTRAP = "scripts/secure-env-bootstrap.ts";
const CLI = "src/cli.ts";

const UPGRADE_ADAPTERS = [
  "src/infra/compat/upgrade-sources.ts",
  "src/infra/compat/settings-source-recovery.ts",
  "src/infra/compat/pre-floor-settings.ts",
  "src/infra/compat/settings-database-upgrade.ts",
] as const;

const ORDINARY_RUNTIME_ROOTS = [
  "src/backend/app/dashboard/compose.ts",
  "src/backend/app/worker-compose.ts",
  "src/backend/app/dry-run-scenario/compose.ts",
  "src/backend/app/dry-run-scenario/runtime.ts",
  "src/backend/app/activity-person-pseudonym-backfill-compose.ts",
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
    for (const adapter of [STOPPED_CONVERTER]) {
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

function relocationBranchCondition(node: ts.Expression): boolean {
  const terms: ts.Expression[] = [];
  const collect = (part: ts.Expression): void => {
    if (ts.isBinaryExpression(part) && part.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      collect(part.left);
      collect(part.right);
    } else terms.push(part);
  };
  collect(node);
  const keyOf = (part: ts.Expression): string | undefined => {
    if (!ts.isBinaryExpression(part) || part.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
      || !ts.isStringLiteral(part.right)) return undefined;
    if (ts.isIdentifier(part.left) && part.left.text === "entrypoint") {
      return `entrypoint=${part.right.text}`;
    }
    if (ts.isElementAccessExpression(part.left) && ts.isIdentifier(part.left.expression)
      && part.left.expression.text === "entrypointArgs" && ts.isNumericLiteral(part.left.argumentExpression)) {
      return `arg${part.left.argumentExpression.text}=${part.right.text}`;
    }
    return undefined;
  };
  return terms.length === 3
    && new Set(terms.map(keyOf)).size === 3
    && ["entrypoint=cli", "arg0=storage", "arg1=relocate"].every((key) => terms.some((part) => keyOf(part) === key));
}

function stoppedRelocationBoundary(graph: SourceGraph): readonly string[] {
  const issues: string[] = [];
  const edges = graph.edges.filter(({ from, to }) => from === SECURE_BOOTSTRAP && to === STORAGE_RELOCATE);
  if (edges.length !== 1 || edges[0]?.kind !== "dynamic") {
    issues.push(`${SECURE_BOOTSTRAP}: storage relocation must have one dynamic stopped-command edge`);
    return issues;
  }
  const source = graph.sources.get(SECURE_BOOTSTRAP);
  if (source === undefined) return [`${SECURE_BOOTSTRAP}: stopped relocation command source is missing`];
  let guarded = false;
  visit(source, (node) => {
    if (!ts.isIfStatement(node) || !relocationBranchCondition(node.expression)
      || !ts.isBlock(node.thenStatement)) return;
    const block = node.thenStatement;
    let dynamicImport = false;
    let parsedCommand = false;
    let exclusiveAdmission = false;
    let acquiredAdmission = false;
    let invokedRelocation = false;
    let releasedAdmission = false;
    visit(block, (part) => {
      if (!ts.isCallExpression(part)) return;
      if (part.expression.kind === ts.SyntaxKind.ImportKeyword
        && literalValue(part.arguments[0]) === "../src/server/storage/relocate.js") dynamicImport = true;
      if (ts.isIdentifier(part.expression) && part.expression.text === "parseRelocationCommand") parsedCommand = true;
      if (ts.isIdentifier(part.expression) && part.expression.text === "acquireEntrypointAdmission") acquiredAdmission = true;
      if (ts.isIdentifier(part.expression) && part.expression.text === "runOfflineStorageRelocation") invokedRelocation = true;
      if (part.arguments.some((argument) => literalValue(argument) === "exclusive")) exclusiveAdmission = true;
      if (ts.isPropertyAccessExpression(part.expression) && ts.isIdentifier(part.expression.expression)
        && part.expression.expression.text === "admission" && part.expression.name.text === "release") releasedAdmission = true;
    });
    const lastStatement = block.statements.at(-1);
    guarded ||= dynamicImport && parsedCommand && acquiredAdmission && exclusiveAdmission
      && invokedRelocation && releasedAdmission
      && lastStatement !== undefined && ts.isReturnStatement(lastStatement);
  });
  if (!guarded) issues.push(`${SECURE_BOOTSTRAP}: relocation import must remain inside exact cli/storage/relocate stopped admission branch`);
  return issues;
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
  const boundaryEdges = graph.edges.filter(({ from, to }) => from === STORAGE_COMPOSE && (to === STORAGE_UPGRADE || to === HISTORICAL_RESTORE));
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
  }), edgeKey({ from: STORAGE_COMPOSE, to: HISTORICAL_RESTORE })]));
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

function auditUpgradeAdapterRetirement(root: string): readonly string[] {
  const graph = buildSourceGraph(root);
  const issues: string[] = [];
  for (const path of [...ORDINARY_RUNTIME_ROOTS, STORAGE_COMPOSE, STORAGE_UPGRADE, STOPPED_CONVERTER, SECURE_BOOTSTRAP, CLI]) {
    if (!graph.sources.has(path)) issues.push(`${path}: required production composition root is missing`);
  }
  for (const path of UPGRADE_ADAPTERS) if (graph.sources.has(path)) issues.push(`${path}: retired adapter restored`);
  const retiredNames = new Set(["readUpgradeSources", "readSettingsUpgradeSources", "convertSettingsDatabase", "recoverSettingsSources", "readPrivateMigrationSource", "settleSettingsUpgrade", "inspectTombstoneBackfill", "countOrphanGateRecords"]);
  for (const [path, source] of graph.sources) visit(source, node => {
    if (ts.isIdentifier(node) && retiredNames.has(node.text)) issues.push(`${path}: retired import API ${node.text}`);
    if (ts.isStringLiteralLike(node) && UPGRADE_ADAPTERS.some(adapter => node.text.replace(/\.js$/u, ".ts").endsWith(adapter.slice("src/infra/compat/".length)))) {
      issues.push(`${path}: retired adapter reference ${node.text}`);
    }
  });
  if (!valueReach(graph, [STORAGE_UPGRADE]).has(STOPPED_CONVERTER)) issues.push("supported stopped converter is disconnected");
  const stoppedBoundary = new Set([edgeKey({ from: STORAGE_COMPOSE, to: STORAGE_UPGRADE }), edgeKey({ from: STORAGE_COMPOSE, to: HISTORICAL_RESTORE })]);
  const relocationIssues = stoppedRelocationBoundary(graph);
  issues.push(...relocationIssues);
  issues.push(...adapterReachabilityIssues(graph, ORDINARY_RUNTIME_ROOTS, stoppedBoundary));
  const bootstrapBoundary = new Set(stoppedBoundary);
  if (relocationIssues.length === 0) bootstrapBoundary.add(edgeKey({ from: SECURE_BOOTSTRAP, to: STORAGE_RELOCATE }));
  issues.push(...adapterReachabilityIssues(graph, [SECURE_BOOTSTRAP], bootstrapBoundary));
  issues.push(...storageBoundaryIssues(graph));
  return [...new Set(issues)].sort();
}

describe("authority-upgrade-adapters-retired", () => {
  it("removes A0/A1 while preserving the supported stopped recovery boundary", () => {
    assert.deepEqual(auditUpgradeAdapterRetirement(REPO_ROOT), []);
  });

  it("catches ordinary composition reaching supported conversion through one helper hop", () => {
    const root = resolve(tmpdir(), `hrauto-upgrade-adapter-guard-${String(process.pid)}-${String(Date.now())}`);
    const write = (path: string, body: string): void => {
      const absolute = resolve(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body);
    };
    try {
      write("src/backend/app/dashboard/compose.ts", 'import "./helper.js";\n');
      write("src/backend/app/dashboard/helper.ts", 'import "../../../infra/sqlite/stopped-database-conversion.js";\n');
      write(STOPPED_CONVERTER, "export const adapter = true;\n");
      const graph = buildSourceGraph(root);
      const issues = adapterReachabilityIssues(
        graph,
        ["src/backend/app/dashboard/compose.ts"],
        new Set(),
      ).join("\n");
      assert.match(
        issues,
        /dashboard\/compose\.ts -> src\/backend\/app\/dashboard\/helper\.ts -> src\/infra\/sqlite\/stopped-database-conversion\.ts/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cuts only the exact stopped relocation command and refuses eager, moved, or widened entry", () => {
    const graph = buildSourceGraph(REPO_ROOT);
    assert.deepEqual(stoppedRelocationBoundary(graph), []);
    const bootstrap = graph.sources.get(SECURE_BOOTSTRAP);
    assert.ok(bootstrap);
    const source = bootstrap.getFullText();
    const changed = (body: string): SourceGraph => ({
      sources: new Map(graph.sources).set(SECURE_BOOTSTRAP, parse(SECURE_BOOTSTRAP, body)),
      edges: graph.edges,
    });
    const importLine = 'const { parseRelocationCommand, runOfflineStorageRelocation, StorageRelocationIncompleteError } = await import("../src/server/storage/relocate.js");';
    assert.ok(source.includes(importLine));
    assert.match(
      stoppedRelocationBoundary(changed(source.replace(importLine, "").replace(
        'const workspace = fileURLToPath(new URL("..", import.meta.url));',
        `const workspace = fileURLToPath(new URL("..", import.meta.url));\n  ${importLine}`,
      ))).join("\n"),
      /exact cli\/storage\/relocate stopped admission branch/u,
    );
    assert.match(
      stoppedRelocationBoundary(changed(source.replace('entrypointArgs[1] === "relocate"', 'entrypointArgs[1] !== "relocate"'))).join("\n"),
      /exact cli\/storage\/relocate stopped admission branch/u,
    );
    assert.match(
      stoppedRelocationBoundary({ sources: graph.sources, edges: graph.edges.map((edge) =>
        edge.from === SECURE_BOOTSTRAP && edge.to === STORAGE_RELOCATE ? { ...edge, kind: "static" as const } : edge) }).join("\n"),
      /one dynamic stopped-command edge/u,
    );
    const ordinaryEdge = { from: "src/backend/app/dashboard/compose.ts", to: STORAGE_RELOCATE, kind: "static" as const };
    const ordinaryGraph = { sources: graph.sources, edges: [...graph.edges, ordinaryEdge] };
    assert.match(
      adapterReachabilityIssues(ordinaryGraph, [ordinaryEdge.from], new Set([
        edgeKey({ from: SECURE_BOOTSTRAP, to: STORAGE_RELOCATE }),
        edgeKey({ from: STORAGE_COMPOSE, to: STORAGE_UPGRADE }),
        edgeKey({ from: STORAGE_COMPOSE, to: HISTORICAL_RESTORE }),
      ])).join("\n"),
      /ordinary runtime reaches upgrade adapter/u,
    );
  });

  it.each(UPGRADE_ADAPTERS)("detects restored module %s and an unresolved import to it", path => {
    const root = resolve(tmpdir(), `hrauto-retired-guard-${String(process.pid)}-${String(Date.now())}`);
    try {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      writeFileSync(resolve(root, path), "export const restored = true;");
      assert.ok(auditUpgradeAdapterRetirement(root).includes(`${path}: retired adapter restored`));
      rmSync(resolve(root, path));
      mkdirSync(resolve(root, "src"), { recursive: true });
      writeFileSync(resolve(root, "src/probe.ts"), `export * from "./infra/compat/${path.split("/").at(-1)?.replace(/\.ts$/u, ".js") ?? "missing"}";`);
      assert.ok(auditUpgradeAdapterRetirement(root).some(issue => issue.includes("retired adapter reference")));
      writeFileSync(resolve(root, "src/probe.ts"), "export function readUpgradeSources() { return {}; }");
      assert.ok(auditUpgradeAdapterRetirement(root).some(issue => issue.includes("retired import API readUpgradeSources")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([0, 46, 49])("rejects equivalent relocated settings-import behavior at schema %s", async version => {
    const f = storageRecoveryFixture(version);
    try {
      writeFileSync(f.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-expired-secret\n");
      writeFileSync(join(f.root, "settings.json"), "corrupt retired settings authority");
      credentialTrap(f.root);
      if (version > 0) await f.backup();
      const before = storageTree(f.root);
      await f.run(true); assert.deepEqual(storageTree(f.root), before);
      const result = await f.run(); assert.deepEqual(result.importedKeys, []); assert.equal(result.credentials, "unchanged");
      const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "retirement-control" }, f.clock);
      try { assert.deepEqual(readSettings(database.authority).settings, {}); } finally { database.close(); }
      assert.equal(readFileSync(f.path).includes(Buffer.from("synthetic-expired-secret")), false);
      for (const [path, digest] of Object.entries(before)) if (!["state.db", "state.db-wal", "state.db-shm"].includes(path)) assert.equal(storageTree(f.root)[path], digest);
    } finally { f.dispose(); }
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
