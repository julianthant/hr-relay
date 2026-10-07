/**
 * D341 — test inputs have one owner each and the private half never leaks.
 *
 * 1. Cross-tier code never imports unit-only fixtures or helpers.
 * 2. Shared imports have no private-input or runtime effects; recorded capabilities
 *    remain deferred. Executable process fixtures are child entrypoints only.
 * 3. The tracked shared inputs are visible to git, the private file is ignored,
 *    the example carries placeholders only, and every declared shared file is a
 *    tracked file inside the repository.
 * 4. The shared-fixture README names every shared module, so the interface stays discoverable.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { TEST_DATA_CONFIG_PATH, TEST_DATA_LOCAL_CONFIG_PATH, TEST_DATA_LOCAL_EXAMPLE_PATH } from "../../../src/models/config/test-data.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const UNIT_ONLY_ROOTS = ["tests/unit/"];
const ARCHITECTURE_HELPERS_ROOT = /^tests\/architecture\/(?:support|[^/]+)\/helpers\//u;
const SHARED_RESOURCE_HARNESSES = new Set([
  "tests/support/fixtures/preflight/corpus.ts",
  "tests/support/helpers/synthetic-storage-admission.ts",
  "tests/support/helpers/admission-fixture.ts",
  "tests/support/helpers/storage/transaction-history-fixture.ts",
  "tests/support/helpers/backend/dashboard-harness.ts",
]);
const SHARED_ROOTS = ["tests/support/fixtures", "tests/support/helpers"];
const CROSS_TIER_ROOTS = ["tests/architecture", "tests/integration", "tests/support", "tests/perf", "tests/types", "scripts", "src"];
/** Seams a shared fixture may never touch at import time. */
const FORBIDDEN_SHARED_IMPORTS: readonly RegExp[] = [
  /src\/control\/test-data\.js$/u,
  /src\/backend\/storage\/configuration\/credential-store\.js$/u,
  /src\/backend\/storage\/configuration\/credential-test-data-migration\.js$/u,
  /secure-env-bootstrap/u,
  /^dotenv/u,
  /^playwright/u,
  /^node:sqlite$/u,
];
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/gu;

function sourceFiles(roots: readonly string[]): string[] {
  return gitVisibleFiles(roots).filter((path) => /\.(?:ts|tsx|mts|js|mjs)$/u.test(path) && !path.endsWith(".d.ts"));
}

function importsFromText(path: string, text: string): { specifier: string; resolved: string }[] {
  return [...text.matchAll(IMPORT_SPECIFIER)].map((match) => {
    const specifier = match[1] ?? "";
    return { specifier, resolved: specifier.startsWith(".")
      ? relative(REPO_ROOT, resolve(REPO_ROOT, dirname(path), specifier)) : specifier };
  });
}
function importsOf(path: string) {
  return importsFromText(path, readFileSync(join(REPO_ROOT, path), "utf8"));
}

const DEFERRED_CAPABILITIES = [
  { importer: "tests/support/helpers/admission-fixture.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/synthetic-storage-admission.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/synthetic-storage-admission.ts", module: "src/backend/storage/configuration/credential-test-data-migration.js", symbol: "migrateTestDataFromCredentials" },
  { importer: "tests/support/helpers/storage/transaction-history-fixture.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/helpers/backend/dashboard-harness.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/fixtures/preflight/corpus.ts", module: "playwright", symbol: "chromium" },
] as const;
const PROCESS_ENTRYPOINTS = [
  { file: "worker-browser-control-cli.ts", consumers: ["tests/integration/backend/storage/events/timeline-emitter/worker-browser-control-process.test.ts"] },
  { file: "worker-stub-cli.ts", consumers: ["tests/integration/backend/runs/lifecycle/run-record-service/worker-pool-parallel-proof.test.ts"] },
  { file: "runtime-lock-contender.ts", consumers: ["tests/integration/backend/storage/sqlite/migrations/storage-restore-drill.test.ts"] },
] as const;

