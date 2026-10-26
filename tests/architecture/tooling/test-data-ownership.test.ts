
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { TEST_DATA_CONFIG_PATH, TEST_DATA_LOCAL_CONFIG_PATH, TEST_DATA_LOCAL_EXAMPLE_PATH } from "../../../src/models/config/test-data.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

function isUnitTest(path: string): boolean {
  return path.startsWith("tests/") && /\.test\.(?:ts|js)$/u.test(path)
    && !/\.integration\.test\.(?:ts|js)$/u.test(path)
    && !/^tests\/(?:architecture|parity|perf)\//u.test(path);
}
const ARCHITECTURE_HELPERS_ROOT = /^tests\/architecture\/(?:support|[^/]+)\/helpers\//u;
const SHARED_RESOURCE_HARNESSES = new Set([
  'tests/support/helpers/backend/dashboard-port-world.ts',
  "tests/support/helpers/credential-persistence-fixtures.ts",
  "tests/support/helpers/synthetic-database-admission.ts",
  "tests/support/fixtures/integration/activity-person-pseudonym-fixtures.ts",
  "tests/support/fixtures/integration/settings-runtime-corruption-fixtures.ts",
  "tests/support/helpers/dashboard/settings-harness.tsx",
  "tests/support/helpers/integration/storage-recovery-fixture.ts",
  "tests/support/helpers/storage/storage-relocation-fixture.ts",

  "tests/support/fixtures/preflight/corpus.ts",
  "tests/support/helpers/synthetic-storage-admission.ts",
  "tests/support/helpers/admission-fixture.ts",
  "tests/support/helpers/backend/dashboard-harness.ts",
  "tests/support/helpers/backend/settings-authority-world.ts",
  "tests/support/helpers/backend/http-route-harness.ts",
  "tests/support/helpers/storage/native-authority/retained-database-fixture.ts",
]);
const SHARED_ROOTS = ["tests/support/fixtures", "tests/support/helpers"];
const CROSS_TIER_ROOTS = ["tests", "scripts", "src"];
/** Seams a shared fixture may never touch at import time. */
const FORBIDDEN_SHARED_IMPORTS: readonly RegExp[] = [
  /src\/control\/test-data\.js$/u,
  /src\/backend\/storage\/configuration\/credential-store\.js$/u,
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
  { importer: 'tests/support/helpers/backend/dashboard-port-world.ts', module: 'src/backend/storage/configuration/credential-store.js', symbol: 'createCredentialStore' },
  { importer: "tests/support/helpers/credential-persistence-fixtures.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/credential-persistence-fixtures.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "readForErasure" },
  { importer: "tests/support/helpers/synthetic-database-admission.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/fixtures/integration/activity-person-pseudonym-fixtures.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/fixtures/integration/settings-runtime-corruption-fixtures.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/helpers/dashboard/settings-harness.tsx", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/integration/storage-recovery-fixture.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/helpers/storage/storage-relocation-fixture.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/helpers/storage/storage-relocation-fixture.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/admission-fixture.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/synthetic-storage-admission.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/helpers/backend/dashboard-harness.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/helpers/backend/settings-authority-world.ts", module: "src/backend/storage/configuration/credential-store.js", symbol: "createCredentialStore" },
  { importer: "tests/support/fixtures/preflight/corpus.ts", module: "playwright", symbol: "chromium" },
  { importer: "tests/support/helpers/backend/http-route-harness.ts", module: "node:sqlite", symbol: "DatabaseSync" },
  { importer: "tests/support/helpers/storage/native-authority/retained-database-fixture.ts", module: "node:sqlite", symbol: "DatabaseSync" },
] as const;
const PROCESS_ENTRYPOINTS = [
  { file: 'child-execution-crash-worker.ts', consumers: ['tests/backend/app/composition/worker-compose.child-crash.integration.test.ts'] },
  { file: 'duo-credential-store-worker.ts', consumers: ['tests/backend/storage/configuration/duo-credential-store.integration.test.ts'] },
  { file: 'storage-restore-attempt-worker.ts', consumers: ['tests/support/helpers/backend/storage-restore-world.ts'] },
  { file: "worker-composition-child.ts", consumers: ["tests/support/helpers/backend/worker-composition-world.ts"] },
  { file: "worker-browser-control-cli.ts", consumers: ["tests/backend/runtime/workers/worker-supervisor.integration.test.ts", "tests/backend/app/composition/dashboard/compose.worker-browser-control-process.integration.test.ts", "tests/backend/app/composition/storage-compose.profile-activity.integration.test.ts"] },
  { file: "worker-stub-cli.ts", consumers: ["tests/support/helpers/backend/dashboard-child-world.ts", 'tests/backend/app/composition/dashboard/compose.worker-pool-capacity.integration.test.ts'] },
  { file: "write-fence-owner.ts", consumers: ["tests/support/helpers/backend/worker-lifetime-world.ts"] },
  { file: "run-record-race-worker.ts", consumers: ["tests/support/helpers/backend/run-record-service-world.ts"] },
  { file: "runtime-lock-contender.ts", consumers: ["tests/backend/storage/sqlite/runtime-process-locks.storage-restore-drill.integration.test.ts"] },
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

function childEntrypointBound(path: string, text: string, file: string): boolean {
  const fileUrlNames = new Set<string>();
  let urlShadowed = false;
  const source = parseSource(path, text);
  const joinNames = new Set(["join"]);
  for (const declaration of source.statements) {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const clause = declaration.importClause;
    if (clause?.name?.text === 'URL' || clause?.namedBindings !== undefined
      && (ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text === 'URL'
        : clause.namedBindings.elements.some(binding => binding.name.text === 'URL'))) urlShadowed = true;
    if (declaration.moduleSpecifier.text === 'node:url') {
      const bindings = declaration.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if (!declaration.importClause?.isTypeOnly && !binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 'fileURLToPath') fileUrlNames.add(binding.name.text);
        }
      }
    }
    if (declaration.moduleSpecifier.text !== 'node:path') continue;
    const bindings = declaration.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === "join") joinNames.add(binding.name.text);
      }
    }
  }
  const declarations = new Map<string, ts.Expression>();
  function collect(node: ts.Node) {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
      || ts.isBindingElement(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node))
      && node.name !== undefined && ts.isIdentifier(node.name)) {
      fileUrlNames.delete(node.name.text);
      if (node.name.text === 'URL') urlShadowed = true;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(source);
  function canonicalPath(node: ts.Expression, seen = new Set<string>()): boolean {
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text); const initializer = declarations.get(node.text);
      return initializer !== undefined && canonicalPath(initializer, seen);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && fileUrlNames.has(node.expression.text)) {
      const url = node.arguments[0];
      return !urlShadowed && node.arguments.length === 1 && url !== undefined && ts.isNewExpression(url) && canonicalPath(url);
    }
    if (ts.isNewExpression(node) && node.expression.getText(source) === "URL" && node.arguments?.length === 2) {
      return ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.endsWith(`/support/processes/${file}`)
        && relative(REPO_ROOT, resolve(REPO_ROOT, dirname(path), node.arguments[0].text)) === `tests/support/processes/${file}`
        && node.arguments[1].getText(source) === "import.meta.url";
    }
    if (ts.isCallExpression(node) && joinNames.has(node.expression.getText(source)) && node.arguments[0]?.getText(source) === "process.cwd()") {
      const parts = node.arguments.slice(1);
      return parts.length > 0 && parts.every(ts.isStringLiteral) && parts.map((part) => part.text).join("/") === `tests/support/processes/${file}`;
    }
    return false;
  }
  let bound = false;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "prefixArgs") {
      let value = node.initializer;
      if (ts.isCallExpression(value) && value.expression.getText(source) === "Object.freeze" && value.arguments[0] !== undefined) value = value.arguments[0];
      if (ts.isArrayLiteralExpression(value) && value.elements.some((element) => canonicalPath(element))) bound = true;
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ["fork", "Worker", "spawn"].includes(node.expression.getText(source))) {
      if (node.expression.getText(source) === "spawn") {
        const args = node.arguments?.[1];
        if (args !== undefined && ts.isArrayLiteralExpression(args) && args.elements.some((element) => canonicalPath(element))) bound = true;
      } else if (node.arguments?.[0] !== undefined && canonicalPath(node.arguments[0])) bound = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); return bound;
}

