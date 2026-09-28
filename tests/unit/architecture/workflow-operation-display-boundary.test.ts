import { describe, expect, it } from "vitest";
import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { REPO_ROOT, repoRelative } from "./helpers/guard-files.js";

const NODE_BUILTINS = new Set(builtinModules);
const DISPLAY_DECLARATION = "src/domain/workflow/operation-display.ts";

function isTypeOnlyImport(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  const clause = statement.importClause;
  if (clause?.isTypeOnly === true) return true;
  const bindings = clause?.namedBindings;
  return clause?.name === undefined
    && bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.length > 0
    && bindings.elements.every((element) => element.isTypeOnly);
}

function bundledSpecifiers(file: string): readonly string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && !isTypeOnlyImport(statement)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier) && !isTypeOnlyImport(statement)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveSourceFile(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(from, "..", specifier);
  const candidates = base.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate));
}

function forbiddenRuntimePath(file: string): string | undefined {
  const relative = repoRelative(file);
  if (relative.startsWith("src/stores/")) return "store/driver implementation";
  if (relative.startsWith("src/infra/browser/")) return "browser runtime implementation";
  return undefined;
}

/** The declaration's runtime import closure must remain browser-safe by itself. */
export function auditOperationDisplayImportClosure(entry: string): readonly string[] {
  const root = resolve(REPO_ROOT, entry);
  const seen = new Set<string>();
  const pending = [root];
  const violations: string[] = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const forbidden = forbiddenRuntimePath(file);
    if (forbidden !== undefined) violations.push(`${repoRelative(file)} is a ${forbidden}`);
    for (const specifier of bundledSpecifiers(file)) {
      if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier)) {
        violations.push(`${repoRelative(file)} imports Node builtin ${specifier}`);
        continue;
      }
      const target = resolveSourceFile(file, specifier);
      if (target !== undefined) pending.push(target);
    }
  }
  return violations.sort();
}

describe("workflow operation display browser boundary", () => {
  it("keeps the bundle-safe declaration closure free of Node and driver imports", () => {
    expect(auditOperationDisplayImportClosure(DISPLAY_DECLARATION)).toEqual([]);
  });

  it("detects both classes of forbidden runtime reach", () => {
    expect(auditOperationDisplayImportClosure("src/domain/config/resolve.ts"))
      .toContain("src/domain/config/resolve.ts imports Node builtin node:crypto");
    expect(auditOperationDisplayImportClosure("src/stores/ucpath/driver/person-org-operation.ts"))
      .toContain("src/stores/ucpath/driver/person-org-operation.ts is a store/driver implementation");
  });
});
