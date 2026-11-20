import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { REPO_ROOT } from "../../support/helpers/guard-files.js";

const API = resolve(REPO_ROOT, "src/backend/transports/http/routes/api.ts");
const INGRESS = resolve(dirname(API), "operator-mutation-ingress.ts");
const STATIC_BUNDLE = resolve(dirname(API), "../static-bundle.ts");
const METHODS = new Set(["get", "head", "options", "post", "put", "patch", "delete", "use"]);
const UNCLASSIFIED = new Set(["all", "on", "route", "mount", "basePath"]);

export interface DashboardRouteRegistration {
  readonly method: string;
  readonly path: string;
  readonly firstGuard: string | undefined;
}

function parseModule(file: string, source: string) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  const checker = ts.createProgram([file], options, {
    ...host, getSourceFile: candidate => resolve(candidate) === file ? parsed : undefined,
  }).getTypeChecker();

  function binding(node: ts.Node): ts.Declaration | undefined {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression(node)) return binding(node.expression);
    if (!ts.isIdentifier(node)) return undefined;
    const declaration = checker.getSymbolAtLocation(node)?.declarations?.[0];
    if (declaration !== undefined && ts.isVariableDeclaration(declaration)
      && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
      && declaration.initializer !== undefined) {
      return binding(declaration.initializer) ?? declaration;
    }
    return declaration;
  }

  function imported(node: ts.Node) {
    const declaration = binding(node);
    if (declaration === undefined || !ts.isImportSpecifier(declaration)) return undefined;
    const module = declaration.parent.parent.parent.moduleSpecifier;
    if (!ts.isStringLiteral(module)) return undefined;
    return { module: module.text, name: (declaration.propertyName ?? declaration.name).text };
  }

  return { parsed, binding, imported };
}

/** Walk the Hono instance and its imported registrars in registration order. */
export function dashboardRouteRegistrations(
  entry = API,
  functionName = "createDashboardApp",
  read: (file: string) => string = file => readFileSync(file, "utf8"),
): { registrations: DashboardRouteRegistration[]; violations: string[] } {
  const active = new Set<string>();
  const modules = new Map<string, ReturnType<typeof parseModule>>();
  const registrations: DashboardRouteRegistration[] = [];
  const violations: string[] = [];

  function scan(file: string, name: string, appParameter?: number): void {
    const key = `${file}:${name}`;
    if (active.has(key)) throw new Error(`cyclic dashboard route registration: ${key}`);
    const module = modules.get(file) ?? parseModule(file, read(file));
    modules.set(file, module);
    const registrar = module.parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (registrar === undefined || !ts.isFunctionDeclaration(registrar) || registrar.body === undefined) {
      throw new Error(`dashboard route registrar is missing: ${key}`);
    }
    const body = registrar.body;
    const roots = appParameter === undefined
      ? body.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).filter(declaration => {
        const initializer = declaration.initializer;
        if (initializer === undefined || !ts.isNewExpression(initializer)) return false;
        const target = module.imported(initializer.expression);
        return target?.module === "hono" && target.name === "Hono";
      })
      : registrar.parameters.slice(appParameter, appParameter + 1);
    const [app] = roots;
    if (app === undefined || roots.length !== 1) throw new Error(`expected one Hono binding: ${key}`);

    const relativeFile = (specifier: string): string => resolve(dirname(file), specifier.replace(/\.js$/u, ".ts"));
    const unclassified = (node: ts.Node): void => {
      const { line } = module.parsed.getLineAndCharacterOfPosition(node.getStart());
      violations.push(`${file}:${String(line + 1)} has an unclassified Hono registration: ${node.getText().split("\n", 1)[0]}`);
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && module.binding(node.expression) === app) {
        const method = ts.isPropertyAccessExpression(node) ? node.name.text
          : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (method === undefined || UNCLASSIFIED.has(method) || METHODS.has(method)) {
          const call = node.parent;
          if (!ts.isCallExpression(call) || call.expression !== node) {
            unclassified(node);
            return;
          }
          const ordered = ts.isExpressionStatement(call.parent) && call.parent.parent === body;
          const path = call.arguments[0];
          const handler = call.arguments[1];
          const imported = handler === undefined ? undefined : module.imported(handler);
          const firstGuard = imported !== undefined && relativeFile(imported.module) === INGRESS ? imported.name : undefined;
          const factory = handler !== undefined && ts.isCallExpression(handler) ? module.imported(handler.expression) : undefined;
          const servesStatic = method === "use" && path !== undefined && ts.isStringLiteral(path) && path.text === "*"
            && factory?.name === "staticBundleHandler" && relativeFile(factory.module) === STATIC_BUNDLE;
          if (method === undefined || UNCLASSIFIED.has(method)) unclassified(call);
          else if (!ordered && servesStatic) {
            // Optional static serving contributes no admission middleware.
          } else if (!ordered || path === undefined || !ts.isStringLiteral(path)) unclassified(call);
          else registrations.push({ method, path: path.text,
            firstGuard: method === "use" || call.arguments.length > 2 ? firstGuard : undefined });
        }
      } else if (ts.isCallExpression(node)) {
        const argument = node.arguments.findIndex(value => module.binding(value) === app);
        if (argument !== -1) {
          const imported = module.imported(node.expression);
          const ordered = ts.isExpressionStatement(node.parent) && node.parent.parent === body;
          if (!ordered || imported === undefined || !imported.module.startsWith(".")) unclassified(node);
          else scan(relativeFile(imported.module), imported.name, argument);
        }
      } else if (ts.isVariableDeclaration(node) && node.initializer !== undefined && module.binding(node.initializer) === app
        && (!ts.isIdentifier(node.name) || (node.parent.flags & ts.NodeFlags.Const) === 0)) {
        unclassified(node);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && module.binding(node.right) === app) {
        unclassified(node);
      }
      ts.forEachChild(node, visit);
    };

    active.add(key);
    try { visit(body); }
    finally { active.delete(key); }
  }

  scan(entry, functionName);
  return { registrations, violations };
}

export function publicProfileRouteRegistrations() {
  return dashboardRouteRegistrations(
    resolve(REPO_ROOT, "src/backend/app/composition/dashboard/profile-session-routes.ts"),
    "composeDashboardApplication",
  );
}
