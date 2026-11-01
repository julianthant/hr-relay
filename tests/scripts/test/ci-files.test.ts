import { describe, expect, it } from "vitest";
import { balance, durationsFromReports, MACOS_FILES, SERIAL_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";

const portable = ["a", "b", "c", "d", "e"].map(name => `tests/backend/${name}.integration.test.ts`);
const integration = [...portable, ...MACOS_FILES, ...SERIAL_FILES].filter(file => file.endsWith(".integration.test.ts"));
const unit = ["tests/models/portable.test.ts", "tests/backend/storage/sqlite/backup-service.test.ts"];
const durations = { [portable[0] ?? ""]: 50, [SERIAL_FILES[0] ?? ""]: 200 };

const run = (listed: readonly string[], project: "unit" | "integration", runner: "ubuntu" | "macos" | "serial", jobs: number) =>
  Array.from({ length: jobs }, (_, i) => selectCiFiles(listed, project, runner, i + 1, jobs, durations)).flat();

describe("CI file selection", () => {
  it("gives each file to exactly one job", () => {
    const integrationRuns = [...run(integration, "integration", "ubuntu", 3), ...run(integration, "integration", "macos", 5), ...run(integration, "integration", "serial", 5)];
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

  it("reads file durations from Vitest JSON reports", () => {
    const report = { testResults: [{ name: "/home/runner/work/hr-relay/hr-relay/tests/x.test.ts", startTime: 1_000, endTime: 3_460 }] };
    expect(durationsFromReports([report])).toEqual({ "tests/x.test.ts": 2.5 });
  });
});
