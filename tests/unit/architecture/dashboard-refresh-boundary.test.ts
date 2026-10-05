/**
 * Ref frontend-backend-integration §8.14 — React Fast Refresh boundary purity for the dashboard's surfaces.
 *
 * `@vitejs/plugin-react` accepts a module as a Fast Refresh boundary only when
 * EVERY export is a likely component (an uppercase-named function, or a
 * `memo`/`forwardRef`/`lazy` wrapper) or is reference-equal across the module's
 * re-evaluation (`validateRefreshBoundaryAndEnqueueUpdate` in its refresh
 * runtime). A helper, a hook, or an object/array constant exported beside a
 * component is a NEW reference every save, so the module is refused as a
 * boundary and the invalidation climbs to the nearest importer that qualifies
 * — for every surface, that is `dashboard-app.tsx`, and the whole app remounts
 * and loses its state on each edit.
 *
 * The rule this guard holds: a surface module (`src/dashboard/surfaces/*.tsx`,
 * `src/dashboard/app/*.tsx`) exports components only. Its hooks, folds,
 * vocabularies and object constants live in a sibling `<surface>-model.ts`
 * (types are erased and stay legal anywhere). `src/dashboard/ds/**` is
 * deliberately OUT of scope: `ui.tsx` is the design system's one barrel and
 * mixes primitives with token exports by design; an edit there remounting the
 * app is the accepted cost of one import for the whole system.
 *
 * Both arms run against checked-in fixtures — one that violates in each way the
 * rule can be broken, one that is clean — so a walker that resolved nothing
 * could not pass.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

const SURFACE_ROOTS = ["src/dashboard/surfaces", "src/dashboard/app"] as const;
const COMPONENT_FACTORIES = new Set(["memo", "forwardRef", "lazy"]);
const FIXTURE_ROOT = "tests/unit/architecture/fixtures";

const isComponentName = (name: string): boolean => /^[A-Z]/.test(name);

function isComponentInitializer(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined;
    return name !== undefined && COMPONENT_FACTORIES.has(name);
  }
  return false;
}

/** Every exported binding of `text` that would stop Fast Refresh at this module. */
export function refreshBoundaryViolations(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const exported = (s: ts.Statement): boolean =>
    ts.canHaveModifiers(s)
    && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const topLevel = new Map<string, ts.Statement>();
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) topLevel.set(s.name.text, s);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) topLevel.set(d.name.text, s);
    }
  }
  const judgeValue = (name: string, s: ts.Statement | undefined, via: string): void => {
    if (!isComponentName(name)) {
      out.push(`${via}: \`${name}\` is an exported non-component value (lowercase name)`);
      return;
    }
    if (s !== undefined && ts.isVariableStatement(s)) {
      const decl = s.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
      if (decl !== undefined && !isComponentInitializer(decl.initializer)) {
        out.push(`${via}: \`${name}\` is an exported value that is not a component function`);
      }
    }
  };
  for (const s of sf.statements) {
    if (ts.isExportAssignment(s)) { out.push("default export"); continue; }
    if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      if (s.exportClause === undefined || !ts.isNamedExports(s.exportClause)) {
        out.push("`export *` cannot be verified as components-only");
        continue;
      }
      for (const el of s.exportClause.elements) {
        if (el.isTypeOnly) continue;
        const local = (el.propertyName ?? el.name).text;
        judgeValue(el.name.text, topLevel.get(local), "named export");
      }
      continue;
    }
    if (!exported(s)) continue;
    if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) continue;
    if (ts.isEnumDeclaration(s)) { out.push(`\`${s.name.text}\`: an exported enum is a runtime object`); continue; }
    if (ts.isFunctionDeclaration(s) && s.name) { judgeValue(s.name.text, s, "function"); continue; }
    if (ts.isClassDeclaration(s) && s.name) { judgeValue(s.name.text, s, "class"); continue; }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) judgeValue(d.name.text, s, "const");
        else out.push("destructured export cannot be verified as components-only");
      }
    }
  }
  return out;
}

function surfaceFiles(): string[] {
  return SURFACE_ROOTS.flatMap(root => walkFiles(join(REPO_ROOT, root), { extensions: [".tsx"] }).map(file => relative(REPO_ROOT, file)));
}

describe("dashboard refresh boundary (ref frontend-backend-integration §8.14)", () => {
  it("every surface and app module exports components only", () => {
    const files = surfaceFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("src/dashboard/surfaces/settings/preflight/settings-preflight.tsx");
    expect(files).toContain("src/dashboard/surfaces/run-detail/log-panel.tsx");
    const report = files.flatMap((file) => {
      const violations = refreshBoundaryViolations(file, readFileSync(join(REPO_ROOT, file), "utf8"));
      return violations.map((v) => `${relative(REPO_ROOT, join(REPO_ROOT, file))}: ${v}`);
    });
    expect(report).toEqual([]);
  });

  it("catches the violating fixture in every way the rule can break, and passes the clean one", () => {
    const bad = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "refresh-boundary-violation.tsx"), "utf8");
    const violations = refreshBoundaryViolations("refresh-boundary-violation.tsx", bad);
    expect(violations).toEqual([
      "function: `useThing` is an exported non-component value (lowercase name)",
      "function: `helper` is an exported non-component value (lowercase name)",
      "const: `TONE` is an exported value that is not a component function",
      "const: `KINDS` is an exported value that is not a component function",
      "named export: `reexported` is an exported non-component value (lowercase name)",
    ]);
    const clean = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "refresh-boundary-clean.tsx"), "utf8");
    expect(refreshBoundaryViolations("refresh-boundary-clean.tsx", clean)).toEqual([]);
  });
});
