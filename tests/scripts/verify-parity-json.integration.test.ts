import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { acquireSuiteLock, TestSuiteWaitTimeoutError } from "../../scripts/test/runner.js";
import { runParityAndVerify } from "../../scripts/verify-parity-json.js";

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
      await assert.rejects(runParityAndVerify({ ...options, args: ["--project", "desktop"] }), TestSuiteWaitTimeoutError);
      assert.equal(existsSync(marker), false);
      assert.equal(existsSync(join(cwd, ".tracker")), false, "report lock must follow shared suite acquisition");
      const errors: string[] = [];
      assert.equal(await runParityAndVerify({ ...options, args: [mode === "assert" ? "run" : "proof.spec.ts"], writeError: (message) => { errors.push(message); } }), 23);
      assert.equal(existsSync(marker), true);
      assert.ok(errors.some((message) => message.includes("Playwright parity command failed first (exit 23)")));
    }
  } finally { await lease.release(); rmSync(root, { recursive: true, force: true }); }
});
