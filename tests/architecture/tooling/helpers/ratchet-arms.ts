import { createHash } from "node:crypto";
import { REVIEWED_CATCH_DEFAULTS } from "./reviewed-catch-defaults.js";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";
import { walkFiles } from "../../support/helpers/guard-files.js";

export const REQUIRED_REBUILD_RATCHET_NAMES = [
  "fail-loud-catch-default",
  "nullish-literal-data-fallback",
  "wait-for-timeout-allowlist",
  "inline-selectors-workflows",
  "evaluate-named-fn",
  "import-cycles",
  "control-layering",
  "code-conventions",
  "frontend-tailwind-compliance",
] as const;

export type RebuildRatchetName = typeof REQUIRED_REBUILD_RATCHET_NAMES[number];

export interface RebuildRatchetFixture {
  readonly files: Readonly<Record<string, string>>;
  readonly expected: RegExp;
}

interface RebuildRatchetSpec {
  readonly roots: readonly string[];
  readonly select?: (repoRelativePath: string) => boolean;
  readonly fixture: RebuildRatchetFixture;
}

export interface RebuildRatchetAudit {
  readonly state: "planned-absent" | "active";
  readonly files: readonly string[];
  readonly violations: readonly string[];
}

const SPECS: Readonly<Record<RebuildRatchetName, RebuildRatchetSpec>> = {
  "fail-loud-catch-default": {
    roots: ["src"],
    fixture: {
      files: { "src/core/bad.ts": "export function bad() { try { throw new Error(); } catch { return []; } }\n" },
      expected: /bare default/,
    },
  },
  "nullish-literal-data-fallback": {
    roots: ["src"],
    select: (path) => !path.startsWith("src/dashboard/"),
    fixture: {
      files: { "src/core/bad.ts": "export const bad = (data: { state?: string }) => data.state ?? \"queued\";\n" },
      expected: /nullish literal/,
    },
  },
  "wait-for-timeout-allowlist": {
    roots: ["src/backend/systems", "src/backend/processing", "src/workflows"],
    fixture: {
      files: {
        "src/stores/ucpath/tasks/bad.ts": "export const bad = async (page: any) => page.waitForTimeout(25);\n",
        "src/backend/systems/ucpath/tasks/bad.ts": "export const bad = async (page: any) => page.waitForTimeout(25);\n",
      },
      expected: /waitForTimeout/,
    },
  },
  // The inline-selector arm covers tasks; driver recipe anchors enforce the separate driver contract.
  "inline-selectors-workflows": {
    roots: ["src/backend/systems", "src/backend/processing", "src/workflows"],
    select: (path) => path.includes("/tasks/"),
    fixture: {
      files: {
        "src/stores/ucpath/tasks/bad.ts": "export const bad = (page: any) => page.locator(\"#employee\");\n",
        "src/backend/systems/ucpath/tasks/bad.ts": "export const bad = (page: any) => page.locator(\"#employee\");\n",
      },
      expected: /raw page\/locator/,
    },
  },
  "evaluate-named-fn": {
    roots: ["src/backend/systems", "src/backend/processing", "src/workflows"],
    fixture: {
      files: {
        "src/stores/ucpath/driver/bad.ts": "export const bad = (page: any) => page.evaluate(function named() { return true; });\n",
        "src/backend/systems/ucpath/driver/bad.ts": "export const bad = (page: any) => page.evaluate(function named() { return true; });\n",
      },
      expected: /named evaluated function/,
    },
  },
  "import-cycles": {
    roots: ["src"],
    fixture: {
      files: {
        "src/domain/a.ts": "import { b } from \"./b.js\"; export const a = b;\n",
        "src/domain/b.ts": "import { a } from \"./a.js\"; export const b = a;\n",
      },
      expected: /import cycle/,
    },
  },
  "control-layering": {
    roots: ["src"],
    fixture: {
      files: {
        "src/domain/bad.ts": "import { core } from \"../core/core.js\"; export const bad = core;\n",
        "src/core/core.ts": "export const core = true;\n",
      },
      expected: /layer inversion/,
    },
  },
  "code-conventions": {
    roots: ["src"],
    fixture: {
      // The escape becomes a real NUL when the fixture is written; the control must probe bytes, not escape spelling.
      files: {
        "src/core/Bad_name.ts": "const value = true; export default value;\n",
        "src/core/nul-carrier.ts": "export const separator = \"\u0000\";\n",
      },
      expected: /(?=[\s\S]*(?:default export|filename))(?=[\s\S]*raw control byte)/,
    },
  },
  "frontend-tailwind-compliance": {
    roots: ["src/dashboard"],
    fixture: {

      files: {
        "src/dashboard/Bad.tsx": [
          "export function Bad() {",
          "  return (",
          "    <div className=\"bg-red-500 z-[9999]\">",
          "      <span className=\"animate-spin\" />",
          "      <img src=\"x.png\" />",
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n"),
      },
      expected: /(?=[\s\S]*palette color)(?=[\s\S]*arbitrary z-index)(?=[\s\S]*reduced-motion)(?=[\s\S]*image without alt)/,
    },
  },
};

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return parseContent(file, readFileSync(file, "utf8"), kind);
}

