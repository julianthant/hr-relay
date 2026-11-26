import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";
import { gitVisibleFiles, repoRelative, REPO_ROOT } from "../support/helpers/guard-files.js";

// A failing node:assert comparison formats both values with util.inspect at depth 1000 and getters on.
// On jsdom nodes that never finishes: the fork grows until the CI runner loses its VM.
const COMPARISONS = new Set([
  "equal", "notEqual", "strictEqual", "notStrictEqual",
  "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "partialDeepStrictEqual",
]);
// `default` and `strict` both name the whole assert module; `assert.strict` is the strict module itself.
const MODULE_EXPORTS = new Set(["default", "strict"]);
const ASSERT_MODULES = new Set(["node:assert", "node:assert/strict", "assert", "assert/strict"]);
const NODE_PROBE = resolve(REPO_ROOT, "tests/architecture/tooling/dom-node-probe.ts");
const PROOF = resolve(REPO_ROOT, "tests/architecture/tooling/dom-node-proof.ts");
const PLAIN = resolve(REPO_ROOT, "tests/dashboard/app/startup/dom-node-plain.ts");
const HELPER_CALLER = resolve(REPO_ROOT, "tests/dashboard/app/startup/dom-node-helper-caller.ts");
const IMPORTS_ASSERT = /["']node:assert(\/strict)?["']|["']assert(\/strict)?["']/u;

const PROOF_SOURCE = [
  'import assert from "node:assert/strict";',
  'import * as nodeAssert from "node:assert";',
  'import { deepEqual } from "node:assert/strict";',
  'import { default as aliased } from "node:assert/strict";',
  'import { strict as strictAssert } from "node:assert";',
  'const trigger = () => document.querySelector<HTMLButtonElement>(\'button[aria-label="Search"]\')!;',
  "export function original() { assert.equal(document.activeElement, trigger()); }",
  "export function namespace(rows: readonly HTMLElement[]) { nodeAssert.deepStrictEqual(rows, []); }",
  "export function named(node: Node | null) { deepEqual(node, null); }",
  "export function identity() { assert.equal(document.activeElement === trigger(), true); }",
  "export function property() { assert.equal(document.activeElement?.getAttribute(\"aria-label\"), \"Search\"); }",
  "export function truthy() { assert.ok(document.activeElement); }",
  "export function defaultAlias() { aliased.equal(document.activeElement, trigger()); }",
  "export function defaultAliasIdentity() { aliased.equal(document.activeElement === trigger(), true); }",
  "export function strictImport() { strictAssert.equal(document.activeElement, null); }",
  "export function strictImportIdentity() { strictAssert.equal(document.activeElement === null, true); }",
  "export function strictMember() { nodeAssert.strict.equal(document.activeElement, null); }",
  "export function strictMemberIdentity() { nodeAssert.strict.equal(document.activeElement === null, true); }",
].join("\n");

const HELPER_CALLER_SOURCE = [
  'import assert from "node:assert/strict";',
  'import { never, start } from "./startup-harness.js";',
  'export async function helperValue() { assert.equal((await start({ "/": never })).host.querySelector("form"), null); }',
].join("\n");

// Every assert importer is a candidate: a DOM value can arrive from a helper without any DOM word in the file.
function selectRoots(paths: readonly string[], read: (path: string) => string): string[] {
  return paths
    .filter((path) => /\.tsx?$/u.test(path) && !path.startsWith("tests/architecture/"))
    .map((path) => resolve(REPO_ROOT, path))
    .filter((path) => IMPORTS_ASSERT.test(read(path)));
}

function scanRoots(): string[] {
  return selectRoots(gitVisibleFiles(["tests"]), (path) => readFileSync(path, "utf8"));
}

function compilerOptions(): ts.CompilerOptions {
  const configPath = resolve(REPO_ROOT, "tsconfig.json");
  return { ...ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, (path) => ts.sys.readFile(path)).config, ts.sys, REPO_ROOT).options, noEmit: true };
}

function assertModuleBinding(checker: ts.TypeChecker, identifier: ts.Identifier): "module" | "function" | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  const declaration = symbol?.declarations?.[0];
  if (declaration === undefined) return undefined;
  const importDeclaration = ts.findAncestor(declaration, ts.isImportDeclaration);
  if (importDeclaration === undefined || !ts.isStringLiteral(importDeclaration.moduleSpecifier)
    || !ASSERT_MODULES.has(importDeclaration.moduleSpecifier.text)) return undefined;
  if (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)) return "module";
  if (ts.isImportSpecifier(declaration) && MODULE_EXPORTS.has((declaration.propertyName ?? declaration.name).text)) return "module";
  if (ts.isImportSpecifier(declaration)) return COMPARISONS.has((declaration.propertyName ?? declaration.name).text) ? "function" : undefined;
  return undefined;
}

