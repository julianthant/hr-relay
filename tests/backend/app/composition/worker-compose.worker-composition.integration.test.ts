import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { fixtureAdmission,installationAdmission,releaseAdmissionFixture,releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import {
composeWorkerRuntime,
parseWorkerArguments
} from "../../../../src/backend/app/composition/worker-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { type GateSourcePort } from "../../../../src/backend/runtime/gates/gate-source-runtime.js";
import {
observeProcessIdentity,
observeRuntimeLockSnapshot,
} from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import {
SETTINGS_SCHEMA_HASH,
derivePersistedSettingsFingerprint,
deriveSettingsPatchFingerprint,
} from "../../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import type { PositiveInt } from "../../../../src/rules/identity/ids.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import {
SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS,
persistCorruptJournaledSettings,
} from "../../../support/fixtures/integration/settings-runtime-corruption-fixtures.js";
import { WRITE_ATTEMPT,WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { ITEM_ID,RUN_ID,WORKFLOW_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { settingsSetOperations } from "../../../support/fixtures/settings-operation-fixtures.js";
import { AuthorityDatabase,createCredentialStore } from "../../../support/helpers/admission-fixture.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import {
happySessionHarness,
healthyCrmDriver,
personLookupQueuedRun,
sessionFactoryHarness,
type SessionFactoryHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  releaseAdmissionFixtures();
  for (const root of roots.splice(0)) {
    releaseAdmissionFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});

const NOW = "2026-08-03T09:00:00.000Z";
const POOL_INDEX_1 = PositiveIntSchema.parse(1);
const POOL_INDEX_2 = PositiveIntSchema.parse(2);

function repoRootWithState(): { repoRoot: string; stateRoot: string } {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-worker-compose-"));
  roots.push(repoRoot);
  const stateRoot = installationAdmission(repoRoot).stateRoot;
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "worker-composition-fixture", version: "0.1.0", type: "module" }));
  return { repoRoot, stateRoot };
}

/** Open the SAME database path the composition will, seed it, and close. */
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

function admittedWorkerId(stateRoot: string, clock: TestClock, poolIndex = 1) {
  const database = reopen(stateRoot, clock);
  const existing = database.authority.workerSlots.list(WORKFLOW_ID)
    .find(slot => slot.poolIndex === poolIndex && slot.retiredAt === null);
  if (existing !== undefined) return existing.workerId;
  return database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
    expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0,
    processId: process.pid, processAcquisitionId: randomUUID(),
    authorityPath: join(stateRoot, "state.db"),
    processLockRoot: join(stateRoot, "locks"), now: clock.now().toISOString(),
  }, randomUUID())).workerId;
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

function persistUnjournaledWorkerSettings(repoRoot: string, clock: TestClock, patch: unknown) {
  patch = settingsSetOperations(patch);
  const patchFingerprint = deriveSettingsPatchFingerprint(patch);
  const command = {
    commandId: "33333333-3333-4333-8333-333333333333",
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
  };
  void repoRoot; void clock;
  return Object.freeze({ command, settingsFingerprint: derivePersistedSettingsFingerprint({ browser: { headless: false } }) });
}

function persistJournaledWorkerSettings(
  repoRoot: string,
  stateRoot: string,
  clock: TestClock,
  patch: unknown,
): void {
  const persisted = persistUnjournaledWorkerSettings(repoRoot, clock, patch);
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  try {
    journalWorkerSettings(database, persisted, stateRoot);
    const record = readSettings(database.authority);
    const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") });
    database.withAuthorityTransaction((repositories) => {
      const configSnapshotId = "55555555-5555-4555-8555-555555555555";
      repositories.configSnapshots.insert({
        configSnapshotId,
        revision: 1,
        fingerprint: resolved.fingerprint,
        capturedAt: clock.now().toISOString(),
        capturedBy: "local-operator",
        config: resolved.config,
        provenance: resolved.provenance,
      });
      repositories.runtimeConfig.activate({
        settingsRevision: record.revision,
        settingsFingerprint: record.settingsFingerprint,
        configSnapshotId,
        configFingerprint: resolved.fingerprint,
        activatedAt: clock.now().toISOString(),
      });
    });
  } finally {
    database.close();
  }
}

function journalWorkerSettings(
  database: AuthorityDatabase,
  persisted: ReturnType<typeof persistUnjournaledWorkerSettings>,
  stateRoot: string,
): void {
  const clock = manualClock(new Date(NOW));
  if (database.authority.runtimeConfig.get() === undefined) {
    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, {
      stateRoot, artifactRoot: join(stateRoot, "artifacts"),
    });
    database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1,
      fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(),
      capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
  }
  const result = executeSettingsCommand({ authority: database, clock, ids: sequentialIdFactory("4"),
    settings: createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }), createCredentialStore({ stateRoot })) }, persisted.command);
  assert.equal(result.state, "applied");
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

