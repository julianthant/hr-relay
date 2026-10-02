import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { availableParallelism } from "node:os";

export const REBUILD_COVERAGE_INCLUDE = ["src/**/*.ts", "src/**/*.tsx"] as const;
export const REBUILD_UNIT_TEST_INCLUDE = ["tests/unit/**/*.test.ts"] as const;
export const REBUILD_UNIT_TEST_EXCLUDE = [] as const;
export const REBUILD_INTEGRATION_TEST_INCLUDE = ["tests/integration/**/*.test.ts"] as const;
export const REBUILD_INTEGRATION_TEST_EXCLUDE = [] as const;
export const REBUILD_ARCHITECTURE_TEST_INCLUDE = [
  "tests/architecture/**/*.test.ts",
] as const;
export const REBUILD_ARCHITECTURE_TEST_EXCLUDE = [] as const;
export const REBUILD_SCENARIO_TEST_INCLUDE = ["tests/scenario/**/*.test.ts"] as const;
export const REBUILD_SCENARIO_TEST_EXCLUDE = ["tests/scenario/combined/**"] as const;
export const REBUILD_TEST_PROJECTS = [
  { name: "unit", include: REBUILD_UNIT_TEST_INCLUDE, exclude: REBUILD_UNIT_TEST_EXCLUDE },
  { name: "integration", include: REBUILD_INTEGRATION_TEST_INCLUDE, exclude: REBUILD_INTEGRATION_TEST_EXCLUDE },
  {
    name: "architecture",
    include: REBUILD_ARCHITECTURE_TEST_INCLUDE,
    exclude: REBUILD_ARCHITECTURE_TEST_EXCLUDE,
  },
  { name: "scenario", include: REBUILD_SCENARIO_TEST_INCLUDE, exclude: REBUILD_SCENARIO_TEST_EXCLUDE },
] as const;
export const REBUILD_TEST_EXEC_ARGV = ["--no-experimental-webstorage"] as const;
export const REBUILD_TEST_REPORTERS = ["verbose"] as const;
export const REBUILD_COVERAGE_EXCLUSIONS = [
  {
    pattern: "src/generated/**/*.ts",
    activation: { ownerRoot: "src/generated", status: "planned" },
    reason: "Generated projections are verified by determinism guards.",
  },
  // The .tsx presentation subtrees (ref frontend-backend-integration §2) landed with the 1i shell;
  // their rendered behavior is proven by the headless Playwright parity lane
  // (tests/parity), not v8 line counting. Extracted .ts logic stays measured.
  {
    pattern: "src/dashboard/app/**/*.tsx",
    activation: { ownerRoot: "src/dashboard/app", status: "active" },
    reason: "Presentation components use the headless Playwright lane; extracted .ts logic remains measured.",
  },
  {
    pattern: "src/dashboard/surfaces/**/*.tsx",
    activation: { ownerRoot: "src/dashboard/surfaces", status: "active" },
    reason: "Presentation components use the headless Playwright lane; extracted .ts logic remains measured.",
  },
  {
    pattern: "src/dashboard/ds/**/*.tsx",
    activation: { ownerRoot: "src/dashboard/ds", status: "active" },
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
    // Every named project, including architecture, must fail if its include or
    // exclude leaves it empty; an empty lane proves no invariant.
    passWithNoTests: false,
    // One human stream for every Vitest entry point: project, file, suite and
    // full behavior/refusal title. Commands do not layer a second reporter on
    // top, and focused callers may still deliberately override it.
    reporters: [...REBUILD_TEST_REPORTERS],
    // Node's process-global experimental localStorage is neither browser parity
    // nor isolated test state. Disable it in workers instead of suppressing its
    // warning; browser tests exercise real window.localStorage in Playwright.
    execArgv: [...REBUILD_TEST_EXEC_ARGV],
    // Each test file runs in its own isolated fork, so process.env mutations
    // and module-level caches are per-file no matter the scheduling.
    pool: "forks",
    isolate: true,
    // Full coverage at the CPU-derived default starves the fixture/guard
    // checks on shared machines. Bound file concurrency, not their deadlines.
    maxWorkers: Math.min(4, availableParallelism()),
    projects: REBUILD_TEST_PROJECTS.map(({ name, include, exclude }) => ({
      extends: true,
      test: {
        name,
        include: [...include],
        exclude: [...exclude],
        fileParallelism: true,
      },
    })),
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
        "src/backend/runs/command-application.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/command-kernel.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/command-refusal.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/dry-run-scenario-runner.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/evidence-receipt.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/failure-resolution.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/provider-admission.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/run-claim-admission.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/run-fan-out.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/run-record-service.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/run-result.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/run-settings.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/run-summary.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/task-provenance.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/archive/archive-runtime-version-changes.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/archive/archive-terminal-runs.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/archive/archive-version-changes.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/storage/run-lifecycle-storage.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/storage/storage-relocation-plans.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/terminal-authorization.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/test-data-usage.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/app/runtime-composition.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/checkpoint-patch.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/deadline-scheduler.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/duo-ceremony-gate.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/gate-source-runtime.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/operation-action-binding.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/receipt-derivation-binding.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/repeat-proof.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/run-checkpoint-reader.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/run-executor.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/policies/durable-intent.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/policies/idle-claim.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/policies/task-retry.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/run-failure.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/worker-loop.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/worker-sessions.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/write-recovery.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/write-resolution-binding.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/write-sequencer.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
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
