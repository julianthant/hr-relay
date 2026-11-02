import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { workflowRegistrySources } from "../../../scripts/build/generate-workflow-registries.js";
import { collectSourceClosure } from "../../../scripts/build/workflow-build-manifest.js";
import { testProcessImport } from "../../support/compiled-process.js";

function put(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function workflow(root: string, id: string, exposure: string, order: number): void {
  const folder = `src/workflows/${id}`;
  put(root, `${folder}/workflow.ts`, `export const ${id}Workflow = defineWorkflow({ id: "${id}" });\n`);
  put(root, `${folder}/task-registry.ts`, `export const ${id}Store = {};\n`);
  put(root, `${folder}/steps/read/step.ts`, `export const ${id}ReadWorkflow = defineWorkflow({ id: "${id}-read" });\n`);
  put(root, `${folder}/index.ts`, [
    'import { deepFreeze } from "../../rules/validation/immutability.js";',
    `import { ${id}Workflow } from "./workflow.js";`,
    `import { ${id}Store } from "./task-registry.js";`,
    `import { ${id}ReadWorkflow } from "./steps/read/step.js";`,
    'throw new Error("registration source must not execute during generation");',
    "export const registration = deepFreeze({",
    `  definition: ${id}Workflow, exposure: ${exposure}, store: ${id}Store,`,
    `  proofs: [{ definition: ${id}ReadWorkflow, order: ${order} }],`,
    "} as const);\n",
  ].join("\n"));
}

describe("workflow registry generation", () => {
  it("keeps the committed lists current and the dashboard closure free of backend implementations", () => {
    const root = resolve(".");
    for (const [path, content] of workflowRegistrySources(root)) expect(readFileSync(join(root, path), "utf8")).toBe(content);
    const closure = collectSourceClosure(root, join(root, "src/workflows/descriptor-registry.ts")).map(source => source.path);
    expect(closure).toContain("src/workflows/generated-descriptors.ts");
    expect(closure).toContain("src/workflow-kit/task-registry.ts");
    expect(closure.filter(path => path.startsWith("src/backend/")
      || /^src\/workflows\/[^/]+\/(?:index\.ts$|task-registry\.ts$|tasks\/)/u.test(path))).toEqual([]);
  });

  it("sorts the picker by declared order, admits child-only modules separately and excludes unregistered owners", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-registries-"));
    try {
      workflow(root, "alpha", '{ kind: "public", order: 4 }', 1);
      workflow(root, "zeta", '{ kind: "public", order: 2 }', 0);
      workflow(root, "child", '{ kind: "child-only" }', 2);
      workflow(root, "pending", '{ kind: "unregistered" }', 0);
      const sources = workflowRegistrySources(root);
      const modules = sources.get("src/backend/app/registries/generated-workflow-modules.ts");
      expect(modules).toContain("WORKFLOW_MODULES = Object.freeze([\n  zetaModule,\n  alphaModule,");
      expect(modules).toContain("CHILD_ONLY_WORKFLOW_MODULES = Object.freeze([\n  childModule,");
      const descriptors = sources.get("src/workflows/generated-descriptors.ts");
      expect(descriptors).toContain("compileWorkflow(zetaWorkflow).descriptor,\n  compileWorkflow(alphaWorkflow).descriptor,");
      expect(descriptors).not.toContain("child");
      expect(descriptors).not.toContain("index.js");
      expect(sources.get("src/backend/app/registries/generated-workflow-stores.ts")).toContain("childModuleRegistration.store");
      expect(sources.get("src/backend/app/registries/generated-step-proof-modules.ts"))
        .toContain("STEP_PROOF_MODULES = Object.freeze([\n  zetaReadModule,\n  alphaReadModule,\n  childReadModule,");
      for (const source of sources.values()) expect(source).not.toContain("pending");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses missing indexes, invalid declarations, duplicate orders and incomplete proof inventories", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-registry-refusals-"));
    try {
      workflow(root, "alpha", '{ kind: "public", order: 0 }', 0);
      const path = join(root, "src/workflows/alpha/index.ts");
      const clean = readFileSync(path, "utf8");
      expect(workflowRegistrySources(root).size).toBe(4);
      rmSync(path);
      expect(() => workflowRegistrySources(root)).toThrow(/index\.ts/u);
      for (const [before, after, reason] of [
        ["export const registration", "const registration", /must export const registration/u],
        ['kind: "public", order: 0', 'kind: "unknown"', /exposure kind/u],
        ['kind: "public", order: 0', 'kind: "public"', /nonnegative integer order/u],
        ['kind: "public", order: 0', 'kind: "child-only", order: 0', /only public exposure/u],
        ["order: 0", "order: -1", /nonnegative integer order/u],
        ["order: 0", "order: 1.5", /nonnegative integer order/u],
        ["store: alphaStore", "store: {}", /real named value import/u],
        ["proofs: [{ definition: alphaReadWorkflow, order: 0 }]", "proofs: []", /proofs must list every/u],
        ["definition: alphaWorkflow", "definition: alphaWorkflow, definition: alphaWorkflow", /duplicate property/u],
        ['"./workflow.js"', '"../../backend/unsafe.js"', /real named value import/u],
      ] as const) {
        writeFileSync(path, clean.replace(before, after));
        expect(() => workflowRegistrySources(root), `${before} → ${after}`).toThrow(reason);
      }
      writeFileSync(path, clean);
      workflow(root, "beta", '{ kind: "public", order: 0 }', 1);
      expect(() => workflowRegistrySources(root)).toThrow(/repeat public picker order/u);
      workflow(root, "beta", '{ kind: "child-only" }', 0);
      expect(() => workflowRegistrySources(root)).toThrow(/repeat step proof order/u);
      workflow(root, "beta", '{ kind: "child-only" }', 1);
      put(root, "src/workflows/beta/workflow.ts", 'export const betaWorkflow = defineWorkflow({ id: "wrong" });\n');
      expect(() => workflowRegistrySources(root)).toThrow(/workflow id must match its folder/u);
      workflow(root, "beta", '{ kind: "child-only" }', 1);
      put(root, "src/workflows/beta/steps/read/step.ts", 'export const betaReadWorkflow = defineWorkflow({ id: "alpha-read" });\n');
      expect(() => workflowRegistrySources(root)).toThrow(/repeat workflow ids/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("bootstraps missing or conflicted output and check refuses stale bytes without rewriting them", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-registry-cli-"));
    try {
      put(root, "package.json", JSON.stringify({ type: "module" }));
      for (const name of ["typescript", "zod"]) {
        const target = join(root, "node_modules", name);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(resolve("node_modules", name), target, { recursive: true });
      }
      const entry = "scripts/build/generate-workflow-registries.ts";
      for (const { path } of collectSourceClosure(resolve("."), resolve(entry))) {
        put(root, path, readFileSync(resolve(path), "utf8"));
      }
      workflow(root, "alpha", '{ kind: "public", order: 0 }', 0);
      mkdirSync(join(root, "src/backend/app/registries"), { recursive: true });
      const run = (...args: string[]) => spawnSync(process.execPath,
        ["--import", testProcessImport(), join(root, entry), ...args], { cwd: root, encoding: "utf8" });
      const check = (status: number, ...args: string[]) => {
        const result = run(...args);
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status, result.stderr).toBe(status);
      };
      check(1, "--check");
      check(0);
      check(0, "--check");
      const target = join(root, "src/workflows/generated-descriptors.ts");
      const conflict = "<<<<<<< current\n=======\n>>>>>>> incoming\n";
      writeFileSync(target, conflict);
      check(1, "--check");
      expect(readFileSync(target, "utf8")).toBe(conflict);
      check(0);
      expect(readFileSync(target, "utf8")).toContain("compileWorkflow(alphaWorkflow).descriptor");
      check(0, "--check");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
