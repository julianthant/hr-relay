import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function envValue(name: string): string | undefined {
  return process.env[name];
}

it("makes the public architecture command exit nonzero when its project collects no tests", () => {
  const execPath = envValue("npm_execpath");
  if (execPath === undefined || execPath === "") throw new Error("npm_execpath is required to launch the architecture command");
  const result = spawnSync(
    process.execPath,
    [execPath, "run", "test:architecture", "--", "tests/architecture/fixtures/does-not-exist.test.ts"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /No test files found, exiting with code 1/);
  assert.match(output, /projects: architecture/);
  assert.match(output, /filter: tests\/architecture\/fixtures\/does-not-exist\.test\.ts/);
});
