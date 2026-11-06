/** Workflow source helpers: the relative-import closure walk (bundle boundary and registry checks) and the declared-id parser shared by the registry generator and the layout guard. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export type SourceHash = Readonly<{ path: string; sha256: string }>;

function posix(path: string): string {
  return path.split("\\").join("/");
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function relativeSpecifiers(sourcePath: string, content: string): readonly string[] {
  const source = ts.createSourceFile(sourcePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers.filter((specifier) => specifier.startsWith("."));
}

function resolveSource(fromFile: string, specifier: string): string {
  const base = resolve(fromFile, "..", specifier);
  const candidates = specifier.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`source closure cannot resolve "${specifier}" from ${fromFile}`);
  }
  return found;
}

const closureSources = new Map<string, { content: string; sha256: SourceHash["sha256"]; specifiers: readonly string[] }>();

/** The closure, sorted by repo-relative path so iteration order cannot leak into the hash. */
export function collectSourceClosure(repoRoot: string, entry: string): readonly SourceHash[] {
  const seen = new Set<string>();
  const sources: SourceHash[] = [];
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const content = readFileSync(file, "utf8").replace(/\r\n/gu, "\n");
    let cached = closureSources.get(file);
    if (cached?.content !== content) {
      cached = { content, sha256: sha256(content), specifiers: relativeSpecifiers(file, content) };
      closureSources.set(file, cached);
    }
    sources.push({ path: posix(relative(repoRoot, file)), sha256: cached.sha256 });
    for (const specifier of cached.specifiers) {
      pending.push(resolveSource(file, specifier));
    }
  }
  return sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Reads the id a descriptor declares, never one inferred from its folder; `workflow-layout` shares this parser so the two readers cannot drift. */
export function declaredWorkflowId(entry: string): string {
  const source = ts.createSourceFile(
    entry, readFileSync(entry, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ids: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const specIndex = node.expression.text === "defineWorkflowDescriptor"
        || node.expression.text === "defineWorkflow"
        || node.expression.text === "defineStep"
        ? 0
        : undefined;
      let spec = specIndex === undefined ? undefined : node.arguments[specIndex];
      if (node.expression.text === "defineStep" && spec !== undefined && ts.isObjectLiteralExpression(spec)) {
        const proof = spec.properties.find(property => ts.isPropertyAssignment(property)
          && property.name.getText(source) === "proof");
        spec = proof !== undefined && ts.isPropertyAssignment(proof) ? proof.initializer : undefined;
      }
      if (spec !== undefined && ts.isObjectLiteralExpression(spec)) {
        for (const property of spec.properties) {
          if (ts.isPropertyAssignment(property)
            && ts.isIdentifier(property.name)
            && property.name.text === "id"
            && ts.isStringLiteral(property.initializer)) {
            ids.push(property.initializer.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const [only] = ids;
  if (ids.length !== 1 || only === undefined) {
    throw new Error(
      `workflow source needs exactly one string-literal descriptor id in ${entry}; found ${String(ids.length)}`,
    );
  }
  return only;
}

