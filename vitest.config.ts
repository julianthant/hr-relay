import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { availableParallelism } from "node:os";

export const REBUILD_COVERAGE_INCLUDE = ["src/**/*.ts", "src/**/*.tsx"] as const;
export const REBUILD_UNIT_TEST_INCLUDE = ["tests/**/*.test.ts"] as const;
export const REBUILD_UNIT_TEST_EXCLUDE = [
  "tests/**/*.integration.test.ts",
  "tests/architecture/**",
  "tests/parity/**",
  "tests/perf/**",
] as const;
export const REBUILD_INTEGRATION_TEST_INCLUDE = ["tests/**/*.integration.test.ts"] as const;
export const REBUILD_INTEGRATION_TEST_EXCLUDE = ["tests/perf/**"] as const;
export const REBUILD_ARCHITECTURE_TEST_INCLUDE = [
  "tests/architecture/**/*.test.ts",
] as const;
export const REBUILD_ARCHITECTURE_TEST_EXCLUDE = [] as const;
export const REBUILD_PERF_TEST_INCLUDE = ["tests/perf/**/*.test.ts"] as const;
export const REBUILD_PERF_TEST_EXCLUDE = [] as const;
export const REBUILD_TEST_PROJECTS = [
  { name: "unit", include: REBUILD_UNIT_TEST_INCLUDE, exclude: REBUILD_UNIT_TEST_EXCLUDE },
  { name: "integration", include: REBUILD_INTEGRATION_TEST_INCLUDE, exclude: REBUILD_INTEGRATION_TEST_EXCLUDE },
  {
    name: "architecture",
    include: REBUILD_ARCHITECTURE_TEST_INCLUDE,
    exclude: REBUILD_ARCHITECTURE_TEST_EXCLUDE,
  },
  { name: "perf", include: REBUILD_PERF_TEST_INCLUDE, exclude: REBUILD_PERF_TEST_EXCLUDE },
] as const;
export const REBUILD_TEST_EXEC_ARGV = ["--no-experimental-webstorage"] as const;
export const REBUILD_TEST_REPORTERS = ["verbose"] as const;
export const REBUILD_COVERAGE_EXCLUSIONS = [
  {
    pattern: "src/generated/**/*.ts",
    activation: { ownerRoot: "src/generated", status: "planned" },
    reason: "Generated projections are verified by determinism guards.",
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
    // Node's process-global experimental localStorage is neither browser state
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
        "src/backend/logs/generated-artifact-projection.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/logs/observed-data.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/logs/span-emitter.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/commands/command-application.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/commands/command-kernel.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/commands/command-refusal.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/provenance/evidence-receipt.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/failure-resolution.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/processing/providers/provider-client.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/run-claim-admission.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/run-fan-out.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/run-record-service.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/run-result.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/settings/run-settings.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/projections/run-summary.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/provenance/task-provenance.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/archive/archive-runtime-version-changes.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/archive-terminal-runs.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/archive/archive-version-changes.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/storage/sqlite/run-lifecycle-storage.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/storage/maintenance/storage-relocation-plans.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/lifecycle/terminal-authorization.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runs/provenance/test-data-usage.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/app/composition/runtime-composition.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/checkpoints/checkpoint-patch.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/scheduling/deadline-scheduler.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/gates/duo-ceremony-gate.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/gates/gate-source-runtime.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/writes/operation-action-binding.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/writes/receipt-derivation-binding.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/gates/repeat-proof.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/checkpoints/run-checkpoint-reader.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/execution/run-executor.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/policies/durable-intent.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/policies/idle-claim.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/policies/task-retry.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/execution/run-failure.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/workers/worker-loop.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/workers/worker-sessions.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/writes/write-recovery.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/writes/write-resolution-binding.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/writes/write-sequencer.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/workflow-kit/mutation-capability.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*write-sequencer*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/runtime/**/write-sequencer.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/backend/storage/sqlite/authority-database.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*recovery*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
        "src/**/*projection*.ts": REBUILD_COVERAGE_FLOORS.safetyCritical,
      },
    },
  },
});
