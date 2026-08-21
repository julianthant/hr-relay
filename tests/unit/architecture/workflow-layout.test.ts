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
 *       (`workflowSourceFolder`, the ONE rule) exists and holds `descriptor.ts`
 *       + `module.ts`, and the descriptor file at that path DECLARES that
 *       module's id — read with the build manifest's own `declaredWorkflowId`,
 *       because the manifest keys every fingerprint by that answer and two
 *       readers of one syntax are two opinions. Nothing else lives directly
 *       under `src/workflows/`: only `descriptor-registry.ts` and the folders
 *       registered workflows are addressed to. A stray folder is refused BY
 *       NAME, and so is anything nested below a step folder — the tree is
 *       exactly two levels deep.
 *   (b) folders ↔ categories, both ways. For a workflow that DECLARED a D225
 *       timeline, the declared category keys and the sub-folder names are the
 *       same set, and each sub-folder's `step.ts` declares a key equal to its
 *       folder name — the folder IS the key. A workflow that declared none
 *       (D225's honest per-node default: `person-lookup`) has no sub-folders at
 *       all; the rule bites exactly when a timeline is declared.
 *   (c) the registry audit is WIRED. `auditWorkflowModuleRoles` is the one
 *       implementation of the role rules, and it now also refuses two harnesses
 *       claiming one `(of, step)` — that pair is an ADDRESS, so a collision is
 *       two modules claiming two files. The arm runs it over the real registry
 *       and asserts silence, then proves the refusal fires.
 *   (d) one rule for path-from-role. `descriptor-coverage` and
 *       `workflow-editor-compile-integrity` both DERIVE a descriptor's path
 *       from `src/domain/workflow/source-layout.ts`; a second copy of the rule,
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
import ts from "typescript";
import { describe, it } from "vitest";

import { WORKFLOW_MODULES, auditWorkflowModuleRoles } from "../../../src/control/workflow-registry.js";
import type { WorkflowRoleView } from "../../../src/control/workflow-registry.js";
import { defineWorkflowRole, type WorkflowModuleRole } from "../../../src/domain/workflow/module-role.js";
import {
  descriptorSourcePath,
  moduleSourcePath,
  workflowSourceFolder,
} from "../../../src/domain/workflow/source-layout.js";
import { declaredWorkflowId } from "../../../src/infra/build/workflow-build-manifest.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

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
 * treated as "no declaration", which would let an unreadable `step.ts` pass as
 * a folder with nothing to say.
 */
type SourceDeclaration = { readonly value: string } | { readonly unreadable: string };

export interface WorkflowLayoutTree {
  /** Every directory under `src/workflows/`, repo-relative, at any depth. */
  readonly directories: readonly string[];
  /** Every file under `src/workflows/`, repo-relative, at any depth. */
  readonly files: readonly string[];
  /** `<folder>/descriptor.ts` → the workflow id that file declares. */
  readonly declaredIds: ReadonlyMap<string, SourceDeclaration>;
  /** `<folder>/step.ts` → the step key that file declares. */
  readonly stepKeys: ReadonlyMap<string, SourceDeclaration>;
}

/**
 * The step key a `step.ts` declares, read from its own source.
 *
 * The same shape of question as `declaredWorkflowId` one file over, and the
 * same fail-loud rule: exactly one string-literal `key` in exactly one
 * `defineWorkflowStep` call, or the file is UNREADABLE and says so. A regex
 * over the literal would have matched the word inside the file's own doc
 * comment.
 */
export function declaredStepKey(entry: string): string {
  const source = ts.createSourceFile(
    entry, readFileSync(entry, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "defineWorkflowStep") {
      const spec = node.arguments[0];
      if (spec !== undefined && ts.isObjectLiteralExpression(spec)) {
        for (const property of spec.properties) {
          if (ts.isPropertyAssignment(property)
            && ts.isIdentifier(property.name)
            && property.name.text === "key"
            && ts.isStringLiteral(property.initializer)) {
            keys.push(property.initializer.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const [only] = keys;
  if (keys.length !== 1 || only === undefined) {
    throw new Error(
      `a step folder's step.ts must declare exactly one string-literal defineWorkflowStep key; found ${String(keys.length)}`,
    );
  }
  return only;
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
  const stepKeys = new Map<string, SourceDeclaration>();

  function walk(relative: string): void {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const child = `${relative}/${name}`;
      if (statSync(join(root, child)).isDirectory()) {
        directories.push(child);
        walk(child);
        continue;
      }
      files.push(child);
      if (name === "descriptor.ts") {
        declaredIds.set(child, readDeclaration(() => declaredWorkflowId(join(root, child))));
      }
      if (name === "step.ts") {
        stepKeys.set(child, readDeclaration(() => declaredStepKey(join(root, child))));
      }
    }
  }

  if (existsSync(join(root, WORKFLOWS_ROOT))) walk(WORKFLOWS_ROOT);
  return { directories, files, declaredIds, stepKeys };
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
    for (const path of [descriptorSourcePath(module.id, module.role), moduleSourcePath(module.id, module.role)]) {
      if (!files.has(path)) violations.push(`workflow ${module.id} must author ${path}, which is missing`);
    }
    const declared = tree.declaredIds.get(descriptorSourcePath(module.id, module.role));
    if (declared === undefined) continue;
    if ("unreadable" in declared) {
      violations.push(`${descriptorSourcePath(module.id, module.role)}: ${declared.unreadable}`);
    } else if (declared.value !== module.id) {
      violations.push(
        `${descriptorSourcePath(module.id, module.role)} declares workflow id ${declared.value}, but the module `
        + `addressed there is ${module.id}; a folder holds the descriptor its role names (§1.2.2)`,
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
    if (depth(directory) === 3) {
      violations.push(
        `${directory}/ is nested below a step folder; the ${WORKFLOWS_ROOT}/ tree is exactly two levels deep — `
        + "a workflow folder and its step folders (§1.2.2)",
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

  // ---- arm (b): folders ↔ declared categories, both ways ---------------------
  for (const module of modules) {
    if (module.role.kind === "chunk-harness") continue;
    const folder = workflowSourceFolder(module.id, module.role);
    if (!directories.has(folder)) continue;
    const subFolders = childrenOf(tree.directories, folder);
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
    for (const key of module.timelineKeys) {
      if (!subFolders.includes(key)) {
        violations.push(
          `workflow ${module.id} declares timeline step ${key}, which has no folder at ${folder}/${key}/`,
        );
      }
    }
    for (const name of subFolders) {
      if (!declaredKeys.has(name)) {
        violations.push(
          `${folder}/${name}/ is a step folder ${module.id} does not declare as a timeline category — `
          + `it declares: ${module.timelineKeys.join(", ")}`,
        );
        continue;
      }
      const stepPath = `${folder}/${name}/step.ts`;
      if (!files.has(stepPath)) {
        violations.push(`step folder ${folder}/${name}/ must author step.ts, where the step's key is written once`);
        continue;
      }
      const key = tree.stepKeys.get(stepPath);
      if (key === undefined || "unreadable" in key) {
        violations.push(`${stepPath}: ${key === undefined ? "was not read" : key.unreadable}`);
      } else if (key.value !== name) {
        violations.push(
          `${stepPath} declares step key ${key.value}, but its folder is named ${name}; the folder IS the key `
          + "(§1.2.2 rule 2)",
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
  "tests/unit/architecture/descriptor-coverage.test.ts",
  "tests/unit/architecture/workflow-editor-compile-integrity.test.ts",
] as const;

export function auditPathRuleSingleSource(sources: ReadonlyMap<string, string>): readonly string[] {
  const violations: string[] = [];
  for (const [path, source] of sources) {
    if (!/from "(?:\.\.\/)+src\/domain\/workflow\/source-layout\.js"/.test(source)) {
      violations.push(
        `${path} must derive a descriptor's path from src/domain/workflow/source-layout.ts (§1.2.2 arm d)`,
      );
    }
    if (/`[^`]*src\/workflows\/\$\{/.test(source)) {
      violations.push(
        `${path} builds a ${WORKFLOWS_ROOT}/ path by interpolation; the path-from-role rule lives in `
        + "src/domain/workflow/source-layout.ts and nowhere else (§1.2.2 arm d)",
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
function fixtureStep(key: string): string {
  return `export const STEP = defineWorkflowStep({ key: "${key}", label: "${key}" });\n`;
}
const FIXTURE_MODULE = "export const module = { role: \"fixture\" };\n";

function cleanFixtureFiles(): Record<string, string> {
  return {
    "src/workflows/descriptor-registry.ts": "export const REGISTRY = [];\n",
    "src/workflows/solo/descriptor.ts": fixtureDescriptor("solo"),
    "src/workflows/solo/module.ts": FIXTURE_MODULE,
    "src/workflows/combo/descriptor.ts": fixtureDescriptor("combo"),
    "src/workflows/combo/module.ts": FIXTURE_MODULE,
    "src/workflows/combo/step-one/step.ts": fixtureStep("step-one"),
    "src/workflows/combo/step-one/nodes.ts": "export const NODES = [];\n",
    "src/workflows/combo/step-one/descriptor.ts": fixtureDescriptor("combo-harness"),
    "src/workflows/combo/step-one/module.ts": FIXTURE_MODULE,
    "src/workflows/combo/step-two/step.ts": fixtureStep("step-two"),
    "src/workflows/combo/step-two/nodes.ts": "export const NODES = [];\n",
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
      delete files["src/workflows/solo/descriptor.ts"];
      delete files["src/workflows/solo/module.ts"];
    }),
    modules: cleanFixtureModules(),
    expected: /workflow solo \(role standalone\) is addressed to src\/workflows\/solo\/, which does not exist/,
  },
  {
    name: "missing-module-file",
    arm: "a",
    files: withFiles((files) => { delete files["src/workflows/combo/step-one/module.ts"]; }),
    modules: cleanFixtureModules(),
    expected: /workflow combo-harness must author src\/workflows\/combo\/step-one\/module\.ts, which is missing/,
  },
  {
    name: "descriptor-declares-another-id",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/step-one/descriptor.ts"] = fixtureDescriptor("somebody-else");
    }),
    modules: cleanFixtureModules(),
    expected: /declares workflow id somebody-else, but the module addressed there is combo-harness/,
  },
  {
    name: "unreadable-descriptor",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/descriptor.ts"] = "export const descriptor = buildIt({ id: someId });\n";
    }),
    modules: cleanFixtureModules(),
    expected: /descriptor\.ts: build manifest needs exactly one string-literal descriptor id/,
  },
  {
    name: "nested-below-a-step-folder",
    arm: "a",
    files: withFiles((files) => {
      files["src/workflows/combo/step-one/deeper/notes.ts"] = "export const NOTE = 1;\n";
    }),
    modules: cleanFixtureModules(),
    expected: /src\/workflows\/combo\/step-one\/deeper\/ is nested below a step folder/,
  },
  {
    name: "declared-category-without-a-folder",
    arm: "b",
    files: cleanFixtureFiles(),
    modules: cleanFixtureModules().map((module) => module.id === "combo"
      ? { ...module, timelineKeys: [...module.timelineKeys, "step-three"] }
      : module),
    expected: /workflow combo declares timeline step step-three, which has no folder at src\/workflows\/combo\/step-three\//,
  },
  {
    name: "step-folder-without-a-category",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/combo/step-three/step.ts"] = fixtureStep("step-three");
    }),
    modules: cleanFixtureModules(),
    expected: /src\/workflows\/combo\/step-three\/ is a step folder combo does not declare as a timeline category — it declares: step-one, step-two/,
  },
  {
    name: "step-key-disagrees-with-its-folder",
    arm: "b",
    files: withFiles((files) => { files["src/workflows/combo/step-two/step.ts"] = fixtureStep("step-2"); }),
    modules: cleanFixtureModules(),
    expected: /step-two\/step\.ts declares step key step-2, but its folder is named step-two/,
  },
  {
    name: "step-folder-without-step-ts",
    arm: "b",
    files: withFiles((files) => { delete files["src/workflows/combo/step-two/step.ts"]; }),
    modules: cleanFixtureModules(),
    expected: /step folder src\/workflows\/combo\/step-two\/ must author step\.ts/,
  },
  {
    name: "unreadable-step-key",
    arm: "b",
    files: withFiles((files) => {
      files["src/workflows/combo/step-two/step.ts"] = "export const STEP = { key: \"step-two\" };\n";
    }),
    modules: cleanFixtureModules(),
    expected: /step-two\/step\.ts: a step folder's step\.ts must declare exactly one string-literal defineWorkflowStep key/,
  },
  {
    name: "undeclared-timeline-with-a-step-folder",
    arm: "b",
    files: withFiles((files) => { files["src/workflows/solo/only-step/step.ts"] = fixtureStep("only-step"); }),
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
  return WORKFLOW_MODULES.map((module) => ({
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
    assert.ok(repositoryTree.declaredIds.size > 0, "collector read no descriptor ids");
    assert.ok(repositoryTree.stepKeys.size > 0, "collector read no step keys");
    assert.deepEqual(auditWorkflowLayout(registeredLayoutModules(), repositoryTree), []);
  });

  it("arm (b): the composition's declared steps are exactly its step folders, by name", () => {
    // Belt-and-braces over the arm above: if `auditWorkflowLayout` ever stopped
    // deriving sub-folders, the set comparison here would still notice.
    const separations = registeredLayoutModules().find(({ id }) => id === "separations");
    assert.ok(separations !== undefined, "separations must stay registered");
    assert.equal(separations.timelineDeclared, true);
    assert.deepEqual(
      [...separations.timelineKeys].sort(),
      childrenOf(repositoryTree.directories, "src/workflows/separations").toSorted(),
    );
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
    assert.deepEqual(auditWorkflowModuleRoles(WORKFLOW_MODULES), []);

    const composition = WORKFLOW_MODULES.find(({ role }) => role.kind === "composition");
    const harnesses = WORKFLOW_MODULES.filter(({ role }) => role.kind === "chunk-harness");
    assert.ok(composition !== undefined, "a composition must stay registered");
    const [first, second] = harnesses;
    assert.ok(first !== undefined && second !== undefined, "two harnesses must stay registered");
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
        "import { x } from \"../../../src/domain/workflow/source-layout.js\";\n"
        + "const path = `src/workflows/${id}/descriptor.ts`;\n",
      ],
    ]);
    const violations = auditPathRuleSingleSource(violating);
    assert.equal(violations.length, 2, violations.join("; "));
    assert.match(violations.join("\n"), /no-import\.test\.ts must derive a descriptor's path from/);
    assert.match(violations.join("\n"), /inline-rule\.test\.ts builds a src\/workflows\/ path by interpolation/);
  });
});
