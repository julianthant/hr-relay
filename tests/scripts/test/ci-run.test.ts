import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/test/ci-run.sh", import.meta.url));

describe("CI shell runner", () => {
  it("preserves native file arguments and distinct platform/group report paths", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-ci-shell-"));
    try {
      const bin = join(root, "bin");
      const temp = join(root, "temp");
      mkdirSync(bin);
      mkdirSync(temp);
      writeFileSync(join(bin, "npx"), `#!/usr/bin/env bash
if [ "$1" = tsx ]; then printf 'tests/native proof.integration.test.ts\\0'; fi
`);
      writeFileSync(join(bin, "npm"), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$CI_ARGS"
exit "$CI_EXIT"
`);
      for (const command of ["npx", "npm"]) chmodSync(join(bin, command), 0o755);
      const reports = new Set<string>();
      for (const platform of ["macOS", "Windows"]) {
        for (const group of ["native", "serial", "storage"]) {
          const args = join(root, "args");
          const result = spawnSync("bash", [script, "integration", group, "1/5", "--maxWorkers=1"], {
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp.replaceAll("/", "\\"),
              RUNNER_OS: platform, CI_ARGS: args, CI_EXIT: "7" }, encoding: "utf8",
          });
          expect(result.error).toBeUndefined();
          expect(result.status).toBe(7);
          const passed = readFileSync(args, "utf8").trim().split("\n");
          expect(passed).toContain("tests/native proof.integration.test.ts");
          expect(passed).toContain("--maxWorkers=1");
          const report = `--outputFile.json=${temp}/durations/${platform}-integration-${group}-1.json`;
          expect(passed).toContain(report);
          reports.add(report);
        }
      }
      expect(reports.size).toBe(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
