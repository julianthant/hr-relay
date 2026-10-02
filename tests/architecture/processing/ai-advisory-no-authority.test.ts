/**
 * `ai-advisory-no-authority` (ref operator-trust §4.4 — activated at 2i-G, D178).
 *
 * The guard stayed PLANNED until there was an advisory to guard: ref operator-trust §4.4
 * had a contract and no producer, and a guard over an empty set is a claim
 * nothing can violate.
 *
 * §4.4's load-bearing sentence is that advisories "cannot transition a run,
 * resolve evidence, select identity, acknowledge a warning, create a UI
 * registry entry, or call the command/mutation services." Every one of those
 * is a WRITE, and this guard makes the whole class structurally unreachable
 * rather than individually forbidden:
 *
 * (1) **Zero authority edge, both directions.** The advisory closure's
 *     bundled-import graph may not reach any authority writer — the sqlite
 *     repositories, the command kernel, terminal authorization, the write
 *     sequencer/recovery, the receipt writer, the knowledge/notification
 *     services or the composition roots. And no command-family module may
 *     import an advisory module, so an advisory VALUE cannot reach a command
 *     payload from the other side either.
 *
 *     The ONE permitted durable neighbour is provider admission, and it is
 *     permitted at the composition root only: D112 budgets every provider
 *     call and grants a read no exemption. That row records who spent the
 *     budget; it transitions nothing.
 *
 * (2) **Declared redaction is complete and cannot be widened.** Every leaf a
 *     `FailureRecord` can present carries a declaration, and no declaration
 *     pairs a classification with a transform `src/rules/redaction/redaction.ts`
 *     forbids. A field added to `FailureRecordSchema` therefore fails here
 *     rather than shipping to a provider unreviewed.
 *
 * (3) **The advice shape cannot be mistaken for a verdict.** The closed advice
 *     schema carries no retryability, no remediation KIND, no run reference
 *     and no command — the arms §4.4 says an advisory may not have.
 *
 * (4) **The advisory route is not a command route.** It is registered as its
 *     own POST outside `/api/v1/commands`, and the command service never
 *     reaches the advisory query.
 *
 * Every arm runs against a VIOLATING fixture as well as the real subject: an
 * arm that cannot fail is not enforcement.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "vitest";
import ts from "typescript";
import {
  ADVISORY_CLASSIFICATIONS,
  FAILURE_TRIAGE_CLASSIFICATIONS,
  FailureTriageAdviceSchema,
  buildAdvisoryFacts,
} from "../../../src/models/trust/advisory.js";
import { evidenceTransformAllowed } from "../../../src/rules/redaction/redaction.js";
import { MAXIMAL_FAILURE } from "../../support/fixtures/integration/advisory-fixtures.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

/* ── the subject ─────────────────────────────────────────────────────────── */

/**
 * The advisory closure's roots. `src/dashboard/surfaces/advisory.tsx` is
 * deliberately absent: it runs in the browser, where authority is not
 * reachable at all, and `dashboard-wire-boundary` already owns that bundle's
 * reach.
 */
const ADVISORY_ROOTS = [
  "src/models/trust/advisory.ts",
  "src/models/dashboard/advisory.ts",
  "src/backend/logs/trust/advisory.ts",
  "src/backend/processing/providers/gemini-advisory.ts",
  "src/backend/runs/queries/advisory.ts",
] as const;

/** Anything that can move durable authority. Prefix match. */
const AUTHORITY_WRITERS = [
  "src/backend/storage/sqlite/",
  "src/backend/runtime/execution/run-executor.ts",
  "src/backend/runtime/workers/worker-loop.ts",
  "src/backend/runs/commands/command-kernel.ts",
  "src/backend/runs/lifecycle/terminal-authorization.ts",
  "src/backend/runtime/writes/write-sequencer.ts",
  "src/backend/runtime/writes/write-recovery.ts",
  "src/backend/runs/provenance/evidence-receipt.ts",
  "src/backend/runtime/execution/run-failure.ts",
  "src/backend/logs/diagnostics/diagnostic-capture.ts",
  "src/backend/runs/notifications/",
  "src/backend/storage/ledger/",
  "src/backend/runs/commands/",
  "src/backend/app/composition/dashboard/compose.ts",
  "src/backend/app/composition/worker-compose.ts",
  "src/backend/app/control/",
] as const;

/** The command family, which may never import an advisory module. */
const COMMAND_FAMILY = [
  "src/rules/commands/commands.ts",
  "src/backend/runs/commands/command-kernel.ts",
  "src/backend/runs/commands/",
] as const;

/* ── the import walker (bundled specifiers only) ─────────────────────────── */

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child) => {
    visit(child, onNode);
  });
}

/**
 * Specifiers that survive into the emitted module — `import type` and a clause
 * whose every binding is `type`-marked are erased, and a type-only import of a
 * record SHAPE is not a path to that record's writer.
 */
function valueSpecifiers(source: ts.SourceFile): readonly string[] {
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
  return specifiers;
}