function assertStoppedWorkerProcessRecord(repoRoot: string, clock: TestClock, generation = 3): void {
  const snapshot = observeRuntimeLockSnapshot({
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
    sourceDatabaseIdentity: "a".repeat(64),
  }, clock, {
    // Re-read through the exact identity observer that wrote this fixture
    // record. An unreleased record is therefore active, not a PID-reuse arm.
    observeProcessIdentity: fixtureProcessIdentityObserver,
  });
  assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation });
}

describe("worker CLI argument parsing", () => {
  it("accepts an explicit positive pool index", () => {
    assert.deepEqual(parseWorkerArguments([WORKFLOW_ID, "--pool-index", "2", "--drain"]), {
      workflowId: WORKFLOW_ID,
      poolIndex: POOL_INDEX_2,
      drain: true,
    });
  });

  it("refuses absent, malformed, zero, and duplicate pool-index flags", () => {
    assert.throws(() => parseWorkerArguments([WORKFLOW_ID]), /requires --pool-index/);
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "many"]),
      /must be a positive integer; received many/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "0"]),
      /must be a positive integer; received 0/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--pool-index", "2"]),
      /duplicate worker flag: --pool-index/,
    );
    const oversized = "999999999999999999999999999999";
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", oversized]),
      new RegExp(`--pool-index.*${oversized}`, "u"),
    );
  });

  it("refuses missing values, duplicate drain flags, and unknown flags by name", () => {
    assert.throws(() => parseWorkerArguments([]), /needs a workflow id/);
    assert.throws(() => parseWorkerArguments(["not-registered"]), /is not registered/);
    assert.throws(
      () => parseWorkerArguments(["separations-kuali-finalization", "--pool-index", "1", "--drain"]),
      /is not registered/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "--drain"]),
      /requires a positive integer value/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--drain", "--drain"]),
      /duplicate worker flag: --drain/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--headed"]),
      /unknown worker flag: --headed/,
    );
  });
});

