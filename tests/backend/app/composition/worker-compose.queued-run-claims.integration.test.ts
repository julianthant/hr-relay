import { createWorkerCompositionTestWorld } from "../../../support/helpers/backend/worker-composition-world.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { fixtureAdmission, releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { composeWorkerRuntime, parseWorkerArguments } from "../../../../src/backend/app/composition/worker-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { type GateSourcePort } from "../../../../src/backend/runtime/gates/gate-source-runtime.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS, persistCorruptJournaledSettings } from "../../../support/fixtures/integration/settings-runtime-corruption-fixtures.js";
import { RUN_ID, WORKFLOW_ID, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { settingsSetOperations } from "../../../support/fixtures/settings-operation-fixtures.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/admission-fixture.js";
import { happySessionHarness, personLookupQueuedRun, type SessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, fixtureProcessIdentityObserver, composeInput, cleanup } = createWorkerCompositionTestWorld(() => releaseAdmissionFixtures(), (root) => releaseAdmissionFixture(root));


afterEach(cleanup);
const POOL_INDEX_2 = PositiveIntSchema.parse(2);

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

  it("keeps a worker live and idle after completion and reuses its exact lifetime for another queued item", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    persistJournaledWorkerSettings(repoRoot, stateRoot, clock, { daemon: { idleRepollMs: 10 } });
    const database = reopen(stateRoot, clock);
    const stop = new AbortController();
    const secondId = randomUUID();
    let firstIdle: (() => void) | undefined;
    let secondIdle: (() => void) | undefined;
    let failFirst: ((error: unknown) => void) | undefined;
    let failSecond: ((error: unknown) => void) | undefined;
    const idleAfterFirst = new Promise<void>((resolve, reject) => { firstIdle = resolve; failFirst = reject; });
    const idleAfterSecond = new Promise<void>((resolve, reject) => { secondIdle = resolve; failSecond = reject; });
    const running = composeWorkerRuntime({
      ...composeInput({ repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
        args: [WORKFLOW_ID, "--pool-index", "1"], stopSignal: stop.signal }),
      heartbeatIntervalMs: 10,
      afterClaimAdmissionCheck: () => {
        const lease = database.authority.workerLeases.listLive(WORKFLOW_ID)[0];
        if (lease?.lifecycle.state !== "idle") return;
        if (database.authority.runs.get(RUN_ID)?.lifecycle.state === "terminal") firstIdle?.();
        if (database.authority.runs.get(secondId)?.lifecycle.state === "terminal") secondIdle?.();
      },
    });
    void running.catch(error => { failFirst?.(error); failSecond?.(error); });
    try {
      await idleAfterFirst;
      const member = database.authority.workerSlots.list(WORKFLOW_ID)[0]; assert.ok(member);
      const pool = database.authority.workerPools.get(WORKFLOW_ID); assert.ok(pool);
      const lease = database.authority.workerLeases.get(member.workerId); assert.ok(lease);
      const first = database.authority.runs.get(RUN_ID); assert.ok(first?.lifecycle.state === "terminal");
      assert.equal(first.lifecycle.outcome, "done"); assert.equal(member.retiredAt, null);
      assert.equal(lease.lifecycle.state, "idle"); assert.equal(lease.control.directive, "run");
      seedQueuedRun(stateRoot, clock, personLookupQueuedRun({ runId: secondId, itemId: randomUUID() }));
      await idleAfterSecond;
      const second = database.authority.runs.get(secondId); assert.ok(second?.lifecycle.state === "terminal");
      assert.equal(second.lifecycle.outcome, "done");
      assert.deepEqual(database.authority.workerPools.get(WORKFLOW_ID), pool);
      assert.deepEqual(database.authority.workerSlots.get(member.workerId), member);
      const reused = database.authority.workerLeases.get(member.workerId); assert.ok(reused);
      assert.equal(reused.leaseGeneration, lease.leaseGeneration); assert.equal(reused.processId, lease.processId);
      assert.equal(reused.lifecycle.state, "idle"); assert.equal(reused.control.directive, "run");
    } finally { stop.abort(); await running; }
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
});
