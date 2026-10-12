import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe,expect,it } from "vitest";
import { computeBuildManifest, declaredWorkflowId } from "../../../scripts/build/workflow-build-manifest.js";

describe("workflow definition compiler", () => {

  it("keeps definition-authored workflow ids visible to the build-manifest guard", () => {
    expect(declaredWorkflowId(resolve("src/workflows/person-lookup/workflow.ts"))).toBe("person-lookup");
    expect(declaredWorkflowId(resolve("src/workflows/separations/workflow.ts"))).toBe("separations");
  });
});


describe("manifest task owners", () => {
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
