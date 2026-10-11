import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join,resolve } from "node:path";
import { describe,it } from "vitest";
import vitestConfig,{ REBUILD_TEST_EXEC_ARGV } from "../vitest.config.js";
const REPO_ROOT = resolve(import.meta.dirname, "..");

function namedArchitectureProject(config: unknown): {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
} | undefined {
  const projects = (config as {
    readonly test?: {
      readonly projects?: readonly {
        readonly test?: {
          readonly name?: string;
          readonly include?: readonly string[];
          readonly exclude?: readonly string[];
        };
      }[];
    };
  }).test?.projects;
  return projects?.find(({ test }) => test?.name === "architecture")?.test;
}

describe("architecture project empty collection", () => {
  it("explicitly refuses an empty architecture project instead of inheriting a permissive default", () => {
    assert.equal(vitestConfig.test?.passWithNoTests, false);
    assert.deepEqual(vitestConfig.test?.execArgv, REBUILD_TEST_EXEC_ARGV);
    assert.deepEqual(
      REBUILD_TEST_EXEC_ARGV,
      ["--no-experimental-webstorage"],
      "Node test workers must disable process-global web storage rather than emit an uncontrolled warning",
    );
    assert.notEqual(
      ({ test: { passWithNoTests: true } }).test.passWithNoTests,
      false,
      "the control must distinguish the permissive empty-suite setting",
    );
  });

  it("independently keeps the membership guard inside an architecture project with no exclusions", () => {
    const architecture = namedArchitectureProject(vitestConfig);
    assert.deepEqual(architecture?.include, ["tests/architecture/**/*.test.ts"]);
    assert.deepEqual(
      architecture?.exclude,
      [],
      "architecture exclusions could remove the membership guard that owns the architecture lane",
    );
    assert.ok(
      existsSync(join(REPO_ROOT, "tests/architecture/tooling/guard-manifest.test.ts")),
      "the recursive architecture project must retain its membership guard",
    );
  });
});
