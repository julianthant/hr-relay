import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import vitestConfig from "../../vitest.config.js";
import { REPO_ROOT } from "./architecture/helpers/guard-files.js";

function inheritedProjectPassWithNoTests(config: unknown): boolean | undefined {
  return (config as { readonly test?: { readonly passWithNoTests?: boolean } }).test?.passWithNoTests;
}

function runArchitectureProjectWithNoMatchingFile() {
  const vitest = join(REPO_ROOT, "node_modules", ".bin", "vitest");
  assert.ok(existsSync(vitest), `Vitest executable is missing: ${vitest}`);
  return spawnSync(
    vitest,
    [
      "run",
      "--project",
      "architecture",
      "tests/unit/architecture/fixtures/does-not-exist.test.ts",
      "--reporter=dot",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}

describe("architecture project empty collection", () => {
  it("explicitly refuses an empty architecture project instead of inheriting a permissive default", () => {
    assert.equal(inheritedProjectPassWithNoTests(vitestConfig), false);
    assert.notEqual(
      inheritedProjectPassWithNoTests({ test: { passWithNoTests: true } }),
      false,
      "the control must distinguish the permissive empty-suite setting",
    );
  });

  it("exits nonzero when the named architecture project collects no tests", () => {
    const result = runArchitectureProjectWithNoMatchingFile();
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /No test files found, exiting with code 1/);
    assert.match(output, /projects: architecture/);
  });
});