function resolveSourceFile(root: string, fromRepoPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(root, dirname(fromRepoPath), specifier.replace(/\.js$/u, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return relativeTo(root, candidate);
  }
  return undefined;
}

function relativeTo(root: string, absolute: string): string {
  return absolute.slice(root.length + 1).replaceAll("\\", "/");
}

/** Every module the roots can reach by a VALUE import, with the chain. */
function valueReach(root: string, roots: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>();
  const pending: { path: string; chain: readonly string[] }[] = roots
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({ path, chain: [path] }));
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined || chains.has(next.path)) continue;
    chains.set(next.path, next.chain);
    for (const specifier of valueSpecifiers(parse(resolve(root, next.path)))) {
      const target = resolveSourceFile(root, next.path, specifier);
      if (target !== undefined && !chains.has(target)) {
        pending.push({ path: target, chain: [...next.chain, target] });
      }
    }
  }
  return chains;
}

export function auditAdvisoryAuthorityEdge(root: string): readonly string[] {
  const issues: string[] = [];
  const reach = valueReach(root, ADVISORY_ROOTS);
  for (const [path, chain] of reach) {
    if (AUTHORITY_WRITERS.some((writer) => path.startsWith(writer))) {
      issues.push(`advisory reaches authority writer ${path} via ${chain.join(" -> ")}`);
    }
  }
  // The other direction: an advisory VALUE may not travel into a command.
  for (const absolute of walkFiles(resolve(root, "src"), { missing: "planned-empty" })) {
    const path = relativeTo(root, absolute);
    if (!COMMAND_FAMILY.some((prefix) => path.startsWith(prefix))) continue;
    for (const specifier of valueSpecifiers(parse(absolute))) {
      const target = resolveSourceFile(root, path, specifier);
      if (target !== undefined && ADVISORY_ROOTS.includes(target as typeof ADVISORY_ROOTS[number])) {
        issues.push(`command-family module ${path} imports advisory module ${target}`);
      }
    }
  }
  return issues;
}

/* ── 1. zero authority edge ──────────────────────────────────────────────── */