const parsedSources = new Map<string, { kind: ts.ScriptKind; source: ts.SourceFile }>();

function parseContent(file: string, content: string, kind?: ts.ScriptKind): ts.SourceFile {
  const scriptKind = kind ?? (file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const cached = parsedSources.get(file);
  if (cached?.kind === scriptKind && cached.source.text === content) return cached.source;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  parsedSources.set(file, { kind: scriptKind, source });
  return source;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function isBareDefault(node: ts.Expression): boolean {
  let expression = node;
  while (ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression)
    || ts.isNonNullExpression(expression)) {
    expression = expression.expression;
  }
  return expression.kind === ts.SyntaxKind.NullKeyword
    || expression.kind === ts.SyntaxKind.TrueKeyword
    || expression.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isIdentifier(expression) && expression.text === "undefined")
    || (ts.isNumericLiteral(expression) && expression.text === "0")
    || (ts.isStringLiteral(expression) && expression.text === "")
    || (ts.isArrayLiteralExpression(expression) && expression.elements.length === 0)
    || (ts.isObjectLiteralExpression(expression) && expression.properties.length === 0);
}

function visitHandlerBody(node: ts.Node, callback: (node: ts.Node) => void, root: ts.Node): void {
  callback(node);
  ts.forEachChild(node, (child) => {
    if (child !== root && (ts.isFunctionLike(child) || ts.isCatchClause(child))) return;
    visitHandlerBody(child, callback, root);
  });
}

function defaultUsesInHandler(root: ts.Block): readonly string[] {
  const uses: string[] = [];
  visitHandlerBody(root, (node) => {
    if (ts.isReturnStatement(node) && node.expression && isBareDefault(node.expression)) {
      uses.push("returns");
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && isBareDefault(node.right)) {
      uses.push("assigns");
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isBareDefault(node.initializer)) {
      uses.push("initializes");
    }
  }, root);
  return uses;
}

export function auditFailLoudCatchDefaults(path: string, content: string): readonly string[] {
  const violations: string[] = [];
  visit(parseContent(path, content), (node) => {
    if (ts.isCatchClause(node)) {
      for (const use of defaultUsesInHandler(node.block)) {
        violations.push(`${path}: catch ${use} a bare default`);
      }
    }
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
      || node.expression.name.text !== "catch") return;
    const handler = node.arguments[0];
    if (!handler || (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))) return;
    if (ts.isBlock(handler.body)) {
      for (const use of defaultUsesInHandler(handler.body)) {
        violations.push(`${path}: promise catch ${use} a bare default`);
      }
    } else if (isBareDefault(handler.body)) {
      violations.push(`${path}: promise catch returns a bare default`);
    }
  });
  return violations;
}

function auditBareDefaults(files: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const content=readFileSync(file, "utf8");
    const findings=auditFailLoudCatchDefaults(file,content);
    const reviewed=REVIEWED_CATCH_DEFAULTS.find(entry=>normalize(file).endsWith(`/${entry.path}`));
    if (reviewed !== undefined && createHash("sha256").update(content).digest("hex") === reviewed.sha256) {
      if (findings.length === 0) violations.push(`${file}: stale reviewed catch classification`);
    } else violations.push(...findings, ...(reviewed === undefined ? [] : [`${file}: reviewed catch source changed; re-review required`]));
  }
  return violations;
}

function auditNullish(files: readonly string[]): string[] {
  const roots = new Set(["data", "row", "input", "item", "entry", "record", "payload", "fields", "opts", "args"]);
  const violations: string[] = [];
  for (const file of files) {
    visit(parse(file), (node) => {
      if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return;
      let left: ts.Expression = node.left;
      while (ts.isPropertyAccessExpression(left)) left = left.expression;
      const literal = ts.isStringLiteral(node.right)
        || (ts.isNumericLiteral(node.right) && node.right.text === "0")
        || node.right.kind === ts.SyntaxKind.TrueKeyword;
      if (literal && ts.isIdentifier(left) && roots.has(left.text)) {
        violations.push(`${file}: data-shaped nullish literal fallback`);
      }
    });
  }
  return violations;
}

function auditCalls(files: readonly string[], names: ReadonlySet<string>, message: string): string[] {
  const violations: string[] = [];
  for (const file of files) {
    visit(parse(file), (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && names.has(node.expression.name.text)) violations.push(`${file}: ${message}`);
    });
  }
  return violations;
}

