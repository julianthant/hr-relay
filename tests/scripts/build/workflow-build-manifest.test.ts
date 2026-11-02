import { testProcessImport } from "../../support/compiled-process.js";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BUILD_MANIFEST_PATH } from "../../../src/models/workflow/build-manifest.js";
import { describe,expect,it } from "vitest";
import { auditBuildManifestBytes, collectSourceClosure, computeBuildManifest, declaredWorkflowId, renderBuildManifestModule } from "../../../scripts/build/workflow-build-manifest.js";

describe("workflow definition compiler", () => {

  it("hashes LF and CRLF equally while cached closure reads still detect real imported-source edits", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-manifest-newlines-"));
    try {
      const entry = join(root, "entry.ts"), dependency = join(root, "dependency.ts");
      writeFileSync(entry, 'import { value } from "./dependency.js";\nexport const result = value;\n');
      writeFileSync(dependency, "export const value = 1;\n");
      const lf = collectSourceClosure(root, entry);
      expect(lf).toHaveLength(2);
      for (const path of [entry, dependency]) writeFileSync(path, readFileSync(path, "utf8").replace(/\n/gu, "\r\n"));
      expect(collectSourceClosure(root, entry)).toEqual(lf);
      expect(collectSourceClosure(root, entry)).toEqual(lf);
      writeFileSync(dependency, "export const value = 2;\r\n");
      const changed = collectSourceClosure(root, entry);
      expect(changed.find(source => source.path === "dependency.ts")?.sha256).not.toBe(lf.find(source => source.path === "dependency.ts")?.sha256);
      expect(changed.find(source => source.path === "entry.ts")).toEqual(lf.find(source => source.path === "entry.ts"));
      expect(collectSourceClosure(root, entry)).toEqual(changed);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps definition-authored workflow ids visible to the build-manifest guard", () => {
    expect(declaredWorkflowId(resolve("src/workflows/person-lookup/workflow.ts"))).toBe("person-lookup");
    expect(declaredWorkflowId(resolve("src/workflows/separations/workflow.ts"))).toBe("separations");
  });
});


describe("manifest task owners", () => {
  it("fingerprints inherited parent metadata even when the step recipe has no parent import", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-proof-parent-"));
    try {
      for (const name of ["typescript", "zod"]) {
        const folder = join(root, "node_modules", name);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "package.json"), JSON.stringify({ version: "1.0.0" }));
      }
      const parent = join(root, "src/workflows/example/workflow.ts");
      const step = join(root, "src/workflows/example/steps/read/step.ts");
      mkdirSync(dirname(step), { recursive: true });
      writeFileSync(parent, 'export const parent = defineWorkflow({ id: "example", label: "First" });\n');
      writeFileSync(step, 'export const read = defineStep({ group: {}, proof: { id: "example-read", order: 0, build: () => ({}) } });\n');
      const first = computeBuildManifest(root).workflows.find(workflow => workflow.id === "example-read");
      expect(first?.sources.map(source => source.path)).toEqual([
        "src/workflows/example/steps/read/step.ts", "src/workflows/example/workflow.ts",
      ]);
      writeFileSync(parent, 'export const parent = defineWorkflow({ id: "example", label: "Changed" });\n');
      const changed = computeBuildManifest(root).workflows.find(workflow => workflow.id === "example-read");
      expect(changed?.fingerprint).not.toBe(first?.fingerprint);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("hashes workflow-owned system task calls through the workflow without inventing task implementations", () => {
    const manifest = computeBuildManifest(resolve("."));
    expect(manifest.tasks.some(task => task.id === "ucpath/search-person-match")).toBe(true);
    expect(manifest.tasks.some(task => task.id === "workflow:i9-check/search-person-match")).toBe(false);
    const workflow = manifest.workflows.find(workflow => workflow.id === "i9-check");
    expect(workflow?.sources.map(source => source.path)).toEqual(expect.arrayContaining([
      "src/workflows/i9-check/tasks/search-person-match.ts", "src/workflows/i9-check/tasks/search-person-org.ts",
    ]));
  });

  it("requires the current registry even when a retired registration exists", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-manifest-owner-"));
    try {
      for (const packageName of ["typescript", "zod"]) {
        const folder = join(root, "node_modules", packageName);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "package.json"), JSON.stringify({ version: "1.0.0" }));
      }
      const owner = join(root, "src/backend/systems/crm");
      mkdirSync(join(owner, "tasks"), { recursive: true });
      writeFileSync(join(owner, "tasks/read.ts"), "export const read = true;\n");
      writeFileSync(join(owner, "store.ts"), "export const retired = true;\n");
      expect(() => computeBuildManifest(root)).toThrow(/task-registry\.ts/);
      rmSync(join(owner, "store.ts"));
      expect(() => computeBuildManifest(root)).toThrow(/task-registry\.ts/);
      writeFileSync(join(owner, "task-registry.ts"), "export const registry = true;\n");
      expect(computeBuildManifest(root).tasks.map(({ id }) => id)).toEqual(["crm/read"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


it("runs the actual generator without existing output and replaces conflicted output while check rejects missing and stale bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-manifest-bootstrap-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
    for (const name of ["typescript", "zod"]) {
      const source = resolve("node_modules", name);
      expect(lstatSync(source).isSymbolicLink()).toBe(false);
      const target = join(root, "node_modules", name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
    }
    for (const name of ["scripts/build/generate-workflow-manifest.ts", "scripts/build/workflow-build-manifest.ts",
      "src/models/workflow/build-manifest.ts", "src/workflow-kit/validation/build-manifest.ts", "src/rules/identity/ids.ts", "src/rules/validation/canonical-json.ts"]) {
      const target = join(root, name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(resolve(name), target, { force: false, errorOnExist: true });
    }
    const owner = join(root, "src/backend/systems/crm");
    mkdirSync(join(owner, "tasks"), { recursive: true });
    writeFileSync(join(owner, "task-registry.ts"), "export const registry = true;\n");
    const task = join(owner, "tasks/read.ts");
    writeFileSync(task, "export const read = true;\n");
    const target = join(root, BUILD_MANIFEST_PATH);
    mkdirSync(dirname(target), { recursive: true });
    const run = (...args: string[]) => spawnSync(process.execPath,
      ["--import", testProcessImport(), join(root, "scripts/build/generate-workflow-manifest.ts"), ...args],
      { cwd: root, encoding: "utf8" });
    const check = (status: number, ...args: string[]) => {
      const result = run(...args);
      expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status, result.stderr).toBe(status);
    };
    check(1, "--check");
    check(0);
    const first = computeBuildManifest(root);
    expect(readFileSync(target, "utf8")).toBe(renderBuildManifestModule(first));
    expect(auditBuildManifestBytes(readFileSync(target, "utf8"), first)).toEqual([]);
    check(0, "--check");
    writeFileSync(task, "export const read = false;\n");
    check(1, "--check");
    writeFileSync(target, "<<<<<<< current\nnot valid TypeScript\n=======\nforeign output\n>>>>>>> incoming\n");
    check(1, "--check");
    check(0);
    const current = computeBuildManifest(root);
    expect(current.tasks[0]?.fingerprint).not.toBe(first.tasks[0]?.fingerprint);
    expect(readFileSync(target, "utf8")).toBe(renderBuildManifestModule(current));
    expect(auditBuildManifestBytes(readFileSync(target, "utf8"), current)).toEqual([]);
    check(0, "--check");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
