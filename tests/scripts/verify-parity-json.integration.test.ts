import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { runChild } from "../../scripts/verify-parity-json.js";

function dead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw error;
  }
}

it("kills an idle parity child's descendants before the child returns", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hrt-parity-"));
  const writer = join(directory, "writer.mjs");
  const parent = join(directory, "parent.mjs");
  const pidFile = join(directory, "pid");
  const logFile = join(directory, "writes");
  writeFileSync(writer, "import { appendFileSync } from 'node:fs';\nconst file = process.argv[2];\nappendFileSync(file, 'x');\nsetInterval(() => appendFileSync(file, 'x'), 30);\n");
  writeFileSync(parent, "import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst child = spawn(process.execPath, [process.argv[2], process.argv[4]], { stdio: 'ignore' });\nwriteFileSync(process.argv[3], String(child.pid));\nsetInterval(() => {}, 1_000_000);\n");
  const result = await runChild(process.execPath, [parent, writer, pidFile, logFile], directory, process.env, 1_000);
  assert.equal(result.code, 1);
  assert.match(result.detail, /no output for 1000ms/);
  const pid = Number(readFileSync(pidFile, "utf8"));
  const deadline = Date.now() + 2_000;
  let size = -1;
  while (Date.now() < deadline) {
    const next = statSync(logFile).size;
    if (dead(pid) && size === next && next > 0) return;
    size = next;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`descendant ${pid} kept writing after the idle timeout`);
});

it("keeps recreated parity output private without changing the parent umask", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hrt-parity-mode-"));
  const previousUmask = process.umask(0o022);
  try {
    const source = "import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync('output'); writeFileSync('output/results.json', '{}');";
    const result = await runChild(process.execPath, ["--input-type=module", "-e", source], directory, process.env);
    assert.equal(result.code, 0);
    assert.equal(process.umask(), 0o022);
    if (process.platform !== "win32") {
      assert.equal(statSync(join(directory, "output")).mode & 0o777, 0o700);
      assert.equal(statSync(join(directory, "output/results.json")).mode & 0o777, 0o600);
    }
  } finally {
    process.umask(previousUmask);
    rmSync(directory, { recursive: true, force: true });
  }
});
