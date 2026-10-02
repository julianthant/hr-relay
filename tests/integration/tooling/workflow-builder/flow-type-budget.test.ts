import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { describe, it } from "vitest";

/**
 * Doc 01 §"Item 1e begins with a new real-scale type-inference proof":
 * the real suite records `tsc --extendedDiagnostics` and FAILS if the
 * representative graph file exceeds 5 seconds or 1 GiB on the same baseline
 * machine. A regression outside that budget stops builder work for type-shape
 * simplification rather than being normalized as editor lag.
 *
 * The budget is measured over a project containing only the representative file
 * and its transitive imports, so an unrelated growth elsewhere in `src/` cannot
 * silently consume the allowance.
 */
const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const REPRESENTATIVE_FILE = "tests/types/flow-graph.typecheck.ts";
const MAX_CHECK_SECONDS = 5;
const MAX_MEMORY_BYTES = 1024 * 1024 * 1024;

interface ExtendedDiagnostics {
  readonly checkTimeSeconds: number;
  readonly totalTimeSeconds: number;
  readonly memoryUsedBytes: number;
}

/**
 * `--extendedDiagnostics` prints `Name: value` lines such as
 * `Check time:     0.71s` and `Memory used:  212345K`.
 */
function parseExtendedDiagnostics(stdout: string): ExtendedDiagnostics {
  const readSeconds = (label: string): number => {
    const match = new RegExp(`^${label}:\\s+([0-9.]+)s$`, "mu").exec(stdout);
    if (match?.[1] === undefined) throw new Error(`tsc --extendedDiagnostics did not report "${label}"`);
    return Number(match[1]);
  };
  const memoryMatch = /^Memory used:\s+(\d+)K$/mu.exec(stdout);
  if (memoryMatch?.[1] === undefined) {
    throw new Error("tsc --extendedDiagnostics did not report \"Memory used\"");
  }
  return {
    checkTimeSeconds: readSeconds("Check time"),
    totalTimeSeconds: readSeconds("Total time"),
    memoryUsedBytes: Number(memoryMatch[1]) * 1024,
  };
}

async function measureRepresentativeGraph(): Promise<ExtendedDiagnostics> {
  const directory = await mkdtemp(join(tmpdir(), "flow-type-budget-"));
  try {
    const configPath = join(directory, "tsconfig.budget.json");
    await writeFile(configPath, JSON.stringify({
      extends: resolve(REPO_ROOT, "tsconfig.json"),
      compilerOptions: {
        rootDir: REPO_ROOT,
        incremental: false,
        // `typeRoots` resolves relative to the config file, which lives outside
        // the repo; without this the `node` type entry point cannot be found and
        // tsc bails before it ever reports a check time.
        typeRoots: [resolve(REPO_ROOT, "node_modules/@types")],
      },
      include: [resolve(REPO_ROOT, REPRESENTATIVE_FILE)],
    }), "utf8");
    const { stdout } = await run(
      resolve(REPO_ROOT, "node_modules/.bin/tsc"),
      ["--noEmit", "--extendedDiagnostics", "--project", configPath],
      { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 },
    );
    return parseExtendedDiagnostics(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("workflow builder type budget", () => {
  it("compiles the representative 21-node graph inside the 5s / 1GiB budget", async () => {
    const diagnostics = await measureRepresentativeGraph();
    // Reported so a run that passes near the ceiling is still visible in CI output.
    process.stdout.write(
      `flow type budget: check ${diagnostics.checkTimeSeconds.toFixed(2)}s, `
      + `total ${diagnostics.totalTimeSeconds.toFixed(2)}s, `
      + `memory ${(diagnostics.memoryUsedBytes / (1024 * 1024)).toFixed(0)}MiB\n`,
    );
    assert.ok(
      diagnostics.checkTimeSeconds <= MAX_CHECK_SECONDS,
      `check time ${diagnostics.checkTimeSeconds}s exceeds the ${MAX_CHECK_SECONDS}s budget — `
      + "simplify the builder's type shapes rather than raising the ceiling",
    );
    assert.ok(
      diagnostics.memoryUsedBytes <= MAX_MEMORY_BYTES,
      `memory ${diagnostics.memoryUsedBytes} bytes exceeds the 1GiB budget — `
      + "simplify the builder's type shapes rather than raising the ceiling",
    );
  }, 120_000);
});
