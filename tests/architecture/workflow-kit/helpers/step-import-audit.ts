import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { walkFiles } from "../../support/helpers/guard-files.js";

const NODE_BUILTINS = new Set(builtinModules);
const isNodeBuiltin = (specifier: string) => specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
const repoPath = (root: string, path: string) => relative(root, path).replaceAll("\\", "/");

/** Module specifiers a file loads at runtime; `import type` and `export type` are erased. */
function runtimeImports(source: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] !== undefined
      && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** True when the module calls the task factory under its own name, an import alias, or a namespace import. */
function callsDefineTask(source: ts.SourceFile): boolean {
  const names = new Set(["defineTask"]);
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "defineTask") names.add(element.name.text);
    }
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && names.has(node.expression.text))
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "defineTask"))) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveLocal(fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(fromPath), specifier).replace(/\.js$/u, ".ts");
  return existsSync(target) ? target : undefined;
}

/** Every workflow step module must stay browser-safe: no path through its runtime imports reaches a task implementation or a Node built-in. */
export function auditBrowserSafeSteps(root: string): readonly string[] {
  const parsed = new Map<string, ts.SourceFile>();
  const sourceOf = (path: string) => {
    let source = parsed.get(path);
    if (source === undefined) {
      source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      parsed.set(path, source);
    }
    return source;
  };
  const steps = walkFiles(resolve(root, "src/workflows"))
    .filter(path => /^src\/workflows\/[^/]+\/steps\/.+\.tsx?$/u.test(repoPath(root, path))).sort();
  if (steps.length === 0) throw new Error("browser-safe-steps resolved no step modules under src/workflows/*/steps/");
  const issues: string[] = [];
  for (const step of steps) {
    const via = new Map<string, string | undefined>([[step, undefined]]);
    const queue = [step];
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const source = sourceOf(path);
      const chain = () => {
        const links: string[] = [];
        for (let at: string | undefined = path; at !== undefined; at = via.get(at)) links.unshift(repoPath(root, at));
        return links.join(" -> ");
      };
      if (callsDefineTask(source)) issues.push(`${repoPath(root, step)}: reaches task implementation ${chain()}`);
      for (const specifier of runtimeImports(source)) {
        if (isNodeBuiltin(specifier)) {
          issues.push(`${repoPath(root, step)}: reaches Node built-in ${specifier} via ${chain()}`);
          continue;
        }
        const target = resolveLocal(path, specifier);
        if (target !== undefined && !via.has(target)) { via.set(target, path); queue.push(target); }
      }
    }
  }
  return issues;
}

/** Workflow registration loads every file under src/workflows, so none of them may import a Node built-in; backend processing owns native work. */
export function auditWorkflowNodeImports(root: string): readonly string[] {
  return walkFiles(resolve(root, "src/workflows")).flatMap(path => {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    return runtimeImports(source).filter(isNodeBuiltin).map(specifier => `${repoPath(root, path)}: imports Node built-in ${specifier}`);
  });
}
