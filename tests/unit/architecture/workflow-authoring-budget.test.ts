/**
 * workflow-authoring-budget — D312/D316/D317 (ref workflow-model §§1.6, 1.6.1):
 * the retired authoring path does not come back, and the simplicity budget has
 * no escape hatch.
 *
 * `workflow-layout` proves the FOLDER shape: one `workflow.ts` per registered
 * workflow and nothing beside it. That is only half of D312. The other half is
 * what an author writes to add a reuse-only workflow, and the two ways it
 * silently grows back:
 *
 *   - the retired path returns under its old names — `WorkflowRecipe`,
 *     `defineWorkflowRecipe`, `workflow-recipe.ts`, a `recipe.ts`, the deleted
 *     node-fragment factory — anywhere in the program, or the bare word
 *     `recipe` re-enters the authoring seam as CODE (§1.6's D317 amendment:
 *     "recipe" is the analogy, never the model); and
 *   - the four-artifact budget is paid in a fifth artifact — a generic surface
 *     that branches on a workflow id (D316), a descriptor/module/flow builder
 *     hand-authored beside `workflow.ts`, or one more file per workflow under
 *     `tests/scenario/` or `docs/migrations/`.
 *
 * The four arms, in the order they run:
 *
 *   (a) RETIRED NAMES. Every `.ts`/`.tsx` under `src/`, `tests/` and
 *       `scripts/` — except this guard (whose fixtures must be able to SAY the
 *       forbidden words) and its shared helpers — is refused for
 *       `WorkflowRecipe`, `defineWorkflowRecipe`, `compileWorkflowRecipe`, the
 *       `workflow-recipe` specifier/basename, `defineWorkflowStepNodeFactory`,
 *       and for being named `recipe.ts`. Those are token scans BY DESIGN: none
 *       of them may appear even in prose in a source file. Inside the authoring
 *       seam only (`src/base/workflow-definition.ts`, `src/base/workflow.ts`,
 *       `src/control/workflow-registry.ts`, `src/workflows/**`,
 *       `src/domain/workflow/**`) the bare identifier `recipe` is refused from
 *       the TypeScript AST — identifiers, never comment text, because
 *       `separations/kronos-timecard/workflow.ts` legitimately says "login
 *       recipe" in a comment and `defineVerifiedLoginRecipe` in
 *       `src/infra/browser/` is a different, unrelated seam.
 *   (b) HAND-AUTHORED PATH BESIDE `workflow.ts`. Under `src/workflows/**`, any
 *       call to `defineWorkflowDescriptor`, `flow`, `defineWorkflowStepNodeFactory`
 *       or `composeWorkflowModule`, and any import from `src/base/flow.js`, is
 *       refused: the flow builder is compiler-internal and stores are composed
 *       only at the composition root (`src/control/workflow-registry.ts`, which
 *       is deliberately OUTSIDE this arm's root). And every
 *       `src/workflows/<folder>/workflow.ts` holds exactly ONE `defineWorkflow(` call
 *       — `defineWorkflowStep(` and `defineStepEntries(` are D315's step
 *       identities and are allowed beside it. AST, never text, so a comment
 *       mentioning `flow(` passes.
 *   (c) WORKFLOW-KEYED GENERIC ADAPTER (D316). Under `src/dashboard/**`,
 *       `src/server/**` and `src/services/**` (tests excluded), any string
 *       literal EQUAL to a registered workflow id is refused unless it is in a
 *       closed `(file, workflow id)` allowlist whose every entry cites the
 *       decision that site's own comments name. The refusal reports the
 *       literal's syntactic context — an equality comparison, a case label, a
 *       dispatch-table key, a call argument — because those are the shapes
 *       §1.6.1 calls "a generic dashboard branch keyed by workflow id". The
 *       allowlist fails BOTH ways: an entry nothing matches is stale and red,
 *       which is also this arm's negative control (a scanner that resolved
 *       nothing would report every entry stale).
 *   (d) FIFTH AUTHORED ARTIFACT (D312). For each registered workflow the
 *       authored surface is exactly its `workflowSourcePath` (the ONE
 *       derivation, D265 arm d — never rebuilt here by interpolation), at most
 *       one structural scenario, at most one
 *       `tests/scenario/workflows/<id>/dry-run.scenario.ts`, and at most one
 *       `docs/migrations/<id>.md`. Any other repository-visible file under
 *       `src/workflows/`, `tests/scenario/` or `docs/migrations/` ATTRIBUTED to
 *       a registered workflow is refused by path. Attribution has two rules,
 *       because a harness id is never a path segment (D265 rule 3): UNDER
 *       `src/workflows/` a file belongs to the registered FOLDER it sits in
 *       (`workflowSourceFolder`, longest folder prefix), so
 *       `separations/identity-check/module.ts` is the harness's budget and not
 *       the composition's; everywhere else a whole directory segment or the
 *       basename stem that equals a registered id, or begins with one followed
 *       by `-`, `_` or `.`, attributes to the LONGEST such id — so
 *       `tests/scenario/separations-kuali-read.scenario.test.ts` belongs to the
 *       harness, and `separations-extra/` and `separations_extra.md` stay
 *       `separations`'s budget instead of escaping it. Two closed
 *       exemptions, each citing its authority, and one closed pre-canonical
 *       structural-scenario allowlist; both are staleness-checked the same way.
 *
 * All four arms are ONE pure function of `(registered workflows, one tree of
 * sources and file paths, three closed allowlists)` —
 * `auditWorkflowAuthoringBudget` never touches the filesystem — so the real
 * repository and every violating fixture go through identical code.
 * `collectWorkflowAuthoringBudgetTree` supplies the tree for both, through the
 * same `gitVisibleFilesIn` lister the rest of this suite uses: a fixture root is
 * `git init`-ed so its miniature tree is listed by the very same code path, not
 * by a second walker written for fixtures. A `.ts` fixture checked into
 * `tests/` would be part of this tree's own zero-debt typecheck/lint program,
 * which a deliberately retired-name-bearing file cannot be.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";

import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { workflowSourceFolder, workflowSourcePath } from "../../../src/domain/workflow/source-layout.js";
import { gitVisibleFilesIn, REPO_ROOT } from "./helpers/guard-files.js";

// ---------------------------------------------------------------------------
// Scan roots
// ---------------------------------------------------------------------------

/** Everything the collector lists, in one `git ls-files` call. */
const SCAN_ROOTS = ["src", "tests", "scripts", "docs/migrations"] as const;
/** Roots whose `.ts`/`.tsx` text arms (a)-(c) read. */
const SOURCE_ROOTS = ["src/", "tests/", "scripts/"] as const;
/** Roots arm (d) counts authored artifacts in. */
const ARTIFACT_ROOTS = ["src/workflows/", "tests/scenario/", "docs/migrations/"] as const;

