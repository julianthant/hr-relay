/**
 * Doc 13 §8.2/§8.3 — the two frontend boundary guards that land with the 1i
 * dashboard surfaces.
 *
 * (2) No duplicate wire types: dashboard code renders schema-inferred types.
 *     A handwritten structural mirror of a `*Wire` contract (an `interface
 *     FooWire { … }` or `type FooWire = { … }` declared under src/dashboard)
 *     is exactly the drift D93 warns about — the mirror keeps compiling after
 *     the schema moves. Aliases of schema-inferred types (`type FooWire =
 *     z.infer<…>`) remain legal.
 *
 * (3) No workflow switches: production dashboard code may not branch on a
 *     concrete workflow id. The registered ids come from the ONE composition
 *     root's bundle-safe view; any string literal equal to a registered id
 *     under src/dashboard (client, surfaces, app, ds) fails. Workflow identity
 *     reaches surfaces only as data (bootstrap projections and descriptor
 *     objects), never as a literal a branch can hang off.
 *
 * (13) Browser-bundle purity: no module the dashboard entry can VALUE-reach may
 *     statically import a Node built-in. `src/dashboard` imports shared domain
 *     contracts, so a `node:*` import several modules deep — one that typechecks,
 *     lints, and unit-tests perfectly on the server — silently becomes browser
 *     code. This is not a theoretical boundary: `src/domain/config/schema.ts`
 *     carried `import { join, resolve } from "node:path"` for its filesystem
 *     path DEFAULTS, and `src/domain/commands.ts` imports its settings-override
 *     contract, so the dashboard bundle reached it. Vite's dev server replaces
 *     an externalized built-in with a proxy that THROWS on the first property
 *     read, so the named-import binding alone killed the whole app at module
 *     evaluation — a blank page, before a single component rendered. Making the
 *     defaults lazy was not enough and never could be: the import itself has to
 *     be gone. The production build is even more dangerous, because it only
 *     WARNS and ships a bundle that fails later, if at all.
 *
 *     The fix direction this guard enforces is structural, not cosmetic: a
 *     browser-reachable module keeps the pure contract, and anything that needs
 *     a filesystem, a process, or a working directory moves to a server-only
 *     module the browser never reaches (here, `src/domain/config/runtime-paths.ts`).
 *     Aliasing, polyfilling, or stubbing `node:path` in the browser would be
 *     strictly worse — a stubbed `resolve()` invents a plausible-but-wrong
 *     absolute path, which is exactly the silent-wrong-value failure this
 *     program forbids.
 *
 *     2i-F generalised this arm from `index.html` to EVERY `*.html` entry under
 *     src/dashboard. A hardcoded entry filename was the wrong shape all along:
 *     the phone surface added a second entry, and a second entry importing the
 *     same shared domain contracts is the most likely place for the next
 *     breach — which would have been completely unguarded.
 *
 * (14) Phone-bundle scope (doc 12 §7, D175): the `capture.html` entry's import
 *     closure may not reach `src/dashboard/surfaces/**`, `src/dashboard/client/**`
 *     or `src/dashboard/app/**`. The capture ingress is the ONE exception to the
 *     loopback rule and it serves the phone page's own asset closure, so "the
 *     phone cannot reach the queue" is a claim about that closure — one
 *     transitive import would ship the run detail, the command envelope and the
 *     SSE transport to a public origin without touching a route.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { REPO_ROOT, repoRelative, walkFiles } from "./helpers/guard-files.js";

const DASHBOARD_ROOT = resolve(REPO_ROOT, "src/dashboard");

/** The `@` alias in `vite.dashboard.config.ts` — kept in sync by the arm below. */
const DASHBOARD_ALIAS = "@/";

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
}

/**
 * The module specifiers that survive into the emitted bundle: `import type …`
 * and a clause whose every named binding is `type`-marked are erased, and so is
 * `export type …`. Everything else — including bare side-effect imports and
 * dynamic `import()` — ships.
 */
