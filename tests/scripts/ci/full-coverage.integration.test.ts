import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCiPlan } from "../../../scripts/test/ci-plan.js";

const file = "src/backend/runs/commands/command-refusal.ts";
const shards = [1, 2].map(shard => ({ suite: "unit", shard, shards: 2 }));
const plan = {
  ...createCiPlan({ workflow: "full", event: "schedule", base: "", head: "development", draft: false, filters: {} }),
  ubuntu: { include: shards },
  macos: { include: [] },
  testJobs: shards.length,
};

function location(line: number) {
  return { start: { line, column: 0 }, end: { line, column: null } };
}

it.each([
  { secondHit: 1, branchHits: [[2, -2], [0, 1]], status: 0, lines: 100, branches: 100 },
  { secondHit: 0, branchHits: [[1, -1], [0, 0]], status: 1, lines: 50, branches: 50 },
])("merges V8 reports with a negative unmapped branch arm and exits $status at $lines% line coverage", ({ secondHit, branchHits, status, lines, branches }) => {
  const directory = mkdtempSync(join(tmpdir(), "relay-full-coverage-"));
  try {
    const artifacts = join(directory, "artifacts");
    for (const { shard } of shards) {
      const artifact = join(artifacts, `coverage-ubuntu-unit-${shard}`);
      const shardRoot = join(directory, `shard-${shard}`);
      const path = join(shardRoot, file);
      mkdirSync(join(artifact, "ubuntu"), { recursive: true });
      writeFileSync(join(artifact, "root"), `${shardRoot}\n`);
      writeFileSync(join(artifact, "ubuntu", "coverage-final.json"), JSON.stringify({
        [path]: {
          path,
          statementMap: { 0: location(1), 1: location(2) },
          fnMap: { 0: { name: "refuse", decl: location(1), loc: location(1), line: 1 } },
          branchMap: {
            0: { loc: location(1), type: "if", locations: [location(1), { start: {}, end: {} }], line: 1 },
          },
          s: { 0: shard === 1 ? 1 : 0, 1: shard === 2 ? secondHit : 0 },
          f: { 0: 1 },
          b: { 0: branchHits[shard - 1] },
        },
      }));
    }
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/ci/full-coverage.ts",
      artifacts, JSON.stringify(plan)], { encoding: "utf8", timeout: 25_000 });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
    expect(result.stdout).toContain("Full coverage for 1 files");
    expect(result.stdout).toContain(`Safety-critical ${file}: lines ${lines}%, statements ${lines}%, functions 100%, branches ${branches}%`);
    if (status === 1) {
      expect(result.stderr).toContain(`Coverage for lines (50%) does not meet "${file}" threshold (80%)`);
    } else {
      expect(result.stderr).toBe("");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