/** This guard's fixtures must be able to spell the forbidden names. */
const GUARD_FILE = "tests/unit/architecture/workflow-authoring-budget.test.ts";
const GUARD_HELPERS = "tests/unit/architecture/helpers/";

/** §1.6's authoring seam — the only place the bare word `recipe` is code-checked. */
const SEAM_FILES = [
  "src/base/workflow-definition.ts",
  "src/base/workflow.ts",
  "src/control/workflow-registry.ts",
] as const;
const SEAM_PREFIXES = ["src/workflows/", "src/domain/workflow/"] as const;

/** Arm (b)'s root: the authored workflow files themselves. */
const WORKFLOWS_ROOT = "src/workflows/";
/** Arm (c)'s roots: the generic surfaces D316 forbids branching by workflow id. */
const GENERIC_ROOTS = ["src/dashboard/", "src/server/", "src/services/"] as const;

const RETIRED_NAMES = [
  { token: "WorkflowRecipe", rule: "D317 — the authored value is a WorkflowDefinition" },
  { token: "defineWorkflowRecipe", rule: "D317 — the authoring API is defineWorkflow" },
  { token: "compileWorkflowRecipe", rule: "D317 — the compiler is compileWorkflow" },
  { token: "workflow-recipe", rule: "D317 — the seam is src/base/workflow-definition.ts" },
  { token: "defineWorkflowStepNodeFactory", rule: "D312 — the flow node-fragment API is deleted" },
] as const;

/** Arm (b): builders a workflow folder may not call. */
const HAND_AUTHORED_CALLS: ReadonlyMap<string, string> = new Map([
  ["defineWorkflowDescriptor", "a descriptor is COMPILED from workflow.ts, never authored (D312/D317)"],
  ["flow", "the flow builder is compiler-internal since D311 (§1.6 item 4)"],
  ["defineWorkflowStepNodeFactory", "the node-fragment API is deleted (D312)"],
  ["composeWorkflowModule", "stores are composed only at src/control/workflow-registry.ts (D311)"],
]);

const COMPARISON_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** A reason is only a citation when it names the authority it rests on. */
const CITATION = /D\d{2,4}|§\d/;

/**
 * Arm (d): the characters that end a registered id inside a longer directory
 * segment or basename stem. `separations-extra/` and `separations_extra.md`
 * are the composition's budget, not a way out of it.
 */
const ID_SEPARATORS = ["-", "_", "."] as const;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface WorkflowAuthoringBudgetTree {
  /** Repo-relative `.ts`/`.tsx` path → its source text. */
  readonly sources: ReadonlyMap<string, string>;
  /** Every repository-visible file under the artifact roots, any extension. */
  readonly artifactFiles: readonly string[];
}

export interface RegisteredWorkflowSource {
  readonly id: string;
  /** From `workflowSourceFolder` — the ONE folder-from-role derivation (D265 arm d). */
  readonly sourceFolder: string;
  /** From `workflowSourcePath` — the ONE path-from-role derivation (D265 arm d). */
  readonly sourcePath: string;
}

/** Arm (c): one reviewed `(file, workflow id)` pair, with the decision it rests on. */
export interface GenericWorkflowIdAllowlistEntry {
  readonly file: string;
  readonly workflowId: string;
  readonly reason: string;
}

/** Arm (d): a structural scenario still at its pre-canonical path. */
export interface PreCanonicalScenarioEntry {
  readonly workflowId: string;
  readonly file: string;
  readonly reason: string;
}

/** Arm (d): an exact file, or a directory prefix ending in `/`. */
export interface ArtifactExemptionEntry {
  readonly path: string;
  readonly reason: string;
}

export interface WorkflowAuthoringBudgetInputs {
  readonly workflows: readonly RegisteredWorkflowSource[];
  readonly tree: WorkflowAuthoringBudgetTree;
  readonly genericIdAllowlist: readonly GenericWorkflowIdAllowlistEntry[];
  readonly preCanonicalScenarios: readonly PreCanonicalScenarioEntry[];
  readonly artifactExemptions: readonly ArtifactExemptionEntry[];
}

// ---------------------------------------------------------------------------
// Collector — the repository's tree and every fixture's, through one lister
// ---------------------------------------------------------------------------

/**
 * List one tree. A read failure is NOT swallowed into "no source": `git`
 * already said the file is there, so an unreadable one throws with its path
 * rather than letting the scanner report a green arm over a file it never saw.
 */
export function collectWorkflowAuthoringBudgetTree(root: string): WorkflowAuthoringBudgetTree {
  const sources = new Map<string, string>();
  const artifactFiles: string[] = [];
  for (const file of gitVisibleFilesIn(root, SCAN_ROOTS)) {
    if (ARTIFACT_ROOTS.some((prefix) => file.startsWith(prefix))) artifactFiles.push(file);
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (!SOURCE_ROOTS.some((prefix) => file.startsWith(prefix))) continue;
    sources.set(file, readFileSync(join(root, file), "utf8"));
  }
  return { sources, artifactFiles };
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text[index] === "\n") line += 1;
  return line;
}

function eachNode(node: ts.Node, visit: (child: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => { eachNode(child, visit); });
}

/** The callee's simple name, for `f()`, `ns.f()` and `f<T>()` alike. */
function calleeName(call: ts.CallExpression): string | undefined {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function moduleSpecifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [first] = node.arguments;
    if (first !== undefined && ts.isStringLiteralLike(first)) return first.text;
  }
  return undefined;
}

/**
 * Arm (c)'s `(file, workflow id)` key. The separator is written as the
 * `\u001f` ESCAPE and never as a raw control byte: a source file carrying a
 * literal NUL is "binary" to `grep -r`, to `git diff` and to a reviewer's
 * editor, which is a poor place to hide an authority key's construction.
 */
function pairKey(file: string, workflowId: string): string {
  return `${file}\u001f${workflowId}`;
}

