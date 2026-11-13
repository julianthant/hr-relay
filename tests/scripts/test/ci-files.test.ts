import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { balance, durationsFromReports, LINUX_NATIVE_FILES, NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";
import { namedNativeRefusal, nativeRunExcludes } from "../../../vitest.config.js";

const linuxNativeReport = [
  "tests/backend/app/composition/storage-compose.predecessor-logout.integration.test.ts",
  "tests/backend/storage/maintenance/evidence-schema-upgrade.integration.test.ts",
  "tests/backend/storage/maintenance/protected-settings-upgrade.integration.test.ts",
  "tests/backend/app/composition/storage-compose.clean-shutdown.integration.test.ts",
  "tests/backend/app/composition/storage-compose.startup-repair.integration.test.ts",
  "tests/backend/app/composition/storage-compose.integration.test.ts",
  "tests/backend/profiles/profile-session.incomplete-publication.integration.test.ts",
  "tests/backend/profiles/profile-session.credential-migration.integration.test.ts",
  "tests/backend/runs/lifecycle/run-record-service.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/admission.assistant-populated-schema7.integration.test.ts",
  "tests/backend/storage/admission/admission.profile-upgrade.integration.test.ts",
  "tests/backend/storage/admission/installation.logical-publication.integration.test.ts",
  "tests/backend/storage/admission/lifetime-lock.handle-proof.integration.test.ts",
  "tests/backend/storage/configuration/chatgpt-credential-repository.maintenance.integration.test.ts",
  "tests/backend/storage/configuration/credential-key-custody.integration.test.ts",
  "tests/backend/storage/configuration/credential-store.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/process-identity.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.custody.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.schema-matrix.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.workbook-schema-18.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.workbook-schema-24.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.incomplete-inventory.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/sqlite/backup-inspection.integration.test.ts",
  "tests/backend/storage/sqlite/migrations.native-baseline.integration.test.ts",
  "tests/backend/storage/sqlite/profile-local-databases.readonly-binding.integration.test.ts",
  "tests/backend/storage/sqlite/readonly-authority-snapshot.integration.test.ts",
  "tests/backend/storage/maintenance/fixed-layout.test.ts",
];

const portable = ["a", "b", "c", "d", "e"].map(name => `tests/backend/${name}.integration.test.ts`);
const integration = [...portable, ...NATIVE_FILES, ...SERIAL_FILES].filter(file => file.endsWith(".integration.test.ts"));
const unit = ["tests/models/portable.test.ts", ...NATIVE_FILES.filter(file => file.endsWith(".test.ts") && !file.endsWith(".integration.test.ts"))];
const ubuntuIntegration = [...portable, ...LINUX_NATIVE_FILES.filter(file => file.endsWith(".integration.test.ts"))].sort();
const durations = { [portable[0] ?? ""]: 50, [SERIAL_FILES[0] ?? ""]: 200 };

const run = (listed: readonly string[], project: "unit" | "integration", runner: "ubuntu" | "native" | "serial" | "storage", jobs: number) =>
  Array.from({ length: jobs }, (_, i) => selectCiFiles(listed, project, runner, i + 1, jobs, durations)).flat();

describe("CI file selection", () => {
  it("gives each file to exactly one job", () => {
    expect(run(integration, "integration", "ubuntu", 3).sort()).toEqual(ubuntuIntegration);
    const macos = [...run(integration, "integration", "native", 5), ...run(integration, "integration", "serial", 5), ...run(integration, "integration", "storage", 5)];
    expect(macos.sort()).toEqual(integration.filter(file => !portable.includes(file)).sort());
    const ubuntuUnit = run(unit, "unit", "ubuntu", 2);
    expect(ubuntuUnit.sort()).toEqual(["tests/models/portable.test.ts", ...LINUX_NATIVE_FILES.filter(file => !file.endsWith(".integration.test.ts"))].sort());
    expect(run(unit, "unit", "native", 5).sort()).toEqual(unit.filter(file => NATIVE_FILES.includes(file)).sort());
  });

  it("runs the Linux-passing native files on Ubuntu and keeps serial files off it", () => {
    expect(LINUX_NATIVE_FILES.every(file => NATIVE_FILES.includes(file))).toBe(true);
    expect(LINUX_NATIVE_FILES.some(file => SERIAL_FILES.includes(file) || SERIAL_STORAGE_FILES.includes(file))).toBe(false);
    expect([...LINUX_NATIVE_FILES].sort()).toEqual([...linuxNativeReport].sort());
    expect(run(integration, "integration", "native", 5)).toContain("tests/backend/storage/maintenance/protected-settings-upgrade.integration.test.ts");
  });

  it("routes the Windows picker dialog proof only through native serial jobs", () => {
    const picker = "tests/backend/transports/http/native-path-picker.windows-native.integration.test.ts";
    const listed = [...new Set([...integration, picker])];
    expect(run(listed, "integration", "ubuntu", 3)).not.toContain(picker);
    expect(run(listed, "integration", "serial", 5)).toContain(picker);
    expect(run(listed, "integration", "native", 5)).not.toContain(picker);
  });

  it("keeps serial proofs apart and balances measured time", () => {
    const serialJobs = [1, 2, 3, 4, 5, 6, 7, 8].map(job => selectCiFiles(integration, "integration", "serial", job, 8, durations).length);
    expect(Math.max(...serialJobs)).toBe(1);
    expect(balance(["x", "y", "z", "w"], 2, file => ({ x: 4, y: 3, z: 2, w: 1 })[file]!)).toEqual([["w", "x"], ["y", "z"]]);
  });

  it("refuses a pinned file Vitest no longer lists", () => {
    expect(() => selectCiFiles(portable, "integration", "ubuntu", 1, 1, durations)).toThrow(/does not list/u);
  });

  it("runs upgrade proofs separately from native proofs and parallel storage files", () => {
    expect(SERIAL_STORAGE_FILES).toContain("tests/backend/app/composition/dashboard/compose.startup-upgrade.integration.test.ts");
    expect(SERIAL_STORAGE_FILES.every(file => NATIVE_FILES.includes(file))).toBe(true);
    expect(run(integration, "integration", "storage", 5).sort()).toEqual([...SERIAL_STORAGE_FILES].sort());
    for (const runner of ["native", "serial"] as const) {
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

  it("uses the slower platform timing regardless of report order", () => {
    const macos = { testResults: [{ name: "/repo/tests/x.test.ts", startTime: 0, endTime: 5_000 }] };
    const windows = { testResults: [{ name: "D:\\a\\relay\\tests\\x.test.ts", startTime: 0, endTime: 2_000 }] };
    expect(durationsFromReports([macos, windows])).toEqual({ "tests/x.test.ts": 5 });
    expect(durationsFromReports([windows, macos])).toEqual({ "tests/x.test.ts": 5 });
  });

  it("matches Windows relative listing paths to pinned native membership", () => {
    const listed = integration.map(file => file.replaceAll("/", "\\"));
    expect(run(listed, "integration", "ubuntu", 3).sort()).toEqual(ubuntuIntegration);
    expect([...run(listed, "integration", "native", 5), ...run(listed, "integration", "serial", 5),
      ...run(listed, "integration", "storage", 5)].sort()).toEqual(integration.filter(file => !portable.includes(file)).sort());
  });

  it("refuses corrupt timing reports instead of replacing measured work", () => {
    expect(() => durationsFromReports([{}])).toThrow();
    expect(() => durationsFromReports([{ testResults: [{ name: "/tmp/x.test.ts", startTime: 0, endTime: 1 }] }])).toThrow();
    expect(() => durationsFromReports([{ testResults: [{ name: "/repo/tests/x.test.ts", startTime: 2, endTime: 1 }] }])).toThrow();
  });

  it("gives untimed files work even when the committed timings round to zero", () => {
    const shards = [1, 2, 3].map(job => selectCiFiles(integration, "integration", "ubuntu", job, 3, { [portable[0]]: 0 }));
    expect(shards.every(files => files.length > 0)).toBe(true);
    expect(shards.flat().sort()).toEqual(ubuntuIntegration);
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

const localNativeOptOut = [...new Set([...NATIVE_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])].sort();

describe("local native opt-in", () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

  function loadProjects(native: "0" | "1") {
    const env = { ...process.env };
    if (native === "1") env.RELAY_TEST_NATIVE = "1";
    else delete env.RELAY_TEST_NATIVE;
    return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", `
      const config = await import("./vitest.config.ts");
      const wanted = ${JSON.stringify(localNativeOptOut)};
      const present = (list) => wanted.filter(file => list.includes(file)).sort();
      const unit = present(config.REBUILD_UNIT_TEST_EXCLUDE);
      const integration = present(config.REBUILD_INTEGRATION_TEST_EXCLUDE);
      if (process.env.RELAY_TEST_NATIVE === "1") {
        if (unit.length !== 0 || integration.length !== 0) throw new Error("opt-in still excludes " + unit.concat(integration).join(","));
      } else if (JSON.stringify(unit) !== JSON.stringify(wanted) || JSON.stringify(integration) !== JSON.stringify(wanted)) {
        throw new Error("unset excluded " + unit.length + " and " + integration.length + " of " + wanted.length);
      }
    `], { cwd: repoRoot, env, encoding: "utf8" });
  }

  it("keeps unit and integration off native files until RELAY_TEST_NATIVE=1", () => {
    expect(nativeRunExcludes(undefined)).toEqual(localNativeOptOut);
    expect(nativeRunExcludes("1")).toEqual([]);
    const child = loadProjects("0");
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
  });

  it("collects every listed file when RELAY_TEST_NATIVE=1", () => {
    const child = loadProjects("1");
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
  });

  it("tells a worker to set RELAY_TEST_NATIVE when a skipped file is named", () => {
    const file = "tests/backend/runtime/browser/onboarding-duo-provider.integration.test.ts";
    const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
    expect(namedNativeRefusal(["node", "vitest", file], undefined, repoRoot)).toContain("RELAY_TEST_NATIVE=1");
    expect(namedNativeRefusal(["node", "vitest", file], "1", repoRoot)).toBeUndefined();
    expect(namedNativeRefusal(["node", "vitest", "tests/backend/runtime/"], undefined, repoRoot)).toBeUndefined();
    expect(namedNativeRefusal(["node", "vitest", LINUX_NATIVE_FILES[0] ?? ""], undefined, repoRoot)).toContain("RELAY_TEST_NATIVE=1");
    const env = { ...process.env };
    delete env.RELAY_TEST_NATIVE;
    const child = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", `
      process.argv.push(${JSON.stringify(file)});
      await import("./vitest.config.ts");
    `], { cwd: repoRoot, env, encoding: "utf8" });
    expect(child.status, child.stderr).toBe(1);
    expect(child.stderr).toContain(`Set RELAY_TEST_NATIVE=1 to run native, serial, and serial-storage tests. Not run: ${file}`);
  });

  it("sets RELAY_TEST_NATIVE before CI lists files", () => {
    const script = readFileSync(new URL("../../../scripts/test/ci-run.sh", import.meta.url), "utf8");
    expect(script).toMatch(/^export RELAY_TEST_NATIVE=1$/m);
  });
});
