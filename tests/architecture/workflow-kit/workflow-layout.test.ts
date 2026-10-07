/**
 * workflow-layout — D265 (ref workflow-model §1.2.2), the `src/workflows/` tree
 * IS the rail and the timeline.
 *
 * The operator's ruling made the folder view and the dashboard view the same
 * view: a top-level folder is a rail entry, a sub-folder is one DECLARED
 * timeline step of the workflow above it, and a chunk harness lives inside the
 * step it proves. That is only true while something holds the served ROLE and
 * the PATH to each other — otherwise the two drift the first time a folder
 * moves, and the surfaces (rail, picker, Explorer, the Explorer's source links)
 * go on rendering a tree that no longer exists on disk.
 *
 * The four arms, in the order they run:
 *
 *   (a) role ↔ path. Every registered module's derived folder
 *       (`workflowSourceFolder`, the ONE rule) exists and holds exactly ONE
 *       authored file, `workflow.ts` (D312/D317 — descriptors, modules, step
 *       identities and omissions are compiled from it or declared inside it,
 *       never authored beside it), and that file DECLARES the module's id —
 *       read with the build manifest's own `declaredWorkflowId`, because the
 *       manifest keys every fingerprint by that answer and two readers of one
 *       syntax are two opinions. Nothing else lives directly under
 *       `src/workflows/`: only `descriptor-registry.ts` and the folders
 *       registered workflows are addressed to. A stray folder is refused BY
 *       NAME, and so is anything nested below a step folder — the tree is
 *       exactly two levels deep.
 *   (b) folders ⊆ declared groups, and a folder holds a harness. Since D312
 *       (ref workflow-model §1.6.1 item 5) the composition's `steps` tuples
 *       own timeline membership and order; a step folder is organization and
 *       audit structure that exists for exactly one reason — to hold the
 *       chunk harness that proves the step (§1.2.2 rule 3). So every
 *       sub-folder of a workflow that DECLARED a timeline must be one of its
 *       declared group keys AND the address of a retained `chunk-harness` proof;
 *       a declared group with no harness (`job-summary`) has no folder. A
 *       workflow that declared none (D225's honest per-node default:
 *       `person-lookup`) has no sub-folders at all.
 *   (c) the registry audit is WIRED. `auditWorkflowModuleRoles` is the one
 *       implementation of the role rules, and it now also refuses two harnesses
 *       claiming one `(of, step)` — that pair is an ADDRESS, so a collision is
 *       two modules claiming two files. The arm runs it over the active
 *       workflows and retained proofs, then proves the refusal fires.
 *   (d) one rule for path-from-role. `descriptor-coverage` and
 *       `workflow-editor-compile-integrity` both DERIVE a descriptor's path
 *       from `src/workflow-kit/validation/source-layout.ts`; a second copy of the rule,
 *       inline in either guard, is refused. Three copies of a path literal were
 *       free to disagree the moment a folder moved, and one of them printed a
 *       link an operator would click.
 *
 * Arms (a) and (b) are ONE pure function of `(modules, tree)` —
 * `auditWorkflowLayout` never touches the filesystem — so the real repository
 * and every violating fixture go through identical code.
 * `collectWorkflowLayoutTree` supplies both: for the repo it reads
 * `src/workflows/`, for a fixture it reads that fixture's own miniature
 * `src/workflows/` written to a temp root, exactly as `guard-manifest` does for
 * the ratchet arms (a `.ts` fixture checked into `tests/` would be part of this
 * tree's own zero-debt `typecheck`/`lint` program, which is not what a
 * deliberately malformed tree can be).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";

import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { auditWorkflowModuleRoles, type WorkflowRoleView } from "../../../src/workflow-kit/validation/workflow-module-audit.js";
import { defineWorkflowRole, type WorkflowModuleRole } from "../../../src/workflow-kit/validation/module-role.js";
import { workflowSourceFolder, workflowSourcePath } from "../../../src/workflow-kit/validation/source-layout.js";
import { declaredWorkflowId } from "../../../scripts/build/workflow-build-manifest.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

const WORKFLOWS_ROOT = "src/workflows";
/** The one file §1.2.2 rule 1 allows to sit beside the workflow folders. */
const TOP_LEVEL_FILES = new Set(["descriptor-registry.ts"]);

/**
 * A registered module as the layout rules see it: its id, its role, and whether
 * its timeline was DECLARED (never the factory's per-node default — §1.2.2
 * rule 2's word "declared" is what separates a step folder from a node id).
 */
