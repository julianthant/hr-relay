import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { balance, durationsFromReports, MACOS_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";

const portable = ["a", "b", "c", "d", "e"].map(name => `tests/backend/${name}.integration.test.ts`);
const integration = [...portable, ...MACOS_FILES, ...SERIAL_FILES].filter(file => file.endsWith(".integration.test.ts"));
const unit = ["tests/models/portable.test.ts", ...MACOS_FILES.filter(file => file.endsWith(".test.ts") && !file.endsWith(".integration.test.ts"))];
const durations = { [portable[0] ?? ""]: 50, [SERIAL_FILES[0] ?? ""]: 200 };

const run = (listed: readonly string[], project: "unit" | "integration", runner: "ubuntu" | "macos" | "serial" | "storage", jobs: number) =>
  Array.from({ length: jobs }, (_, i) => selectCiFiles(listed, project, runner, i + 1, jobs, durations)).flat();

describe("CI file selection", () => {
  it("gives each file to exactly one job", () => {
    const integrationRuns = [...run(integration, "integration", "ubuntu", 3), ...run(integration, "integration", "macos", 5), ...run(integration, "integration", "serial", 5), ...run(integration, "integration", "storage", 5)];
    expect(integrationRuns.sort()).toEqual([...integration].sort());
    expect(run(integration, "integration", "ubuntu", 3).sort()).toEqual(portable);
    expect([...run(unit, "unit", "ubuntu", 2), ...run(unit, "unit", "macos", 5)].sort()).toEqual([...unit].sort());
  });

  it("keeps serial proofs apart and balances measured time", () => {
    const serialJobs = [1, 2, 3, 4, 5].map(job => selectCiFiles(integration, "integration", "serial", job, 5, durations).length);
    expect(Math.max(...serialJobs)).toBe(1);
    expect(balance(["x", "y", "z", "w"], 2, file => ({ x: 4, y: 3, z: 2, w: 1 })[file]!)).toEqual([["w", "x"], ["y", "z"]]);
  });

  it("refuses a pinned file Vitest no longer lists", () => {
    expect(() => selectCiFiles(portable, "integration", "ubuntu", 1, 1, durations)).toThrow(/does not list/u);
  });

  it("runs upgrade proofs separately from native proofs and parallel storage files", () => {
    expect(SERIAL_STORAGE_FILES).toContain("tests/backend/app/composition/dashboard/compose.startup-upgrade.integration.test.ts");
    expect(SERIAL_STORAGE_FILES.every(file => MACOS_FILES.includes(file))).toBe(true);
    expect(run(integration, "integration", "storage", 5).sort()).toEqual([...SERIAL_STORAGE_FILES].sort());
    for (const runner of ["macos", "serial"] as const) {
      expect(run(integration, "integration", runner, 5).some(file => SERIAL_STORAGE_FILES.includes(file))).toBe(false);
    }
  });

  it("reads file durations from Vitest JSON reports", () => {
    const report = { testResults: [{ name: "/home/runner/work/hr-relay/hr-relay/tests/x.test.ts", startTime: 1_000, endTime: 3_460 }] };
    expect(durationsFromReports([report])).toEqual({ "tests/x.test.ts": 2.5 });
  });

  it("uses the same file keys for Windows reports", () => {
    expect(durationsFromReports([{ testResults: [{ name: "D:\\a\\relay\\tests\\x.test.ts", startTime: 0, endTime: 2_000 }] }]))
      .toEqual({ "tests/x.test.ts": 2 });
  });

  it("refuses corrupt timing reports instead of replacing measured work", () => {
    expect(() => durationsFromReports([{}])).toThrow();
    expect(() => durationsFromReports([{ testResults: [{ name: "/tmp/x.test.ts", startTime: 0, endTime: 1 }] }])).toThrow();
    expect(() => durationsFromReports([{ testResults: [{ name: "/repo/tests/x.test.ts", startTime: 2, endTime: 1 }] }])).toThrow();
  });

  it("gives untimed files work even when the committed timings round to zero", () => {
    const shards = [1, 2, 3].map(job => selectCiFiles(integration, "integration", "ubuntu", job, 3, { [portable[0]]: 0 }));
    expect(shards.every(files => files.length > 0)).toBe(true);
    expect(shards.flat().sort()).toEqual(portable);
  });

  it("refuses corrupt downloaded weights before changing the timing map", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-ci-timings-"));
    try {
      mkdirSync(join(root, "scripts/test"), { recursive: true });
      mkdirSync(join(root, "reports"));
      const path = join(root, "scripts/test/ci-durations.json");
      const invalid = JSON.stringify({ "tests/x.test.ts": "invalid" });
      writeFileSync(path, invalid);
      const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"),
        fileURLToPath(new URL("../../../scripts/test/ci-files.ts", import.meta.url)), "durations", "reports"],
      { cwd: root, encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("ZodError");
      expect(readFileSync(path, "utf8")).toBe(invalid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
