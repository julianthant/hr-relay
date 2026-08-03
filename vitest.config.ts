import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export const REBUILD_COVERAGE_INCLUDE = ["src/**/*.ts", "src/**/*.tsx"] as const;
export const REBUILD_COVERAGE_EXCLUSIONS = [
  {
    pattern: "src/generated/**/*.ts",
    activation: { ownerRoot: "src/generated", status: "planned" },
    reason: "Generated projections are verified by determinism guards.",
  },
  // The 1g transport client made src/dashboard exist as pure .ts; the .tsx
  // presentation subtrees (doc 13 §2) stay planned per-directory and flip
  // as the 1i shell lands each one. Extracted .ts logic remains measured.
  {
    pattern: "src/dashboard/app/**/*.tsx",
    activation: { ownerRoot: "src/dashboard/app", status: "planned" },
    reason: "Presentation components use the headless Playwright lane; extracted .ts logic remains measured.",
  },
  {
    pattern: "src/dashboard/surfaces/**/*.tsx",
    activation: { ownerRoot: "src/dashboard/surfaces", status: "planned" },
    reason: "Presentation components use the headless Playwright lane; extracted .ts logic remains measured.",
  },
  {
    pattern: "src/dashboard/ds/**/*.tsx",
    activation: { ownerRoot: "src/dashboard/ds", status: "planned" },
    reason: "Presentation components use the headless Playwright lane; extracted .ts logic remains measured.",
  },
] as const;

export const REBUILD_COVERAGE_FLOORS = {
  global: { lines: 60, statements: 60, functions: 60 },
  safetyCritical: { lines: 80, statements: 80, functions: 80 },
  branches: { phase1ReportOnly: true, phase2Global: 50, phase2SafetyCritical: 70 },
} as const;

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/dashboard"),
    },
  },
  test: {
    // Each test file runs in its own isolated fork, so process.env mutations
    // and module-level caches are per-file no matter the scheduling.
    pool: "forks",
    isolate: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          fileParallelism: true,
        },
      },
      {
        extends: true,
        test: {
          name: "scenario",
          include: ["tests/scenario/**/*.test.ts"],
          fileParallelism: true,
        },
      },
    ],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [...REBUILD_COVERAGE_INCLUDE],
      exclude: REBUILD_COVERAGE_EXCLUSIONS.map(({ pattern }) => pattern),
      thresholds: {
        lines: REBUILD_COVERAGE_FLOORS.global.lines,
        statements: REBUILD_COVERAGE_FLOORS.global.statements,
        functions: REBUILD_COVERAGE_FLOORS.global.functions,
        "src/core/**": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/stores/common/mutation*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*write-sequencer*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*subject-binding*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*authority-store*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*recovery*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*projection*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
      },
    },
  },
});
