import { testProcessImport } from "../../support/compiled-process.js";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BUILD_MANIFEST_PATH } from "../../../src/models/workflow/build-manifest.js";
import { describe,expect,it } from "vitest";
import { auditBuildManifestBytes, collectSourceClosure, computeBuildManifest, declaredWorkflowId, fingerprintSourceSet, prepareBuildManifest, renderBuildManifestModule } from "../../../scripts/build/workflow-build-manifest.js";

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
    writeFileSync(task, 'import { BUILD_MANIFEST } from "../../../../workflow-kit/validation/build-manifest.js";\nexport const read = BUILD_MANIFEST;\n');
    const target = join(root, BUILD_MANIFEST_PATH);
    mkdirSync(dirname(target), { recursive: true });
    const run = (...args: string[]) => spawnSync(process.execPath,
      ["--import", testProcessImport(), join(root, "scripts/build/generate-workflow-manifest.ts"), ...args],
      { cwd: root, encoding: "utf8" });
    const check = (status: number, ...args: string[]) => {
      const result = run(...args);
      expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status, result.stderr).toBe(status);
    };
    const runtime = () => spawnSync(process.execPath,
      ["--import", testProcessImport(), join(root, "src/workflow-kit/validation/build-manifest.ts")],
      { cwd: root, encoding: "utf8" });
    expect(runtime().status).not.toBe(0);
    check(1, "--check");
    check(0);
    expect(runtime().status).toBe(0);
    const bytes = readFileSync(target, "utf8");
    const modified = statSync(target).mtimeMs;
    check(0);
    expect(readFileSync(target, "utf8")).toBe(bytes);
    expect(statSync(target).mtimeMs).toBe(modified);
    const first = computeBuildManifest(root);
    expect(first.tasks[0]?.sources.map(source => source.path)).toContain("src/workflow-kit/validation/build-manifest.ts");
    expect(first.tasks[0]?.sources.map(source => source.path)).not.toContain(BUILD_MANIFEST_PATH);
    expect(readFileSync(target, "utf8")).toBe(renderBuildManifestModule(first));
    expect(auditBuildManifestBytes(readFileSync(target, "utf8"), first)).toEqual([]);
    check(0, "--check");
    writeFileSync(target, bytes.replace(" = {", " =  {"));
    check(1, "--check");
    expect(readFileSync(target, "utf8")).toBe(bytes.replace(" = {", " =  {"));
    writeFileSync(target, bytes);
    writeFileSync(task, readFileSync(task, "utf8") + "export const changed = true;\n");
    check(1, "--check");
    expect(readFileSync(target, "utf8")).toBe(bytes);
    writeFileSync(target, "<<<<<<< current\nnot valid TypeScript\n=======\nforeign output\n>>>>>>> incoming\n");
    check(1, "--check");
    expect(readFileSync(target, "utf8")).toContain("<<<<<<< current");
    expect(runtime().status).not.toBe(0);
    check(0);
    const current = computeBuildManifest(root);
    expect(current.tasks[0]?.fingerprint).not.toBe(first.tasks[0]?.fingerprint);
    expect(readFileSync(target, "utf8")).toBe(renderBuildManifestModule(current));
    expect(auditBuildManifestBytes(readFileSync(target, "utf8"), current)).toEqual([]);
    check(0, "--check");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("excludes only the exact artifact while refusing ordinary unresolved imports", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-manifest-resolution-"));
  try {
    const entry = join(root, "entry.ts");
    writeFileSync(entry, 'import "./src/workflow-kit/validation/generated-build-manifest.js";\n');
    expect(collectSourceClosure(root, entry).map(source => source.path)).toEqual(["entry.ts"]);
    for (const specifier of ["./missing.js", "./elsewhere/generated-build-manifest.js"]) {
      writeFileSync(entry, `import "${specifier}";\n`);
      expect(() => collectSourceClosure(root, entry)).toThrow(/build manifest cannot resolve/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("invalidates imported source, installed toolchain and driver closure membership", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-manifest-inputs-"));
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  try {
    for (const name of ["typescript", "zod"]) put(`node_modules/${name}/package.json`, '{"version":"1.0.0"}');
    put("src/backend/systems/crm/task-registry.ts", "export const registry = true;\n");
    put("src/backend/systems/crm/tasks/read.ts", 'import type { Value } from "../value.js";\n');
    put("src/backend/systems/crm/value.ts", "export type Value = 1;\n");
    const first = computeBuildManifest(root);
    put("src/backend/systems/crm/value.ts", "export type Value = 2;\n");
    const imported = computeBuildManifest(root);
    expect(imported.tasks[0]?.fingerprint).not.toBe(first.tasks[0]?.fingerprint);
    put("node_modules/typescript/package.json", '{"version":"2.0.0"}');
    const toolchain = computeBuildManifest(root);
    expect(toolchain.tasks[0]?.fingerprint).not.toBe(imported.tasks[0]?.fingerprint);
    put("src/backend/systems/crm/driver/interpreter.ts", "export const driver = true;\n");
    const driver = computeBuildManifest(root);
    expect(driver.tasks[0]?.fingerprint).not.toBe(toolchain.tasks[0]?.fingerprint);
    expect(driver.tasks[0]?.sources.map(source => source.path)).toContain("src/backend/systems/crm/driver/interpreter.ts");
    prepareBuildManifest(root);
    const target = join(root, BUILD_MANIFEST_PATH), bytes = readFileSync(target, "utf8");
    prepareBuildManifest(root);
    expect(readFileSync(target, "utf8")).toBe(bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("retains the canonical fingerprint algorithm's known complete tuple", () => {
  expect(fingerprintSourceSet({ typescript: "5.9.3", zod: "4.6.6" }, "crm/read", []))
    .toBe("8360e1578d55ebfbff6bcffb72100606d6fdb6ecc831d1d253abd46c694afa90");
});
