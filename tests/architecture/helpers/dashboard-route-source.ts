import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { REPO_ROOT } from "./guard-files.js";

/** Expand imported route registrations at their call sites, preserving middleware order. */
export function dashboardRouteSource(
  entry = resolve(REPO_ROOT, "src/backend/transports/dashboard/routes/api.ts"),
  read: (file: string) => string = file => readFileSync(file, "utf8"),
): string {
  const active = new Set<string>();
  function expand(file: string, functionName?: string): string {
    const key = `${file}:${functionName ?? "module"}`;
    if (active.has(key)) throw new Error(`cyclic dashboard route registration: ${key}`);
    active.add(key);
    try {
      const source = read(file);
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const imports = new Map<string, { file: string; name: string }>();
      for (const node of parsed.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)
          || !node.moduleSpecifier.text.startsWith(".")) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
        for (const binding of bindings.elements) {
          imports.set(binding.name.text, {
            file: resolve(dirname(file), node.moduleSpecifier.text.replace(/\.js$/u, ".ts")),
            name: binding.propertyName?.text ?? binding.name.text,
          });
        }
      }
      const declaration = functionName === undefined ? undefined : parsed.statements.find(node =>
        ts.isFunctionDeclaration(node) && node.name?.text === functionName);
      if (functionName !== undefined && (declaration === undefined
        || !ts.isFunctionDeclaration(declaration) || declaration.body === undefined)) {
        throw new Error(`dashboard route registrar is missing: ${key}`);
      }
      const body = declaration !== undefined && ts.isFunctionDeclaration(declaration)
        ? declaration.body : undefined;
      const start = body?.getStart(parsed) ?? 0;
      const end = body?.end ?? source.length;
      const replacements: { start: number; end: number; text: string }[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.arguments.some(argument => ts.isIdentifier(argument) && argument.text === "app")) {
          const target = imports.get(node.expression.expression.text);
          if (target === undefined) throw new Error(`unbound dashboard registrar: ${node.getText(parsed)}`);
          replacements.push({ start: node.getStart(parsed), end: node.end, text: expand(target.file, target.name) });
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(body ?? parsed);
      let result = source.slice(start, end);
      for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, replacement.start - start) + replacement.text
          + result.slice(replacement.end - start);
      }
      return result;
    } finally {
      active.delete(key);
    }
  }
  return expand(entry);
}
