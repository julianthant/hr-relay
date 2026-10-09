import { databaseStateTable } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { storageTree } from "../../../../../support/helpers/integration/storage-recovery-fixture.js";
import { restoreHistoricalStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { executeSequencedWriteCommit } from "../../../../../../src/backend/runtime/writes/write-sequencer.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../../../../src/models/dashboard/storage.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../../../support/helpers/timeline-write-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { runQueuedSpanEvent } from "../../../../../../src/backend/runs/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID, WorkerIdSchema, PositiveIntSchema } from "../../../../../../src/rules/identity/ids.js";
import { RunRecordService, workerRunLifecyclePort, sweepWorkerClaims } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { randomUUID } from "node:crypto";
import { upgradeStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { localDatePart, manualClock } from "../../../../../../src/rules/time/clock.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
} from "../../../../../../src/models/config/protected-settings.js";
import { createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import {
  inspectAuthorityBackupReadOnly,
  openAuthorityBackupSourceReadOnly,
} from "../../../../../support/helpers/synthetic-storage-admission.js";
import {
  AuthorityBackupService,
  AuthorityDatabase,
  OfflineAuthorityRestoreService,
  OfflineRestoreFailure,
  RecoveryStopProofStore,
} from "../../../../../support/helpers/synthetic-storage-admission.js";
import {
  AUTHORITY_APPLICATION_ID,
  SQLITE_MIGRATIONS,
} from "../../../../../../src/backend/storage/sqlite/migrations.js";
import {
  acquireRuntimeProcessLock,
  acquireRuntimeRestoreAdmission,
  observeProcessIdentity,
  observeRuntimeLockSnapshot,
} from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import {
  composeStorageCommand,
  restoreFailureDisposition,
} from "../../../../../support/helpers/synthetic-storage-admission.js";
import {
  COMMAND_FIXTURES,
  NOW,
  NOTIFICATION,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { sqliteRunReader } from "../../../../../support/helpers/canonical-run-reader.js";
import { makeWorld } from "../../../../../support/helpers/backend/dashboard-harness.js";

const CLOCK = manualClock(new Date(NOW));
const CommandIdentitySchema = z.object({ commandId: z.string().min(1) });
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface DrillPaths {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly processLockRoot: string;
}

function drillPaths(): DrillPaths {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-2j-restore-"));
  roots.push(repoRoot);
  const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  // The command reads the running build's version out of its repo root, the
  // same way the dashboard composition does; the drill's root is a repo root.
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
  return {
    repoRoot,
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
  };
}

function open(paths: DrillPaths): AuthorityDatabase {
  return AuthorityDatabase.open(
    { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "restore-drill" },
    CLOCK,
  );
}

function createHistoricalAuthority(path: string, schemaVersion: number): void {
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    for (const migration of SQLITE_MIGRATIONS) {
      if (migration.version > schemaVersion) break;
      for (const statement of migration.statements) database.exec(statement);
    }
    database.prepare(`
      INSERT INTO ${databaseStateTable(schemaVersion)}
        (singleton_id, schema_version, authority_generation, updated_at,
         migration_owner, migration_started_at)
      VALUES (1, ?, 7, ?, NULL, NULL)
    `).run(schemaVersion, NOW);
    database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
    database.exec(`PRAGMA user_version = ${String(schemaVersion)}`);
    database.exec("COMMIT");
  } finally {
    database.close();
  }
}

/** `COMMAND_FIXTURES` is a `readonly unknown[]`, so its id is read by schema. */
function seededCommandId(): string {
  return CommandIdentitySchema.parse(COMMAND_FIXTURES[0]).commandId;
}


function seedRealShapedAuthority(database: AuthorityDatabase): Readonly<{
  claimGeneration: number;
  runId: string;
}> {
  database.authority.commands.insert(COMMAND_FIXTURES[0]);
  database.authority.runs.enqueue(QUEUED_RUN);
  const claimed = database.authority.runs.claimNext({
    workflow: QUEUED_RUN.envelope.workflow,
    workerId: "person-lookup-worker-1",
    now: NOW,
  });
  assert.equal(claimed.state, "claimed");
  const claimGeneration = claimed.state === "claimed" ? claimed.run.claimGeneration : -1;
  const fenced = database.authority.writeIntents.fenceAttempt({
    intent: WRITE_INTENT_ATTEMPTING,
    attempt: WRITE_ATTEMPT,
  });
  assert.equal(fenced.state, "fenced");
  return { claimGeneration, runId: String(QUEUED_RUN.envelope.runId) };
}

async function takeBackup(database: AuthorityDatabase, paths: DrillPaths): Promise<string> {
  const service = new AuthorityBackupService(database, { directory: paths.backupDirectory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: database.getMeta().authorityGeneration,
  });
  const manifest = report.manifests.at(-1);
  assert.ok(manifest !== undefined, "the backup run produced no manifest");
  return join(paths.backupDirectory, `${manifest.backupFileName}.manifest.json`);
}


function corrupt(paths: DrillPaths): void {
  const bytes = readFileSync(paths.authorityPath);
  bytes.fill(0x5a, 4096, Math.min(bytes.length, 40_960));
  writeFileSync(paths.authorityPath, bytes);
}

describe("2j — corruption → degraded → restore → rebuild, through the CLI", () => {
  it("reports post-swap failures without claiming the live authority was untouched", () => {
    const failure = new OfflineRestoreFailure(
      "replaced",
      "offline authority restore failed",
      new Error("injected post-swap fsync failure"),
    );
    assert.deepEqual(restoreFailureDisposition(failure), {
      heading: "authority restore POST-SWAP FAILURE",
      authorityLine: "the authority database was replaced; inspect the post-swap failure before restarting runtime",
    });
    assert.deepEqual(restoreFailureDisposition(new OfflineRestoreFailure(
      "companion-state-uncertain",
      "offline authority restore failed",
      new Error("rollback fsync failed"),
    )), {
      heading: "authority restore COMPANION-STATE FAILURE",
      authorityLine: "the authority database was not replaced, but live WAL/SHM rollback is unproven; inspect recovery artifacts before restarting runtime",
    });
    assert.deepEqual(restoreFailureDisposition(new OfflineRestoreFailure(
      "authority-state-uncertain",
      "offline authority restore failed",
      new Error("swap outcome could not be observed"),
    )), {
      heading: "authority restore AUTHORITY-STATE UNCERTAIN",
      authorityLine: "the authority replacement outcome is unproven; inspect staged/live paths before restarting runtime",
    });
    assert.deepEqual(restoreFailureDisposition(new Error("pre-swap refusal")), {
      heading: "authority restore REFUSED",
      authorityLine: "the live authority database was not modified",
    });
  });

  it("names the corruption read-only, restores the named backup, and keeps every authority family", async () => {
    const paths = drillPaths();
    const credentialDirectory = join(paths.stateRoot, "credentials");
    const credentialPath = join(credentialDirectory, "protected.json");
    const credentialOutcome = createCredentialStore({ stateRoot: paths.stateRoot }).apply(
      ProtectedSettingsApplyInputSchema.parse({
        commandId: "a7111111-1111-4111-8111-111111111111",
        commandFingerprint: "1".repeat(64),
        expectedRevision: 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        entries: { ucpathPassword: { set: "restore-independent-credential-canary" } },
        updatedAt: NOW,
      }),
    );
    assert.equal(credentialOutcome.state, "applied");
    const credentialBytes = readFileSync(credentialPath);
    const credentialStats = statSync(credentialPath);
    const database = open(paths);
    const seeded = seedRealShapedAuthority(database);
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock: CLOCK, pid: 4242 }).emit({
      t: "span.started", kind: "worker", workflow: "person-lookup", ts: NOW,
      workerId: "restored-worker", spanPath: "worker/restored-worker", name: "Restored worker" });
    const retainedTimeline = database.authority.timelineEvents.page({});
    const generation = database.getMeta().authorityGeneration;
    const manifestPath = await takeBackup(database, paths);

    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const before = readFileSync(paths.authorityPath);

    corrupt(paths);

    // 1 — the doctor degrades READ-ONLY and names the corruption.
    const degraded = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["doctor", "--json"],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(degraded.exitCode, 1);
    const report: unknown = JSON.parse(degraded.output);
    assert.equal(Reflect.get(report as object, "mode"), "read-only");
    const authority = Reflect.get(report as object, "authority") as Record<string, unknown>;
    assert.equal(authority["state"], "degraded");
    const cause = authority["cause"] as Record<string, unknown>;
    assert.equal(cause["code"], "authority-corrupt");

    assert.equal(
      readFileSync(paths.authorityPath).equals(before),
      false,
      "the corruption itself must have changed the file",
    );
    const afterDoctor = readFileSync(paths.authorityPath);

    // 2 — the restore, through the operator's command, naming ONE manifest.
    const restored = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(restored.exitCode, 0, restored.output);
    assert.match(restored.output, /authority restore — restored/u);
    assert.match(restored.output, /projections rebuilt: true/u);

    // 3 — the suspect database is preserved, byte-identical to what the
    // doctor saw. It is evidence, not garbage.
    const quarantined = readdirSync(join(paths.stateRoot, "suspects"));
    const suspects = quarantined.filter((name) => name.endsWith(".sqlite"));
    assert.equal(suspects.length, 1, quarantined.join(","));
    assert.equal(
      readFileSync(join(paths.stateRoot, "suspects", suspects[0] ?? "")).equals(afterDoctor),
      true,
    );

    // 4 — every family the exit criterion names survived.
    const reopened = open(paths);
    try {
      assert.deepEqual(reopened.authority.timelineEvents.page({}), retainedTimeline);
      assert.deepEqual(reopened.authority.commands.get(seededCommandId()), COMMAND_FIXTURES[0]);
      const run = reopened.authority.runs.get(seeded.runId);
      assert.ok(run !== undefined);
      assert.equal(run.claimGeneration, seeded.claimGeneration);
      assert.equal(run.lifecycle.state, "claimed");
      assert.deepEqual(
        reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        WRITE_INTENT_ATTEMPTING,
      );
      assert.equal(reopened.getMeta().authorityGeneration, generation);
      const world = makeWorld({ reader: sqliteRunReader(reopened, CLOCK) });
      try {
        assert.equal(world.projection.runFold(seeded.runId), undefined);
        assert.equal(world.projection.queueSurface(seeded.runId)?.status, "running",
          "restored canonical authority renders without replaying execution spans or writes");
        const day = world.projection.buildDashboardDayWire(localDatePart(new Date(run.envelope.enqueuedAt)));
        assert.equal(day.queueSurfaces.find((row) => row.runId === seeded.runId)?.status, "running");
        assert.deepEqual(day.statusCounts, [{ status: "running", count: 1 }]);
        world.projection.reconcileWorkerAuthority();
        assert.equal(world.changes.length, 0, "an unchanged restored authority must not churn snapshots");
        assert.equal(reopened.getMeta().authorityGeneration, generation);
        assert.deepEqual(reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          WRITE_INTENT_ATTEMPTING);
      } finally {
        world.dispose();
      }
      // The post-backup row is gone — the restore restored the BACKUP, not a merge.
      assert.equal(reopened.authority.notifications.get(NOTIFICATION.notificationId), undefined);
    } finally {
      reopened.close();
    }

    // 5 — the doctor now reports a healthy authority over the restored file.
    const healthy = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["doctor", "--json"],
      CLOCK,
      paths.repoRoot,
    );
    const healthyReport: unknown = JSON.parse(healthy.output);
    const healthyAuthority = Reflect.get(healthyReport as object, "authority") as Record<string, unknown>;
    assert.equal(healthyAuthority["state"], "healthy");
    assert.equal(readFileSync(credentialPath).equals(credentialBytes), true);
    const afterCredentialStats = statSync(credentialPath);
    assert.deepEqual({
      mode: afterCredentialStats.mode,
      uid: afterCredentialStats.uid,
      ino: afterCredentialStats.ino,
      size: afterCredentialStats.size,
      mtimeMs: afterCredentialStats.mtimeMs,
      ctimeMs: afterCredentialStats.ctimeMs,
    }, {
      mode: credentialStats.mode,
      uid: credentialStats.uid,
      ino: credentialStats.ino,
      size: credentialStats.size,
      mtimeMs: credentialStats.mtimeMs,
      ctimeMs: credentialStats.ctimeMs,
    });
  });

  it.each([29, 30, 31, 32, 33, 34, 35, 36, 37, 46, 47, 48])("enforces the restore floor for exact v%s without credential changes", async (version) => {
    const paths = drillPaths();
    const credentialPath = join(paths.stateRoot, "credentials", "protected.json");
    const credentialOutcome = createCredentialStore({ stateRoot: paths.stateRoot }).apply(
      ProtectedSettingsApplyInputSchema.parse({
        commandId: "11111111-1111-4111-8111-111111111111",
        commandFingerprint: "1".repeat(64),
        expectedRevision: 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        entries: { ucpathPassword: { set: "historical-restore-credential-canary" } },
        updatedAt: NOW,
      }),
    );
    assert.equal(credentialOutcome.state, "applied");
    const credentialBytes = readFileSync(credentialPath);

    const live = open(paths);
    live.close();
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(paths.authorityPath);
    const historicalPath = join(paths.stateRoot, `historical-v${String(version)}.sqlite`);
    createHistoricalAuthority(historicalPath, version);
    const rawSource = openAuthorityBackupSourceReadOnly(historicalPath);
    let manifestPath: string;
    try {
      const source = {
        getMeta: () => rawSource.getMeta(),
        getSourceDatabaseIdentity: () => sourceDatabaseIdentity,
        onlineBackupTo: (destinationPath: string) => rawSource.onlineBackupTo(destinationPath),
      };
      const report = await new AuthorityBackupService(
        source,
        { directory: paths.backupDirectory },
        CLOCK,
      ).request({ trigger: "schema-migration", requiredGeneration: 7 });
      const manifest = report.manifests[0];
      assert.ok(manifest !== undefined);
      manifestPath = join(
        paths.backupDirectory,
        `${manifest.backupFileName}.manifest.json`,
      );
    } finally {
      rawSource.close();
    }

    const proofStore = new RecoveryStopProofStore({
      processLockRoot: paths.processLockRoot,
      maxProofAgeMs: 60_000,
    }, CLOCK);
    proofStore.recordRuntimeState(observeRuntimeLockSnapshot({
      processLockRoot: paths.processLockRoot,
      sourceDatabaseIdentity,
    }, CLOCK));
    const stoppedSystemProof = proofStore.issue({
      observedBy: "local-operator",
      sourceDatabaseIdentity,
    });
    let projectionRebuildCalls = 0;
    const restore = new OfflineAuthorityRestoreService({
      authorityPath: paths.authorityPath,
      suspectDirectory: join(paths.stateRoot, "suspects"),
      busyTimeoutMs: 100,
      processLockRoot: paths.processLockRoot,
      stoppedProofMaxAgeMs: 60_000,
    }, async () => {
      projectionRebuildCalls += 1;
      throw new Error("historical restore must not invoke the current projection builder");
    }, CLOCK);

    if (version < 46) {
      const before = storageTree(paths.stateRoot);
      const refused = /authority-below-floor.*floor: 46.*original compatible release/u;
      await assert.rejects(restore.restore({ manifestPath, stoppedSystemProof }), refused);
      assert.deepEqual(storageTree(paths.stateRoot), before, "offline refusal precedes replacement and admission");
      await assert.rejects(restoreHistoricalStorage({ authorityPath: paths.authorityPath,
        suspectDirectory: join(paths.stateRoot, "suspects"), busyTimeoutMs: 100,
        processLockRoot: paths.processLockRoot, stoppedProofMaxAgeMs: 60_000 },
        { manifestPath, stoppedSystemProof }, join(paths.stateRoot, ".env"), CLOCK), refused);
      assert.deepEqual(storageTree(paths.stateRoot), before, "historical refusal precedes marker and quarantine");
      assert.equal(projectionRebuildCalls, 0);
      assert.deepEqual(readFileSync(credentialPath), credentialBytes);
      return;
    }
    const report = await restore.restore({ manifestPath, stoppedSystemProof });

    assert.equal(report.schemaVersion, version);
    assert.equal(report.projectionRebuilt, false);
    assert.equal(projectionRebuildCalls, 0);
    assert.equal(readFileSync(credentialPath).equals(credentialBytes), true);
    assert.equal(inspectAuthorityBackupReadOnly(paths.authorityPath, version).schemaVersion, version);
    if (version >= 46) {
      assert.equal((await upgradeStorage({ stateRoot: paths.stateRoot, processLockRoot: paths.processLockRoot,
        environmentFile: join(paths.stateRoot, ".env"), plan: false }, CLOCK)).state, "converted");
      const upgraded = open(paths);
      try {
        const names = upgraded.inspectSchema().tables.map(({ name }) => name);
        assert.ok(names.includes("workflow_workers"));
        assert.ok(names.includes("worker_auth"));
        assert.ok(names.includes("workflow_run_requests"));
        assert.deepEqual(upgraded.authority.workerLeases.listLive(), []);
      } finally { upgraded.close(); }
      assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    }
  });

  it("refuses while a live process holds a runtime lock, and touches nothing", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    const manifestPath = await takeBackup(database, paths);
    database.close();
    corrupt(paths);
    const corrupted = readFileSync(paths.authorityPath);

    // This test process IS a live pid, which is exactly the condition.
    const held = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    try {
      const refused = await composeStorageCommand(
        rebuildRuntimeIsolation,
        ["restore", "--from", manifestPath],
        CLOCK,
        paths.repoRoot,
      );
      assert.equal(refused.exitCode, 1);
      assert.match(refused.output, /authority restore REFUSED/u);
      assert.match(refused.output, new RegExp(`server process lock generation 2 is active for pid ${String(process.pid)}`, "u"));
      assert.match(refused.output, /the live authority database was not modified/u);
      assert.match(refused.output, new RegExp(`server=ACTIVE pid ${String(process.pid)}`, "u"));
      assert.equal(readFileSync(paths.authorityPath).equals(corrupted), true);
      assert.equal(existsSync(join(paths.stateRoot, "suspects")), false);
    } finally {
      held.release();
    }


    const after = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(after.exitCode, 0, after.output);
  });

  it("admits concurrent worker processes under one aggregate restore lock", () => {
    const paths = drillPaths();
    const first = acquireRuntimeProcessLock(
      {
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-1",
        pid: process.pid,
      },
      CLOCK,
    );
    const second = acquireRuntimeProcessLock(
      {
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-2",
        pid: process.pid,
      },
      CLOCK,
    );
    try {
      const snapshot = observeRuntimeLockSnapshot(
        {
          processLockRoot: paths.processLockRoot,
          sourceDatabaseIdentity: "a".repeat(64),
        },
        CLOCK,
      );
      assert.deepEqual(snapshot.processLocks.workers, {
        state: "active",
        generation: 3,
        pid: process.pid,
      });
    } finally {
      second.release();
      first.release();
    }
  });

  it("unwinds a worker that loses the check/write race to restore admission", () => {
    const paths = drillPaths();
    let restoreAdmission: ReturnType<typeof acquireRuntimeRestoreAdmission> | undefined;
    assert.throws(
      () => acquireRuntimeProcessLock({
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-2",
        pid: process.pid,
      }, CLOCK, {
        afterInitialAdmissionCheck: () => {
          restoreAdmission = acquireRuntimeRestoreAdmission({
            processLockRoot: paths.processLockRoot,
            pid: process.pid,
          }, CLOCK);
        },
      }),
      /restore admission .* is held by live pid/u,
    );
    try {
      const snapshot = observeRuntimeLockSnapshot(
        { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
        CLOCK,
      );
      assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
    } finally {
      restoreAdmission?.release();
    }
  });

  it("refuses malformed restore admission and archives crashed ownership", () => {
    const malformedPaths = drillPaths();
    mkdirSync(malformedPaths.processLockRoot, { recursive: true });
    writeFileSync(join(malformedPaths.processLockRoot, "restore-admission.lock.json"), "{}\n");
    assert.throws(
      () => acquireRuntimeProcessLock({
        processLockRoot: malformedPaths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-1",
        pid: process.pid,
      }, CLOCK),
      /restore admission record .* is malformed/u,
    );

    const stalePaths = drillPaths();
    acquireRuntimeRestoreAdmission({
      processLockRoot: stalePaths.processLockRoot,
      pid: deadPid(),
    }, CLOCK, { observeProcessIdentity: pretendAliveIdentity });
    const replacement = acquireRuntimeRestoreAdmission({
      processLockRoot: stalePaths.processLockRoot,
      pid: process.pid,
    }, CLOCK);
    assert.equal(
      readdirSync(join(stalePaths.processLockRoot, "restore-admission-history")).length,
      1,
    );
    replacement.release();
    assert.equal(
      readdirSync(join(stalePaths.processLockRoot, "restore-admission-history")).length,
      2,
    );
  });

  it("advances the aggregate generation whenever a worker starts or restarts", () => {
    const paths = drillPaths();
    const observe = () => observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    ).processLocks.workers.generation;
    assert.equal(observe(), 1);
    const first = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: deadPid(),
    }, CLOCK, { observeProcessIdentity: pretendAliveIdentity });
    assert.equal(observe(), 2);
    first.release();
    const restarted = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: deadPid(),
    }, CLOCK, { observeProcessIdentity: pretendAliveIdentity });
    assert.equal(observe(), 3);
    restarted.release();
  });

  it("retries release after its first durable write attempt fails", () => {
    const paths = drillPaths();
    let nowCalls = 0;
    const failFirstReleaseClock = {
      ...CLOCK,
      now: (): Date => {
        nowCalls += 1;
        return nowCalls === 2 ? new Date(Number.NaN) : new Date(NOW);
      },
    };
    const held = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: process.pid,
    }, failFirstReleaseClock);
    assert.throws(() => held.release(), /Invalid time value/u);
    assert.doesNotThrow(() => held.release());
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    );
    assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
  });

  it("retries singleton release after its first durable write attempt fails", () => {
    const paths = drillPaths();
    let nowCalls = 0;
    const failFirstReleaseClock = {
      ...CLOCK,
      now: (): Date => {
        nowCalls += 1;
        return nowCalls === 2 ? new Date(Number.NaN) : new Date(NOW);
      },
    };
    const held = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      failFirstReleaseClock,
    );
    assert.throws(() => held.release(), /Invalid time value/u);
    assert.doesNotThrow(() => held.release());
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    );
    assert.deepEqual(snapshot.processLocks.server, { state: "stopped", generation: 2 });
  });

  it("reads the old root-level workers lock forward into the aggregate", () => {
    const paths = drillPaths();
    mkdirSync(paths.processLockRoot, { recursive: true });
    writeFileSync(join(paths.processLockRoot, "workers.lock.json"), `${JSON.stringify({
      schemaVersion: 1,
      name: "workers",
      pid: process.pid,
      generation: 7,
      acquiredAt: NOW,
      releasedAt: null,
    })}\n`);
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    );
    assert.deepEqual(snapshot.processLocks.workers, {
      state: "active",
      generation: 7,
      pid: process.pid,
    });
    assert.equal(existsSync(join(paths.processLockRoot, "workers.lock.json")), true);
  });

  it("refuses restore while any worker process is alive", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    const manifestPath = await takeBackup(database, paths);
    database.close();
    corrupt(paths);
    const corrupted = readFileSync(paths.authorityPath);
    const held = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-2",
      pid: process.pid,
    }, CLOCK);
    try {
      const refused = await composeStorageCommand(
        rebuildRuntimeIsolation,
        ["restore", "--from", manifestPath],
        CLOCK,
        paths.repoRoot,
      );
      assert.equal(refused.exitCode, 1);
      assert.match(refused.output, new RegExp(
        `workers process lock generation 2 is active for pid ${String(process.pid)}`,
        "u",
      ));
      assert.equal(readFileSync(paths.authorityPath).equals(corrupted), true);
    } finally {
      held.release();
    }
  });

  it("fails loud on a malformed worker process-lock record", () => {
    const paths = drillPaths();
    const workersRoot = join(paths.processLockRoot, "workers");
    mkdirSync(workersRoot, { recursive: true });
    writeFileSync(join(workersRoot, "broken.lock.json"), "{}\n");

    assert.throws(
      () => observeRuntimeLockSnapshot(
        {
          processLockRoot: paths.processLockRoot,
          sourceDatabaseIdentity: "a".repeat(64),
        },
        CLOCK,
      ),
      /worker process-lock record broken\.lock\.json is malformed/u,
    );
  });

  it("observes a crashed holder as stopped rather than bricking recovery", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    const manifestPath = await takeBackup(database, paths);
    database.close();
    corrupt(paths);

    // A worker that died without releasing: the file still says `held`, but
    // the pid is gone. Refusing here forever would make a crash unrecoverable.
    acquireRuntimeProcessLock(
      {
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-1",
        pid: deadPid(),
      },
      CLOCK,
      { observeProcessIdentity: pretendAliveIdentity },
    );
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(paths.authorityPath) },
      CLOCK,
    );
    assert.equal(snapshot.processLocks.workers.state, "stopped");
    // The lock FILE is untouched by the observation — nothing rewrites another
    // process's record to make a restore possible.
    assert.equal(readdirSync(join(paths.processLockRoot, "workers")).length, 1);

    const restored = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(restored.exitCode, 0, restored.output);
  });

  it("refuses a second live holder of one role lock", () => {
    const paths = drillPaths();
    const first = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.throws(
      () => acquireRuntimeProcessLock(
        { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
        CLOCK,
      ),
      /server process lock is held by live pid/u,
    );
    first.release();
    // Released, the next acquire takes the NEXT generation — that advance is
    // what fences a stopped-system proof issued before the restart.
    const second = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.equal(second.generation, 3);
    second.release();
  });

  it("admits exactly one singleton under 16-process contention and never observes it stopped", async () => {
    const paths = drillPaths();
    const contenderCount = 16;
    const readyDirectory = join(paths.repoRoot, "contenders-ready");
    const startPath = join(paths.repoRoot, "contenders-start");
    const releasePath = join(paths.repoRoot, "contenders-release");
    mkdirSync(readyDirectory);
    const fixturePath = join(
      process.cwd(),
      "tests",
      "support", "processes",
      "runtime-lock-contender.ts",
    );
    const children: ChildProcessWithoutNullStreams[] = [];
    const outputs: string[] = [];
    for (let index = 0; index < contenderCount; index += 1) {
      const child = spawn(process.execPath, [
        "--import",
        "tsx",
        fixturePath,
        paths.processLockRoot,
        readyDirectory,
        startPath,
        releasePath,
        String(index),
      ], { stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => outputs.push(chunk));
      child.stderr.on("data", (chunk: string) => outputs.push(`STDERR ${chunk}`));
      children.push(child);
    }
    try {
      await waitFor(() => readdirSync(readyDirectory).length === contenderCount, outputs);
      writeFileSync(startPath, "start\n", { flag: "wx" });
      await waitFor(
        () => outputs.join("").match(/^(?:ADMITTED|REFUSED) /gmu)?.length === contenderCount,
        outputs,
      );
      // Admission is printed before the child finishes its read-only snapshot.
      // Wait for that distinct observation, then retain the active-state assertion.
      await waitFor(() => /^SNAPSHOT \S+$/mu.test(outputs.join("")), outputs);
      const output = outputs.join("");
      assert.equal(output.match(/^ADMITTED /gmu)?.length, 1, output);
      assert.equal(output.match(/^REFUSED /gmu)?.length, contenderCount - 1, output);
      assert.match(output, /^ADMITTED \S+ \d+ 2$/mu);
      assert.match(output, /^SNAPSHOT active$/mu);
      const snapshot = observeRuntimeLockSnapshot({
        processLockRoot: paths.processLockRoot,
        sourceDatabaseIdentity: "a".repeat(64),
      });
      assert.equal(snapshot.processLocks.server.state, "active", output);
    } finally {
      if (!existsSync(startPath)) writeFileSync(startPath, "start\n", { flag: "wx" });
      if (!existsSync(releasePath)) writeFileSync(releasePath, "release\n", { flag: "wx" });
      await Promise.all(children.map(waitForExit));
    }
    const next = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.equal(next.generation, 3);
    next.release();
  }, 30_000);

  it("keeps one live process identity stable when the caller timezone changes", () => {
    const paths = drillPaths();
    const priorTimezone = process.env["TZ"];
    let held: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
    try {
      process.env["TZ"] = "America/Los_Angeles";
      const first = observeProcessIdentity(process.pid);
      held = acquireRuntimeProcessLock(
        { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
        CLOCK,
      );

      process.env["TZ"] = "Pacific/Honolulu";
      const second = observeProcessIdentity(process.pid);
      const snapshot = observeRuntimeLockSnapshot(
        { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
        CLOCK,
      );

      assert.deepEqual(second, first);
      assert.deepEqual(snapshot.processLocks.server, {
        state: "active",
        generation: 2,
        pid: process.pid,
      });
      if (process.platform === "darwin" && second.state === "alive") {
        assert.match(second.identity.startToken, /^\d+$/u);
      }
    } finally {
      held?.release();
      if (priorTimezone === undefined) delete process.env["TZ"];
      else process.env["TZ"] = priorTimezone;
    }
  });

  it("treats a reused pid with a different OS start identity as a crashed owner", () => {
    const paths = drillPaths();
    const originalIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-a" });
    const reusedIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-b" });
    acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: originalIdentity }) },
    );
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: reusedIdentity }) },
    );
    assert.deepEqual(snapshot.processLocks.server, { state: "stopped", generation: 2 });
  });

  it("archives restore admission when its pid was reused by a different process birth", () => {
    const paths = drillPaths();
    const originalIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-a" });
    const reusedIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-b" });
    acquireRuntimeRestoreAdmission(
      { processLockRoot: paths.processLockRoot, pid: process.pid },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: originalIdentity }) },
    );
    const replacement = acquireRuntimeRestoreAdmission(
      { processLockRoot: paths.processLockRoot, pid: process.pid },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: reusedIdentity }) },
    );
    assert.equal(readdirSync(join(paths.processLockRoot, "restore-admission-history")).length, 1);
    replacement.release();
  });

  it("names every storage-doctor exit-zero condition in command help", async () => {
    const paths = drillPaths();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      [],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 1);
    assert.match(
      usage.output,
      /authority, recovery inspection, credentials and span reconciliation are healthy; backup is reported, not gated/u,
    );
  });

  it("refuses restore without an exact named manifest", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    database.close();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore"],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 2);
    assert.match(usage.output, /requires the exact backup manifest/u);
    // A missing manifest is a refusal that names the file, never a fall-back
    // to whatever backup happens to be newest.
    const missing = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", join(paths.backupDirectory, "no-such.manifest.json")],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(missing.exitCode, 1);
    assert.match(missing.output, /no-such\.manifest\.json does not exist/u);
  });
});