function isAssertModule(checker: ts.TypeChecker, receiver: ts.Expression): boolean {
  if (ts.isIdentifier(receiver)) return assertModuleBinding(checker, receiver) === "module";
  return ts.isPropertyAccessExpression(receiver) && receiver.name.text === "strict" && isAssertModule(checker, receiver.expression);
}

function holdsNode(checker: ts.TypeChecker, type: ts.Type, node: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
  if (type.isUnion()) return type.types.some((member) => holdsNode(checker, member, node, seen));
  if (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return false;
  // An empty intersection is assignable to everything, Node included.
  if (checker.isTypeAssignableTo(type, checker.getNeverType())) return false;
  if (checker.isTypeAssignableTo(type, node)) return true;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker.getTypeArguments(type as ts.TypeReference).some((element) => holdsNode(checker, element, node, seen));
  }
  return false;
}

function domNodeProgram(files: readonly string[], virtual: ReadonlyMap<string, string>): ts.Program {
  return createGuardProgram([...files, NODE_PROBE], compilerOptions(), new Map([...virtual, [NODE_PROBE, "export type DomNode = Node;"]]));
}

/** Checks `only` (default: every file) inside one program, so slices of a large scan share its parse and binding. */
export function findDomNodeAssertions(roots: readonly string[], virtual: ReadonlyMap<string, string> = new Map(),
  program = domNodeProgram([...new Set([...roots, ...virtual.keys()])], virtual),
  only: readonly string[] = [...new Set([...roots, ...virtual.keys()])]): string[] {
  const checker = program.getTypeChecker();
  const probe = program.getSourceFile(NODE_PROBE)?.statements.find(ts.isTypeAliasDeclaration);
  assert.ok(probe, "the DOM Node probe must compile");
  const node = checker.getTypeAtLocation(probe);
  const violations: string[] = [];
  for (const root of only) {
    const source = program.getSourceFile(root);
    assert.ok(source, `${repoRelative(root)} must be in the guard program`);
    const visit = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) {
        const callee = child.expression;
        const binding = ts.isPropertyAccessExpression(callee) && COMPARISONS.has(callee.name.text)
          ? isAssertModule(checker, callee.expression)
          : ts.isIdentifier(callee) && assertModuleBinding(checker, callee) === "function";
        if (binding && child.arguments.slice(0, 2).some((argument) => holdsNode(checker, checker.getTypeAtLocation(argument), node))) {
          const position = source.getLineAndCharacterOfPosition(child.getStart(source));
          violations.push(`${repoRelative(root)}:${position.line + 1}:${position.character + 1}`);
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(source);
  }
  return violations;
}

describe("DOM node assertions", () => {
  // Type-checking every assert argument takes minutes under V8 coverage; slices of one shared program keep each test in budget.
  const SLICES = 4;
  let scan: { roots: string[]; program: ts.Program } | undefined;
  const scanned = () => { if (scan === undefined) { const roots = scanRoots(); scan = { roots, program: domNodeProgram(roots, new Map()) }; } return scan; };

  it("scans helper-fed DOM tests", () => {
    assert.ok(scanned().roots.includes(resolve(REPO_ROOT, "tests/dashboard/app/startup/startup-gate.test.ts")), "helper-fed DOM tests are scanned");
  }, 120_000);

  it.each(Array.from({ length: SLICES }, (_, slice) => slice))("compares jsdom nodes by identity, never through node:assert equality (slice %i)", (slice) => {
    const { roots, program } = scanned();
    assert.deepEqual(findDomNodeAssertions(roots, new Map(), program, roots.filter((_, index) => index % SLICES === slice)), []);
  }, 120_000);

  it("catches the original search palette focus assertion and its namespace, named, default-alias and strict forms", () => {
    assert.deepEqual(findDomNodeAssertions([], new Map([[PROOF, PROOF_SOURCE]])), [
      "tests/architecture/tooling/dom-node-proof.ts:7:30",
      "tests/architecture/tooling/dom-node-proof.ts:8:59",
      "tests/architecture/tooling/dom-node-proof.ts:9:44",
      "tests/architecture/tooling/dom-node-proof.ts:13:34",
      "tests/architecture/tooling/dom-node-proof.ts:15:34",
      "tests/architecture/tooling/dom-node-proof.ts:17:34",
    ]);
  }, 120_000);

  it("selects a file whose DOM value comes only from a helper and flags its comparison", () => {
    const virtual = new Map([[HELPER_CALLER, HELPER_CALLER_SOURCE], [PLAIN, "export const plain = 1;"]]);
    const roots = selectRoots([HELPER_CALLER, PLAIN].map(repoRelative), (path) => virtual.get(path) ?? "");
    assert.deepEqual(roots.map(repoRelative), ["tests/dashboard/app/startup/dom-node-helper-caller.ts"]);
    assert.deepEqual(findDomNodeAssertions(roots, virtual), ["tests/dashboard/app/startup/dom-node-helper-caller.ts:3:39"]);
  }, 120_000);
});
