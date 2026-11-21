import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/test/ram-tmp.sh", import.meta.url));

it("refuses a missing or out-of-range RAM disk size before attaching one", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ram-tmp-refusal-"));
  try {
    const diskLog = join(fixture, "disk.log");
    writeFileSync(diskLog, "");
    for (const command of ["hdiutil", "diskutil"]) {
      writeFileSync(join(fixture, command), "#!/bin/sh\nprintf '%s\\n' \"$0\" >> \"$RAM_TMP_DISK_LOG\"\nexit 1\n", { mode: 0o700 });
    }
    const env = { ...process.env, PATH: [fixture, process.env.PATH].join(delimiter), RAM_TMP_DISK_LOG: diskLog };
    const usage = "usage: ram-tmp.sh <mebibytes> | ram-tmp.sh eject <volume>\n";
    const bounds = "ram-tmp: size must be 64..8192 MiB\n";
    const cases = [[[], usage], [["0"], bounds], [["8193"], bounds], [["eject"], usage]] as const;
    for (const [args, stderr] of cases) {
      const result = spawnSync("sh", [script, ...args], { encoding: "utf8", env });
      assert.ifError(result.error);
      assert.equal(readFileSync(diskLog, "utf8"), "", "a refused request must never invoke a disk command");
      assert.equal(result.status, 2, args.join(" ") || "(no args)");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, stderr);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