function privateSeamViolations(path: string, text: string): string[] {
  const source = parseSource(path, text);
  const failures: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
      && /test-data\.local\.json|\.tracker\/credentials/u.test(node.getText(source))) failures.push(node.getText(source));
    if (ts.isPropertyAccessExpression(node) && /^process\.env\.HRAUTO_/u.test(node.getText(source))) failures.push(node.getText(source));
    if (ts.isElementAccessExpression(node) && node.expression.getText(source) === "process.env"
      && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text.startsWith("HRAUTO_")) failures.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("test-data ownership", () => {
  it("no cross-tier module imports a unit-only fixture or helper", () => {
    const observed: { importer: string; module: string }[] = [];
    for (const path of sourceFiles(CROSS_TIER_ROOTS).filter((file) => !isUnitTest(file))) {
      for (const { resolved } of importsOf(path)) {
        if (isUnitTest(resolved)) observed.push({ importer: path, module: resolved.replace(/\.js$/u, "") });
      }
    }
    assert.deepEqual(observed, [], "cross-tier code must use shared fixture homes");
    assert.equal(isUnitTest("tests/backend/helper.test.js"), true);
    assert.equal(isUnitTest("tests/support/helpers/helper.test.ts"), true);
    for (const path of ["tests/backend/helper.integration.test.js", "tests/architecture/guard.test.ts", "tests/parity/reference.test.ts", "tests/perf/benchmark.ts", "tests/support/helpers/helper.ts"]) {
      assert.equal(isUnitTest(path), false, path);
    }
    assert.equal(importsFromText("tests/backend/composition.integration.test.ts", 'import "../models/helper.test.js";')[0]?.resolved, "tests/models/helper.test.js");
  });

  it("cross-tier imports use shared architecture helpers", () => {
    const files = sourceFiles(CROSS_TIER_ROOTS).filter((file) => !isUnitTest(file));
    assert.ok(files.length > 0);
    for (const path of files) {
      for (const { resolved } of importsOf(path)) {
        if (ARCHITECTURE_HELPERS_ROOT.test(resolved) && !path.startsWith("tests/architecture/")) {
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
      for (const path of consumers) assert.ok(childEntrypointBound(path, readFileSync(join(REPO_ROOT, path), "utf8"), entry.file), `${path}: ${entry.file} must bind a canonical child entrypoint`);
    }
    assert.equal(processImportViolations("tests/support/helpers/violation.ts", 'import "../processes/worker-stub-cli.js";').length, 1);
    const importer = 'tests/backend/app/composition/worker-compose.child-crash.integration.test.ts';
    const file = 'child-execution-crash-worker.ts';
    const canonical = `new URL('../../../support/processes/${file}', import.meta.url)`;
    const prefix = `import { fileURLToPath as fromUrl } from 'node:url'; import { spawn } from 'node:child_process';`;
    assert.equal(childEntrypointBound(importer, `${prefix} spawn(process.execPath, [fromUrl(${canonical})]);`, file), true);
    assert.equal(childEntrypointBound(importer, `${prefix} spawn(process.execPath, [fromUrl(new URL('file:///foreign/${file}'))]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} let root = new URL('file:///foreign/'); spawn(process.execPath, [fromUrl(new URL('../../../support/processes/${file}', root))]);`, file), false);
    assert.equal(childEntrypointBound(importer, `import { spawn } from 'node:child_process'; const fromUrl = (value: URL) => value; spawn(process.execPath, [fromUrl(${canonical})]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} spawn(process.execPath, [fromUrl(${canonical}, 'extra')]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} function launch(fromUrl: (value: URL) => URL) { spawn(process.execPath, [fromUrl(${canonical})]); }`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} function launch({ fromUrl }: { fromUrl: (value: URL) => URL }) { spawn(process.execPath, [fromUrl(${canonical})]); }`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} const [fromUrl] = supplied; spawn(process.execPath, [fromUrl(${canonical})]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} const { nested: { ...fromUrl } } = supplied; spawn(process.execPath, [fromUrl(${canonical})]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} function launch() { class fromUrl {} spawn(process.execPath, [fromUrl(${canonical})]); }`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} const URL = supplied; spawn(process.execPath, [fromUrl(${canonical})]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} import { URL } from 'untrusted'; spawn(process.execPath, [fromUrl(${canonical})]);`, file), false);
    assert.equal(childEntrypointBound(importer, `${prefix} function launch({ URL }: { URL: unknown }) { spawn(process.execPath, [fromUrl(${canonical})]); }`, file), false);
    assert.equal(childEntrypointBound(importer, `import { fileURLToPath as wrapper } from "node:url"; const holder = function wrapper() { spawn(wrapper(${canonical}), []); };`, file), false);
    assert.equal(childEntrypointBound(importer, `import { fileURLToPath as wrapper } from "node:url"; const holder = class wrapper { launch() { spawn(wrapper(${canonical}), []); } };`, file), false);

  });

  it("child-entrypoint controls require canonical executable launch binding", () => {
    const path = "tests/scripts/test/child-proof.integration.test.ts", file = "worker-stub-cli.ts";
    const literal = 'join(process.cwd(), "tests", "support", "processes", "worker-stub-cli.ts")';
    assert.equal(childEntrypointBound(path, `const child = ${literal}; spawn(process.execPath, ["--import", "tsx", child]);`, file), true);
    assert.equal(childEntrypointBound(path, `import { join as join_m1 } from "node:path"; const child = ${literal.replace("join(", "join_m1(")}; spawn(process.execPath, ["--import", "tsx", child]);`, file), true);
    assert.equal(childEntrypointBound(path, `const child = ${literal.replace("join(", "join_m1(")}; spawn(process.execPath, ["--import", "tsx", child]);`, file), false);
    for (const text of [`// spawn(process.execPath, [${literal}]);`, `const unused = ${literal};`, `spawn(process.execPath, [${literal.replace('"support", "processes"', '"process-fixtures"')}]);`, 'import "../../support/processes/worker-stub-cli.ts";']) {
      assert.equal(childEntrypointBound(path, text, file), false, text);
    }
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
    for (const entry of DEFERRED_CAPABILITIES.filter((item) => item.module === "node:sqlite")) {
      const prefix = 'import { DatabaseSync as database } from "node:sqlite";';
      assert.deepEqual(capabilityViolations(entry.importer, `${prefix} export function fixture() { return new database(":memory:"); }`), []);
      assert.ok(capabilityViolations(entry.importer, `${prefix} const eager = new database(":memory:");`).length > 0, entry.importer);
      assert.ok(capabilityViolations(`${dirname(entry.importer)}/unrecorded-sibling.ts`, `${prefix} export function fixture() { return new database(":memory:"); }`).length > 0, entry.importer);
    }
    const corpus = "tests/support/fixtures/preflight/corpus.ts";
    assert.deepEqual(capabilityViolations(corpus, 'import { chromium } from "playwright"; function test() { vi.spyOn(chromium, "launch"); }'), []);
    assert.ok(capabilityViolations(corpus, 'import { chromium } from "playwright"; function test() { chromium.launch(); }').length > 0);
  });

  it("shared fixtures and helpers stay pure at import", () => {
    const files = sourceFiles(SHARED_ROOTS).filter((path) => !path.endsWith(".test.ts"));
    assert.ok(files.length > 10, "shared fixtures exist");
    const violations: string[] = [];
    const observedResourceHarnesses = new Set<string>();
    for (const path of files) {
      violations.push(...capabilityViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
      const source = parseSource(path, readFileSync(join(REPO_ROOT, path), "utf8"));
      const typeOnly = new Set(source.statements.flatMap((statement) =>
        ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly
          && ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : []));
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly
          && ts.isStringLiteral(statement.moduleSpecifier)) typeOnly.delete(statement.moduleSpecifier.text);
      }
      for (const { specifier, resolved } of importsOf(path)) {
        if (typeOnly.has(specifier)) continue;
        if (FORBIDDEN_SHARED_IMPORTS.some((pattern) => pattern.test(resolved) || pattern.test(specifier))) {
          if (SHARED_RESOURCE_HARNESSES.has(path)) observedResourceHarnesses.add(path);
          else violations.push(`${path} -> ${specifier}`);
        }
      }
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.deepEqual(privateSeamViolations(path, text), [], `${path} names a private seam`);
    }
    assert.deepEqual(violations, []);
    assert.deepEqual(observedResourceHarnesses, SHARED_RESOURCE_HARNESSES);
  });

  it("private-seam controls ignore comments and reject executable references", () => {
    const path = "tests/support/fixtures/private-seam-proof.ts";
    assert.deepEqual(privateSeamViolations(path, '// config/test-data.local.json .tracker/credentials process.env.HRAUTO_SECRET'), []);
    for (const text of ['const path = "config/test-data.local.json";', 'read(".tracker/credentials");', 'process.env.HRAUTO_SECRET;', 'process.env["HRAUTO_SECRET"];']) {
      assert.ok(privateSeamViolations(path, text).length > 0, text);
    }
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
      .filter((path) => !path.endsWith(".test.ts"))
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
