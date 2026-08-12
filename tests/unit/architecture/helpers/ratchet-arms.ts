import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";
import { walkFiles } from "./guard-files.js";

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
    roots: ["src/stores"],
    fixture: {
      files: { "src/stores/ucpath/tasks/bad.ts": "export const bad = async (page: any) => page.waitForTimeout(25);\n" },
      expected: /waitForTimeout/,
    },
  },
  "inline-selectors-workflows": {
    roots: ["src/stores"],
    select: (path) => path.includes("/tasks/"),
    fixture: {
      files: { "src/stores/ucpath/tasks/bad.ts": "export const bad = (page: any) => page.locator(\"#employee\");\n" },
      expected: /raw page\/locator/,
    },
  },
  "evaluate-named-fn": {
    roots: ["src/stores"],
    fixture: {
      files: { "src/stores/ucpath/driver/bad.ts": "export const bad = (page: any) => page.evaluate(function named() { return true; });\n" },
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
      // The second file carries a REAL NUL byte (the escape below evaluates to
      // one before the fixture is written), because the control-byte arm's whole
      // subject is bytes that make a file invisible to text tooling — a fixture
      // spelled with the escape would test nothing.
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
      // ONE fixture that violates all FOUR checks, and an expectation that
      // requires all four to be reported. A fixture tripping only the palette
      // rule would let the other three rot back out silently — which is exactly
      // how three of them were lost in the port in the first place.
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

function parseContent(file: string, content: string, kind?: ts.ScriptKind): ts.SourceFile {
  const scriptKind = kind ?? (file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
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
    violations.push(...auditFailLoudCatchDefaults(file, readFileSync(file, "utf8")));
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

function moduleSpecifiers(file: string): string[] {
  const specs: string[] = [];
  visit(parse(file), (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
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
    edges.set(resolve(file), moduleSpecifiers(file)
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
  ["domain", 0],
  ["infra", 1], ["services", 1], ["systems", 1], ["stores", 1],
  ["core", 2],
  ["control", 3], ["workflows", 3], ["server", 3],
]);

function layer(path: string): number | undefined {
  const first = normalize(path).split("/")[0];
  return first ? LAYERS.get(first) : undefined;
}

function auditLayering(files: readonly string[], root: string): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const sourceRelative = normalize(relative(root, file));
    const sourceLayer = layer(sourceRelative);
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

/*
  Raw control bytes make a SOURCE file invisible to the tools that audit it:
  one literal NUL and git/grep/rg classify the file as binary and silently skip
  it — every in-tree search stops seeing it, diffs render as "Bin", and a guard
  that greps its text matches nothing. Found live three times in one day
  (context-rail.tsx, then two fresh helpers that inherited the idiom), each a
  string literal typed as the actual byte instead of the escape. Tab, CR and LF
  are the only control bytes with any business in source.
*/
function hasRawControlByte(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    // 9 = tab, 10 = LF, 13 = CR - the only control bytes source may carry.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

/*
  The five committed carriers found the day the check landed (2026-08-12) were
  PINNED for one afternoon rather than fixed in the same commit, because four
  sit inside descriptor source closures: fixing their bytes moves
  contractFingerprints, which regenerates generated-build-manifest.ts and drifts
  every a11y reference that renders a fingerprint - and the manifest was
  carrying another session's uncommitted work at the time. That debt was PAID by
  separations chunk 2 (the closure edit, `build:manifest`, and the deliberate
  parity re-freeze in one unit), so the pin set is gone and this is a plain
  invariant again: NO source file carries a raw control byte, full stop. Do not
  reintroduce a pin list - a carrier that cannot be fixed today is a carrier
  that hides the file from every audit today.
*/

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

/*
  The port of this arm kept ONE of the four checks its source had.

  Legacy's `frontend-tailwind-compliance.test.ts` runs four: reduced-motion
  coverage over animation, the z-index scale, image loading discipline, and the
  palette/hex rule. Only the last came across, and DESIGN.md meanwhile asserts
  "guard enforced" for the first two by name (`:209`, `:546`, `:548-549`). A
  document claiming a guard that does not run is worse than no claim, because
  the next reader believes it.

  The tree happens to be clean on all four today. That is not the same as being
  held to them — which is the whole argument of `DESIGN.md:56-57`, "if it is
  true, hold it with a test".

  Palette and hex stay on the AST (a colour only means something inside a string
  literal or JSX text). The other three read raw text on purpose: the
  reduced-motion rule is a statement about what appears on the SAME LINE as an
  `animate-*` class, and `@keyframes` is not a TypeScript node at all.
*/
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
      // Images go through the AST rather than a text match on purpose: the
      // first text-based draft of this check reported `capture-client.ts` for
      // the sentence "an `<img src>` cannot carry a header" in a comment. A
      // guard that reads prose as code teaches people to work around it.
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

  /*
    MOTION. DESIGN.md's five classes are all TRANSITIONS, which is what makes
    them interruptible; key-frames are banned outright under `src/dashboard/**`.
    The Tailwind animation utilities that remain (a spinner, mostly) must pair
    with an explicit reduced-motion arm, because `prefers-reduced-motion` has to
    zero both the clock AND the distance — an unpaired `animate-spin` keeps
    spinning for an operator who asked the machine to stop moving.
  */
  if (/@keyframes\b/.test(text)) violations.push(`${file}: @keyframes is banned in dashboard code`);
  if (/\banimation\s*:/.test(text)) violations.push(`${file}: raw animation property`);
  if (/\banimate-\[[^\]]+\]/.test(text)) violations.push(`${file}: arbitrary animation utility`);
  text.split("\n").forEach((line, index) => {
    if (!/\banimate-(?:spin|pulse|ping|bounce)\b/.test(line)) return;
    if (/\bmotion-safe:animate-(?:spin|pulse|ping|bounce)\b/.test(line)) return;
    if (/\bmotion-reduce:animate-none\b/.test(line)) return;
    violations.push(`${file}:${String(index + 1)}: animate-* without reduced-motion coverage`);
  });

  /*
    LAYERING. `dsLayer` is a five-step scale (sticky/menu/drawer/modal/toast) and
    an arbitrary `z-[…]` is how a control ends up above a modal by accident — the
    stack is a shared resource, so it cannot be negotiated one file at a time.
    `flex-shrink-0` rides along because the tree standardised on `shrink-0` and
    two spellings of one idea is how a grep stops finding things.
  */
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