function bundledSpecifiers(file: string, source: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  visit(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly === true) return;
      const bindings = clause?.namedBindings;
      const everyBindingIsType = clause?.name === undefined
        && bindings !== undefined
        && ts.isNamedImports(bindings)
        && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly);
      if (everyBindingIsType) return;
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
  });
  return specifiers.map((specifier) => specifier.startsWith(DASHBOARD_ALIAS)
    ? `${repoRelative(DASHBOARD_ROOT)}/${specifier.slice(DASHBOARD_ALIAS.length)}`
    : specifier)
    .filter((specifier) => specifier !== file);
}

/**
 * Resolves a project-internal specifier to a source file, or `undefined` when it
 * is not one (`react`, `zod`, `./index.css`). `verbatimModuleSyntax` means every
 * relative specifier carries a `.js` extension that maps back to `.ts`/`.tsx`.
 */
function resolveSourceFile(fromFile: string, specifier: string): string | undefined {
  const base = specifier.startsWith(".")
    ? resolve(fromFile, "..", specifier)
    : specifier.startsWith("src/") ? join(REPO_ROOT, specifier) : undefined;
  if (base === undefined) return undefined;
  const candidates = base.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Every Node built-in the entry's bundled-import closure can reach, with the chain that got there. */
function nodeBuiltinReach(entry: string): readonly string[] {
  const violations: string[] = [];
  const parents = new Map<string, string>();
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = parse(file);
    for (const specifier of bundledSpecifiers(file, source)) {
      if (isNodeBuiltin(specifier)) {
        const chain = [repoRelative(file)];
        for (let cursor = parents.get(file); cursor !== undefined; cursor = parents.get(cursor)) {
          chain.push(repoRelative(cursor));
        }
        violations.push(`${repoRelative(file)}: imports Node built-in "${specifier}" — reached from ${entry} via ${chain.reverse().join(" -> ")}`);
        continue;
      }
      const target = resolveSourceFile(file, specifier);
      if (target === undefined || seen.has(target)) continue;
      parents.set(target, file);
      pending.push(target);
    }
  }
  return violations.sort();
}

/**
 * EVERY entry the bundler uses, read from the HTML rather than assumed.
 *
 * This walked `index.html` alone until 2i-F added `capture.html`, and a
 * hardcoded filename is exactly the wrong shape for this guard: a second entry
 * would have escaped the Node-built-in check silently, which is the failure
 * mode D120 exists to prevent — the breach it caught was six modules deep in a
 * shared domain contract, so a NEW entry importing the same contracts is the
 * most likely place for the next one. `walkFiles` is TS-only, so the HTML files
 * are enumerated directly.
 */
function dashboardHtmlFiles(): readonly string[] {
  const files = readdirSync(DASHBOARD_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort();
  expect(files.length, "src/dashboard declares at least one HTML entry").toBeGreaterThan(0);
  return files;
}

function dashboardEntries(): readonly string[] {
  const entries = dashboardHtmlFiles().flatMap((file) => {
    const html = readFileSync(join(DASHBOARD_ROOT, file), "utf8");
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
      .map((match) => `src/dashboard${match[1] ?? ""}`);
    expect(scripts.length, `${file} declares a module entry`).toBeGreaterThan(0);
    return scripts;
  });
  expect(entries.length).toBeGreaterThan(0);
  return entries;
}

/** Every project-internal source file an entry's bundled-import closure reaches. */
function bundleClosure(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of bundledSpecifiers(file, parse(file))) {
      if (isNodeBuiltin(specifier)) continue;
      const target = resolveSourceFile(file, specifier);
      if (target !== undefined && !seen.has(target)) pending.push(target);
    }
  }
  return new Set([...seen].map((file) => repoRelative(file)));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

