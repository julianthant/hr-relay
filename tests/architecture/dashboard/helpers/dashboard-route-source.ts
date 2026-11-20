import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { REPO_ROOT } from "../../support/helpers/guard-files.js";

const API = resolve(REPO_ROOT, "src/backend/transports/http/routes/api.ts");
const PROFILE_API = resolve(REPO_ROOT, "src/backend/app/composition/dashboard/profile-session-routes.ts");
const HTTP_SERVER = resolve(dirname(API), "../http-server.ts");
const INGRESS = resolve(dirname(API), "operator-mutation-ingress.ts");
const STATIC_BUNDLE = resolve(dirname(API), "../static-bundle.ts");
const METHODS = new Set(["get", "head", "options", "post", "put", "patch", "delete", "use"]);
const CALLBACKS = new Set(["onError", "notFound"]);

export interface DashboardRouteRegistration {
  readonly method: string;
  readonly path: string;
  readonly firstGuard: string | undefined;
}

function unwrap(node: ts.Node): ts.Node {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)) return unwrap(node.expression);
  return node;
}

function parseModule(file: string, source: string) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  const checker = ts.createProgram([file], options, {
    ...host, getSourceFile: candidate => resolve(candidate) === file ? parsed : undefined,
  }).getTypeChecker();

  function binding(expression: ts.Node): ts.Declaration | undefined {
    const node = unwrap(expression);
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    const declaration = symbol?.declarations?.[0];
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
    if (app === undefined || roots.length !== 1 || !ts.isIdentifier(app.name)
      || (ts.isParameter(app) && app.dotDotDotToken !== undefined)) {
      throw new Error(`expected one Hono binding: ${key}`);
    }

    const relativeFile = (specifier: string): string => resolve(dirname(file), specifier.replace(/\.js$/u, ".ts"));
    const unclassified = (node: ts.Node, shape = "registration"): void => {
      const { line } = module.parsed.getLineAndCharacterOfPosition(node.getStart());
      violations.push(`${file}:${String(line + 1)} has an unclassified Hono ${shape}: ${node.getText().split("\n", 1)[0]}`);
    };
    const classified = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && module.binding(node.expression) === app) {
        classified.add(unwrap(node.expression));
        const method = ts.isPropertyAccessExpression(node) ? node.name.text
          : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
        const call = node.parent;
        if (!ts.isCallExpression(call) || call.expression !== node || method === undefined) {
          unclassified(node);
        } else if (METHODS.has(method)) {
          const ordered = ts.isExpressionStatement(call.parent) && call.parent.parent === body;
          const path = call.arguments[0];
          const handler = call.arguments[1];
          const imported = handler === undefined ? undefined : module.imported(handler);
          const firstGuard = imported !== undefined && relativeFile(imported.module) === INGRESS ? imported.name : undefined;
          const factory = handler !== undefined && ts.isCallExpression(handler) ? module.imported(handler.expression) : undefined;
          const servesStatic = method === "use" && path !== undefined && ts.isStringLiteral(path) && path.text === "*"
            && factory?.name === "staticBundleHandler" && relativeFile(factory.module) === STATIC_BUNDLE;
          if (!ordered && servesStatic) {
            // Optional static serving contributes no admission middleware.
          } else if (!ordered || path === undefined || !ts.isStringLiteral(path)) unclassified(call);
          else registrations.push({ method, path: path.text,
            firstGuard: method === "use" || call.arguments.length > 2 ? firstGuard : undefined });
        } else if (!CALLBACKS.has(method)) {
          unclassified(call);
        }
      } else if (ts.isCallExpression(node)) {
        const appArgs = node.arguments.flatMap((argument, index) => module.binding(argument) === app ? [{ argument, index }] : []);
        const [first] = appArgs;
        if (first !== undefined) {
          for (const { argument } of appArgs) classified.add(unwrap(argument));
          const imported = module.imported(node.expression);
          const ordered = ts.isExpressionStatement(node.parent) && node.parent.parent === body;
          if (appArgs.length !== 1 || !ordered || imported === undefined || !imported.module.startsWith(".")) unclassified(node);
          else scan(relativeFile(imported.module), imported.name, first.index);
        }
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && (node.parent.flags & ts.NodeFlags.Const) !== 0
        && node.initializer !== undefined && module.binding(node.initializer) === app) {
        classified.add(unwrap(node.initializer));
      } else if (ts.isReturnStatement(node) && file === API && name === "createDashboardApp"
        && node === body.statements.at(-1) && node.expression !== undefined && module.binding(node.expression) === app) {
        // The API factory returns the audited instance to the existing composition.
        classified.add(unwrap(node.expression));
      } else if (ts.isShorthandPropertyAssignment(node) && file === PROFILE_API && name === "composeDashboardApplication"
        && module.binding(node.name) === app && ts.isCallExpression(node.parent.parent)) {
        const call = node.parent.parent;
        const listener = module.imported(call.expression);
        if (call.arguments[0] === node.parent && listener?.name === "startDashboardHttpServer"
          && relativeFile(listener.module) === HTTP_SERVER) classified.add(node.name);
      } else if (ts.isIdentifier(node) && !classified.has(node) && module.binding(node) === app
        && !((ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent)) && node.parent.name === node)) {
        unclassified(node, "binding use");
      }
      ts.forEachChild(node, visit);
    };

    active.add(key);
    try {
      for (const parameter of registrar.parameters) visit(parameter);
      visit(body);
    } finally {
      active.delete(key);
    }
  }

  scan(entry, functionName);
  return { registrations, violations };
}

export function publicProfileRouteRegistrations() {
  return dashboardRouteRegistrations(PROFILE_API, "composeDashboardApplication");
}
