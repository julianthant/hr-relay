import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { acquireSuiteLock, TestSuiteWaitTimeoutError } from "../../scripts/test/runner.js";
import { hasParitySpecFilter, runParityAndVerify } from "../../scripts/verify-parity-json.js";

it("takes the suite lock before parity's report lock and skips it for a spec filter in both modes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-parity-entry-")));
  const directory = join(root, "runs");
  const lease = await acquireSuiteLock({ directory });
  try {
    for (const mode of ["assert", "update"] as const) {
      const cwd = join(root, mode);
      mkdirSync(cwd, { mode: 0o700 });
      mkdirSync(join(cwd, "tests/parity"), { recursive: true, mode: 0o700 });
      const marker = join(cwd, "child-started");
      const options = {
        cwd, env: {}, mode, command: process.execPath,
        commandArgs: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');process.exitCode=23`, "--"],
        suiteLockDirectory: directory, suiteLockRetryIntervalMs: 10, suiteLockWaitTimeoutMs: 50,
      };
      for (const args of [
        ["--project", "desktop"],
        ["--timeout", "60000", "--grep", "heading", "--fully-parallel"],
        ["--debug", "cli", "--only-changed", "HEAD", "--project", "desktop", "other"],
        ["-xj2", "-gheading", "--timeout=60000"],
        ["--", "proof.spec.ts"],
      ]) {
        await assert.rejects(runParityAndVerify({ ...options, args }), TestSuiteWaitTimeoutError);
      }
      assert.equal(existsSync(marker), false);
      assert.equal(existsSync(join(cwd, ".tracker")), false, "report lock must follow shared suite acquisition");
      const errors: string[] = [];
      for (const args of [
        [mode === "assert" ? "run" : "proof.spec.ts"],
        ["--timeout", "60000", "--grep", "heading", "--fully-parallel", "proof.spec.ts"],
        ["--debug", "cli", "--only-changed", "HEAD", "proof.spec.ts"],
        ["--project=desktop", "proof.spec.ts"],
        ["proof.spec.ts", "--project", "desktop", "other"],
        ["-xj2", "-gheading", "proof.spec.ts"],
      ]) {
        assert.equal(await runParityAndVerify({ ...options, args, writeError: (message) => { errors.push(message); } }), 23);
      }
      assert.equal(existsSync(marker), true);
      assert.ok(errors.some((message) => message.includes("Playwright parity command failed first (exit 23)")));
    }
  } finally { await lease.release(); rmSync(root, { recursive: true, force: true }); }
});

it("classifies Playwright option ownership including optional and variadic operands", () => {
  for (const args of [
    [], ["--workers", "1", "--grep", "heading"], ["--timeout", "60000"],
    ["--fully-parallel"], ["--debug"], ["--debug=cli"], ["--debug", "--fully-parallel"],
    ["--only-changed"], ["--only-changed", "HEAD"], ["--project", "desktop", "other"],
    ["--project=desktop"], ["--project", "desktop", "--", "proof.spec.ts"],
    ["-xj2", "-gheading", "-Gskip"], ["--", "proof.spec.ts"],
  ]) assert.equal(hasParitySpecFilter(args), false, JSON.stringify(args));
  for (const args of [
    ["run"], ["--timeout", "60000", "proof.spec.ts"], ["--fully-parallel", "proof.spec.ts"],
    ["--fully-parallel", "false"], ["--debug", "cli", "proof.spec.ts"],
    ["--only-changed", "HEAD", "proof.spec.ts"], ["--project=desktop", "proof.spec.ts"],
    ["proof.spec.ts", "--project", "desktop", "other"], ["-j", "2", "-g", "heading", "run"],
    ["proof.spec.ts", "--", "argument"],
  ]) assert.equal(hasParitySpecFilter(args), true, JSON.stringify(args));
  for (const args of [["--unknown", "operand"], ["proof.spec.ts", "--unknown"], ["--fully-parallel=false"], ["--timeout"]]) {
    assert.throws(() => hasParitySpecFilter(args), /Unknown parity option|Parity option requires a value/, JSON.stringify(args));
  }
});