async function waitFor(predicate: () => boolean, diagnostics: readonly string[]): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for lock contenders:\n${diagnostics.join("")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) resolve();
      else reject(new Error(`runtime-lock contender exited with code ${String(child.exitCode)}`));
      return;
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `runtime-lock contender exited with code ${String(code)} signal ${signal ?? "none"}`,
      ));
    });
  });
}

function pretendAliveIdentity(pid: number) {
  return {
    state: "alive" as const,
    identity: { platform: "darwin" as const, startToken: `synthetic-${String(pid)}` },
  };
}


function deadPid(): number {
  for (let candidate = 2 ** 21; candidate < 2 ** 21 + 512; candidate += 1) {
    if (!pidExists(candidate)) return candidate;
  }
  throw new Error("could not find a dead pid to stand in for a crashed worker");
}

function pidExists(pid: number): boolean {
  const outcome = probePid(pid);
  return outcome.state === "present";
}

function probePid(pid: number): Readonly<{ state: "present" | "absent" }> {
  try {
    process.kill(pid, 0);
    return { state: "present" };
  } catch (error) {
    return { state: typeof error === "object" && error !== null && Reflect.get(error, "code") === "ESRCH" ? "absent" : "present" };
  }
}

describe("T restore-loss warning after real worker recovery", () => {
  const CLOCK = manualClock(new Date("2026-09-03T12:00:00.000Z"));
  const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_COMMIT);
  function paths() {
    const repoRoot = mkdtempSync(join(tmpdir(), "history-restore-loss-")); roots.push(repoRoot);
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "history-restore", version: "0.1.0" }));
    return { repoRoot, stateRoot, authorityPath: join(stateRoot, "state.db"), backupDirectory: join(stateRoot, "backups", "authority") };
  }
  function createAuthority(p: ReturnType<typeof paths>) {
    mkdirSync(p.stateRoot, { recursive: true });
    const db = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 250, migrationOwner: "history-restore" }, CLOCK); db.close();
  }