describe("dashboard wire boundary (doc 13 §8)", () => {
  const files = walkFiles(DASHBOARD_ROOT);

  it("scans a non-vacuous dashboard tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("declares no handwritten mirror of a *Wire contract under src/dashboard", () => {
    const violations: string[] = [];
    for (const file of files) {
      visit(parse(file), (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith("Wire")) {
          violations.push(`${repoRelative(file)}: interface ${node.name.text} mirrors a wire contract; import the schema-inferred type`);
        }
        if (
          ts.isTypeAliasDeclaration(node)
          && node.name.text.endsWith("Wire")
          && ts.isTypeLiteralNode(node.type)
        ) {
          violations.push(`${repoRelative(file)}: type ${node.name.text} mirrors a wire contract; import the schema-inferred type`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("reaches no Node built-in from ANY dashboard bundle entry", () => {
    const entries = dashboardEntries();
    // Both shipped entries are covered, not merely one of them: the whole
    // point of walking the HTML is that the entry set is read rather than
    // assumed, and an entry the walker never visits is an unguarded bundle.
    expect(dashboardHtmlFiles()).toContain("index.html");
    expect(dashboardHtmlFiles()).toContain("capture.html");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // The `@` alias the walker rewrites must be the one the bundler resolves.
    expect(readFileSync(join(REPO_ROOT, "vite.dashboard.config.ts"), "utf8"))
      .toContain('"@": resolve(import.meta.dirname, "src/dashboard")');
    for (const entry of entries) {
      expect(nodeBuiltinReach(entry), entry).toEqual([]);
    }
    // The rule only means something because the walker catches a real breach:
    // the config RESOLVER is server-only and imports node:crypto, and the
    // server-only path defaults it pulls in import node:path.
    const breach = nodeBuiltinReach("src/domain/config/resolve.ts");
    expect(breach.some((violation) => violation.includes('"node:crypto"'))).toBe(true);
    expect(breach.some((violation) =>
      violation.includes("src/domain/config/runtime-paths.ts") && violation.includes('"node:path"'))).toBe(true);
  });

  /**
   * (14) The phone bundle's SCOPE, as a fact about its import closure.
   *
   * Doc 12 §7 grants the capture ingress exactly one exception to the
   * loopback-only rule, and the ingress serves `capture.html` plus that page's
   * own asset closure. So "the phone cannot reach the queue" is only true if
   * the phone's closure does not CONTAIN the queue: a single import from
   * `phone/` into `surfaces/`, `client/` or `app/` would pull the run detail,
   * the command envelope and the SSE transport into a bundle served on a
   * public origin, and it would do so without changing a single route.
   *
   * The check is on the closure rather than on the phone's own import lines,
   * because the dangerous version of this is transitive — exactly how
   * `node:path` reached the dashboard six modules deep. `src/domain/**` and
   * `src/dashboard/ds/**` are shared on purpose: contracts and the token layer
   * are what keep the two surfaces one product.
   */
  it("reaches no operator surface, client or app module from the phone entry", () => {
    const forbidden = ["src/dashboard/surfaces/", "src/dashboard/client/", "src/dashboard/app/"];
    const closure = bundleClosure("src/dashboard/phone/main.tsx");
    // Non-vacuous: the walker must really be resolving the phone's own modules.
    expect(closure).toContain("src/dashboard/phone/capture-client.ts");
    expect(closure).toContain("src/dashboard/phone/capture-app.tsx");
    const violations = [...closure]
      .filter((file) => forbidden.some((root) => file.startsWith(root)))
      .sort();
    expect(violations, "the phone bundle may not reach an operator module").toEqual([]);

    // The rule only means something because the walker can SEE such a reach:
    // the operator entry legitimately reaches all three.
    const operator = bundleClosure("src/dashboard/app/main.tsx");
    for (const root of forbidden) {
      expect([...operator].some((file) => file.startsWith(root)), root).toBe(true);
    }
  });

  it("branches on no concrete workflow id anywhere under src/dashboard", () => {
    const ids = WORKFLOW_DESCRIPTORS.map((descriptor) => String(descriptor.id));
    expect(ids.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      visit(parse(file), (node) => {
        if (!ts.isStringLiteralLike(node)) return;
        if (ids.includes(node.text)) {
          violations.push(`${repoRelative(file)}: workflow id literal "${node.text}"`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