describe("composed worker runtime", () => {
  it("three workers boot, poll and claim without creating file authority", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const reports = await Promise.all([0, 1, 2].map((offset) =>
      composeWorkerRuntime(composeInput({ repoRoot, clock, sessions: happySessionHarness(),
        poolIndex: PositiveIntSchema.parse(offset + 1), processId: 4300 + offset }))));
    assert.equal(reports.flatMap(({ outcomes }) => outcomes).length, 1,
      "one queued run is claimed once while other workers observe idle");
    assert.equal(existsSync(join(stateRoot, "settings")), false, "boot and polling create no file authority or lock");
  });

  it("starts and awaits shutdown of registered gate source ports", async () => {
    const { repoRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    let subscribed = 0;
    let stopped = 0;
    const port: GateSourcePort = {
      kind: "external",
      sourceId: "composition-startup-fixture",
      bindCorrelation: () => "synthetic-correlation",
      subscribe: async (_deliver, _signal) => {
        subscribed += 1;
        return async () => { stopped += 1; };
      },
    };
    const report = await composeWorkerRuntime({
      ...composeInput({ repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1 }),
      gateSourcePorts: [port],
    });
    assert.equal(report.stopped, "idle");
    assert.equal(subscribed, 1, "composeWorkerRuntime must start its registered gate source runtime");
    assert.equal(stopped, 1, "composeWorkerRuntime must await source shutdown before returning");
  });

  it("ignores retired unjournaled file bytes and claims using SQLite settings", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    const directory = join(stateRoot, "settings"); mkdirSync(directory);
    const path = join(directory, "settings.json"); writeFileSync(path, "retired invalid authority");
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.equal(readFileSync(path, "utf8"), "retired invalid authority");
    assertStoppedWorkerProcessRecord(repoRoot, clock);
  });

  it.each(SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS)(
    "refuses valid settings bytes with corrupt $label on worker boot",
    async (corruption) => {
      const { repoRoot, stateRoot } = repoRootWithState();
      const clock = manualClock(new Date(NOW));
      seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
      const sessions = happySessionHarness();
      const input = composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 });
      const fixture = persistCorruptJournaledSettings({
        repoRoot,
        stateRoot,
        clock,
        corruption,
        activateRuntime: true,
        admission: fixtureAdmission(repoRoot),
      });
      const before = readFileSync(join(stateRoot, "state.db"));
      await assert.rejects(
        composeWorkerRuntime(input),
        corruption.id === "command-envelope" ? /command-row-identity-mismatch/u : /command-audit-settlement-mismatch/u,
      );
      const raw = new DatabaseSync(join(stateRoot, "state.db"), { readOnly: true });
      try {
        const row = raw.prepare("SELECT payload_json FROM settings WHERE id='current'").get();
        assert.equal(typeof row?.payload_json, "string");
        assert.deepEqual(AppSettingsSchema.parse(JSON.parse(String(row?.payload_json))).saved, fixture.record);
        assert.equal(raw.prepare("SELECT state FROM runs WHERE id=?").get(RUN_ID)?.state, "queued");
      } finally { raw.close(); }
      assert.deepEqual(readFileSync(join(stateRoot, "state.db")), before);
      assert.equal(sessions.opens("ucpath"), 0);
      assert.equal(sessions.opens("crm"), 0);
      assertStoppedWorkerProcessRecord(repoRoot, clock, 2);
    },
  );

  it("uses persisted settings after restart for the worker session-acquisition bound", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    persistJournaledWorkerSettings(
      repoRoot,
      stateRoot,
      clock,
      { timeouts: { sessionAcquireMs: 1 } },
    );
    seedQueuedRun(
      stateRoot,
      clock,
      personLookupQueuedRun(),
      resolveConfigWithProvenance({ timeouts: { sessionAcquireMs: 1 } }, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }),
    );
    const neverOpeningSessions: SessionFactoryHarness = {
      ...happySessionHarness(),
      factory: {
        open: () => new Promise<never>(() => undefined),
      },
    };
    const stop = new AbortController();
    const stopFallback = setTimeout(() => {
      stop.abort(new Error("persisted worker config was ignored"));
    }, 5_000);

    try {
      const report = await composeWorkerRuntime(composeInput({
        repoRoot,
        clock,
        sessions: neverOpeningSessions,
        poolIndex: POOL_INDEX_1,
        stopSignal: stop.signal,
      }));
      assert.deepEqual(report.outcomes.map(({ state }) => state), ["failed"]);
      const failed = report.outcomes[0];
      assert.ok(failed?.state === "failed");
      const failure = reopen(stateRoot, clock).authority.failures.get(failed.failureId);
      assert.match(failure?.summary ?? "", /exceeded its 1ms timeouts\.sessionAcquireMs bound/u);
    } finally {
      clearTimeout(stopFallback);
    }
  });

  it("executes a retained queued run after settings change", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const original = reopen(stateRoot, clock).authority.runs.get(RUN_ID); assert.ok(original);
    persistJournaledWorkerSettings(
      repoRoot,
      stateRoot,
      clock,
      { browser: { headless: false } },
    );

    const sessions = happySessionHarness();
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(sessions.opens("ucpath") > 0);
    assert.equal(reopen(stateRoot, clock).authority.runs.get(RUN_ID)?.envelope.configFingerprint,
      original.envelope.configFingerprint);
  });

  it("rolls back a nested settings save when ownership fails at claim admission before either browser opens", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    let admissionCrossed = false;
    let admissionSettingsRecord: ReturnType<typeof readSettings> | undefined;
    let admissionDatabase: AuthorityDatabase | undefined;

    const refusal = await composeWorkerRuntime({
        ...composeInput({
          repoRoot,
          clock,
          sessions,
          poolIndex: POOL_INDEX_1,
        }),
        openDatabase: (options, openClock) => {
          const database = AuthorityDatabase.open(options, openClock);
          admissionDatabase = database;
          return database;
        },
        afterClaimAdmissionCheck: () => {
          assert.ok(admissionDatabase !== undefined, "claim admission ran before authority opened");
          const persisted = persistUnjournaledWorkerSettings(
            repoRoot,
            clock,
            { browser: { headless: false } },
          );
          // Nested settings application must roll back with failed claim admission.
          admissionSettingsRecord = readSettings(admissionDatabase.authority);
          journalWorkerSettings(admissionDatabase, persisted, stateRoot);
          admissionCrossed = true;
          throw new Error("synthetic stale owner at claim admission");
        },
      }).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.equal(admissionCrossed, true);
    assert.deepEqual(readSettings(reopen(stateRoot, clock).authority), admissionSettingsRecord);
    const database = reopen(stateRoot, clock);
    assert.equal(sessions.opens("ucpath"), 0);
    assert.equal(sessions.opens("crm"), 0);
    assert.match(
      refusal instanceof Error ? refusal.message : String(refusal),
      /synthetic stale owner at claim admission/u,
    );
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    assert.equal(database.authority.commands.get("33333333-3333-4333-8333-333333333333"), undefined);
    assert.equal(database.authority.settingsCurrent.get(), undefined);
  });

  it("releases its process record when authority open fails without masking that error", async () => {
    const { repoRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    const openFailure = new Error("injected authority open failure");
    await assert.rejects(
      composeWorkerRuntime({
        ...composeInput({
          repoRoot,
          clock,
          sessions: happySessionHarness(),
          poolIndex: POOL_INDEX_1,
          processId: process.pid,
        }),
        openDatabase: () => {
          throw openFailure;
        },
      }),
      (error: unknown) => error === openFailure,
    );
    const snapshot = observeRuntimeLockSnapshot({
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
      sourceDatabaseIdentity: "a".repeat(64),
    }, clock);
    assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
  });

  it("keeps its process record active when database closure cannot be proven", async () => {
    const { repoRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    const closeFailure = new Error("injected database close failure");
    let stillOpen: AuthorityDatabase | undefined;
    await assert.rejects(
      composeWorkerRuntime({
        ...composeInput({
          repoRoot,
          clock,
          sessions: happySessionHarness(),
          poolIndex: POOL_INDEX_1,
          processId: process.pid,
        }),
        closeDatabase: (database) => {
          stillOpen = database;
          throw closeFailure;
        },
      }),
      (error: unknown) => error === closeFailure,
    );
    assert.ok(stillOpen !== undefined);
    assert.doesNotThrow(() => stillOpen?.getMeta(), "the injected close failure left the handle usable");
    const snapshot = observeRuntimeLockSnapshot({
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
      sourceDatabaseIdentity: "a".repeat(64),
    }, clock);
    assert.deepEqual(snapshot.processLocks.workers, {
      state: "active",
      generation: 3,
      pid: process.pid,
    });
    stillOpen.close();
  });

  it("builds the whole dependency graph and drains a queued run to done", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const lines: string[] = [];

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, lines, poolIndex: POOL_INDEX_1,
    }));

    assert.equal(report.workflowId, WORKFLOW_ID);
    assert.equal(report.workerId, admittedWorkerId(stateRoot, clock));
    assert.equal(report.stopped, "idle");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    // The terminal result authority is the composition's, not a fixture's.
    assert.ok(database.authority.runResults.get(RUN_ID));

    // The durable lease: started by this process, settled honestly at exit.
    const lease = database.authority.workerLeases.get(report.workerId);
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
    assert.equal(lease.processId, 4242);
    assert.equal(lease.workflow, WORKFLOW_ID);

    // Composition persists its own cross-process timeline in authority.
    assert.ok(database.authority.timelineEvents.page({ workflow: WORKFLOW_ID }).length > 0);

    // One browser session per system, closed exactly once at worker stop.
    assert.equal(sessions.opens("ucpath"), 1);
    assert.deepEqual(sessions.closeReasons(), ["worker-stop", "worker-stop"]);
  });

  it("composes distinct stable identities for members of one workflow pool", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));

    const first = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    const second = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_2,
    }));

    const expected = [
      admittedWorkerId(stateRoot, clock, POOL_INDEX_1),
      admittedWorkerId(stateRoot, clock, POOL_INDEX_2),
    ];
    const database = reopen(stateRoot, clock);
    assert.deepEqual({
      reports: [first.workerId, second.workerId],
      authorityLeases: expected.map((workerId) => database.authority.workerLeases.get(workerId)?.workerId),
    }, {
      reports: expected,
      authorityLeases: expected,
    });
  });

  it("refuses a second process answering to the same worker id", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock, POOL_INDEX_1);
    const database = reopen(stateRoot, clock);
    assert.equal(database.authority.workerLeases.start({
      workerId,
      workflow: WORKFLOW_ID,
      browserSystems: ["crm", "ucpath"],
      processId: 999,
      requestedBy: "local-operator",
      now: NOW,
    }).state, "started");

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
      })),
      /a second process may not answer to the same worker id/,
    );
  });

  it("reclaims a lease whose process died without settling, instead of bricking the workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const seed = reopen(stateRoot, clock);

    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 999,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    }).state, "applied");
    clock.advanceWall(120_000);
    clock.advanceMonotonic(120_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
    assert.ok(lines.some((line) => line.includes("stale worker lease reclaimed before start")));
  });


  it("sweeps its own orphaned claim at startup and then claims it, same workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.equal(claimed.state, "claimed", "the crashed process must actually own the row");
    // The clock barely moves: the heartbeat this row carries is FRESH, which is
    // precisely why the staleness-gated boot sweep skips it.
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(
      lines.some((line) => line.includes("orphaned claim released before the first poll")),
      "the startup self-sweep did not report releasing the row",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    assert.equal(run.envelope.attempt, 1, "recovery preserves the immutable item attempt");
  });


  for (const recovery of ["startup", "global"] as const) it(`${recovery} recovery publishes cancellation once without claiming or opening browsers`, async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = recovery === "startup" ? admittedWorkerId(stateRoot, clock) : "orphan-other-worker";
    const database = reopen(stateRoot, clock);
    const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const service = testRunService(database, clock);
    assert.equal(service.transition({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: RUN_ID, expectedVersion: claimed.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }).state, "applied");
    if (recovery === "global") clock.advanceWall(600_000);
    const sessions = happySessionHarness();
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes, []);
    assert.equal(sessions.opens("ucpath"), 0);
    assert.equal(sessions.opens("crm"), 0);
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled);
    assert.deepEqual(settled.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() });
    assert.equal(settled.envelope.attempt, claimed.run.envelope.attempt);
    assert.equal(settled.claimGeneration, claimed.run.claimGeneration);
    // A fresh process repeating startup/global maintenance must not duplicate the terminal event.
    await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    const terminal = database.authority.timelineEvents.page({ runId: RUN_ID })
      .flatMap((record) => record.payload.kind === "span" ? [record.payload.event] : [])
      .flatMap((event) => event.t === "span.ended" && event.kind === "run" && event.runId === RUN_ID ? [event] : []);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0]?.outcome, "cancelled");
    assert.equal(terminal[0]?.attempt, claimed.run.envelope.attempt);
    assert.equal(terminal[0]?.traceId, claimed.run.envelope.traceId);
  });

  it("parks — never requeues — its own orphaned claim that holds an attempting write intent", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const validating = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    });
    assert.ok(validating.state === "applied");
    const running = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "searching" },
      now: NOW,
    });
    assert.ok(running.state === "applied");
    crashed.authority.writeIntents.fenceAttempt({
      intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: WORKFLOW_ID, itemId: ITEM_ID },
      attempt: WRITE_ATTEMPT,
    });
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));

    assert.deepEqual(report.outcomes, []);
    assert.equal(report.stopped, "idle");
    assert.ok(
      lines.some((line) => line.includes("orphaned claim routed to ref write-safety recovery")),
      "the startup self-sweep did not report the recovery routing",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "parked-write");
    assert.equal(run.lifecycle.writeIntentId, WRITE_INTENT_ATTEMPTING.writeIntentId);
    assert.equal(run.envelope.attempt, 1, "a parked write must never take a new attempt");
  });

  it("stops gracefully mid-run: the run is abandoned, never terminalized over a lost claim", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    let started: (() => void) | undefined;
    const driverStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          started?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const stop = new AbortController();

    const running = composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, stopSignal: stop.signal, poolIndex: POOL_INDEX_1,
    }));
    await Promise.race([driverStarted, running.then(() => { throw new Error("worker settled before driver start"); })]);
    stop.abort(new Error("operator pressed Ctrl-C"));
    const report = await running;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["abandoned"]);

    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state !== "terminal");
    const lease = database.authority.workerLeases.get(admittedWorkerId(stateRoot, clock));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
  });

  it("fails loud when worker-stop cannot prove closure, and records the lease as crashed", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const unprovable: SessionFactoryHarness = {
      ...sessions,
      factory: {
        open: async (input) => {
          const resource = await sessions.factory.open(input);
          return {
            ...resource,
            // An unproven close retains the registered resource and reports uncertainty.
            close: () => Promise.reject(new Error(
              `${resource.system} context did not close within its bounded deadline`,
            )),
          };
        },
      },
    };

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: unprovable, poolIndex: POOL_INDEX_1,
      })),
      (error: unknown) => error instanceof AggregateError
        && error.errors.some((failure: unknown) => failure instanceof Error
          && /did not close within its bounded deadline/.test(failure.message)),
    );

    const database = reopen(stateRoot, clock);
    const lease = database.authority.workerLeases.get(admittedWorkerId(stateRoot, clock));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    // An unprovable teardown is a crash, never a clean shutdown.
    assert.equal(lease.lifecycle.reason, "crashed");
  });

  it("starts a NEW lease generation over a settled one and drains normally", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const seed = reopen(stateRoot, clock);
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 7,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "operator" },
      now: NOW,
    }).state, "applied");

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
  });
});

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

function _envelope(commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}