it.each([false, true])("restore confirmation evidence survives recovery accounting (backup after commit: %s)", async (backupAfterCommit) => {
  CLOCK.setWall(new Date(WRITE_INTENT_ATTEMPTING.fencedAt));
  const p = paths(); createAuthority(p);
  const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
  const inspect = (path: string) => {
    const db = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "r1c-read",
      openMode: "storage-doctor-read-only-no-migrate" }, CLOCK);
    try {
      const run = db.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(run);
      const attempt = db.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId); assert.ok(attempt);
      return { runId: run.envelope.runId, version: run.version, lifecycle: run.lifecycle.state,
        claimedAt: "claimedAt" in run.lifecycle ? run.lifecycle.claimedAt : undefined, claimGeneration: run.claimGeneration,
        attemptId: attempt.writeAttemptId, outcome: attempt.outcome.state,
        operationStatus: db.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status,
        checkpoint: db.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId,
          checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration) !== undefined,
        events: db.authority.timelineEvents.page({}).map((record) => record.payload.kind === "span" ? record.payload.event.t : record.payload.kind) };
    } finally { db.close(); }
  };
  const initial = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "r1c-seed" }, CLOCK);
  try {
    seedAtomicWriteOwner(initial, ATOMIC_WRITE_COMMIT);
    const queued = initial.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(queued);
    createTimelineEmitter({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
      runQueuedSpanEvent({ run: queued, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic restored commit" }));
    const claim = initial.authority.runs.claimNext({ workflow: WRITE_INTENT_ATTEMPTING.workflowId,
      workerId: "r1c-restore-worker", now: CLOCK.now().toISOString() });
    assert.equal(claim.state, "claimed");
    const service = new RunRecordService({ database: initial, clock: CLOCK, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const validating = service.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId,
      claim: { workerId: "r1c-restore-worker", claimGeneration: 1 }, lifecycle: { state: "validating",
        workerId: "r1c-restore-worker", claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString() } });
    assert.equal(validating.state, "applied", JSON.stringify(validating));
    const running = service.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId,
      claim: { workerId: "r1c-restore-worker", claimGeneration: 1 }, lifecycle: { state: "running",
        workerId: "r1c-restore-worker", claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString(),
        currentNodeId: checkpoint.nodeId } });
    assert.equal(running.state, "applied");
    initial.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
  } finally { initial.close(); }
  const before = inspect(p.authorityPath);
  assert.equal(before.lifecycle, "running"); assert.equal(before.outcome, "attempting");
  let backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
  assert.equal(backup.exitCode, 0, backup.output);
  let manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert.ok(manifest);
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT.confirmedAt));
  const newer = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "r1c-commit" }, CLOCK);
  try {
    const service = new RunRecordService({ database: newer, clock: CLOCK, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const claim = { workerId: WorkerIdSchema.parse("r1c-restore-worker"),
      claimGeneration: PositiveIntSchema.parse(before.claimGeneration) };
    executeSequencedWriteCommit(newer, { run: { runId: before.runId, expectedVersion: before.version, claim },
      commit: ATOMIC_WRITE_COMMIT, checkpoint }, { kind: "advance-running", claim, claimedAt: before.claimedAt!,
      port: workerRunLifecyclePort(service) });
  } finally { newer.close(); }
  const committed = inspect(p.authorityPath);
  assert.equal(committed.version, before.version + 1); assert.equal(committed.attemptId, before.attemptId);
  assert.equal(committed.outcome, "committed"); assert.equal(committed.checkpoint, true);
  if (backupAfterCommit) {
    // A preserved confirmation already present in the restored backup is accounted for.
    backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    manifest = readdirSync(p.backupDirectory).filter((name) => name.endsWith(".manifest.json")).sort().at(-1);
    assert.ok(manifest);
  }
  const restore = await composeStorageCommand(rebuildRuntimeIsolation,
    ["restore", "--from", join(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
  assert.equal(restore.exitCode, 0, restore.output);
  const restoredReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  const current = inspect(p.authorityPath);
  const preserved = inspect(join(p.stateRoot, "suspects", restoredReport.suspectFileName));
  assert.deepEqual(current, backupAfterCommit ? committed : before); assert.deepEqual(preserved, committed);
  assert.equal(doctor.exitCode, backupAfterCommit ? 0 : 1, doctor.output);
  if (backupAfterCommit) {
    const healthy = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" }, CLOCK);
    try {
      const service = new RunRecordService({ database: healthy, clock: CLOCK, ids: { uuid: randomUUID },
        publishQueued: () => { throw new Error("test must not enqueue"); } });
      assert.equal(service.renewClaim({ commandId: randomUUID(), runId: current.runId,
        claim: { workerId: "r1c-restore-worker", claimGeneration: current.claimGeneration } }).state, "applied");
    } finally { healthy.close(); }
    const accounted = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(accounted.exitCode, 0, accounted.output);
    assert.ok(inspect(p.authorityPath).version > committed.version);
    return;
  }
  CLOCK.advanceWall(60 * 60 * 1000);
  const mutationDb = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-sweep" }, CLOCK);
  try {
    const service = new RunRecordService({ database: mutationDb, clock: CLOCK, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const outcomes = sweepWorkerClaims(mutationDb, workerRunLifecyclePort(service), {
      staleBefore: CLOCK.now().toISOString(), now: CLOCK.now().toISOString() });
    assert.equal(outcomes.length, 1);
    const outcome = outcomes[0]; assert.ok(outcome);
    assert.equal(outcome.state, "recovery-required");
    if (outcome.state !== "recovery-required") throw new Error("expected parked recovery");
    assert.equal(outcome.parked, true);
  } finally { mutationDb.close(); }
  const afterSweep = inspect(p.authorityPath);
  assert.equal(afterSweep.version, committed.version);
  assert.equal(afterSweep.lifecycle, "parked-write");
  assert.equal(afterSweep.outcome, "attempting"); assert.equal(afterSweep.checkpoint, false);
  const doctorAfter = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  assert.equal(doctorAfter.exitCode, 1, doctorAfter.output);
  const afterReport = z.object({ spanAuthority: SpanAuthorityReconciliationWireSchema }).parse(JSON.parse(doctorAfter.output));
  assert.equal(afterReport.spanAuthority.state, "degraded");
  if (afterReport.spanAuthority.state !== "degraded") throw new Error("expected restore-loss warning");
  assert.ok(afterReport.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
    && problem.runId === current.runId && problem.possibleExternalWrite === true));
});

});