export interface WorkflowLayoutModule {
  readonly id: string;
  readonly role: WorkflowModuleRole;
  readonly timelineDeclared: boolean;
  readonly timelineKeys: readonly string[];
}

/**
 * A declaration read out of a source file, or the reason it could not be.
 *
 * The reason travels as a VALUE rather than a throw so the audit can name the
 * file in a violation instead of exploding mid-walk; it is never silently
 * treated as "no declaration", which would let an unreadable `workflow.ts` pass
 * as a folder with nothing to say.
 */
type SourceDeclaration = { readonly value: string } | { readonly unreadable: string };

export interface WorkflowLayoutTree {
  /** Every directory under `src/workflows/`, repo-relative, at any depth. */
  readonly directories: readonly string[];
  /** Every file under `src/workflows/`, repo-relative, at any depth. */
  readonly files: readonly string[];
  /** `<folder>/workflow.ts` → the workflow id that file declares. */
  readonly declaredIds: ReadonlyMap<string, SourceDeclaration>;
}

function readDeclaration(read: () => string): SourceDeclaration {
  try {
    return { value: read() };
  } catch (error) {
    // Not a swallow: the reason becomes a VIOLATION naming the file, which is
    // the loudest place it can land — the audit has no other way to report on a
    // file it cannot parse, and reporting nothing would read as "compliant".
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

/** Read one `src/workflows/` tree — the repository's, or a fixture's. */
export function collectWorkflowLayoutTree(root: string): WorkflowLayoutTree {
  const directories: string[] = [];
  const files: string[] = [];
  const declaredIds = new Map<string, SourceDeclaration>();

  function walk(relative: string): void {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const child = `${relative}/${name}`;
      if (statSync(join(root, child)).isDirectory()) {
        directories.push(child);
        walk(child);
        continue;
      }
      files.push(child);
      if (name === "workflow.ts" || name === "step.ts") {
        declaredIds.set(child, readDeclaration(() => declaredWorkflowId(join(root, child))));
      }
    }
  }

  if (existsSync(join(root, WORKFLOWS_ROOT))) walk(WORKFLOWS_ROOT);
  return { directories, files, declaredIds };
}

function depth(path: string): number {
  return path.split("/").length - WORKFLOWS_ROOT.split("/").length;
}

function childrenOf(paths: readonly string[], parent: string): readonly string[] {
  return paths.filter((path) => dirname(path) === parent).map((path) => path.slice(parent.length + 1));
}

/**
 * Arms (a) and (b), decided entirely from the registered modules and one tree
 * listing. Every refusal names the offender — a path, an id, or both — because
 * "the layout is wrong" is a sentence nobody can act on.
 */
export function auditWorkflowLayout(
  modules: readonly WorkflowLayoutModule[],
  tree: WorkflowLayoutTree,
): readonly string[] {
  const violations: string[] = [];
  const directories = new Set(tree.directories);
  const files = new Set(tree.files);

  // ---- arm (a): role ↔ path -------------------------------------------------
  const addressed = new Map<string, string>();
  for (const module of modules) {
    const folder = workflowSourceFolder(module.id, module.role);
    addressed.set(folder, module.id);
    if (!directories.has(folder)) {
      violations.push(
        `workflow ${module.id} (role ${module.role.kind}) is addressed to ${folder}/, which does not exist`,
      );
      continue;
    }
    // D312/D317 — a workflow authors exactly `workflow.ts`; a descriptor,
    // module, step, node-id, entry or omission file beside it is the retired
    // multi-file authoring path returning under another name.
    const entryPath = workflowSourcePath(module.id, module.role);
    if (!files.has(entryPath)) violations.push(`workflow ${module.id} must author ${entryPath}, which is missing`);
    for (const name of childrenOf(tree.files, folder)) {
      if (name === (module.role.kind === "chunk-harness" ? "step.ts" : "workflow.ts")) continue;
      if (module.role.kind !== "chunk-harness" && name === "task-registry.ts") continue;
      violations.push(
        `workflow ${module.id} authors ${folder}/${name} beside ${entryPath}; a workflow folder holds exactly its `
        + `one ${module.role.kind === "chunk-harness" ? "step.ts" : "workflow.ts"} (D312/D317)`,
      );
    }
    const declared = tree.declaredIds.get(entryPath);
    if (declared === undefined) continue;
    if ("unreadable" in declared) {
      violations.push(`${entryPath}: ${declared.unreadable}`);
    } else if (declared.value !== module.id) {
      violations.push(
        `${entryPath} declares workflow id ${declared.value}, but the module `
        + `addressed there is ${module.id}; a folder holds the workflow its role names (§1.2.2)`,
      );
    }
  }

  for (const directory of tree.directories) {
    if (depth(directory) === 1 && addressed.get(directory) === undefined) {
      violations.push(
        `${directory}/ sits at the top level of ${WORKFLOWS_ROOT}/ but no registered workflow is addressed there; `
        + "a top-level folder is a rail entry (§1.2.2 rule 1)",
      );
    }
    if (depth(directory) === 4) {
      violations.push(
        `${directory}/ is nested below a step folder; the ${WORKFLOWS_ROOT}/ tree is exactly three levels deep — `
        + "a workflow folder, steps/, and its step folders (§1.2.2)",
      );
    }
  }
  for (const file of tree.files) {
    if (depth(file) !== 1 || TOP_LEVEL_FILES.has(file.slice(WORKFLOWS_ROOT.length + 1))) continue;
    violations.push(
      `${file} sits directly under ${WORKFLOWS_ROOT}/; only ${[...TOP_LEVEL_FILES].join(", ")} and registered `
      + "workflow folders may (§1.2.2 rule 1)",
    );
  }

  // ---- arm (b): step folders ⊆ declared groups, and each holds a harness -----
  for (const module of modules) {
    if (module.role.kind === "chunk-harness") continue;
    const folder = workflowSourceFolder(module.id, module.role);
    if (!directories.has(folder)) continue;
    const stepsFolder = `${folder}/steps`;
    const subFolders = childrenOf(tree.directories, stepsFolder);
    for (const stray of childrenOf(tree.directories, folder).filter((name) => name !== "steps" && name !== "tasks")) {
      violations.push(`${folder}/${stray}/ is outside the steps/ folder`);
    }
    if (!module.timelineDeclared) {
      if (subFolders.length > 0) {
        violations.push(
          `workflow ${module.id} declares no timeline (D225's per-node default) but ${folder}/ holds step `
          + `folder(s) ${subFolders.join(", ")}; a step folder is a DECLARED category (§1.2.2 rule 2)`,
        );
      }
      continue;
    }
    const declaredKeys = new Set(module.timelineKeys);
    for (const name of subFolders) {
      if (!declaredKeys.has(name)) {
        violations.push(
          `${stepsFolder}/${name}/ is a step folder ${module.id} does not declare as a timeline group — `
          + `it declares: ${module.timelineKeys.join(", ")}`,
        );
        continue;
      }
      // D312 §1.6.1 item 5 — the composition's `workflow.ts` owns the step's
      // identities; a folder exists only to hold the harness that proves the
      // step, so a folder nobody is addressed to is authored glue with no owner.
      const harness = addressed.get(`${stepsFolder}/${name}`);
      if (harness === undefined) {
        violations.push(
          `${stepsFolder}/${name}/ holds no retained chunk-harness; a step folder exists only to hold the harness `
          + "that proves the step (D312, §1.2.2 rule 3)",
        );
      }
    }
  }

  return violations;
}

/**
 * Arm (d) — the two guards that need a descriptor's path must ASK for it.
 *
 * A path literal rebuilt inline is a second copy of §1.2.2's rule, free to
 * disagree the next time a folder moves. `source-layout.ts` is the one
 * derivation and these two are its consumers alongside the Explorer's source
 * links.
 */
export const PATH_RULE_CONSUMERS = [
  "tests/architecture/workflow-kit/descriptor-coverage.test.ts",
  "tests/architecture/workflow-kit/workflow-editor-compile-integrity.test.ts",
] as const;

export function auditPathRuleSingleSource(sources: ReadonlyMap<string, string>): readonly string[] {
  const violations: string[] = [];
  for (const [path, source] of sources) {
    if (!/from "(?:\.\.\/)+src\/workflow-kit\/validation\/source-layout\.js"/.test(source)) {
      violations.push(
        `${path} must derive a descriptor's path from src/workflow-kit/validation/source-layout.ts (§1.2.2 arm d)`,
      );
    }
    if (/`[^`]*src\/workflows\/\$\{/.test(source)) {
      violations.push(
        `${path} builds a ${WORKFLOWS_ROOT}/ path by interpolation; the path-from-role rule lives in `
        + "src/workflow-kit/validation/source-layout.ts and nowhere else (§1.2.2 arm d)",
      );
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Fixtures — miniature `src/workflows/` trees, one per arm, written to a temp
// root and read back by the same collector the repository goes through.
// ---------------------------------------------------------------------------

function fixtureDescriptor(id: string): string {
  return `export const descriptor = defineWorkflowDescriptor({ id: "${id}", version: 1 });\n`;
}
function fixtureWorkflow(id: string): string {
  return `export const workflow = defineWorkflow({ id: "${id}", version: 1 });\n`;
}
const FIXTURE_MODULE = "export const module = { role: \"fixture\" };\n";

/**
 * The clean tree: a standalone workflow, a composition declaring two groups of
 * which only `step-one` carries a harness (so only `step-one/` exists — the
 * `job-summary` shape), and nothing authored beside any `workflow.ts`.
 */
function cleanFixtureFiles(): Record<string, string> {
  return {
    "src/workflows/descriptor-registry.ts": "export const REGISTRY = [];\n",
    "src/workflows/solo/workflow.ts": fixtureWorkflow("solo"),
    "src/workflows/combo/workflow.ts": fixtureWorkflow("combo"),
    "src/workflows/combo/steps/step-one/step.ts": fixtureWorkflow("combo-harness"),
  };
}

function cleanFixtureModules(): WorkflowLayoutModule[] {
  return [
    {
      id: "solo",
      role: defineWorkflowRole({ kind: "standalone" }),
      timelineDeclared: false,
      timelineKeys: [],
    },
    {
      id: "combo",
      role: defineWorkflowRole({ kind: "composition" }),
      timelineDeclared: true,
      timelineKeys: ["step-one", "step-two"],
    },
    {
      id: "combo-harness",
      role: defineWorkflowRole({ kind: "chunk-harness", of: "combo", step: "step-one" }),
      timelineDeclared: false,
      timelineKeys: [],
    },
  ];
}

interface LayoutFixture {
  readonly name: string;
  readonly arm: "a" | "b";
  readonly files: Record<string, string>;
  readonly modules: readonly WorkflowLayoutModule[];
  readonly expected: RegExp;
}

function withFiles(mutate: (files: Record<string, string>) => void): Record<string, string> {
  const files = cleanFixtureFiles();
  mutate(files);
  return files;
}

const FIXTURES: readonly LayoutFixture[] = [
  {
    name: "stray-top-level-folder",
    arm: "a",
    files: withFiles((files) => { files["src/workflows/orphan/module.ts"] = FIXTURE_MODULE; }),
    modules: cleanFixtureModules(),
    expected: /src\/workflows\/orphan\/ sits at the top level .* no registered workflow is addressed there/s,
  },
  {
    name: "stray-top-level-file",
    arm: "a",
    files: withFiles((files) => { files["src/workflows/helpers.ts"] = "export const HELP = 1;\n"; }),
    modules: cleanFixtureModules(),
    expected: /src\/workflows\/helpers\.ts sits directly under src\/workflows\//,
  },
  {
    name: "missing-workflow-folder",
    arm: "a",
    files: withFiles((files) => {
      delete files["src/workflows/solo/workflow.ts"];
    }),
    modules: cleanFixtureModules(),
    expected: /workflow solo \(role standalone\) is addressed to src\/workflows\/solo\/, which does not exist/,
  },
  {
    name: "folder-also-authors-descriptor",
    arm: "a",
    files: withFiles((files) => { files["src/workflows/solo/descriptor.ts"] = fixtureDescriptor("solo"); }),
    modules: cleanFixtureModules(),
    expected: /workflow solo authors src\/workflows\/solo\/descriptor\.ts beside src\/workflows\/solo\/workflow\.ts; a workflow folder holds exactly its one workflow\.ts \(D312\/D317\)/,
  },
  {
    name: "folder-missing-workflow-ts",
    arm: "a",
    files: withFiles((files) => {
      delete files["src/workflows/solo/workflow.ts"];
      files["src/workflows/solo/descriptor.ts"] = fixtureDescriptor("solo");
      files["src/workflows/solo/module.ts"] = FIXTURE_MODULE;
    }),
    modules: cleanFixtureModules(),
    expected: /workflow solo must author src\/workflows\/solo\/workflow\.ts, which is missing/,
  },
  {
    name: "harness-folder-authors-module-ts",
    arm: "a",
    files: withFiles((files) => { files["src/workflows/combo/steps/step-one/module.ts"] = FIXTURE_MODULE; }),
    modules: cleanFixtureModules(),
    expected: /workflow combo-harness authors src\/workflows\/combo\/steps\/step-one\/module\.ts beside src\/workflows\/combo\/steps\/step-one\/step\.ts/,
  },
  {
    name: "step-identities-authored-beside-workflow-ts",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/steps/step-one/nodes.ts"] = "export const NODES = [];\n";
      files["src/workflows/combo/steps/step-one/omission.ts"] = "export const STEP = { key: \"step-one\" };\n";
    }),
    modules: cleanFixtureModules(),
    expected: /workflow combo-harness authors src\/workflows\/combo\/steps\/step-one\/nodes\.ts beside .*\n.*authors src\/workflows\/combo\/steps\/step-one\/omission\.ts beside/,
  },
  {
    name: "workflow-ts-declares-another-id",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/steps/step-one/step.ts"] = fixtureWorkflow("somebody-else");
    }),
    modules: cleanFixtureModules(),
    expected: /declares workflow id somebody-else, but the module addressed there is combo-harness/,
  },
  {
    name: "unreadable-workflow-ts",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/workflow.ts"] = "export const workflow = buildIt({ id: someId });\n";
    }),
    modules: cleanFixtureModules(),
    expected: /workflow\.ts: build manifest needs exactly one string-literal descriptor id/,
  },
  {
    name: "nested-below-a-step-folder",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/steps/step-one/deeper/notes.ts"] = "export const NOTE = 1;\n";
    }),
    modules: cleanFixtureModules(),
    expected: /src\/workflows\/combo\/steps\/step-one\/deeper\/ is nested below a step folder/,
  },
  {
    name: "step-folder-without-a-group",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/combo/steps/step-three/step.ts"] = fixtureWorkflow("combo-harness-three");
    }),
    modules: [
      ...cleanFixtureModules(),
      {
        id: "combo-harness-three",
        role: defineWorkflowRole({ kind: "chunk-harness", of: "combo", step: "step-three" }),
        timelineDeclared: false,
        timelineKeys: [],
      },
    ],
    expected: /src\/workflows\/combo\/steps\/step-three\/ is a step folder combo does not declare as a timeline group — it declares: step-one, step-two/,
  },
  {
    name: "step-folder-without-a-harness",
    arm: "b",
    files: withFiles((files) => { files["src/workflows/combo/steps/step-two/nodes.ts"] = "export const NODES = [];\n"; }),
    modules: cleanFixtureModules(),
    expected: /src\/workflows\/combo\/steps\/step-two\/ holds no retained chunk-harness; a step folder exists only to hold the harness that proves the step/,
  },
  {
    name: "undeclared-timeline-with-a-step-folder",
    arm: "b",
    files: withFiles((files) => { files["src/workflows/solo/steps/only-step/step.ts"] = fixtureWorkflow("solo-step"); }),
    modules: cleanFixtureModules(),
    expected: /workflow solo declares no timeline .* holds step folder\(s\) only-step/,
  },
];

function writeFixtureTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-workflow-layout-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function registeredLayoutModules(): readonly WorkflowLayoutModule[] {
  return [...WORKFLOW_MODULES, ...STEP_PROOF_MODULES].map((module) => ({
    id: String(module.descriptor.id),
    role: module.role,
    timelineDeclared: module.descriptor.timelineDeclared,
    timelineKeys: module.descriptor.timeline.map((category) => category.key),
  }));
}

describe("workflow-layout — the src/workflows/ tree IS the rail and the timeline (D265, §1.2.2)", () => {
  const repositoryTree = collectWorkflowLayoutTree(REPO_ROOT);

  it("arms (a) and (b): the real tree and the real registry agree, in both directions", () => {
    // A walker that resolved nothing would report every arm green, so the tree
    // is asserted non-empty first — the same negative control every fixture-fed
    // guard in this suite carries.
    assert.ok(repositoryTree.directories.length > 0, "collector resolved no workflow folders");
    assert.ok(repositoryTree.declaredIds.size > 0, "collector read no workflow ids");
    assert.deepEqual(auditWorkflowLayout(registeredLayoutModules(), repositoryTree), []);
  });

  it("arm (b): the composition's step folders are exactly its harness-carrying declared groups, by name", () => {
    // Belt-and-braces over the arm above: if `auditWorkflowLayout` ever stopped
    // deriving sub-folders, the set comparison here would still notice. The
    // one declared group without a folder is the one with no harness.
    const modules = registeredLayoutModules();
    const separations = modules.find(({ id }) => id === "separations");
    assert.ok(separations !== undefined, "separations must stay registered");
    assert.equal(separations.timelineDeclared, true);
    const harnessSteps = modules
      .flatMap(({ role }) => (role.kind === "chunk-harness" && role.of === "separations" ? [role.step] : []))
      .toSorted();
    assert.deepEqual(childrenOf(repositoryTree.directories, "src/workflows/separations/steps").toSorted(), harnessSteps);
    assert.ok(harnessSteps.every((step) => separations.timelineKeys.includes(step)));
    assert.deepEqual(
      separations.timelineKeys.filter((key) => !harnessSteps.includes(key)),
      ["job-summary"],
      "job-summary is the declared group proved inside identity-check's harness and has no folder (D265 mapping)",
    );
  });

  it("arm (b): a declared group with no harness needs no folder (D312 §1.6.1 item 5)", () => {
    // The clean fixture declares `step-two` and holds no `step-two/` folder;
    // if that ever became a violation, the tuples would no longer own membership.
    const root = writeFixtureTree(cleanFixtureFiles());
    try {
      assert.deepEqual(auditWorkflowLayout(cleanFixtureModules(), collectWorkflowLayoutTree(root)), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const fixture of FIXTURES) {
    it(`arm (${fixture.arm}): refuses ${fixture.name}`, () => {
      const clean = writeFixtureTree(cleanFixtureFiles());
      try {
        assert.deepEqual(
          auditWorkflowLayout(cleanFixtureModules(), collectWorkflowLayoutTree(clean)),
          [],
          "the clean fixture tree must pass, or the violating fixtures prove nothing",
        );
      } finally {
        rmSync(clean, { recursive: true, force: true });
      }

      const root = writeFixtureTree(fixture.files);
      try {
        const violations = auditWorkflowLayout(fixture.modules, collectWorkflowLayoutTree(root));
        assert.ok(violations.length > 0, `${fixture.name} produced no violation`);
        assert.match(violations.join("\n"), fixture.expected);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("arm (c): the registry's role audit is wired over the real modules and refuses a shared step", () => {
    assert.deepEqual(auditWorkflowModuleRoles([...WORKFLOW_MODULES, ...STEP_PROOF_MODULES]), []);

    const composition = WORKFLOW_MODULES.find(({ role }) => role.kind === "composition");
    const harnesses = STEP_PROOF_MODULES.filter(({ role }) => role.kind === "chunk-harness");
    assert.ok(composition !== undefined, "a composition must stay registered");
    const [first, second] = harnesses;
    assert.ok(first !== undefined && second !== undefined, "two step proofs must remain available");
    assert.ok(first.role.kind === "chunk-harness", "the first harness must carry its role");

    const collided: WorkflowRoleView[] = [
      { descriptor: composition.descriptor, role: composition.role },
      { descriptor: first.descriptor, role: first.role },
      { descriptor: second.descriptor, role: defineWorkflowRole({ ...first.role }) },
    ];
    const violations = auditWorkflowModuleRoles(collided);
    assert.ok(violations.length > 0, "two harnesses on one step must be refused");
    assert.match(
      violations.join("\n"),
      new RegExp(`workflows ${String(first.descriptor.id)} and ${String(second.descriptor.id)} both declare role chunk-harness`),
    );
    assert.match(violations.join("\n"), /is the one folder they would share/);
  });

  it("arm (d): both path-consuming guards derive the path from source-layout, and none rebuilds it", () => {
    const sources = new Map(PATH_RULE_CONSUMERS.map((path) =>
      [path, readFileSync(join(REPO_ROOT, path), "utf8")] as const));
    assert.equal(sources.size, PATH_RULE_CONSUMERS.length);
    assert.deepEqual(auditPathRuleSingleSource(sources), []);

    // The violating fixture for this arm: one consumer that imports nothing,
    // one that rebuilt the rule inline.
    const violating = new Map([
      ["fixture/no-import.test.ts", "const path = descriptorPathFor(id);\n"],
      [
        "fixture/inline-rule.test.ts",
        "import { x } from \"../../../src/workflow-kit/validation/source-layout.js\";\n"
        + "const path = `src/workflows/${id}/descriptor.ts`;\n",
      ],
    ]);
    const violations = auditPathRuleSingleSource(violating);
    assert.equal(violations.length, 2, violations.join("; "));
    assert.match(violations.join("\n"), /no-import\.test\.ts must derive a descriptor's path from/);
    assert.match(violations.join("\n"), /inline-rule\.test\.ts builds a src\/workflows\/ path by interpolation/);
  });
});