function auditInlineSelectors(files: readonly string[]): string[] {
  const methods = new Set(["locator", "getByRole", "getByText", "getByLabel", "getByTestId", "frameLocator"]);
  const violations = auditCalls(files, methods, "raw page/locator call in task implementation");
  for (const file of files) {
    visit(parse(file), (node) => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
        && (node.typeName.text === "Page" || node.typeName.text === "Locator")) {
        violations.push(`${file}: raw page/locator type in task implementation`);
      }
    });
  }
  return violations;
}

function auditEvaluate(files: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    visit(parse(file), (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
        || !["evaluate", "evaluateAll"].includes(node.expression.name.text)) return;
      const callback = node.arguments[0];
      if (callback && ts.isFunctionExpression(callback) && callback.name) {
        violations.push(`${file}: named evaluated function ${callback.name.text}`);
      }
    });
  }
  return violations;
}

function moduleSpecifiers(file: string, runtimeOnly = false): string[] {
  const specs: string[] = [];
  visit(parse(file), (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (runtimeOnly) {
        if (ts.isImportDeclaration(node) && node.importClause !== undefined) {
          if (node.importClause.isTypeOnly) return;
          const bindings=node.importClause.namedBindings;
          if (node.importClause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings)
            && bindings.elements.length > 0 && bindings.elements.every(element=>element.isTypeOnly)) return;
        }
        if (ts.isExportDeclaration(node) && (node.isTypeOnly || (node.exportClause !== undefined && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element=>element.isTypeOnly)))) return;
      }
      specs.push(node.moduleSpecifier.text);
    }
  });
  return specs;
}

function resolveModule(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const raw = resolve(dirname(file), specifier);
  const candidates = [raw, raw.replace(/\.js$/, ".ts"), raw.replace(/\.js$/, ".tsx"), resolve(raw, "index.ts")];
  return candidates.find(existsSync);
}