function parseSource(path: string, text: string) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function ancestors(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) found.push(parent);
  return found;
}
function insideDeferredBody(node: ts.Node): boolean {
  const parents = ancestors(node);
  const functions = parents.filter(ts.isFunctionLike);
  if (functions.length === 0) return false;
  return !functions.some((fn) => {
    // An inline callback/IIFE passed to an eager top-level call is still eager.
    const outer = ancestors(fn);
    return outer.some((parent) => ts.isCallExpression(parent) || ts.isNewExpression(parent))
      && !outer.some(ts.isFunctionLike);
  });
}
function capabilityViolations(path: string, text: string): string[] {
  const source = parseSource(path, text);
  const failures: string[] = [];
  function rejectDynamicCapability(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])) {
      const specifier = node.arguments[0].text;
      const resolved = specifier.startsWith(".") ? relative(REPO_ROOT, resolve(REPO_ROOT, dirname(path), specifier)) : specifier;
      if (FORBIDDEN_SHARED_IMPORTS.some((pattern) => pattern.test(resolved) || pattern.test(specifier))) failures.push(`${path}: dynamic capability import`);
    }
    ts.forEachChild(node, rejectDynamicCapability);
  }
  rejectDynamicCapability(source);
  for (const declaration of source.statements) {
    if (!(ts.isImportDeclaration(declaration) || ts.isExportDeclaration(declaration))
      || declaration.moduleSpecifier === undefined || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const specifier = declaration.moduleSpecifier.text;
    const resolved = specifier.startsWith(".") ? relative(REPO_ROOT, resolve(REPO_ROOT, dirname(path), specifier)) : specifier;
    if (!FORBIDDEN_SHARED_IMPORTS.some((pattern) => pattern.test(resolved) || pattern.test(specifier))) continue;
    if ((ts.isExportDeclaration(declaration) && declaration.isTypeOnly)
      || (ts.isImportDeclaration(declaration) && declaration.importClause?.isTypeOnly)) continue;
    const allowed = DEFERRED_CAPABILITIES.filter((entry) => entry.importer === path && entry.module === resolved);
    if (allowed.length === 0) { failures.push(`${path} -> ${specifier}`); continue; }
    if (ts.isExportDeclaration(declaration)) {
      if (declaration.exportClause !== undefined || resolved === "playwright") failures.push(`${path}: unrecorded capability reexport`);
      continue;
    }
    const clause = declaration.importClause;
    if (clause?.name !== undefined || clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
      failures.push(`${path}: capability must use exact named imports`); continue;
    }
    for (const binding of clause.namedBindings.elements) {
      if (binding.isTypeOnly) continue;
      const symbol = binding.propertyName?.text ?? binding.name.text;
      if (!allowed.some((entry) => entry.symbol === symbol)) { failures.push(`${path}: unrecorded ${symbol}`); continue; }
      const deferredOwners = new Set<string>();
      function visit(node: ts.Node) {
        if (ts.isIdentifier(node) && node.text === binding.name.text && node !== binding.name && node !== binding.propertyName
          && !ancestors(node).some(ts.isTypeNode)) {
          if (!insideDeferredBody(node)) failures.push(`${path}: eager ${symbol}`);
          for (const parent of ancestors(node)) {
            if (ts.isFunctionDeclaration(parent) && parent.name !== undefined) deferredOwners.add(parent.name.text);
            if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer !== undefined
              && (ts.isArrowFunction(parent.initializer) || ts.isFunctionExpression(parent.initializer))) deferredOwners.add(parent.name.text);
          }
          if (symbol === "chromium") {
            const call = node.parent;
            if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)
              || call.expression.expression.getText(source) !== "vi" || call.expression.name.text !== "spyOn"
              || call.arguments[0] !== node || call.arguments.length !== 2
              || !ts.isStringLiteral(call.arguments[1]) || !["launch", "launchPersistentContext"].includes(call.arguments[1].text)) {
              failures.push(`${path}: chromium must only install launch refusal spies`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      let added = true;
      while (added) {
        added = false;
        function checkEagerOwner(node: ts.Node) {
          if (ts.isIdentifier(node) && deferredOwners.has(node.text)
            && !ancestors(node).some((parent) => ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
            && !(ts.isFunctionDeclaration(node.parent) && node.parent.name === node)
            && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)
            && !ancestors(node).some(ts.isTypeNode)) {
            if (!insideDeferredBody(node)) failures.push(`${path}: eager capability owner ${node.text}`);
            for (const parent of ancestors(node)) {
              if (ts.isFunctionDeclaration(parent) && parent.name !== undefined && !deferredOwners.has(parent.name.text)) {
                deferredOwners.add(parent.name.text); added = true;
              }
            }
          }
          ts.forEachChild(node, checkEagerOwner);
        }
        checkEagerOwner(source);
      }
    }
  }
  return failures;
}
function processImportViolations(path: string, text: string): string[] {
  return importsFromText(path, text).filter(({ resolved }) => resolved.startsWith("tests/support/processes/"))
    .map(({ resolved }) => `${path} -> ${resolved}`);
}

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("D341 test-data ownership", () => {
  it("no cross-tier module imports a unit-only fixture or helper", () => {
    const observed: { importer: string; module: string }[] = [];
    for (const path of sourceFiles(CROSS_TIER_ROOTS)) {
      for (const { resolved } of importsOf(path)) {
        if (UNIT_ONLY_ROOTS.some((root) => resolved.startsWith(root))) observed.push({ importer: path, module: resolved.replace(/\.js$/u, "") });
      }
    }
    assert.deepEqual(observed, [], "cross-tier code must use shared fixture homes");
  });

  it("cross-tier imports use shared architecture helpers", () => {
    assert.ok(sourceFiles(CROSS_TIER_ROOTS).length > 0);
    for (const path of sourceFiles(CROSS_TIER_ROOTS)) {
      for (const { resolved } of importsOf(path)) {
        if (ARCHITECTURE_HELPERS_ROOT.test(resolved)) {
          assert.fail(`${path} imports an architecture-owned helper directly: ${resolved}`);
        }
      }
    }
  });

  it("process fixtures are exactly recorded child entrypoints and cannot be imported", () => {
    const files = sourceFiles(["tests", "scripts", "src"]);
    assert.deepEqual(sourceFiles(["tests/support/processes"]).map((path) => path.split("/").at(-1)).toSorted(),
      PROCESS_ENTRYPOINTS.map((entry) => entry.file).toSorted());
    assert.deepEqual(files.filter((path) => path !== "tests/architecture/tooling/test-data-ownership.test.ts").flatMap((path) => processImportViolations(path, readFileSync(join(REPO_ROOT, path), "utf8"))), []);
    for (const entry of PROCESS_ENTRYPOINTS) {
      const consumers = files.filter((path) => path !== "tests/architecture/tooling/test-data-ownership.test.ts" && !path.startsWith("tests/support/processes/")
        && readFileSync(join(REPO_ROOT, path), "utf8").includes(entry.file));
      assert.deepEqual(consumers.toSorted(), [...entry.consumers].toSorted(), entry.file);
      for (const path of consumers) assert.match(readFileSync(join(REPO_ROOT, path), "utf8"), /process-fixtures/u);
    }
    assert.equal(processImportViolations("tests/support/helpers/violation.ts", 'import "../processes/worker-stub-cli.js";').length, 1);
  });

  it("recorded credential capabilities are deferred producer functions", () => {
    for (const entry of DEFERRED_CAPABILITIES) {
      if (entry.module === "playwright" || entry.module === "node:sqlite") continue;
      const path = entry.module.replace(/\.js$/u, ".ts");
      const source = parseSource(path, readFileSync(join(REPO_ROOT, path), "utf8"));
      const producer = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === entry.symbol);
      assert.ok(producer !== undefined && ts.isFunctionDeclaration(producer) && producer.body !== undefined, `${path}:${entry.symbol}`);
      const declarationName = producer.name;
      function rejectEagerProducer(node: ts.Node) {
        if (ts.isIdentifier(node) && node.text === entry.symbol && node !== declarationName
          && !ancestors(node).some(ts.isTypeNode)) assert.ok(insideDeferredBody(node), `${path}: eager producer ${entry.symbol}`);
        ts.forEachChild(node, rejectEagerProducer);
      }
      rejectEagerProducer(source);
      assert.equal(capabilityViolations(entry.importer, readFileSync(join(REPO_ROOT, entry.importer), "utf8")).length, 0);
    }
  });

  it("capability checks reject eager calls, aliases, namespaces, unlisted symbols and IIFEs", () => {
    const path = "tests/support/helpers/admission-fixture.ts";
    const prefix = 'import { createCredentialStore as factory } from "../../../src/backend/storage/configuration/credential-store.js";';
    assert.deepEqual(capabilityViolations(path, `${prefix} export function fixture() { return factory({}); }`), []);
    for (const suffix of ['factory({});', 'new factory({});', 'const alias = factory;', '(() => factory({}))();',
      'function fixture() { return factory({}); } fixture();', '[1].map(() => factory({}));',
      'const fixture = () => factory({}); fixture();',
      'function inner() { return factory({}); } function outer() { return inner(); } outer();']) {
      assert.ok(capabilityViolations(path, `${prefix} ${suffix}`).length > 0, suffix);
    }
    assert.ok(capabilityViolations(path, 'import * as credential from "../../../src/backend/storage/configuration/credential-store.js";').length > 0);
    assert.ok(capabilityViolations(path, 'import { unlisted } from "../../../src/backend/storage/configuration/credential-store.js";').length > 0);
    assert.ok(capabilityViolations(path, 'import("../../../src/backend/storage/configuration/credential-store.js");').length > 0);
    const corpus = "tests/support/fixtures/preflight/corpus.ts";
    assert.deepEqual(capabilityViolations(corpus, 'import { chromium } from "playwright"; function test() { vi.spyOn(chromium, "launch"); }'), []);
    assert.ok(capabilityViolations(corpus, 'import { chromium } from "playwright"; function test() { chromium.launch(); }').length > 0);
  });

  it("shared fixtures and helpers stay pure at import", () => {
    const files = sourceFiles(SHARED_ROOTS);
    assert.ok(files.length > 10, "shared fixtures exist");
    const violations: string[] = [];
    const observedResourceHarnesses = new Set<string>();
    for (const path of files) {
      violations.push(...capabilityViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
      for (const { specifier, resolved } of importsOf(path)) {
        if (FORBIDDEN_SHARED_IMPORTS.some((pattern) => pattern.test(resolved) || pattern.test(specifier))) {
          if (SHARED_RESOURCE_HARNESSES.has(path)) observedResourceHarnesses.add(path);
          else violations.push(`${path} -> ${specifier}`);
        }
      }
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.equal(/test-data\.local\.json|\.tracker\/credentials|process\.env\.HRAUTO_/u.test(text), false, `${path} names a private seam`);
    }
    assert.deepEqual(violations, []);
    assert.deepEqual(observedResourceHarnesses, SHARED_RESOURCE_HARNESSES);
  });

  it("tracks the shared inputs, ignores the private file and keeps the example value-free", () => {
    const visible = new Set(gitVisibleFiles(["config", "tests/support/fixtures/documents"]));
    assert.ok(visible.has(TEST_DATA_CONFIG_PATH), `${TEST_DATA_CONFIG_PATH} must be visible to git`);
    assert.ok(visible.has(TEST_DATA_LOCAL_EXAMPLE_PATH), `${TEST_DATA_LOCAL_EXAMPLE_PATH} must be visible to git`);
    assert.equal(visible.has(TEST_DATA_LOCAL_CONFIG_PATH), false, `${TEST_DATA_LOCAL_CONFIG_PATH} must never be visible to git`);
    assert.equal(isIgnored(TEST_DATA_LOCAL_CONFIG_PATH), true, `${TEST_DATA_LOCAL_CONFIG_PATH} must be gitignored`);
    assert.equal(isIgnored(`${dirname(TEST_DATA_LOCAL_CONFIG_PATH)}/.test-data.local.00000000-0000-4000-8000-000000000000.tmp`), true, "an orphaned private staging file must be gitignored");
    assert.equal(isIgnored(TEST_DATA_CONFIG_PATH), false);
    assert.equal(isIgnored(TEST_DATA_LOCAL_EXAMPLE_PATH), false);

    const example = JSON.parse(readFileSync(join(REPO_ROOT, TEST_DATA_LOCAL_EXAMPLE_PATH), "utf8")) as { inputs: Record<string, { value: unknown }>; files: Record<string, string> };
    for (const [name, entry] of Object.entries(example.inputs)) {
      assert.match(String(entry.value), /^<[^<>]+>$/u, `example input ${name} must be a <placeholder>`);
    }
    for (const [name, path] of Object.entries(example.files)) {
      assert.match(path, /^<[^<>]+>$/u, `example file ${name} must be a <placeholder>`);
    }

    const shared = JSON.parse(readFileSync(join(REPO_ROOT, TEST_DATA_CONFIG_PATH), "utf8")) as { files: Record<string, { path: string }> };
    const repoReal = realpathSync(REPO_ROOT);
    for (const [name, file] of Object.entries(shared.files)) {
      const declared = resolve(REPO_ROOT, dirname(TEST_DATA_CONFIG_PATH), file.path);
      assert.ok(existsSync(declared), `declared file ${name} must exist`);
      const real = realpathSync(declared);
      assert.ok(real.startsWith(`${repoReal}/`), `declared file ${name} must resolve inside the repository`);
      const rel = relative(repoReal, real);
      assert.ok(visible.has(rel), `declared file ${name} (${rel}) must be visible to git`);
      assert.equal(isIgnored(rel), false, `declared file ${name} must not be ignored`);
    }
  });

  it("the shared-fixture README names every shared module", () => {
    const readme = readFileSync(join(REPO_ROOT, "tests/support/fixtures/README.md"), "utf8");
    const missing = sourceFiles(SHARED_ROOTS)
      .map((path) => path.replace(/^tests\/support\/(?:fixtures|helpers)\//u, "").replace(/\.(?:ts|tsx)$/u, ""))
      .filter((stem) => !stem.includes("/"))
      .filter((stem) => !readme.includes(stem) && !isCoveredByFamily(readme, stem));
    assert.deepEqual(missing, [], "add the module to the ownership map in tests/support/fixtures/README.md");
  });
});

/** Seam modules are listed as a family ("seams", "documents") rather than one by one. */
function isCoveredByFamily(readme: string, stem: string): boolean {
  if (stem.endsWith("-seams")) return readme.includes("seams");
  return false;
}