function isSeamFile(path: string): boolean {
  return SEAM_FILES.some((seam) => seam === path) || SEAM_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isTestSource(path: string): boolean {
  return path.includes(".test.") || path.includes(".scenario.") || path.includes(".walk.");
}

/** Where a workflow-id literal sits — the D316 shapes, named in the refusal. */
function literalContext(literal: ts.StringLiteralLike): string {
  const parent: ts.Node = literal.parent;
  if (ts.isBinaryExpression(parent) && COMPARISON_OPERATORS.has(parent.operatorToken.kind)) {
    return "an equality comparison";
  }
  if (ts.isCaseClause(parent)) return "a case label";
  if (ts.isArrayLiteralExpression(parent) && parent.elements[0] === literal) return "a dispatch-table key";
  if (ts.isPropertyAssignment(parent) && parent.name === literal) return "a dispatch-table key";
  if (ts.isComputedPropertyName(parent)) return "a dispatch-table key";
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === literal) {
    return "a dispatch-table key";
  }
  if (ts.isCallExpression(parent) && parent.arguments.includes(literal)) {
    return "a workflow-keyed call argument";
  }
  return "a workflow-id literal";
}

/**
 * Arm (d) attribution, in two rules, because a path under `src/workflows/`
 * does not carry its owner's id at all.
 *
 *   - UNDER `src/workflows/`: the owner is the registered FOLDER the file sits
 *     in, taken from `workflowSourceFolder` — the ONE folder-from-role
 *     derivation (D265 arm d), never rebuilt here by interpolation. The
 *     LONGEST folder prefix wins, so `separations/identity-check/module.ts` is
 *     the harness's budget and not the composition's, even though the
 *     composition's folder contains it. D265 rule 3 puts a harness INSIDE the
 *     step it proves and leaves its id out of the path entirely, so the name
 *     rule below would charge every harness file to `separations`.
 *   - EVERYWHERE ELSE: a whole directory segment, or the basename stem, that
 *     equals a registered id or begins with one followed by `-`, `_` or `.`.
 *     The LONGEST such id wins — `separations` is a prefix of five harness ids,
 *     so `tests/scenario/separations-kuali-read.scenario.test.ts` belongs to
 *     the harness, while `tests/scenario/separations-extra/foo.ts` and
 *     `docs/migrations/separations_extra.md` belong to `separations` instead of
 *     leaving the budget by suffixing an unregistered word.
 */
