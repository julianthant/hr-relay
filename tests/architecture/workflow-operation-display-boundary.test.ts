import { describe, expect, it } from "vitest";
import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { compileWorkflowOperationDisplay } from "../../src/domain/workflow/operation-display.js";
import {
  freezeWorkflowOperationDisplaySnapshot,
  requireWorkflowOperationDisplaySnapshot,
  WorkflowOperationDisplaySnapshotSchema,
} from "../../src/domain/workflow/operation-display-snapshot.js";
import { REPO_ROOT, repoRelative } from "./helpers/guard-files.js";

const NODE_BUILTINS = new Set(builtinModules);
const DISPLAY_DECLARATION = "src/domain/workflow/operation-display.ts";
const DISPLAY_SNAPSHOT = "src/domain/workflow/operation-display-snapshot.ts";

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
    expect(auditOperationDisplayImportClosure(DISPLAY_SNAPSHOT)).toEqual([]);
  });

  it("detects both classes of forbidden runtime reach", () => {
    expect(auditOperationDisplayImportClosure("src/backend/app/config/resolve.ts"))
      .toContain("src/backend/app/config/resolve.ts imports Node builtin node:crypto");
    expect(auditOperationDisplayImportClosure("src/stores/ucpath/driver/person-org-operation.ts"))
      .toContain("src/stores/ucpath/driver/person-org-operation.ts is a store/driver implementation");
  });
});


function completeSnapshot() {
  const identity = { workflowId: "fixture-display-boundary", definitionFingerprint: "a".repeat(64) };
  const display = compileWorkflowOperationDisplay({
    workflowId: identity.workflowId,
    input: z.strictObject({}),
    entries: [{ id: "approval", kind: "gate", dependsOn: [], contracts: [] }],
    declaration: {
      capability: "complete",
      version: 1,
      invocations: [],
      presentation: [{ id: "approval", kind: "operator-gate", entryId: "approval" }],
    },
  });
  const snapshot = freezeWorkflowOperationDisplaySnapshot({ ...identity, display });
  if (snapshot === undefined) throw new Error("compiler-produced complete display must freeze");
  return { identity, snapshot };
}

describe("workflow operation display durable boundary", () => {
  it("round-trips a compiler-produced snapshot through the real strict integrity reader", () => {
    const { identity, snapshot } = completeSnapshot();
    const reopened = requireWorkflowOperationDisplaySnapshot(JSON.parse(canonicalJsonStringify(snapshot)), identity);
    expect(reopened).toEqual(snapshot);
    expect(reopened.presentation).toEqual([{ id: "approval", kind: "operator-gate", entryId: "approval" }]);
    expect(reopened.execution).toEqual([{ entryId: "approval", dependsOn: [] }]);
  });

  it("refuses a forged complete projection before it can cross the durable boundary", () => {
    expect(() => freezeWorkflowOperationDisplaySnapshot({
      workflowId: "fixture-display-boundary",
      definitionFingerprint: "a".repeat(64),
      display: { capability: "complete", version: 1, transforms: [], invocations: [], presentation: [], execution: [] },
    })).toThrow(/compiler-produced complete projection/u);
  });

  it("refuses unknown nested fields and executable values at the snapshot schema", () => {
    const { identity, snapshot } = completeSnapshot();
    const invalid = [
      { ...snapshot, presentation: snapshot.presentation.map((node) => ({ ...node, undeclared: "value" })) },
      { ...snapshot, presentation: snapshot.presentation.map((node) => ({ ...node, id: () => "approval" })) },
      { ...snapshot, presentation: snapshot.presentation.map((node) => ({ ...node, children: [{ ...node, undeclared: "value" }] })) },
      { ...snapshot, presentation: snapshot.presentation.map((node) => ({ ...node, children: [{ ...node, id: () => "approval" }] })) },
      { ...snapshot, execution: snapshot.execution.map((entry) => ({ ...entry, undeclared: "value" })) },
      { ...snapshot, execution: snapshot.execution.map((entry) => ({ ...entry, dependsOn: [() => "approval"] })) },
    ];
    for (const stored of invalid) {
      expect(WorkflowOperationDisplaySnapshotSchema.safeParse(stored).success).toBe(false);
      expect(() => requireWorkflowOperationDisplaySnapshot(stored, identity)).toThrow(/corrupt frozen operation display snapshot/u);
    }
  });

  it("refuses missing complete structure, wrong identity and altered digest", () => {
    const { identity, snapshot } = completeSnapshot();
    expect(() => requireWorkflowOperationDisplaySnapshot(undefined, identity)).toThrow(/missing its frozen operation display snapshot/u);
    expect(() => requireWorkflowOperationDisplaySnapshot(snapshot, { ...identity, workflowId: "fixture-other-display" }))
      .toThrow(/identity does not match/u);
    expect(() => requireWorkflowOperationDisplaySnapshot(snapshot, { ...identity, definitionFingerprint: "b".repeat(64) }))
      .toThrow(/identity does not match/u);
    expect(() => requireWorkflowOperationDisplaySnapshot({ ...snapshot, contentDigest: "0".repeat(64) }, identity))
      .toThrow(/corrupt frozen operation display snapshot digest/u);
    expect(() => requireWorkflowOperationDisplaySnapshot({ ...snapshot, presentation: [] }, identity))
      .toThrow(/corrupt frozen operation display snapshot digest/u);
  });
});
