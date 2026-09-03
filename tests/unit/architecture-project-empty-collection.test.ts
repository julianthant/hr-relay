import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "vitest";
import vitestConfig, { REBUILD_TEST_EXEC_ARGV } from "../../vitest.config.js";
import { REPO_ROOT } from "./architecture/helpers/guard-files.js";

function inheritedProjectPassWithNoTests(config: unknown): boolean | undefined {
  return (config as { readonly test?: { readonly passWithNoTests?: boolean } }).test?.passWithNoTests;
}

function inheritedProjectExecArgv(config: unknown): readonly string[] | undefined {
  return (config as { readonly test?: { readonly execArgv?: readonly string[] } }).test?.execArgv;
}

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

function runArchitectureProjectWithNoMatchingFile() {
  return spawnSync(
    "npm",
    [
      "run", "test:architecture", "--",
      "tests/unit/architecture/fixtures/does-not-exist.test.ts",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}

describe("architecture project empty collection", () => {
  it("explicitly refuses an empty architecture project instead of inheriting a permissive default", () => {
    assert.equal(inheritedProjectPassWithNoTests(vitestConfig), false);
    assert.deepEqual(inheritedProjectExecArgv(vitestConfig), REBUILD_TEST_EXEC_ARGV);
    assert.deepEqual(
      REBUILD_TEST_EXEC_ARGV,
      ["--no-experimental-webstorage"],
      "Node test workers must disable process-global web storage rather than emit an uncontrolled warning",
    );
    assert.notEqual(
      inheritedProjectPassWithNoTests({ test: { passWithNoTests: true } }),
      false,
      "the control must distinguish the permissive empty-suite setting",
    );
  });

  it("independently keeps the membership guard inside an architecture project with no exclusions", () => {
    const architecture = namedArchitectureProject(vitestConfig);
    assert.deepEqual(architecture?.include, ["tests/unit/architecture/**/*.test.ts"]);
    assert.deepEqual(
      architecture?.exclude,
      [],
      "architecture exclusions could remove the membership guard that owns the architecture lane",
    );
    assert.match(
      architecture?.include?.[0] ?? "",
      /tests\/unit\/architecture\/\*\*\/\*\.test\.ts/,
      "the recursive include must collect tests/unit/architecture/guard-manifest.test.ts",
    );
  });

  it("makes the public architecture command exit nonzero when its project collects no tests", () => {
    const result = runArchitectureProjectWithNoMatchingFile();
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /No test files found, exiting with code 1/);
    assert.match(output, /projects: architecture/);
    assert.match(output, /filter: tests\/unit\/architecture\/fixtures\/does-not-exist\.test\.ts/);
  });
});
