import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const file = resolve("tests/architecture/example.test.ts");
const valid = [{ file, projectName: "architecture" }];

function select(project: string, runner: string, slice: string, rows: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "relay-ci-files-"));
  try {
    const listing = join(directory, "files.json");
    writeFileSync(listing, JSON.stringify(rows));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/test/ci-files.ts",
      "select", project, runner, listing, slice], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it("rejects an out-of-range or malformed shard selection", () => {
  for (const slice of ["2/1", "0/1", "1/0", "1/2/3", "1.0/2"]) {
    const result = select("architecture", "ubuntu", slice, valid);
    expect(result.status, slice).toBe(1);
    expect(result.stderr, slice).toMatch(/slice/i);
    expect(result.stdout).toBe("");
  }
});

it("rejects unknown projects and runners", () => {
  for (const [project, runner] of [["unknown", "ubuntu"], ["architecture", "unknown"]]) {
    const result = select(project, runner, "1/1", valid);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  }
});

it("rejects malformed Vitest rows without emitting a partial selection", () => {
  for (const row of [{ file: "" }, { file: 1 }, { file, projectName: 1 }, { file, typo: "architecture" }]) {
    const result = select("architecture", "ubuntu", "1/1", [...valid, row]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/listing/i);
    expect(result.stdout).toBe("");
  }
});

it("prints NUL-delimited files from a valid listing", () => {
  const result = select("architecture", "ubuntu", "1/1", valid);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("tests/architecture/example.test.ts\0");
});
