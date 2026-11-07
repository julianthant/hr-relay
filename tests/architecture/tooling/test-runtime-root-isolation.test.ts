import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";



/** Isolation-contract properties whose values are real, operator-owned roots. */
const ISOLATION_ROOT_PROPERTIES = new Set([
  "browserProfileRoot",
  "stateRoot",
  "artifactRoot",
  "processLockRoot",
]);

/** `.auth`, `.auth-rebuild`, `.tracker`, `.tracker-rebuild` and anything beneath them. */
const REAL_ROOT_LITERAL = /^\.(?:auth|tracker)(?:-rebuild)?(?:[/\\]|$)/;

/** The config constant that already holds the resolved real profile root. */
const REAL_ROOT_IDENTIFIERS = new Set(["DEFAULT_BROWSER_PROFILE_ROOT", "defaultBrowserProfileRoot"]);

const FS_MUTATORS = new Set([
  "appendFile", "appendFileSync",
  "chmod", "chmodSync", "chown", "chownSync",
  "copyFile", "copyFileSync", "cp", "cpSync",
  "createWriteStream",
  "link", "linkSync",
  "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync",
  "open", "openSync",
  "rename", "renameSync",
  "rm", "rmSync", "rmdir", "rmdirSync",
  "symlink", "symlinkSync",
  "truncate", "truncateSync",
  "unlink", "unlinkSync",
  "utimes", "utimesSync",
  "writeFile", "writeFileSync",
]);

/** Mutators whose SECOND argument is also a path, not payload/options. */
const TWO_PATH_MUTATORS = new Set([
  "copyFile", "copyFileSync", "cp", "cpSync",
  "link", "linkSync", "rename", "renameSync", "symlink", "symlinkSync",
]);

/** Calls that root a relative segment somewhere else entirely. */
const PATH_JOINERS = new Set(["join", "resolve", "resolvePath", "relative", "normalize"]);

// Resolve mutators only from node:fs bindings; another object method named open is not a filesystem write.
function fsMutatorName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return FS_MUTATORS.has(expression.text) ? expression.text : undefined;
  }
  if (ts.isPropertyAccessExpression(expression) && FS_MUTATORS.has(expression.name.text)
    && /^(?:fs|fsp|fsPromises|promises|nodeFs)$/i.test(expression.expression.getText())) {
    return expression.name.text;
  }
  return undefined;
}

function calleeSimpleName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/** `<something isolation-ish>.browserProfileRoot` and friends. */
function isIsolationRootAccess(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node)
    && ISOLATION_ROOT_PROPERTIES.has(node.name.text)
    && /isolation/i.test(node.expression.getText());
}

// Only the first join argument establishes a path root; mentioning an isolated root later is insufficient.
function isRealRootPath(node: ts.Node, tainted: ReadonlySet<string>): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isAwaitExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    return isRealRootPath(node.expression, tainted);
  }
  if (isIsolationRootAccess(node)) return true;
  if (ts.isIdentifier(node)) {
    return REAL_ROOT_IDENTIFIERS.has(node.text) || tainted.has(node.text);
  }
  if (ts.isCallExpression(node)) {
    const name = calleeSimpleName(node.expression);
    if (name !== undefined && REAL_ROOT_IDENTIFIERS.has(name)) return true;
    const [first] = node.arguments;
    return name !== undefined && PATH_JOINERS.has(name) && first !== undefined
      && isRealRootPath(first, tainted);
  }
  if (ts.isConditionalExpression(node)) {
    return isRealRootPath(node.whenTrue, tainted) || isRealRootPath(node.whenFalse, tainted);
  }
  if (ts.isTemplateExpression(node)) {
    if (REAL_ROOT_LITERAL.test(node.head.text)) return true;
    const [firstSpan] = node.templateSpans;
    return node.head.text === "" && firstSpan !== undefined && isRealRootPath(firstSpan.expression, tainted);
  }
  return ts.isStringLiteralLike(node) && REAL_ROOT_LITERAL.test(node.text);
}

