
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


export interface WorkflowLayoutModule {
  readonly id: string;
  readonly role: WorkflowModuleRole;
  readonly timelineDeclared: boolean;
  readonly timelineKeys: readonly string[];
}


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

    const entryPath = workflowSourcePath(module.id, module.role);
    if (!files.has(entryPath)) violations.push(`workflow ${module.id} must author ${entryPath}, which is missing`);
    for (const name of childrenOf(tree.files, folder)) {
      if (name === (module.role.kind === "chunk-harness" ? "step.ts" : "workflow.ts")) continue;
      if (module.role.kind !== "chunk-harness" && name === "task-registry.ts") continue;
      violations.push(
        `workflow ${module.id} authors ${folder}/${name} beside ${entryPath}; a workflow folder holds exactly its `
        + `one ${module.role.kind === "chunk-harness" ? "step.ts" : "workflow.ts"}`,
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
          `workflow ${module.id} declares no timeline (the per-node default) but ${folder}/ holds step `
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

      const harness = addressed.get(`${stepsFolder}/${name}`);
      if (harness === undefined) {
        violations.push(
          `${stepsFolder}/${name}/ holds no retained chunk-harness; a step folder exists only to hold the harness `
          + "that proves the step",
        );
      }
    }
  }

  return violations;
}


export const PATH_RULE_CONSUMERS = [
  "tests/architecture/workflow-kit/descriptor-coverage.test.ts",
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



function fixtureDescriptor(id: string): string {
  return `export const descriptor = defineWorkflowDescriptor({ id: "${id}", version: 1 });\n`;
}
function fixtureWorkflow(id: string): string {
  return `export const workflow = defineWorkflow({ id: "${id}", version: 1 });\n`;
}
const FIXTURE_MODULE = "export const module = { role: \"fixture\" };\n";


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
    expected: /^workflow solo authors src\/workflows\/solo\/descriptor\.ts beside src\/workflows\/solo\/workflow\.ts; a workflow folder holds exactly its one workflow\.ts$/,
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

describe("workflow-layout — the src/workflows/ tree IS the rail and the timeline", () => {
  const repositoryTree = collectWorkflowLayoutTree(REPO_ROOT);

  it("arms (a) and (b): the real tree and the real registry agree, in both directions", () => {

    assert.ok(repositoryTree.directories.length > 0, "collector resolved no workflow folders");
    assert.ok(repositoryTree.declaredIds.size > 0, "collector read no workflow ids");
    assert.deepEqual(auditWorkflowLayout(registeredLayoutModules(), repositoryTree), []);
  });

  it("arm (b): the composition's step folders are exactly its harness-carrying declared groups, by name", () => {

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
      "job-summary is the declared group proved inside identity-check's harness and has no folder",
    );
  });

  it("a declared group with no harness needs no folder", () => {

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