export function attributeWorkflowArtifact(
  file: string,
  workflows: readonly RegisteredWorkflowSource[],
): string | undefined {
  if (file.startsWith(WORKFLOWS_ROOT)) {
    let owner: RegisteredWorkflowSource | undefined;
    for (const workflow of workflows) {
      if (!file.startsWith(`${workflow.sourceFolder}/`)) continue;
      if (owner === undefined || workflow.sourceFolder.length > owner.sourceFolder.length) owner = workflow;
    }
    return owner?.id;
  }
  const segments = file.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const stem = basename.split(".")[0] ?? "";
  const names = [...segments.slice(0, -1), stem];
  const namesId = (id: string): boolean =>
    names.some((name) => name === id || ID_SEPARATORS.some((separator) => name.startsWith(`${id}${separator}`)));
  let best: string | undefined;
  for (const { id } of workflows) {
    if (!namesId(id)) continue;
    if (best === undefined || id.length > best.length) best = id;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export function auditWorkflowAuthoringBudget(
  inputs: WorkflowAuthoringBudgetInputs,
): readonly string[] {
  const violations: string[] = [];
  const ids = inputs.workflows.map(({ id }) => id);
  const parsed = new Map<string, ts.SourceFile>();
  const sourceOf = (path: string, text: string): ts.SourceFile => {
    const existing = parsed.get(path);
    if (existing !== undefined) return existing;
    const source = parseSource(path, text);
    parsed.set(path, source);
    return source;
  };

  // ---- arm (a): the retired authoring path may not return, by any name -----
  for (const [path, text] of inputs.tree.sources) {
    if (path === GUARD_FILE || path.startsWith(GUARD_HELPERS)) continue;
    const basename = path.split("/").at(-1) ?? "";
    if (basename === "recipe.ts") {
      violations.push(
        `${path} is named recipe.ts; \`recipe\` is a forbidden name for this seam — the authored file is `
        + "workflow.ts (D317, §1.6)",
      );
    }
    for (const { token, rule } of RETIRED_NAMES) {
      let index = text.indexOf(token);
      while (index !== -1) {
        violations.push(
          `${path}:${lineOfOffset(text, index)} carries the retired authoring name \`${token}\` (${rule})`,
        );
        index = text.indexOf(token, index + token.length);
      }
    }
    if (!isSeamFile(path)) continue;
    eachNode(sourceOf(path, text), (node) => {
      if (!ts.isIdentifier(node) || node.text !== "recipe") return;
      violations.push(
        `${path}:${lineOf(sourceOf(path, text), node)} uses the bare identifier \`recipe\` inside the authoring `
        + "seam; \"recipe\" is the teaching analogy, never a type, file, API or second domain concept (D317, §1.6)",
      );
    });
  }

  // ---- arm (b): nothing is hand-authored beside workflow.ts ----------------
  for (const [path, text] of inputs.tree.sources) {
    if (!path.startsWith(WORKFLOWS_ROOT)) continue;
    const source = sourceOf(path, text);
    let defineWorkflowCalls = 0;
    eachNode(source, (node) => {
      const specifier = moduleSpecifierOf(node);
      if (specifier !== undefined && /(^|\/)base\/flow\.js$/.test(specifier)) {
        violations.push(
          `${path}:${lineOf(source, node)} imports "${specifier}"; the flow builder is compiler-internal since `
          + "D311 and a workflow folder authors only its defineWorkflow call (§1.6 item 4)",
        );
      }
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name === undefined) return;
      if (name === "defineWorkflow") defineWorkflowCalls += 1;
      const banned = HAND_AUTHORED_CALLS.get(name);
      if (banned !== undefined) {
        violations.push(`${path}:${lineOf(source, node)} calls ${name}(): ${banned}`);
      }
    });
    if (!path.endsWith("/workflow.ts")) continue;
    if (defineWorkflowCalls !== 1) {
      violations.push(
        `${path} holds ${defineWorkflowCalls} defineWorkflow( call(s); D312 §1.6.1 item 1 authors exactly ONE per `
        + "workflow file (defineWorkflowStep( and defineStepEntries( are D315 step identities and are allowed)",
      );
    }
  }

  // ---- arm (c): no generic surface branches on a workflow id (D316) --------
  const allowedPairs = new Set(
    inputs.genericIdAllowlist.map(({ file, workflowId }) => pairKey(file, workflowId)),
  );
  const usedPairs = new Set<string>();
  for (const [path, text] of inputs.tree.sources) {
    if (!GENERIC_ROOTS.some((prefix) => path.startsWith(prefix))) continue;
    if (isTestSource(path)) continue;
    if (!ids.some((id) => text.includes(id))) continue;
    const source = sourceOf(path, text);
    eachNode(source, (node) => {
      if (!ts.isStringLiteralLike(node) || !ids.includes(node.text)) return;
      const pair = pairKey(path, node.text);
      if (allowedPairs.has(pair)) {
        usedPairs.add(pair);
        return;
      }
      violations.push(
        `${path}:${lineOf(source, node)} names workflow "${node.text}" as ${literalContext(node)} in a generic `
        + "surface; a generic dashboard/server branch keyed by workflow id fails D316 (§1.6.1) — a reuse-only "
        + "workflow changes workflow.ts once and nothing else",
      );
    });
  }
  for (const entry of inputs.genericIdAllowlist) {
    if (!CITATION.test(entry.reason)) {
      violations.push(
        `${entry.file} / "${entry.workflowId}": the D316 allowlist reason must cite the decision the site's own `
        + "comments name",
      );
    }
    if (!usedPairs.has(pairKey(entry.file, entry.workflowId))) {
      violations.push(
        `${entry.file} / "${entry.workflowId}": stale D316 allowlist entry — the scan found no such workflow-id `
        + "literal there; remove the entry with the branch",
      );
    }
  }

  // ---- arm (d): four authored artifacts per workflow, and no fifth ---------
  const artifactFiles = new Set(inputs.tree.artifactFiles);
  const allowedArtifacts = new Set<string>();
  for (const { id, sourcePath } of inputs.workflows) {
    allowedArtifacts.add(sourcePath);
    allowedArtifacts.add(`tests/scenario/workflows/${id}/structural.scenario.test.ts`);
    allowedArtifacts.add(`tests/scenario/workflows/${id}/dry-run.scenario.ts`);
    allowedArtifacts.add(`docs/migrations/${id}.md`);
  }
  for (const entry of inputs.preCanonicalScenarios) {
    allowedArtifacts.add(entry.file);
    if (!CITATION.test(entry.reason)) {
      violations.push(`${entry.file}: the pre-canonical structural-scenario reason must cite its authority`);
    }
    if (!ids.includes(entry.workflowId)) {
      violations.push(`${entry.file}: pre-canonical entry names unregistered workflow "${entry.workflowId}"`);
    }
    if (!artifactFiles.has(entry.file)) {
      violations.push(
        `${entry.file}: stale pre-canonical structural-scenario entry — no such file; canonicalize the entry away `
        + "rather than leaving it behind",
      );
    }
  }
  for (const entry of inputs.artifactExemptions) {
    if (!CITATION.test(entry.reason)) {
      violations.push(`${entry.path}: the D312 artifact exemption must cite its authority`);
    }
    const matched = inputs.tree.artifactFiles.some((file) =>
      entry.path.endsWith("/") ? file.startsWith(entry.path) : file === entry.path);
    if (!matched) {
      violations.push(`${entry.path}: stale D312 artifact exemption — it matches no repository-visible file`);
    }
  }

  for (const file of inputs.tree.artifactFiles) {
    if (allowedArtifacts.has(file)) continue;
    if (inputs.artifactExemptions.some((entry) =>
      entry.path.endsWith("/") ? file.startsWith(entry.path) : file === entry.path)) continue;
    const owner = attributeWorkflowArtifact(file, inputs.workflows);
    if (owner === undefined) continue;
    const workflow = inputs.workflows.find(({ id }) => id === owner);
    if (workflow === undefined) {
      // Attribution answers only with an id it was given, so this cannot
      // happen — and if it ever does, the refusal must not quietly print a
      // plausible `its workflow.ts` in place of the budget it failed to find.
      throw new Error(`attributeWorkflowArtifact attributed ${file} to unregistered workflow "${owner}"`);
    }
    violations.push(
      `${file} is a fifth authored artifact for workflow ${owner}; D312 §1.6.1's budget is exactly `
      + `${workflow.sourcePath}, tests/scenario/workflows/${owner}/structural.scenario.test.ts, `
      + `tests/scenario/workflows/${owner}/dry-run.scenario.ts and docs/migrations/${owner}.md`,
    );
  }

  for (const { id } of inputs.workflows) {
    const structural = [
      `tests/scenario/workflows/${id}/structural.scenario.test.ts`,
      ...inputs.preCanonicalScenarios.filter((entry) => entry.workflowId === id).map(({ file }) => file),
    ].filter((path) => artifactFiles.has(path));
    if (structural.length > 1) {
      violations.push(
        `workflow ${id} carries ${structural.length} structural scenarios (${structural.join(", ")}); D312 §1.6.1 `
        + "item 2 budgets exactly one",
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// The repository's three closed allowlists
// ---------------------------------------------------------------------------

const DRY_RUN_TARGET_REASON =
  "D318 / ref guards-and-tests §10.9 — the ONE production registration surface from a workflow id to its T1b "
  + "manifest loader and canonical-input resolver; the per-workflow ingress shapes differ, so an unregistered "
  + "workflow fails loud by name here instead of resolving to something plausible.";

const GENERIC_WORKFLOW_ID_ALLOWLIST: readonly GenericWorkflowIdAllowlistEntry[] = [
  { file: "src/server/dry-run-scenario/compose.ts", workflowId: "separations", reason: DRY_RUN_TARGET_REASON },
  { file: "src/server/dry-run-scenario/compose.ts", workflowId: "separations-kuali-finalization", reason: DRY_RUN_TARGET_REASON },
  { file: "src/server/dry-run-scenario/compose.ts", workflowId: "person-lookup", reason: DRY_RUN_TARGET_REASON },
  { file: "src/server/dry-run-scenario/manifests.ts", workflowId: "separations", reason: DRY_RUN_TARGET_REASON },
  { file: "src/server/dry-run-scenario/manifests.ts", workflowId: "separations-kuali-finalization", reason: DRY_RUN_TARGET_REASON },
  { file: "src/server/dry-run-scenario/manifests.ts", workflowId: "person-lookup", reason: DRY_RUN_TARGET_REASON },
  {
    file: "src/server/dashboard/compose.ts",
    workflowId: "separations",
    reason:
      "D289 — the retry receipt-comparison registry is sealed against the CURRENT separations descriptor's exact "
      + "node-to-task ownership; the file refuses by name when that descriptor is absent.",
  },
  {
    file: "src/server/dashboard/projectors/run-queue-projection.ts",
    workflowId: "separations",
    reason:
      "D288 — the Activity person-pseudonym fold is current-Separations-only BY DECISION: its evidence is minted "
      + "from a done Separations run's terminal result, so a foreign workflow's evidence row is counted foreign.",
  },
  {
    file: "src/server/activity-person-pseudonym-backfill/service.ts",
    workflowId: "separations",
    reason:
      "D288 — the reviewed backfill's `current-separations` scope is the decision's own named scope; it may inspect "
      + "no other workflow's runs.",
  },
] as const;

/**
 * Every registered workflow's structural scenario now sits at the canonical
 * `tests/scenario/workflows/<id>/` path (the four chunk harnesses moved there
 * 2026-09-03 in the test-suite rationalization); nothing is pre-canonical.
 */
const PRE_CANONICAL_SCENARIOS: readonly PreCanonicalScenarioEntry[] = [];

const ARTIFACT_EXEMPTIONS: readonly ArtifactExemptionEntry[] = [
  {
    path: "docs/migrations/separations-legacy-behavior.md",
    reason:
      "D312 — a supplement to docs/migrations/separations.md rather than a second migration doc; the budget item "
      + "is the migration record, and this is the same record's overflow.",
  },
  {
    path: "tests/scenario/dashboard/separations/",
    reason:
      "ref guards-and-tests §10.11/§10.12 — T2/T3 dashboard proofs, which §1.6.1 admits beside the four-artifact "
      + "budget because a genuinely new DASHBOARD capability is not reuse-only workflow authoring.",
  },
] as const;

function registeredWorkflowSources(): readonly RegisteredWorkflowSource[] {
  return WORKFLOW_MODULES.map((module) => {
    const id = String(module.descriptor.id);
    return {
      id,
      sourceFolder: workflowSourceFolder(id, module.role),
      sourcePath: workflowSourcePath(id, module.role),
    };
  });
}

function repositoryInputs(tree: WorkflowAuthoringBudgetTree): WorkflowAuthoringBudgetInputs {
  return {
    workflows: registeredWorkflowSources(),
    tree,
    genericIdAllowlist: GENERIC_WORKFLOW_ID_ALLOWLIST,
    preCanonicalScenarios: PRE_CANONICAL_SCENARIOS,
    artifactExemptions: ARTIFACT_EXEMPTIONS,
  };
}

// ---------------------------------------------------------------------------
// Fixtures — miniature repositories, written to a temp root, `git init`-ed and
// read back by the SAME collector the repository goes through.
// ---------------------------------------------------------------------------

const CLEAN_WORKFLOWS: readonly RegisteredWorkflowSource[] = [
  { id: "solo", sourceFolder: "src/workflows/solo", sourcePath: "src/workflows/solo/workflow.ts" },
  { id: "combo", sourceFolder: "src/workflows/combo", sourcePath: "src/workflows/combo/workflow.ts" },
  {
    id: "combo-harness",
    sourceFolder: "src/workflows/combo/step-one",
    sourcePath: "src/workflows/combo/step-one/workflow.ts",
  },
] as const;

function fixtureWorkflowFile(id: string, extra = ""): string {
  return `import { defineWorkflow } from "../../base/workflow-definition.js";\n`
    + `${extra}export const ${id.replaceAll("-", "_")}Workflow = defineWorkflow({ id: "${id}", steps: [] });\n`;
}

/**
 * The clean tree carries every tricky NEGATIVE this arm must not fire on: a
 * comment saying "login recipe" inside the authoring seam, an unrelated
 * `defineVerifiedLoginRecipe` outside it, `composeWorkflowModule` at the
 * composition root (outside `src/workflows/`), a harness scenario whose stem
 * starts with the composition's id, an exempted migration-doc supplement and an
 * exempted T2/T3 dashboard scenario folder.
 */
function cleanFixtureFiles(): Record<string, string> {
  return {
    "src/workflows/solo/workflow.ts": fixtureWorkflowFile("solo"),
    "src/workflows/combo/workflow.ts":
      "import { defineWorkflow, defineWorkflowStep, defineStepEntries } from \"../../base/workflow-definition.js\";\n"
      + "const step = defineWorkflowStep({ key: \"step-one\", label: \"Step one\" });\n"
      + "const entries = defineStepEntries(step, []);\n"
      + "export const comboWorkflow = defineWorkflow({ id: \"combo\", steps: [[step, entries]] });\n",
    "src/workflows/combo/step-one/workflow.ts":
      "// The step this harness proves brings a login recipe into existence.\n"
      + fixtureWorkflowFile("combo-harness"),
    "src/control/workflow-registry.ts":
      "import { composeWorkflowModule } from \"../base/workflow-definition.js\";\n"
      + "export const soloModule = composeWorkflowModule(soloWorkflow, stores);\n",
    "src/infra/browser/authenticated-application.ts":
      "// A login recipe returns only after observing an authenticated application.\n"
      + "export function defineVerifiedLoginRecipe(input) { return input.flow; }\n",
    "src/server/dashboard/compose.ts":
      "export function compose(descriptors) {\n"
      + "  return descriptors.find((descriptor) => descriptor.id === registeredId);\n"
      + "}\n",
    "tests/scenario/workflows/solo/structural.scenario.test.ts": "export const SOLO = 1;\n",
    "tests/scenario/workflows/solo/dry-run.scenario.ts": "export const SOLO_DRY_RUN = 1;\n",
    "tests/scenario/workflows/combo/structural.scenario.test.ts": "export const COMBO = 1;\n",
    "tests/scenario/workflows/combo/dry-run.scenario.ts": "export const COMBO_DRY_RUN = 1;\n",
    "tests/scenario/combo-harness.scenario.test.ts": "export const COMBO_HARNESS = 1;\n",
    "tests/scenario/dashboard/combo/world.ts": "export const WORLD = 1;\n",
    "tests/scenario/intake-extraction.scenario.test.ts": "export const INTAKE = 1;\n",
    "docs/migrations/solo.md": "# solo\n",
    "docs/migrations/combo.md": "# combo\n",
    "docs/migrations/combo-legacy-behavior.md": "# combo, as legacy did it\n",
    "docs/migrations/i9-lookup.md": "# an unregistered candidate\n",
  };
}

const CLEAN_PRE_CANONICAL: readonly PreCanonicalScenarioEntry[] = [{
  workflowId: "combo-harness",
  file: "tests/scenario/combo-harness.scenario.test.ts",
  reason: "D318 — pre-canonical harness path.",
}] as const;

const CLEAN_EXEMPTIONS: readonly ArtifactExemptionEntry[] = [
  { path: "docs/migrations/combo-legacy-behavior.md", reason: "D312 — the migration record's overflow." },
  { path: "tests/scenario/dashboard/combo/", reason: "ref guards-and-tests §10.12 — a T2/T3 dashboard proof." },
] as const;

/** One miniature repository plus the three allowlists it is judged under. */
interface BudgetFixtureTree {
  readonly files: Record<string, string>;
  readonly genericIdAllowlist?: readonly GenericWorkflowIdAllowlistEntry[];
  readonly preCanonicalScenarios?: readonly PreCanonicalScenarioEntry[];
  readonly artifactExemptions?: readonly ArtifactExemptionEntry[];
}

interface BudgetFixture extends BudgetFixtureTree {
  readonly name: string;
  readonly arm: "a" | "b" | "c" | "d";
  readonly expected: RegExp;
}

function withFiles(mutate: (files: Record<string, string>) => void): Record<string, string> {
  const files = cleanFixtureFiles();
  mutate(files);
  return files;
}

/**
 * Arm (c)'s allowlist is keyed by the PAIR. One reviewed entry, held constant
 * across three trees, is what separates that from a file-keyed or an id-keyed
 * check: the same entry must admit `(compose.ts, "solo")`, refuse `"combo"` in
 * that same file, and refuse `"solo"` in a different file.
 */
const PAIR_EXACT_ENTRY: GenericWorkflowIdAllowlistEntry = {
  file: "src/server/dashboard/compose.ts",
  workflowId: "solo",
  reason: "D316 — the one reviewed pair these three fixtures hold constant.",
};
const SOLO_BRANCH = "export const isSolo = (id) => id === \"solo\";\n";
const COMBO_BRANCH = "export const isCombo = (id) => id === \"combo\";\n";

const FIXTURES: readonly BudgetFixture[] = [
  {
    name: "retired-recipe-type-anywhere-in-the-program",
    arm: "a",
    files: withFiles((files) => {
      files["src/base/workflow-definition.ts"] = "export type WorkflowRecipe = { readonly steps: readonly [] };\n";
    }),
    expected: /src\/base\/workflow-definition\.ts:1 carries the retired authoring name `WorkflowRecipe` \(D317/,
  },
  {
    name: "retired-node-fragment-factory-in-a-test",
    arm: "a",
    files: withFiles((files) => {
      files["tests/unit/nodes.test.ts"] = "const nodes = defineWorkflowStepNodeFactory(step);\n";
    }),
    expected: /tests\/unit\/nodes\.test\.ts:1 carries the retired authoring name `defineWorkflowStepNodeFactory` \(D312/,
  },
  {
    name: "retired-workflow-recipe-specifier",
    arm: "a",
    files: withFiles((files) => {
      files["src/base/workflow-definition.ts"] = "export { compileWorkflow } from \"./workflow-recipe.js\";\n";
    }),
    expected: /carries the retired authoring name `workflow-recipe`/,
  },
  {
    name: "a-file-named-recipe-ts",
    arm: "a",
    files: withFiles((files) => {
      files["src/domain/workflow/recipe.ts"] = "export const RECIPE = 1;\n";
    }),
    expected: /src\/domain\/workflow\/recipe\.ts is named recipe\.ts; `recipe` is a forbidden name/,
  },
  {
    name: "bare-recipe-identifier-inside-the-authoring-seam",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] = fixtureWorkflowFile("solo", "const recipe = { steps: [] };\n");
    }),
    expected: /src\/workflows\/solo\/workflow\.ts:2 uses the bare identifier `recipe` inside the authoring seam/,
  },
  {
    name: "flow-builder-imported-and-called-beside-workflow-ts",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        "import { flow } from \"../../base/flow.js\";\n"
        + fixtureWorkflowFile("solo", "const graph = flow().build();\n");
    }),
    expected: /src\/workflows\/solo\/workflow\.ts:1 imports "\.\.\/\.\.\/base\/flow\.js"[\s\S]*calls flow\(\): the flow builder is compiler-internal/,
  },
  {
    // The step folder is three levels below `src/`, so a relative specifier
    // that reaches the flow builder is `../../../base/flow.js` there. A
    // two-dot-only pattern would have missed every harness.
    name: "flow-builder-imported-three-levels-up-from-a-step-folder",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/combo/step-one/workflow.ts"] =
        "import { flow } from \"../../../base/flow.js\";\n"
        + fixtureWorkflowFile("combo-harness");
    }),
    expected: /src\/workflows\/combo\/step-one\/workflow\.ts:1 imports "\.\.\/\.\.\/\.\.\/base\/flow\.js"; the flow builder is compiler-internal/,
  },
  {
    name: "descriptor-hand-authored-under-src-workflows",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        fixtureWorkflowFile("solo", "const descriptor = defineWorkflowDescriptor({ id: \"solo\" });\n");
    }),
    expected: /calls defineWorkflowDescriptor\(\): a descriptor is COMPILED from workflow\.ts, never authored \(D312\/D317\)/,
  },
  {
    name: "stores-composed-inside-a-workflow-folder",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        fixtureWorkflowFile("solo", "const composed = composeWorkflowModule(soloWorkflow, stores);\n");
    }),
    expected: /calls composeWorkflowModule\(\): stores are composed only at src\/control\/workflow-registry\.ts/,
  },
  {
    name: "two-defineWorkflow-calls-in-one-workflow-file",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        fixtureWorkflowFile("solo", "const shadow = defineWorkflow({ id: \"solo-shadow\", steps: [] });\n");
    }),
    expected: /src\/workflows\/solo\/workflow\.ts holds 2 defineWorkflow\( call\(s\); D312 .* authors exactly ONE/,
  },
  {
    name: "generic-server-branch-keyed-by-workflow-id",
    arm: "c",
    files: withFiles((files) => {
      files["src/server/dashboard/projectors/run-queue-projection.ts"] =
        "export function fold(record) {\n"
        + "  if (record.workflowId !== \"combo\") return undefined;\n"
        + "  return record;\n"
        + "}\n";
    }),
    expected: /run-queue-projection\.ts:2 names workflow "combo" as an equality comparison in a generic surface; a generic dashboard\/server branch keyed by workflow id fails D316/,
  },
  {
    name: "generic-dashboard-dispatch-table-keyed-by-workflow-id",
    arm: "c",
    files: withFiles((files) => {
      files["src/dashboard/surfaces/picker-model.ts"] =
        "export const LABELS = new Map([\n"
        + "  [\"combo-harness\", \"Combo harness\"],\n"
        + "]);\n";
    }),
    expected: /picker-model\.ts:2 names workflow "combo-harness" as a dispatch-table key in a generic surface/,
  },
  {
    // Pair-exactness, half one: the allowlisted FILE, a different workflow id.
    // A file-keyed allowlist passes this fixture.
    name: "allowlisted-file-branching-on-a-DIFFERENT-workflow-id",
    arm: "c",
    files: withFiles((files) => { files[PAIR_EXACT_ENTRY.file] = SOLO_BRANCH + COMBO_BRANCH; }),
    genericIdAllowlist: [PAIR_EXACT_ENTRY],
    expected: /src\/server\/dashboard\/compose\.ts:2 names workflow "combo" as an equality comparison in a generic surface/,
  },
  {
    // Pair-exactness, half two: the allowlisted workflow id, a different file.
    // An id-keyed allowlist passes this fixture.
    name: "another-file-branching-on-an-allowlisted-workflow-id",
    arm: "c",
    files: withFiles((files) => {
      files[PAIR_EXACT_ENTRY.file] = SOLO_BRANCH;
      files["src/services/workflow-labels.ts"] = SOLO_BRANCH;
    }),
    genericIdAllowlist: [PAIR_EXACT_ENTRY],
    expected: /src\/services\/workflow-labels\.ts:1 names workflow "solo" as an equality comparison in a generic surface/,
  },
  {
    name: "stale-D316-allowlist-entry",
    arm: "c",
    files: cleanFixtureFiles(),
    genericIdAllowlist: [{
      file: "src/server/dashboard/compose.ts",
      workflowId: "combo",
      reason: "D316 — a branch that no longer exists.",
    }],
    expected: /stale D316 allowlist entry — the scan found no such workflow-id literal there/,
  },
  {
    name: "uncited-D316-allowlist-entry",
    arm: "c",
    files: withFiles((files) => {
      files["src/server/dashboard/compose.ts"] =
        "export const isCombo = (id) => id === \"combo\";\n";
    }),
    genericIdAllowlist: [{
      file: "src/server/dashboard/compose.ts",
      workflowId: "combo",
      reason: "it has always been like this",
    }],
    expected: /the D316 allowlist reason must cite the decision the site's own comments name/,
  },
  {
    name: "fifth-authored-artifact-for-a-workflow",
    arm: "d",
    files: withFiles((files) => { files["docs/migrations/combo-appendix.md"] = "# one more file\n"; }),
    expected: /docs\/migrations\/combo-appendix\.md is a fifth authored artifact for workflow combo; D312 .* budget is exactly src\/workflows\/combo\/workflow\.ts/,
  },
  {
    name: "fifth-artifact-under-tests-scenario",
    arm: "d",
    files: withFiles((files) => {
      files["tests/scenario/workflows/solo/edge-cases.scenario.test.ts"] = "export const EDGE = 1;\n";
    }),
    expected: /tests\/scenario\/workflows\/solo\/edge-cases\.scenario\.test\.ts is a fifth authored artifact for workflow solo/,
  },
  {
    // The folder rule: a harness id is never a path segment, so only
    // `workflowSourceFolder` can charge this file to the harness that owns it.
    name: "fifth-artifact-inside-a-harness-folder-belongs-to-the-harness",
    arm: "d",
    files: withFiles((files) => { files["src/workflows/combo/step-one/nodes.ts"] = "export const NODES = 1;\n"; }),
    expected: /src\/workflows\/combo\/step-one\/nodes\.ts is a fifth authored artifact for workflow combo-harness; D312 .* budget is exactly src\/workflows\/combo\/step-one\/workflow\.ts/,
  },
  {
    // The two ways out of the budget by suffixing an unregistered word.
    name: "fifth-artifact-in-a-folder-suffixing-a-registered-id",
    arm: "d",
    files: withFiles((files) => { files["tests/scenario/combo-extra/world.ts"] = "export const WORLD = 1;\n"; }),
    expected: /tests\/scenario\/combo-extra\/world\.ts is a fifth authored artifact for workflow combo;/,
  },
  {
    name: "fifth-artifact-whose-stem-suffixes-a-registered-id-with-an-underscore",
    arm: "d",
    files: withFiles((files) => { files["docs/migrations/combo_extra.md"] = "# one more file\n"; }),
    expected: /docs\/migrations\/combo_extra\.md is a fifth authored artifact for workflow combo;/,
  },
  {
    name: "two-structural-scenarios-for-one-workflow",
    arm: "d",
    files: withFiles((files) => {
      files["tests/scenario/workflows/combo-harness/structural.scenario.test.ts"] = "export const H = 1;\n";
    }),
    expected: /workflow combo-harness carries 2 structural scenarios .*; D312 .* budgets exactly one/,
  },
  {
    name: "stale-artifact-exemption",
    arm: "d",
    files: cleanFixtureFiles(),
    artifactExemptions: [
      ...CLEAN_EXEMPTIONS,
      { path: "docs/migrations/combo-gone.md", reason: "D312 — removed long ago." },
    ],
    expected: /docs\/migrations\/combo-gone\.md: stale D312 artifact exemption — it matches no repository-visible file/,
  },
  {
    name: "stale-pre-canonical-structural-scenario",
    arm: "d",
    files: cleanFixtureFiles(),
    preCanonicalScenarios: [
      ...CLEAN_PRE_CANONICAL,
      { workflowId: "solo", file: "tests/scenario/solo.scenario.test.ts", reason: "D318 — moved already." },
    ],
    expected: /tests\/scenario\/solo\.scenario\.test\.ts: stale pre-canonical structural-scenario entry/,
  },
];

function writeFixtureTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-authoring-budget-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  // `git init` so the fixture is listed by the SAME `gitVisibleFilesIn` the
  // repository goes through — a second walker written for fixtures would be a
  // second opinion about what "a repository-visible file" is.
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

function fixtureInputs(fixture: BudgetFixtureTree, root: string): WorkflowAuthoringBudgetInputs {
  return {
    workflows: CLEAN_WORKFLOWS,
    tree: collectWorkflowAuthoringBudgetTree(root),
    genericIdAllowlist: fixture.genericIdAllowlist ?? [],
    preCanonicalScenarios: fixture.preCanonicalScenarios ?? CLEAN_PRE_CANONICAL,
    artifactExemptions: fixture.artifactExemptions ?? CLEAN_EXEMPTIONS,
  };
}

/** Write one miniature repository, audit it through the real collector, remove it. */
function auditFixture(fixture: BudgetFixtureTree): readonly string[] {
  const root = writeFixtureTree(fixture.files);
  try {
    return auditWorkflowAuthoringBudget(fixtureInputs(fixture, root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertCleanFixturePasses(): void {
  assert.deepEqual(
    auditFixture({ files: cleanFixtureFiles() }),
    [],
    "the clean fixture must pass, or the violating fixtures prove nothing",
  );
}

describe("workflow-authoring-budget — the retired path stays dead and D312's budget has no escape hatch", () => {
  const tree = collectWorkflowAuthoringBudgetTree(REPO_ROOT);

  it("all four arms: the real repository is inside the budget, and the scan is not empty", () => {
    // A collector that resolved nothing would report every arm green, so both
    // halves of the tree are asserted non-empty first. The allowlist staleness
    // arms are the third negative control: they can only stay silent if the
    // scanner actually reached those exact literals, files and folders.
    assert.ok(tree.sources.size > 500, `source scan resolved only ${tree.sources.size} files`);
    assert.ok(tree.artifactFiles.length > 10, `artifact scan resolved only ${tree.artifactFiles.length} files`);
    const registered = registeredWorkflowSources();
    assert.ok(registered.length >= 7, "the registered workflows must stay in the scan");
    // Arm (b)'s own negative control: the authored workflow files it reads are
    // EXACTLY the registered ones. A scan that entered no `workflow.ts` — a
    // moved root, a lister that stopped listing `src/workflows/` — would report
    // this arm green over nothing at all.
    const scannedWorkflowFiles = [...tree.sources.keys()]
      .filter((path) => path.startsWith(WORKFLOWS_ROOT) && path.endsWith("/workflow.ts"))
      .sort();
    assert.ok(
      scannedWorkflowFiles.length >= 2,
      `arm (b) entered only ${scannedWorkflowFiles.length} workflow.ts file(s)`,
    );
    assert.deepEqual(scannedWorkflowFiles, [...registered].map(({ sourcePath }) => sourcePath).sort());
    assert.deepEqual(auditWorkflowAuthoringBudget(repositoryInputs(tree)), []);
  });

  it("arm (a): the seam's comment prose and the unrelated login-recipe seam both stay legal", () => {
    // The two live negatives this arm must never fire on. If the `recipe`
    // check ever became a text scan, both of these would go red — and the
    // guard would be teaching authors to delete accurate prose.
    const harness = tree.sources.get("src/workflows/separations/kronos-timecard/workflow.ts");
    assert.ok(harness !== undefined && /login recipe/.test(harness), "the harness comment must stay in the scan");
    const login = tree.sources.get("src/infra/browser/authenticated-application.ts");
    assert.ok(login !== undefined && /defineVerifiedLoginRecipe/.test(login), "the login seam must stay in the scan");
    assert.deepEqual(auditWorkflowAuthoringBudget(repositoryInputs(tree)), []);
  });

  it("arm (d): a harness's own files are never counted against the composition that owns its folder", () => {
    const workflows = registeredWorkflowSources();
    assert.equal(
      attributeWorkflowArtifact("tests/scenario/separations-kuali-read.scenario.test.ts", workflows),
      "separations-kuali-read",
    );
    assert.equal(
      attributeWorkflowArtifact(
        "tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.ts",
        workflows,
      ),
      "separations-kuali-finalization",
    );
    assert.equal(
      attributeWorkflowArtifact("docs/migrations/separations-legacy-behavior.md", workflows),
      "separations",
    );
    assert.equal(attributeWorkflowArtifact("docs/migrations/i9-lookup.md", workflows), undefined);
    assert.equal(attributeWorkflowArtifact("src/workflows/descriptor-registry.ts", workflows), undefined);
    // Inside `src/workflows/` the harness id is NOT in the path: only the
    // registered FOLDER can say whose budget a file beside its workflow.ts is.
    assert.equal(
      attributeWorkflowArtifact("src/workflows/separations/identity-check/module.ts", workflows),
      "separations-identity-check",
    );
    assert.equal(attributeWorkflowArtifact("src/workflows/separations/module.ts", workflows), "separations");
    // Outside it, a longer word built on a registered id stays that workflow's
    // budget rather than attributing to nothing and escaping the arm.
    assert.equal(attributeWorkflowArtifact("tests/scenario/separations-extra/foo.ts", workflows), "separations");
    assert.equal(attributeWorkflowArtifact("docs/migrations/separations_extra.md", workflows), "separations");
  });

  it("arm (c): the reviewed (file, workflow id) pair itself passes, so the allowlist is pair-EXACT", () => {
    // The two halves that would make a file-keyed or an id-keyed allowlist
    // indistinguishable from this one are the fixtures
    // `allowlisted-file-branching-on-a-DIFFERENT-workflow-id` and
    // `another-file-branching-on-an-allowlisted-workflow-id`. This is the
    // third leg: the exact pair, and nothing else, is admitted.
    const files = withFiles((tree) => { tree[PAIR_EXACT_ENTRY.file] = SOLO_BRANCH; });
    assert.deepEqual(auditFixture({ files, genericIdAllowlist: [PAIR_EXACT_ENTRY] }), []);
  });

  for (const fixture of FIXTURES) {
    it(`arm (${fixture.arm}): refuses ${fixture.name}`, () => {
      assertCleanFixturePasses();
      const violations = auditFixture(fixture);
      assert.ok(violations.length > 0, `${fixture.name} produced no violation`);
      assert.match(violations.join("\n"), fixture.expected);
    });
  }
});