// Resolve root aliases to a fixpoint so indirection cannot hide filesystem mutation.
function taintedBindings(source: ts.SourceFile): ReadonlySet<string> {
  const tainted = new Set<string>();
  const declarations: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (!ts.isIdentifier(declaration.name) || tainted.has(declaration.name.text)) continue;
      if (declaration.initializer !== undefined && isRealRootPath(declaration.initializer, tainted)) {
        tainted.add(declaration.name.text);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return tainted;
}

function position(source: ts.SourceFile, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${source.fileName}:${String(line + 1)}`;
}

export function auditTestRuntimeRootWrites(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const tainted = taintedBindings(source);
  const violations: string[] = [];
  let usesSessionFactory = false;
  let boundProfileRoot = false;

  const detectFactory = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "PlaywrightWorkerSessionFactory"
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      usesSessionFactory = true;
    }
    ts.forEachChild(node, detectFactory);
  };
  detectFactory(source);

  const visit = (node: ts.Node): void => {
    // Only a file that actually opens sessions is making a BINDING here; every
    // other `browserProfileRoot:` is an assertion about the isolation contract.
    if (usesSessionFactory && ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name) && node.name.text === "browserProfileRoot") {
      boundProfileRoot = true;
      if (isRealRootPath(node.initializer, tainted)) {
        violations.push(
          `${position(source, node)}: binds browserProfileRoot to the REAL isolation root; bind a temp directory instead`,
        );
      }
    }
    if (ts.isCallExpression(node)) {
      const name = fsMutatorName(node.expression);
      if (name !== undefined) {
        const paths = TWO_PATH_MUTATORS.has(name) ? node.arguments.slice(0, 2) : node.arguments.slice(0, 1);
        for (const argument of paths) {
          if (isRealRootPath(argument, tainted)) {
            violations.push(
              `${position(source, node)}: ${name}() targets a real runtime-isolation root; tests must mutate only temp roots`,
            );
            break;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (usesSessionFactory && !boundProfileRoot) {
    violations.push(
      `${source.fileName}: constructs PlaywrightWorkerSessionFactory without binding paths.browserProfileRoot; open() creates a profile directory under whatever root the config carries — the operator's real one by default`,
    );
  }
  return violations;
}

describe("test runtime-root isolation", () => {
  it("never creates or deletes a real runtime-isolation root from a test", () => {
    const violations = gitVisibleFiles(["tests"])
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
      .flatMap((path) => auditTestRuntimeRootWrites(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });

  it("catches the exact regression it was written for, direct and laundered", () => {
    const direct = auditTestRuntimeRootWrites("fixture.test.ts", [
      'import { rmSync } from "node:fs";',
      'import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";',
      "rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });",
    ].join("\n"));
    assert.equal(direct.length, 1, direct.join("\n"));
    assert.match(direct.join("\n"), /rmSync\(\) targets a real runtime-isolation root/);

    // One indirection must not launder it.
    assert.match(auditTestRuntimeRootWrites("fixture.test.ts", [
      "const profileRoot = rebuildRuntimeIsolation.browserProfileRoot;",
      'const worker = join(profileRoot, "worker-1");',
      "mkdirSync(worker, { recursive: true });",
    ].join("\n")).join("\n"), /mkdirSync\(\) targets a real runtime-isolation root/);

    // A bare literal is the same hazard without the binding.
    assert.match(auditTestRuntimeRootWrites("fixture.test.ts", [
      'rmSync(".auth-rebuild/hrauto-rebuild", { recursive: true, force: true });',
    ].join("\n")).join("\n"), /targets a real runtime-isolation root/);
    assert.match(auditTestRuntimeRootWrites("fixture.test.ts", [
      'writeFileSync(".tracker-rebuild/runs.sqlite", "");',
    ].join("\n")).join("\n"), /targets a real runtime-isolation root/);

    // Both halves of a two-path mutator are paths.
    assert.match(auditTestRuntimeRootWrites("fixture.test.ts", [
      'renameSync(temporary, ".auth-rebuild/duo-webauthn.json");',
    ].join("\n")).join("\n"), /renameSync\(\) targets a real runtime-isolation root/);
  });

  it("requires a test that opens real sessions to bind its own profile root", () => {
    const unbound = auditTestRuntimeRootWrites("fixture.test.ts", [
      'import { PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";',
      "const factory = new PlaywrightWorkerSessionFactory({ config, isolation, clock, scheduler, newSessionId, bindings, launcher });",
    ].join("\n"));
    assert.match(unbound.join("\n"), /without binding paths\.browserProfileRoot/);

    assert.deepEqual(auditTestRuntimeRootWrites("fixture.test.ts", [
      'import { PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";',
      'const config = { ...base, paths: { ...base.paths, browserProfileRoot: join(root, "profiles") } };',
      "const factory = new PlaywrightWorkerSessionFactory({ config, isolation, clock, scheduler, newSessionId, bindings, launcher });",
    ].join("\n")), []);

    // Binding it to the real root is worse than not binding it.
    assert.match(auditTestRuntimeRootWrites("fixture.test.ts", [
      'import { PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";',
      "const config = { ...base, paths: { ...base.paths, browserProfileRoot: rebuildRuntimeIsolation.browserProfileRoot } };",
      "void new PlaywrightWorkerSessionFactory({ config });",
    ].join("\n")).join("\n"), /binds browserProfileRoot to the REAL isolation root/);
  });

  it("leaves temp-rooted fixtures and read-only isolation assertions alone", () => {
    assert.deepEqual(auditTestRuntimeRootWrites("fixture.test.ts", [
      'const root = mkdtempSync(join(tmpdir(), "hrauto-fixture-"));',
      "mkdirSync(join(root, \"profiles\"), { recursive: true });",
      "rmSync(root, { recursive: true, force: true });",
      // Naming the contract is how the isolation guard stays meaningful; only
      // MUTATING it is banned.
      "assert.equal(config.paths.browserProfileRoot, resolve(rebuildRuntimeIsolation.browserProfileRoot));",
      "assert.doesNotMatch(directory, /\\.auth\\/|hrauto-legacy/u);",
    ].join("\n")), []);
  });
});
