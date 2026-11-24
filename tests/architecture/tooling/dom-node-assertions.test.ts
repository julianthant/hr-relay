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
const ASSERT_MODULES = new Set(["node:assert", "node:assert/strict", "assert", "assert/strict"]);
const NODE_PROBE = resolve(REPO_ROOT, "tests/architecture/tooling/dom-node-probe.ts");
const PROOF = resolve(REPO_ROOT, "tests/architecture/tooling/dom-node-proof.ts");

const PROOF_SOURCE = [
  'import assert from "node:assert/strict";',
  'import * as nodeAssert from "node:assert";',
  'import { deepEqual } from "node:assert/strict";',
  'const trigger = () => document.querySelector<HTMLButtonElement>(\'button[aria-label="Search"]\')!;',
  "export function original() { assert.equal(document.activeElement, trigger()); }",
  "export function namespace(rows: readonly HTMLElement[]) { nodeAssert.deepStrictEqual(rows, []); }",
  "export function named(node: Node | null) { deepEqual(node, null); }",
  "export function identity() { assert.equal(document.activeElement === trigger(), true); }",
  "export function property() { assert.equal(document.activeElement?.getAttribute(\"aria-label\"), \"Search\"); }",
  "export function truthy() { assert.ok(document.activeElement); }",
].join("\n");

function scanRoots(): string[] {
  return gitVisibleFiles(["tests"])
    .filter((path) => /\.tsx?$/u.test(path) && !path.startsWith("tests/architecture/"))
    .filter((path) => {
      const text = readFileSync(resolve(REPO_ROOT, path), "utf8");
      return /["']node:assert(\/strict)?["']|["']assert(\/strict)?["']/u.test(text) && /\bdocument\b|\bElement\b|\bNode\b/u.test(text);
    })
    .map((path) => resolve(REPO_ROOT, path));
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
  if (ts.isImportSpecifier(declaration)) return COMPARISONS.has((declaration.propertyName ?? declaration.name).text) ? "function" : undefined;
  return undefined;
}

function holdsNode(checker: ts.TypeChecker, type: ts.Type, node: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
  if (type.isUnion()) return type.types.some((member) => holdsNode(checker, member, node, seen));
  if (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return false;
  if (checker.isTypeAssignableTo(type, node)) return true;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker.getTypeArguments(type as ts.TypeReference).some((element) => holdsNode(checker, element, node, seen));
  }
  return false;
}

export function findDomNodeAssertions(roots: readonly string[], virtual: ReadonlyMap<string, string> = new Map()): string[] {
  const sources = new Map([...virtual, [NODE_PROBE, "export type DomNode = Node;"]]);
  const program = createGuardProgram([...roots, ...virtual.keys(), NODE_PROBE], compilerOptions(), sources);
  const checker = program.getTypeChecker();
  const probe = program.getSourceFile(NODE_PROBE)?.statements.find(ts.isTypeAliasDeclaration);
  assert.ok(probe, "the DOM Node probe must compile");
  const node = checker.getTypeAtLocation(probe);
  const violations: string[] = [];
  for (const root of [...roots, ...virtual.keys()]) {
    const source = program.getSourceFile(root);
    assert.ok(source, `${repoRelative(root)} must be in the guard program`);
    const visit = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) {
        const callee = child.expression;
        const binding = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && COMPARISONS.has(callee.name.text)
          ? assertModuleBinding(checker, callee.expression) === "module"
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
  it("compares jsdom nodes by identity, never through node:assert equality", () => {
    const roots = scanRoots();
    assert.ok(roots.length > 0, "the scan must resolve DOM test files");
    assert.deepEqual(findDomNodeAssertions(roots), []);
  }, 120_000);

  it("catches the original search palette focus assertion and its namespace and named forms", () => {
    assert.deepEqual(findDomNodeAssertions([], new Map([[PROOF, PROOF_SOURCE]])), [
      "tests/architecture/tooling/dom-node-proof.ts:5:30",
      "tests/architecture/tooling/dom-node-proof.ts:6:59",
      "tests/architecture/tooling/dom-node-proof.ts:7:44",
    ]);
  }, 120_000);
});