describe("ai-advisory-no-authority — the module graph", () => {
  it("cannot reach any authority writer, and no command module can reach it", () => {
    assert.deepEqual(auditAdvisoryAuthorityEdge(REPO_ROOT), []);
  });

  it("the audit fails on a violating fixture in either direction", () => {
    const root = resolve(tmpdir(), `hrauto-advisory-guard-${process.pid}-${Date.now()}`);
    try {
      const write = (path: string, body: string): void => {
        const absolute = resolve(root, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, body);
      };
      // ① an advisory module that reaches a writer, three hops down.
      write("src/models/trust/advisory.ts", 'import { helper } from "../../backend/logs/trust/helper.js";\nexport const a = helper;\n');
      write("src/backend/logs/trust/helper.ts", 'import { db } from "../../storage/sqlite/authority-database.js";\nexport const helper = db;\n');
      write("src/backend/storage/sqlite/authority-database.ts", "export const db = 1;\n");
      // ② a command module that imports the advisory.
      write("src/rules/commands/commands.ts", 'import { a } from "./trust/advisory.js";\nexport const c = a;\n');
      const issues = auditAdvisoryAuthorityEdge(root).join("\n");
      assert.match(issues, /advisory reaches authority writer src\/backend\/storage\/sqlite\/authority-database\.ts/u);
      assert.match(issues, /advisory\.ts -> .*helper\.ts -> .*authority-database\.ts/u);
      assert.match(issues, /command-family module src\/domain\/commands\.ts imports advisory module/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a type-only import of a record shape is not a path to its writer", () => {
    const root = resolve(tmpdir(), `hrauto-advisory-typeonly-${process.pid}-${Date.now()}`);
    try {
      const absolute = resolve(root, "src/models/trust/advisory.ts");
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, 'import type { Db } from "../../infra/sqlite/authority-database.js";\nexport type A = Db;\n');
      const dbPath = resolve(root, "src/backend/storage/sqlite/authority-database.ts");
      mkdirSync(dirname(dbPath), { recursive: true });
      writeFileSync(dbPath, "export type Db = number;\n");
      assert.deepEqual(auditAdvisoryAuthorityEdge(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ── 2. declared redaction is complete and cannot be widened ─────────────── */

describe("ai-advisory-no-authority — declared redaction", () => {
  it("declares every leaf a failure record can present, in both directions", () => {
    const declared = new Set(FAILURE_TRIAGE_CLASSIFICATIONS.map((entry) => entry.path));
    const produced = new Set(buildAdvisoryFacts("failure-triage", MAXIMAL_FAILURE).map((fact) => fact.key));
    assert.deepEqual([...produced].sort().filter((path) => !declared.has(path)), []);
    assert.deepEqual(
      [...declared].sort().filter((path) => !produced.has(path)),
      [],
      "a declaration the maximal failure never presents is a rule nothing proves",
    );
  });

  it("never pairs a classification with a transform redaction.ts forbids", () => {
    for (const entry of FAILURE_TRIAGE_CLASSIFICATIONS) {
      assert.ok(
        evidenceTransformAllowed(entry.classification, entry.transform),
        `${entry.path} declares ${entry.transform}, forbidden for ${entry.classification}`,
      );
      // The stronger rule the classification table alone does not state: only
      // `safe-diagnostic` may leave the process as a VALUE.
      if (entry.transform === "allow") {
        assert.equal(
          entry.classification,
          "safe-diagnostic",
          `${entry.path} would send a ${entry.classification} value verbatim`,
        );
      }
    }
  });

  it("refuses an undeclared leaf by name, and refuses a widened declaration at parse", () => {
    assert.throws(
      () => buildAdvisoryFacts("failure-triage", { ...MAXIMAL_FAILURE, leakedNote: "call Johnnie" }),
      /no declared advisory classification for failure-triage leaf "leakedNote"/u,
    );
    // The violating fixture for the declaration table itself.
    assert.equal(evidenceTransformAllowed("sensitive-hr", "allow"), false);
    assert.equal(evidenceTransformAllowed("direct-identifier", "allow"), false);
    assert.equal(evidenceTransformAllowed("secret", "allow"), false);
  });

  it("registers a classification table for every declared surface", () => {
    for (const surface of ["failure-triage", "contact-normalization"] as const) {
      assert.ok(ADVISORY_CLASSIFICATIONS[surface] !== undefined, `${surface} has no classification table`);
    }
    // The contact surface classifies through `CANONICAL_FIELDS` on purpose, so
    // its table here is EMPTY — and that is enforced rather than incidental: a
    // second table would be a second answer to "how is this field handled".
    assert.equal(ADVISORY_CLASSIFICATIONS["contact-normalization"].size, 0);
  });
});

/* ── 3. the advice shape cannot be mistaken for a verdict ────────────────── */

describe("ai-advisory-no-authority — the advice shape", () => {
  it("carries no retryability, remediation kind, run reference or command", () => {
    const shape = FailureTriageAdviceSchema.shape;
    assert.deepEqual(Object.keys(shape).sort(), ["checks", "confidence", "explanation", "headline"]);
    for (const forbidden of ["transient", "retryable", "remediation", "runId", "command", "action", "resolution"]) {
      assert.equal(forbidden in shape, false, `the advice schema exposes ${forbidden}`);
    }
    // …and the strict object REFUSES one rather than ignoring it.
    const widened = FailureTriageAdviceSchema.safeParse({
      headline: "h",
      explanation: "e",
      checks: [{ what: "w", why: "y" }],
      confidence: "low",
      retryable: true,
    });
    assert.equal(widened.success, false);
  });
});

/* ── 4. the advisory route is not a command route ────────────────────────── */

describe("ai-advisory-no-authority — the route", () => {
  const apiSource = readFileSync(join(REPO_ROOT, "src/backend/transports/http/routes/api.ts"), "utf8");
  const routeSource = readFileSync(join(REPO_ROOT, "src/backend/transports/http/routes/run-detail.ts"), "utf8");
  function advisoryRouteValid(composition: string, route: string): boolean {
    return /registerRunDetailRoutes\(app, deps\)/u.test(composition)
      && /app\.use\("\/api\/v1\/runs\/:runId\/advisory", operatorOpaqueIngressGuard\)/u.test(composition)
      && /app\.post\("\/api\/v1\/runs\/:runId\/advisory"/u.test(route)
      && /buildRunAdvisory\(deps\.advisory, c\.req\.param\("runId"\)\)/u.test(route)
      && !/deps\.commands/u.test(route);
  }

  it("registers the admitted advisory POST through its actual route owner outside commands", () => {
    assert.equal(advisoryRouteValid(apiSource, routeSource), true);
    assert.equal(routeSource.includes('"advisory"'), false, "advisory must not appear as a section name");
    assert.equal(advisoryRouteValid(apiSource, routeSource.replace('/api/v1/runs/:runId/advisory', '/api/v1/commands/advisory')), false);
    assert.equal(advisoryRouteValid(apiSource, routeSource.replace('buildRunAdvisory(deps.advisory', 'buildRunAdvisory(deps.commands')), false);
    assert.equal(advisoryRouteValid(apiSource.replace('registerRunDetailRoutes(app, deps)', 'registerOtherRoutes(app, deps)'), routeSource), false);
    assert.equal(advisoryRouteValid(apiSource.replace('app.use("/api/v1/runs/:runId/advisory", operatorOpaqueIngressGuard)', 'app.use("/api/v1/runs/:runId/advisory", unreviewedGuard)'), routeSource), false);
  });

  it("the command service never reaches the advisory query", () => {
    const commandSources = walkFiles(join(REPO_ROOT, "src/backend/runs/commands"), { missing: "planned-empty" });
    for (const absolute of commandSources) {
      const text = readFileSync(absolute, "utf8");
      assert.equal(
        text.includes("queries/advisory.js") || text.includes("trust/advisory.js"),
        false,
        `${relativeTo(REPO_ROOT, absolute)} reaches the advisory`,
      );
    }
  });
});