function auditCycles(files: readonly string[]): string[] {
  const fileSet = new Set(files.map((file) => resolve(file)));
  const edges = new Map<string, string[]>();
  for (const file of files) {
    edges.set(resolve(file), moduleSpecifiers(file, true)
      .map((specifier) => resolveModule(file, specifier))
      .filter((target): target is string => target !== undefined && fileSet.has(resolve(target)))
      .map((target) => resolve(target)));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const violations: string[] = [];
  function walk(node: string, path: readonly string[]): void {
    if (visiting.has(node)) {
      violations.push(`import cycle: ${[...path, node].map((item) => basename(item)).join(" -> ")}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of edges.get(node) ?? []) walk(target, [...path, node]);
    visiting.delete(node);
    visited.add(node);
  }
  for (const file of files) walk(resolve(file), []);
  return violations;
}

const LAYERS = new Map([
  ["base", 0], ["domain", 0], ["validation", 0],
  ["infra", 1], ["services", 1], ["systems", 1], ["stores", 1],
  ["core", 2],
  ["control", 3], ["workflows", 3], ["server", 3],
]);

function layer(path: string): number | undefined {
  const parts = normalize(path).split("/");
  const first = parts[0];
  if (first === "backend") {
    if (parts[1] === "app") return parts[2] === "config" || parts[2] === "host" ? 1 : 3;
    if (parts[1] === "transports") return 3;
    if (["assistant", "runs", "runtime", "logs"].includes(parts[1] ?? "")) return 2;
    if (["accounts", "systems", "processing", "workflow-tasks", "storage", "workbooks"].includes(parts[1] ?? "")) return 1;
    return undefined;
  }
  return first ? LAYERS.get(first) : undefined;
}

function auditLayering(files: readonly string[], root: string): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const sourceRelative = normalize(relative(root, file));
    const sourceLayer = layer(sourceRelative);
    if (sourceRelative.startsWith("backend/") && sourceLayer === undefined) {
      violations.push(`${sourceRelative}: unclassified backend responsibility`);
    }
    if (sourceLayer === undefined) continue;
    for (const specifier of moduleSpecifiers(file)) {
      const target = resolveModule(file, specifier);
      if (!target) continue;
      const targetLayer = layer(normalize(relative(root, target)));
      if (targetLayer !== undefined && sourceLayer < targetLayer) {
        violations.push(`${sourceRelative}: layer inversion imports ${normalize(relative(root, target))}`);
      }
    }
  }
  return violations;
}

// Raw control bytes make audit tools classify source as binary and skip it.
function hasRawControlByte(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    // 9 = tab, 10 = LF, 13 = CR - the only control bytes source may carry.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}



function auditConventions(files: readonly string[], root: string): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = normalize(relative(root, file));
    const name = basename(file, extname(file));
    if (hasRawControlByte(readFileSync(file, "utf8"))) {
      violations.push(`${path}: raw control byte — write the "\\u0000"-style escape so the file stays text to git and grep`);
    }
    if (!path.startsWith("src/dashboard/") && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      violations.push(`${path}: filename is not kebab-case`);
    }
    if (file.endsWith(".tsx") && !path.startsWith("src/dashboard/")) {
      violations.push(`${path}: TSX outside dashboard`);
    }
    visit(parse(file), (node) => {
      if (ts.isExportAssignment(node) && !node.isExportEquals) violations.push(`${path}: default export`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console") {
        violations.push(`${path}: console call`);
      }
    });
  }
  return violations;
}


function auditFrontend(files: readonly string[]): string[] {
  const palette = /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/;
  const hex = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;
  const violations: string[] = [];
  for (const file of files) {
    visit(parse(file), (node) => {
      if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
        if (palette.test(node.text)) violations.push(`${file}: palette color class`);
        if (hex.test(node.text.replace(/#4ade80|#fbbf24/gi, ""))) violations.push(`${file}: raw hex color`);
        return;
      }
      // Inspect image elements through the AST so prose mentioning an img tag cannot count as a client.
      if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
      if (node.tagName.getText(node.getSourceFile()) !== "img") return;
      const named = node.attributes.properties.filter(ts.isJsxAttribute);
      const has = (name: string): boolean =>
        named.some((attribute) => ts.isIdentifier(attribute.name) && attribute.name.text === name);
      if (!has("alt")) violations.push(`${file}: image without alt`);
      if (!has("loading")) violations.push(`${file}: image without explicit loading`);
    });
    violations.push(...auditFrontendText(file, readFileSync(file, "utf8")));
  }
  return violations;
}

function auditFrontendText(file: string, text: string): string[] {
  const violations: string[] = [];

  // Design-system motion uses interruptible transitions; keyframes remain forbidden.
  if (/@keyframes\b/.test(text)) violations.push(`${file}: @keyframes is banned in dashboard code`);
  if (/\banimation\s*:/.test(text)) violations.push(`${file}: raw animation property`);
  if (/\banimate-\[[^\]]+\]/.test(text)) violations.push(`${file}: arbitrary animation utility`);
  text.split("\n").forEach((line, index) => {
    if (!/\banimate-(?:spin|pulse|ping|bounce)\b/.test(line)) return;
    if (/\bmotion-safe:animate-(?:spin|pulse|ping|bounce)\b/.test(line)) return;
    if (/\bmotion-reduce:animate-none\b/.test(line)) return;
    violations.push(`${file}:${String(index + 1)}: animate-* without reduced-motion coverage`);
  });


  if (/\bz-\[[^\]]+\]/.test(text)) violations.push(`${file}: arbitrary z-index outside dsLayer`);
  if (/\bflex-shrink-0\b/.test(text)) violations.push(`${file}: flex-shrink-0, use shrink-0`);

  return violations;
}

function resolveFiles(name: RebuildRatchetName, repoRoot: string): RebuildRatchetAudit {
  const spec = SPECS[name];
  const roots = spec.roots.map((root) => resolve(repoRoot, root)).filter(existsSync);
  if (roots.length === 0) return { state: "planned-absent", files: [], violations: [] };
  const files = roots.flatMap((root) => walkFiles(root)).filter((file) => {
    const path = normalize(relative(repoRoot, file));
    return spec.select?.(path) ?? true;
  });
  if (files.length === 0) return { state: "planned-absent", files: [], violations: [] };
  return { state: "active", files, violations: [] };
}

export function auditRebuildRatchetArm(name: RebuildRatchetName, repoRoot: string): RebuildRatchetAudit {
  const resolved = resolveFiles(name, repoRoot);
  if (resolved.state === "planned-absent") return resolved;
  const tempRoot = resolve(repoRoot, "src");
  let violations: string[];
  switch (name) {
    case "fail-loud-catch-default": violations = auditBareDefaults(resolved.files); break;
    case "nullish-literal-data-fallback": violations = auditNullish(resolved.files); break;
    case "wait-for-timeout-allowlist": violations = auditCalls(resolved.files, new Set(["waitForTimeout"]), "waitForTimeout is forbidden"); break;
    case "inline-selectors-workflows": violations = auditInlineSelectors(resolved.files); break;
    case "evaluate-named-fn": violations = auditEvaluate(resolved.files); break;
    case "import-cycles": violations = auditCycles(resolved.files); break;
    case "control-layering": violations = auditLayering(resolved.files, tempRoot); break;
    case "code-conventions": violations = auditConventions(resolved.files, repoRoot); break;
    case "frontend-tailwind-compliance": violations = auditFrontend(resolved.files); break;
  }
  return { ...resolved, violations };
}

export function rebuildRatchetFixture(name: RebuildRatchetName): RebuildRatchetFixture {
  return SPECS[name].fixture;
}
