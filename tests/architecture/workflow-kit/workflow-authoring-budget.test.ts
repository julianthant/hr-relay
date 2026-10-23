import { createRetainedDashboardMockFixtures } from "../../support/helpers/retained-dashboard-mock-fixtures.js";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";

import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { workflowScenarioFolder, workflowSourceFolder, workflowSourcePath } from "../../../src/workflow-kit/validation/source-layout.js";
import { gitVisibleFilesIn, REPO_ROOT } from "../support/helpers/guard-files.js";



/** Everything the collector lists, in one `git ls-files` call. */
const SCAN_ROOTS = ["src", "tests", "scripts"] as const;
/** Roots whose `.ts`/`.tsx` text arms (a)-(c) read. */
const SOURCE_ROOTS = ["src/", "tests/", "scripts/"] as const;
/** Roots arm (d) counts authored artifacts in. */
const ARTIFACT_ROOTS = ["src/workflows/", "tests/scenario/"] as const;

/** This guard's fixtures must be able to spell the forbidden names. */
const GUARD_FILE = "tests/architecture/workflow-kit/workflow-authoring-budget.test.ts";
const GUARD_HELPERS = /^(?:tests\/architecture\/support\/helpers\/|tests\/architecture\/[^/]+\/helpers\/)/u;

/** contract authoring seam — the only place the bare word `recipe` is code-checked. */
const SEAM_FILES = [
  "src/workflow-kit/workflow-definition.ts",
  "src/workflow-kit/workflow.ts",
  "src/backend/app/registries/workflow-registry.ts",
] as const;
const SEAM_PREFIXES = ["src/workflows/", "src/workflow-kit/"] as const;

/** Arm (b)'s root: the authored workflow files themselves. */
const WORKFLOWS_ROOT = "src/workflows/";

const GENERIC_ROOTS = [
  "src/dashboard/", "src/backend/app/", "src/backend/transports/", "src/backend/runtime/", "src/backend/logs/", "src/services/",
  "src/backend/runs/commands/", "src/backend/runs/projections/", "src/backend/runs/queries/",
  "src/backend/runs/exports/", "src/backend/runs/trust/", "src/backend/runs/start/",
  "src/backend/runs/archive/", "src/backend/runs/notifications/", "src/backend/runs/explain/",
] as const;
const GENERIC_RUN_FILES = new Set([
  "src/backend/runs/start/enqueue.ts", "src/backend/runs/commands/refusals.ts",
  "src/backend/runs/lifecycle/run-status.ts", "src/backend/runs/lifecycle/support.ts",
]);

const { RETAINED_MOCK_SITES, retainedLiteralSite, RETAINED_MOCK_LITERALS } = createRetainedDashboardMockFixtures();


function retainedMockLiteralsMatch(path: string, source: ts.SourceFile, ids: readonly string[]): boolean {
  const expected = RETAINED_MOCK_SITES[path];
  if (expected === undefined) return false;
  const values: string[] = [];
  eachNode(source, node => { if (ts.isStringLiteralLike(node) && ids.includes(node.text)) values.push(retainedLiteralSite(node, source)); });
  return JSON.stringify(values) === JSON.stringify(expected);
}

/** Arm (b): builders a workflow folder may not call. */
const HAND_AUTHORED_CALLS: ReadonlyMap<string, string> = new Map([
  ["defineWorkflowDescriptor", "a descriptor is COMPILED from workflow.ts, never authored"],
  ["flow", "the flow builder is compiler-internal (contract)"],
  ["composeWorkflowModule", "stores are composed only at src/backend/app/registries/workflow-registry.ts"],
]);

const COMPARISON_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);



const ID_SEPARATORS = ["-", "_", "."] as const;



export interface WorkflowAuthoringBudgetTree {
  /** Repo-relative `.ts`/`.tsx` path → its source text. */
  readonly sources: ReadonlyMap<string, string>;
  /** Every repository-visible file under the artifact roots, any extension. */
  readonly artifactFiles: readonly string[];
}

export interface RegisteredWorkflowSource {
  readonly id: string;

  readonly sourceFolder: string;

  readonly sourcePath: string;
  readonly scenarioFolder: string;
}

/** Arm (c): one reviewed `(file, workflow id)` pair, with its current reason. */
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

