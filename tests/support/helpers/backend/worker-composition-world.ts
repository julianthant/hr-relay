import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { type PositiveInt, PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { healthyRuntimePreflightRunners } from "../../fixtures/preflight-seams.js";
import { fixtureAdmission, installationAdmission, AuthorityDatabase } from "../admission-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { type TestClock } from "../../../../src/rules/time/clock.js";
import { WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../duo-ceremony-fixtures.js";
import { type SessionFactoryHarness } from "../phase1f-executor-harness.js";



export function createWorkerCompositionTestWorld() {
  const roots: string[] = [];

  const openDatabases: AuthorityDatabase[] = [];

  const NOW = "2026-08-03T09:00:00.000Z";

  const POOL_INDEX_1 = PositiveIntSchema.parse(1);

  function repoRootWithState(): { repoRoot: string; stateRoot: string } {
    const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-worker-compose-"));
    roots.push(repoRoot);
    const stateRoot = installationAdmission(repoRoot).stateRoot;
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "worker-composition-fixture", version: "0.1.0", type: "module" }));
    return { repoRoot, stateRoot };
  }

  function seedQueuedRun(
    stateRoot: string,
    clock: TestClock,
    run: Record<string, unknown>,
    resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }),
  ): void {
    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    try {
      const parsedRun = RunRecordSchema.parse(run);
      const configSnapshotId = parsedRun.envelope.configSnapshotId;
      database.withAuthorityTransaction((repositories) => {
        const snapshot = {
          configSnapshotId,
          revision: 1,
          fingerprint: resolved.fingerprint,
          capturedAt: clock.now().toISOString(),
          capturedBy: "local-operator",
          config: resolved.config,
          provenance: resolved.provenance,
        };
        if (repositories.runtimeConfig.get() === undefined) {
          repositories.runtimeConfig.initialize(snapshot);
        } else if (repositories.configSnapshots.get(configSnapshotId) === undefined) repositories.configSnapshots.insert(snapshot);
        assert.equal(repositories.runs.enqueue({
          ...parsedRun,
          envelope: { ...parsedRun.envelope, configFingerprint: resolved.fingerprint },
        }).state, "inserted");
      });
    } finally {
      database.close();
    }
  }

  function reopen(stateRoot: string, clock: TestClock): AuthorityDatabase {
    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    openDatabases.push(database);
    return database;
  }

  function ensureBaselineRuntimeConfig(repoRoot: string, clock: TestClock): void {
    const database = AuthorityDatabase.open(
      {
        path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
        busyTimeoutMs: 250,
        migrationOwner: "unit-test",
      },
      clock,
    );
    try {
      database.withAuthorityTransaction((repositories) => {
        if (repositories.runtimeConfig.get() !== undefined) return;
        const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, { stateRoot: join(repoRoot, rebuildRuntimeIsolation.stateRoot), artifactRoot: join(repoRoot, rebuildRuntimeIsolation.artifactRoot) });
        const configSnapshotId = "66666666-6666-4666-8666-666666666666";
        repositories.runtimeConfig.initialize({
          configSnapshotId,
          revision: 1,
          fingerprint: resolved.fingerprint,
          capturedAt: clock.now().toISOString(),
          capturedBy: "local-operator",
          config: resolved.config,
          provenance: resolved.provenance,
        });
      });
    } finally {
      database.close();
    }
  }

  function fixtureProcessIdentityObserver(pid: number) {
    return pid === process.pid
      ? observeProcessIdentity(pid)
      : {
          state: "alive" as const,
          identity: { platform: "darwin" as const, startToken: `synthetic-${String(pid)}` },
        };
  }

  function composeInput(options: Readonly<{
    repoRoot: string;
    clock: TestClock;
    sessions: SessionFactoryHarness;
    poolIndex: PositiveInt;
    processId?: number;
    args?: readonly string[];
    stopSignal?: AbortSignal;
    lines?: string[];
  }>) {
    ensureBaselineRuntimeConfig(options.repoRoot, options.clock);
    return {
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      isolation: rebuildRuntimeIsolation,
      args: options.args ?? [WORKFLOW_ID, "--pool-index", String(options.poolIndex), "--drain"],
      env: {},
      clock: options.clock,
      ids: { uuid: randomUUID },
      admission: fixtureAdmission(options.repoRoot),
      repoRoot: options.repoRoot,
      processId: options.processId ?? 4242,
      processIdentityObserver: fixtureProcessIdentityObserver,
      sessionFactory: options.sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(options.clock),
      stopSignal: options.stopSignal ?? new AbortController().signal,
      // Long enough that no scheduled beat fires during a test; the boot beat is
      // synchronous, so the lease/sweep path is still exercised.
      heartbeatIntervalMs: 600_000,
      sweepIntervalMs: 600_000,
      write: (line: string): void => {
        options.lines?.push(line);
      },
    } as const;
  }
  return { roots, openDatabases, NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, ensureBaselineRuntimeConfig, composeInput, fixtureProcessIdentityObserver };
}