// Use an escaped separator; a raw control byte can hide source from audit tools.
function pairKey(file: string, workflowId: string): string {
  return `${file}\u001f${workflowId}`;
}

function isSeamFile(path: string): boolean {
  return SEAM_FILES.some((seam) => seam === path) || SEAM_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isTestSource(path: string): boolean {
  return path.includes(".test.") || path.includes(".scenario.") || path.includes(".walk.");
}


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

// Workflow-tree artifacts take their registered folder owner; other artifacts use segment-delimited ids.
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
  if (file.startsWith("tests/scenario/workflows/")) {
    let owner: RegisteredWorkflowSource | undefined;
    for (const workflow of workflows) {
      if (!file.startsWith(`${workflow.scenarioFolder}/`)) continue;
      if (owner === undefined || workflow.scenarioFolder.length > owner.scenarioFolder.length) owner = workflow;
    }
    if (owner !== undefined) return owner.id;
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


  for (const [path, text] of inputs.tree.sources) {
    if (path === GUARD_FILE || GUARD_HELPERS.test(path)) continue;
    const basename = path.split("/").at(-1) ?? "";
    if (basename === "recipe.ts") {
      violations.push(
        `${path} is named recipe.ts; \`recipe\` is a forbidden name for this seam — the authored file is `
        + "workflow.ts (definition contract, contract)",
      );
    }
    if (!isSeamFile(path)) continue;
    eachNode(sourceOf(path, text), (node) => {
      if (!ts.isIdentifier(node) || node.text !== "recipe") return;
      violations.push(
        `${path}:${lineOf(sourceOf(path, text), node)} uses the bare identifier \`recipe\` inside the authoring `
        + "seam; \"recipe\" is the teaching analogy, never a type, file, API or second domain concept (definition contract, contract)",
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
          `${path}:${lineOf(source, node)} imports "${specifier}"; the flow builder is compiler-internal; `
          + "a workflow folder authors only its defineWorkflow call (contract)",
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
    if (!inputs.workflows.some((workflow) => workflow.sourcePath === path)) {
      if (defineWorkflowCalls > 0) violations.push(`${path} authors defineWorkflow( outside a registered entry`);
      continue;
    }
    if (defineWorkflowCalls !== 1) {
      violations.push(
        `${path} holds ${defineWorkflowCalls} defineWorkflow( call(s); workflow budget contract authors exactly ONE per `
        + "workflow file (defineWorkflowStep( and defineStepEntries( are step identities and are allowed)",
      );
    }
  }


  const allowedPairs = new Set(
    inputs.genericIdAllowlist.map(({ file, workflowId }) => pairKey(file, workflowId)),
  );
  const usedPairs = new Set<string>();
  for (const [path, text] of inputs.tree.sources) {
    if (!GENERIC_ROOTS.some((prefix) => path.startsWith(prefix)) && !GENERIC_RUN_FILES.has(path)) continue;
    if (isTestSource(path)) continue;
    if (!ids.some((id) => text.includes(id))) continue;
    const source = sourceOf(path, text);
    if (retainedMockLiteralsMatch(path, source, ids)) continue;
    eachNode(source, (node) => {
      if (!ts.isStringLiteralLike(node) || !ids.includes(node.text)) return;
      const pair = pairKey(path, node.text);
      if (allowedPairs.has(pair)) {
        usedPairs.add(pair);
        return;
      }
      violations.push(
        `${path}:${lineOf(source, node)} names workflow "${node.text}" as ${literalContext(node)} in a generic `
        + "surface; a generic dashboard/server branch keyed by workflow id fails workflow-id boundary (contract) — a reuse-only "
        + "workflow changes workflow.ts once and nothing else",
      );
    });
  }
  for (const entry of inputs.genericIdAllowlist) {
    if (entry.reason.trim().length === 0) {
      violations.push(
        `${entry.file} / "${entry.workflowId}": the workflow-id boundary allowlist requires a current reason`,
      );
    }
    if (!usedPairs.has(pairKey(entry.file, entry.workflowId))) {
      violations.push(
        `${entry.file} / "${entry.workflowId}": stale workflow-id boundary allowlist entry — the scan found no such workflow-id `
        + "literal there; remove the entry with the branch",
      );
    }
  }

  // ---- arm (d): four authored artifacts per workflow, and no fifth ---------
  const artifactFiles = new Set(inputs.tree.artifactFiles);
  const allowedArtifacts = new Set<string>();
  for (const { sourcePath, scenarioFolder } of inputs.workflows) {
    allowedArtifacts.add(sourcePath);
    allowedArtifacts.add(`${scenarioFolder}/structural.scenario.test.ts`);
    allowedArtifacts.add(`${scenarioFolder}/dry-run.scenario.ts`);
    if (sourcePath.endsWith("/workflow.ts")) {
      allowedArtifacts.add(`${sourcePath.slice(0, -"workflow.ts".length)}task-registry.ts`);
      for (const taskFile of inputs.tree.artifactFiles) {
        if (/\/tasks\/[^/]+\.ts$/u.test(taskFile) && taskFile.startsWith(`${sourcePath.slice(0, -"workflow.ts".length)}tasks/`)) {
          allowedArtifacts.add(taskFile);
        }
      }
    }
  }
  for (const entry of inputs.preCanonicalScenarios) {
    allowedArtifacts.add(entry.file);
    if (entry.reason.trim().length === 0) {
      violations.push(`${entry.file}: the pre-canonical structural-scenario requires a current reason`);
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
    if (entry.reason.trim().length === 0) {
      violations.push(`${entry.path}: the workflow budget artifact exemption must cite its authority`);
    }
    const matched = inputs.tree.artifactFiles.some((file) =>
      entry.path.endsWith("/") ? file.startsWith(entry.path) : file === entry.path);
    if (!matched) {
      violations.push(`${entry.path}: stale workflow budget artifact exemption — it matches no repository-visible file`);
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

      throw new Error(`attributeWorkflowArtifact attributed ${file} to unregistered workflow "${owner}"`);
    }
    violations.push(
      `${file} is an extra authored artifact for workflow ${owner}; workflow budget contract budget is exactly `
      + `${workflow.sourcePath}, ${workflow.scenarioFolder}/structural.scenario.test.ts, `
      + `${workflow.scenarioFolder}/dry-run.scenario.ts`,
    );
  }

  for (const { id, scenarioFolder } of inputs.workflows) {
    const structural = [
      `${scenarioFolder}/structural.scenario.test.ts`,
      ...inputs.preCanonicalScenarios.filter((entry) => entry.workflowId === id).map(({ file }) => file),
    ].filter((path) => artifactFiles.has(path));
    if (structural.length > 1) {
      violations.push(
        `workflow ${id} carries ${structural.length} structural scenarios (${structural.join(", ")}); workflow budget contract `
        + "item 2 budgets exactly one",
      );
    }
  }

  return violations;
}



const DRY_RUN_TARGET_REASON =
  "the ONE production registration surface from a workflow id to its T1b "
  + "manifest loader and canonical-input resolver; the per-workflow ingress shapes differ, so an unregistered "
  + "workflow fails loud by name here instead of resolving to something plausible.";

const GENERIC_WORKFLOW_ID_ALLOWLIST: readonly GenericWorkflowIdAllowlistEntry[] = [
  { file: "src/backend/app/registries/test-target-registry.ts", workflowId: "separations",
    reason: "the committed public test-target registry names the exact supported workflow, without dispatching production behavior." },
  { file: "src/backend/app/registries/test-target-registry.ts", workflowId: "separations-kuali-finalization",
    reason: "the committed public test-target registry names the exact supported workflow, without dispatching production behavior." },
  { file: "src/backend/app/registries/test-target-registry.ts", workflowId: "person-lookup",
    reason: "the committed public test-target registry names the exact supported workflow, without dispatching production behavior." },
  { file: "src/backend/app/dry-run/manifests.ts", workflowId: "separations", reason: DRY_RUN_TARGET_REASON },
  { file: "src/backend/app/dry-run/manifests.ts", workflowId: "separations-kuali-finalization", reason: DRY_RUN_TARGET_REASON },
  { file: "src/backend/app/dry-run/manifests.ts", workflowId: "person-lookup", reason: DRY_RUN_TARGET_REASON },
  { file: "src/backend/runs/projections/run-queue-projection.ts", workflowId: "separations",
    reason: "retained projection callers use the same current-Separations-only canonical identity corpus as indexed Activity." },
  {
    file: "src/backend/runs/queries/activity-summaries.ts",
    workflowId: "separations",
    reason:
      "the Activity distinct-person fold is current-Separations-only: its validated identity is derived "
      + "from a done Separations run's terminal result, so a foreign workflow's evidence row is counted foreign.",
  },
] as const;


const PRE_CANONICAL_SCENARIOS: readonly PreCanonicalScenarioEntry[] = [];

const ARTIFACT_EXEMPTIONS: readonly ArtifactExemptionEntry[] = [];

function auditedWorkflowSources(): readonly RegisteredWorkflowSource[] {
  return [...WORKFLOW_MODULES, ...STEP_PROOF_MODULES].map((module) => {
    const id = String(module.descriptor.id);
    return {
      id,
      sourceFolder: workflowSourceFolder(id, module.role),
      sourcePath: workflowSourcePath(id, module.role),
      scenarioFolder: workflowScenarioFolder(id, module.role),
    };
  });
}

function repositoryInputs(tree: WorkflowAuthoringBudgetTree): WorkflowAuthoringBudgetInputs {
  return {
    workflows: auditedWorkflowSources(),
    tree,
    genericIdAllowlist: GENERIC_WORKFLOW_ID_ALLOWLIST,
    preCanonicalScenarios: PRE_CANONICAL_SCENARIOS,
    artifactExemptions: ARTIFACT_EXEMPTIONS,
  };
}



const CLEAN_WORKFLOWS: readonly RegisteredWorkflowSource[] = [
  { id: "solo", sourceFolder: "src/workflows/solo", sourcePath: "src/workflows/solo/workflow.ts", scenarioFolder: "tests/scenario/workflows/solo" },
  { id: "combo", sourceFolder: "src/workflows/combo", sourcePath: "src/workflows/combo/workflow.ts", scenarioFolder: "tests/scenario/workflows/combo" },
  {
    id: "combo-harness",
    sourceFolder: "src/workflows/combo/steps/step-one",
    sourcePath: "src/workflows/combo/steps/step-one/step.ts",
    scenarioFolder: "tests/scenario/workflows/combo/steps/step-one",
  },
] as const;

function fixtureWorkflowFile(id: string, extra = ""): string {
  return `import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";\n`
    + `${extra}export const ${id.replaceAll("-", "_")}Workflow = defineWorkflow({ id: "${id}", steps: [] });\n`;
}


function cleanFixtureFiles(): Record<string, string> {
  return {
    "src/workflows/solo/workflow.ts": fixtureWorkflowFile("solo"),
    "src/workflows/combo/workflow.ts":
      "import { defineWorkflow, defineWorkflowStep, defineStepEntries } from \"../../workflow-kit/workflow-definition.js\";\n"
      + "const step = defineWorkflowStep({ key: \"step-one\", label: \"Step one\" });\n"
      + "const entries = defineStepEntries(step, []);\n"
      + "export const comboWorkflow = defineWorkflow({ id: \"combo\", steps: [[step, entries]] });\n",
    "src/workflows/combo/steps/step-one/step.ts":
      "// The step this harness proves brings a login recipe into existence.\n"
      + fixtureWorkflowFile("combo-harness"),
    "src/backend/app/registries/workflow-registry.ts":
      "import { composeWorkflowModule } from \"../../../../workflow-kit/workflow-definition.js\";\n"
      + "export const soloModule = composeWorkflowModule(soloWorkflow, stores);\n",
    "src/backend/systems/browser-shared/authenticated-application.ts":
      "// A login recipe returns only after observing an authenticated application.\n"
      + "export function defineVerifiedLoginRecipe(input) { return input.flow; }\n",
    "src/backend/app/composition/dashboard/compose.ts":
      "export function compose(descriptors) {\n"
      + "  return descriptors.find((descriptor) => descriptor.id === registeredId);\n"
      + "}\n",
    "tests/scenario/workflows/solo/structural.scenario.test.ts": "export const SOLO = 1;\n",
    "tests/scenario/workflows/solo/dry-run.scenario.ts": "export const SOLO_DRY_RUN = 1;\n",
    "tests/scenario/workflows/combo/structural.scenario.test.ts": "export const COMBO = 1;\n",
    "tests/scenario/workflows/combo/dry-run.scenario.ts": "export const COMBO_DRY_RUN = 1;\n",
    "tests/scenario/workflows/combo/steps/step-one/structural.scenario.test.ts": "export const COMBO_HARNESS = 1;\n",
    "tests/scenario/dashboard/combo/world.ts": "export const WORLD = 1;\n",
    "tests/scenario/intake-extraction.scenario.test.ts": "export const INTAKE = 1;\n",
    "tests/scenario/combo-supplement.md": "# additional combo proof\n",
    "tests/scenario/i9-lookup.md": "# an unregistered candidate\n",
  };
}

const CLEAN_PRE_CANONICAL: readonly PreCanonicalScenarioEntry[] = [];

const CLEAN_EXEMPTIONS: readonly ArtifactExemptionEntry[] = [
  { path: "tests/scenario/combo-supplement.md", reason: "contract — additional scenario proof." },
  { path: "tests/scenario/dashboard/combo/", reason: "ref guards-and-tests contract — a T2/T3 dashboard proof." },
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

// Allowlist keys include both file and workflow id; one file exemption must not admit other ids.
const PAIR_EXACT_ENTRY: GenericWorkflowIdAllowlistEntry = {
  file: "src/backend/app/composition/dashboard/compose.ts",
  workflowId: "solo",
  reason: "the one reviewed pair these three fixtures hold constant.",
};
const SOLO_BRANCH = "export const isSolo = (id) => id === \"solo\";\n";
const COMBO_BRANCH = "export const isCombo = (id) => id === \"combo\";\n";

const FIXTURES: readonly BudgetFixture[] = [
  {
    name: "a-file-named-recipe-ts",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflow-kit/recipe.ts"] = "export const RECIPE = 1;\n";
    }),
    expected: /src\/workflow-kit\/recipe\.ts is named recipe\.ts; `recipe` is a forbidden name/,
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

    name: "flow-builder-imported-three-levels-up-from-a-step-folder",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/combo/steps/step-one/step.ts"] =
        "import { flow } from \"../../../base/flow.js\";\n"
        + fixtureWorkflowFile("combo-harness");
    }),
    expected: /src\/workflows\/combo\/steps\/step-one\/step\.ts:1 imports "\.\.\/\.\.\/\.\.\/base\/flow\.js"; the flow builder is compiler-internal/,
  },
  {
    name: "descriptor-hand-authored-under-src-workflows",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        fixtureWorkflowFile("solo", "const descriptor = defineWorkflowDescriptor({ id: \"solo\" });\n");
    }),
    expected: /calls defineWorkflowDescriptor\(\): a descriptor is COMPILED from workflow\.ts, never authored/,
  },
  {
    name: "stores-composed-inside-a-workflow-folder",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        fixtureWorkflowFile("solo", "const composed = composeWorkflowModule(soloWorkflow, stores);\n");
    }),
    expected: /calls composeWorkflowModule\(\): stores are composed only at src\/backend\/app\/registries\/workflow-registry\.ts/,
  },
  {
    name: "two-defineWorkflow-calls-in-one-workflow-file",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/solo/workflow.ts"] =
        fixtureWorkflowFile("solo", "const shadow = defineWorkflow({ id: \"solo-shadow\", steps: [] });\n");
    }),
    expected: /src\/workflows\/solo\/workflow\.ts holds 2 defineWorkflow\( call\(s\); workflow budget .* authors exactly ONE/,
  },
  {
    name: "generic-server-branch-keyed-by-workflow-id",
    arm: "c",
    files: withFiles((files) => {
      files["src/backend/runs/projections/run-queue-projection.ts"] =
        "export function fold(record) {\n"
        + "  if (record.workflowId !== \"combo\") return undefined;\n"
        + "  return record;\n"
        + "}\n";
    }),
    expected: /run-queue-projection\.ts:2 names workflow "combo" as an equality comparison in a generic surface; a generic dashboard\/server branch keyed by workflow id fails workflow-id boundary/,
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
    expected: /src\/backend\/app\/composition\/dashboard\/compose\.ts:2 names workflow "combo" as an equality comparison in a generic surface/,
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
    name: "stale-allowlist-entry",
    arm: "c",
    files: cleanFixtureFiles(),
    genericIdAllowlist: [{
      file: "src/backend/app/composition/dashboard/compose.ts",
      workflowId: "combo",
      reason: "a branch that no longer exists.",
    }],
    expected: /stale workflow-id boundary allowlist entry — the scan found no such workflow-id literal there/,
  },
  {
    name: "empty-allowlist-reason",
    arm: "c",
    files: withFiles((files) => {
      files["src/backend/app/composition/dashboard/compose.ts"] =
        "export const isCombo = (id) => id === \"combo\";\n";
    }),
    genericIdAllowlist: [{
      file: "src/backend/app/composition/dashboard/compose.ts",
      workflowId: "combo",
      reason: " ",
    }],
    expected: /the workflow-id boundary allowlist requires a current reason/,
  },
  {
    name: "fifth-authored-artifact-for-a-workflow",
    arm: "d",
    files: withFiles((files) => { files["tests/scenario/combo-appendix.md"] = "# one more file\n"; }),
    expected: /tests\/scenario\/combo-appendix\.md is an extra authored artifact for workflow combo; workflow budget .* budget is exactly src\/workflows\/combo\/workflow\.ts/,
  },
  {
    name: "fifth-artifact-under-tests-scenario",
    arm: "d",
    files: withFiles((files) => {
      files["tests/scenario/workflows/solo/edge-cases.scenario.test.ts"] = "export const EDGE = 1;\n";
    }),
    expected: /tests\/scenario\/workflows\/solo\/edge-cases\.scenario\.test\.ts is an extra authored artifact for workflow solo/,
  },
  {
    // The folder rule: a harness id is never a path segment, so only
    // `workflowSourceFolder` can charge this file to the harness that owns it.
    name: "fifth-artifact-inside-a-harness-folder-belongs-to-the-harness",
    arm: "d",
    files: withFiles((files) => { files["src/workflows/combo/steps/step-one/nodes.ts"] = "export const NODES = 1;\n"; }),
    expected: /src\/workflows\/combo\/steps\/step-one\/nodes\.ts is an extra authored artifact for workflow combo-harness; workflow budget .* budget is exactly src\/workflows\/combo\/steps\/step-one\/step\.ts/,
  },
  {
    // The two ways out of the budget by suffixing an unregistered word.
    name: "fifth-artifact-in-a-folder-suffixing-a-registered-id",
    arm: "d",
    files: withFiles((files) => { files["tests/scenario/combo-extra/world.ts"] = "export const WORLD = 1;\n"; }),
    expected: /tests\/scenario\/combo-extra\/world\.ts is an extra authored artifact for workflow combo;/,
  },
  {
    name: "fifth-artifact-whose-stem-suffixes-a-registered-id-with-an-underscore",
    arm: "d",
    files: withFiles((files) => { files["tests/scenario/combo_extra.md"] = "# one more file\n"; }),
    expected: /tests\/scenario\/combo_extra\.md is an extra authored artifact for workflow combo;/,
  },
  {
    name: "two-structural-scenarios-for-one-workflow",
    arm: "d",
    files: withFiles((files) => {
      files["tests/scenario/combo-harness.scenario.test.ts"] = "export const H = 1;\n";
    }),
    preCanonicalScenarios: [{
      workflowId: "combo-harness",
      file: "tests/scenario/combo-harness.scenario.test.ts",
      reason: "negative fixture for a duplicate pre-canonical proof.",
    }],
    expected: /workflow combo-harness carries 2 structural scenarios .*; workflow budget .* budgets exactly one/,
  },
  {
    name: "stale-artifact-exemption",
    arm: "d",
    files: cleanFixtureFiles(),
    artifactExemptions: [
      ...CLEAN_EXEMPTIONS,
      { path: "tests/scenario/combo-gone.md", reason: "The exemption must name an existing artifact." },
    ],
    expected: /tests\/scenario\/combo-gone\.md: stale workflow budget artifact exemption — it matches no repository-visible file/,
  },
  {
    name: "stale-pre-canonical-structural-scenario",
    arm: "d",
    files: cleanFixtureFiles(),
    preCanonicalScenarios: [
      ...CLEAN_PRE_CANONICAL,
      { workflowId: "solo", file: "tests/scenario/solo.scenario.test.ts", reason: "The scenario must exist at its registered path." },
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
  // Fixture roots use the same repository-visible lister as the real tree.
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

describe("workflow authoring budget prevents unsupported paths and excess artifacts", () => {
  const tree = collectWorkflowAuthoringBudgetTree(REPO_ROOT);

  it("all four arms: the real repository is inside the budget, and the scan is not empty", () => {

    assert.ok(tree.sources.size > 500, `source scan resolved only ${tree.sources.size} files`);
    assert.ok(tree.artifactFiles.length > 10, `artifact scan resolved only ${tree.artifactFiles.length} files`);
    const registered = auditedWorkflowSources();
    assert.equal(registered.length, WORKFLOW_MODULES.length + STEP_PROOF_MODULES.length,
      "operator workflows and retained step proofs must stay in the scan");

    const scannedWorkflowFiles = [...tree.sources.keys()]
      .filter((path) => path.startsWith(WORKFLOWS_ROOT) && (path.endsWith("/workflow.ts") || path.endsWith("/step.ts")))
      .sort();
    assert.ok(
      scannedWorkflowFiles.length >= 2,
      `arm (b) entered only ${scannedWorkflowFiles.length} workflow.ts file(s)`,
    );
    assert.deepEqual(scannedWorkflowFiles, [...registered].map(({ sourcePath }) => sourcePath).sort());
    assert.deepEqual(auditWorkflowAuthoringBudget(repositoryInputs(tree)), []);
  });

  it("arm (c): retained mock literals stay exact and served or sibling additions remain forbidden", () => {
    assert.equal(Object.values(RETAINED_MOCK_LITERALS).flat().length, 27);
    assert.deepEqual(auditWorkflowAuthoringBudget(repositoryInputs(tree)), []);
    for (const path of ["src/dashboard/client/queries/day-queries.ts", "src/dashboard/surfaces/workflows/mocks/new-sibling.ts", "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx", ...Object.keys(RETAINED_MOCK_LITERALS)]) {
      const sources = new Map(tree.sources);
      sources.set(path, `${sources.get(path) ?? ""}\nconst injected = (id: string) => id === "person-lookup";`);
      assert.ok(auditWorkflowAuthoringBudget(repositoryInputs({ ...tree, sources })).some(issue => issue.startsWith(`${path}:`)), path);
    }
  });

  it("arm (c): repurposing an admitted occurrence with the same literal count fails", () => {
    const path = "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts";
    const sources = new Map(tree.sources);
    sources.set(path, sources.get(path)!.replace('"separations"', '(unknownId === "separations" ? unknownId : unknownId)'));
    assert.ok(auditWorkflowAuthoringBudget(repositoryInputs({ ...tree, sources })).some(issue => issue.startsWith(`${path}:`)));
  });

  it("arm (a): the seam's comment prose and the unrelated login-recipe seam both stay legal", () => {

    const harness = tree.sources.get("src/workflows/separations/steps/kronos-timecard/step.ts");
    assert.ok(harness !== undefined && /login recipe/.test(harness), "the harness comment must stay in the scan");
    const login = tree.sources.get("src/backend/systems/browser-shared/authenticated-application.ts");
    assert.ok(login !== undefined && /defineVerifiedLoginRecipe/.test(login), "the login seam must stay in the scan");
    assert.deepEqual(auditWorkflowAuthoringBudget(repositoryInputs(tree)), []);
  });

  it("arm (d): a harness's own files are never counted against the composition that owns its folder", () => {
    const workflows = auditedWorkflowSources();
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
      attributeWorkflowArtifact("tests/scenario/separations-supplement.md", workflows),
      "separations",
    );
    assert.equal(attributeWorkflowArtifact("tests/scenario/i9-lookup.md", workflows), undefined);
    assert.equal(attributeWorkflowArtifact("src/workflows/descriptor-registry.ts", workflows), undefined);
    // Inside `src/workflows/` the harness id is NOT in the path: only the
    // registered FOLDER can say whose budget a file beside its workflow.ts is.
    assert.equal(
      attributeWorkflowArtifact("src/workflows/separations/steps/identity-check/extra.ts", workflows),
      "separations-identity-check",
    );
    assert.equal(attributeWorkflowArtifact("src/workflows/separations/module.ts", workflows), "separations");
    // Outside it, a longer word built on a registered id stays that workflow's
    // budget rather than attributing to nothing and escaping the arm.
    assert.equal(attributeWorkflowArtifact("tests/scenario/separations-extra/foo.ts", workflows), "separations");
    assert.equal(attributeWorkflowArtifact("tests/scenario/separations_extra.md", workflows), "separations");
  });

  it("arm (c): the reviewed (file, workflow id) pair itself passes, so the allowlist is pair-EXACT", () => {

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
