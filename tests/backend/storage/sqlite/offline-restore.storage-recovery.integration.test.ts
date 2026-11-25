import { CLOCK, seedTerminalAuthority, testRoot, fixtureFor, baselineGeneration, databaseOptions, admissions, admissionFor, openDatabase, restoreMissingTriggers, backupDirectory, manifestPaths, createBackup } from "./storage-recovery-fixtures.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { mkdtempSync, realpathSync, copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { OldBuildRuntimeArtifactsError } from "../../../../src/backend/storage/admission/process-root.js";
import { RuntimeLifetimeLock, RuntimeAlreadyRunningError, OfflineMaintenanceOperationUnavailableError, isOfflineMaintenanceOperationActive } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { readAuthorityRestoreJournal } from "../../../../src/backend/storage/admission/installation.js";
import { CONFIG_SNAPSHOT, COMMAND_FIXTURES, NOTIFICATION, NOW, UUID_1, UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { completionFromAuthorization } from "../../../../src/models/run/completion.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, vi } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { TerminalAuthorizationRecordSchema } from "../../../../src/models/run/terminal-authorization.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure } from "../../../../src/backend/storage/sqlite/index.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { plantOldBuildArtifact } from "../../../support/helpers/storage/old-build-artifact.js";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
} from "../../../../src/backend/storage/sqlite/migrations.js";

function processLockRoot(root: string): string { return join(fixtureFor(root).workspace, rebuildRuntimeIsolation.processLockRoot); }
function renewAfterRestore(path: string): void {
  const profile = fixtureFor(path), old = profile.admission;
  const fresh = profile.renewAfterRestore();
  assert.throws(() => old.assertLive(), /profile-restore-context-expired|released admission/u);
  admissions.set(profile.stateRoot, fresh.admission);
}

function inspectFencedAuthority(path: string) {
  assert.equal(existsSync(join(fixtureFor(path).workspace, ".tracker", "control", "journal.json")), true);
  assert.throws(() => admissionFor(path).assertProfileRuntime(), OfflineMaintenanceOperationUnavailableError);
  const copy = fixtureFor(path).machine.verifiedReadOnlyCopy(path, createHash("sha256").update(readFileSync(path)).digest("hex"));
  try {
    const inspection = AuthorityDatabase.inspectExistingReadOnly(copy, path);
    assert.equal(inspection.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    return inspection;
  } finally { copy.release(); }
}

function restoreOptions(root: string, authorityPath: string, suspects = join(root, "backups", "suspects")) {
  return {
    authorityPath,
    suspectDirectory: suspects,
    busyTimeoutMs: 100,
    processLockRoot: processLockRoot(root),
    };
}

function maintenanceOperation(root: string) {
  return admissionFor(root).acquireOfflineMaintenance();
}

describe("offline exact-backup restore", () => {
  it("consumes the exact issued proof when the wall clock advances before exclusive verification", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const advancingClock = manualClock(new Date(NOW));
    const proof = maintenanceOperation(root);
    advancingClock.advanceWall(1);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, advancingClock, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.doesNotReject(restore.restore({ manifestPath }, proof));
    renewAfterRestore(root);
  });

  it("preserves nonempty failure, result and immutable same-row completion authority", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const seeded = seedTerminalAuthority(database);
    const generation = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.close();

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const report = await restore.restore({ manifestPath }, maintenanceOperation(root));
    renewAfterRestore(root);
    assert.equal(report.authorityGeneration, generation);
    const restored = openDatabase(authorityPath);
    assert.deepEqual(restored.authority.failures.get(seeded.failure.failureId), seeded.failure);
    assert.deepEqual(restored.authority.runResults.get(seeded.result.runId), seeded.result);
    assert.deepEqual(
      restored.authority.runs.get(seeded.failure.runId)?.completion,
      completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(seeded.failureAuthorization)),
    );
    assert.deepEqual(
      restored.authority.runs.get(seeded.result.runId)?.completion,
      completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(seeded.successAuthorization)),
    );
  });

  it("preserves the suspect DB and restores authority without resurrecting retired projections", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    writeFileSync(`${authorityPath}-wal`, "suspect wal bytes", { mode: 0o644 });
    writeFileSync(`${authorityPath}-shm`, "suspect shm bytes", { mode: 0o644 });

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async (stagedPath, restoreAdmission) => {
      const stagedAdmission = admissionFor(stagedPath).stoppedRestoreProjection(stagedPath, restoreAdmission);
      const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, databaseOptions(stagedPath), CLOCK);
      assert.equal("projections" in staged,false);
      assert.deepEqual(staged.authority.commands.get(UUID_1),COMMAND_FIXTURES[0]);
      staged.close();
      stagedAdmission.release();
    }, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const report = await restore.restore({ manifestPath }, maintenanceOperation(root));
    assert.equal(report.state, "restored");
    assert.equal(report.authorityGeneration, baselineGeneration(root) + 1);
    assert.equal(existsSync(join(suspects, report.suspectFileName)), true);
    assert.equal(readFileSync(join(suspects, `${report.suspectFileName}-wal`), "utf8"), "suspect wal bytes");
    assert.equal(readFileSync(join(suspects, `${report.suspectFileName}-shm`), "utf8"), "suspect shm bytes");
    assert.equal(existsSync(`${authorityPath}-wal`), false);
    assert.equal(existsSync(`${authorityPath}-shm`), false);
    renewAfterRestore(root);
    const restored = openDatabase(authorityPath);
    assert.deepEqual(restored.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
    assert.equal(restored.authority.notifications.get(UUID_3), undefined);
    assert.equal("projections" in restored,false);
  });

  it("refuses a copied unissued operation before preserving or swapping", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const before = readFileSync(authorityPath);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const proof = maintenanceOperation(root);
    try { await assert.rejects(restore.restore({ manifestPath }, { ...proof }), /offline-maintenance-unissued/u); }
    finally { proof.release(); }
    assert.deepEqual(readFileSync(authorityPath), before);
    assert.equal(existsSync(suspects), false);
  });

  it("refuses old-build worker evidence during a held operation", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const proof = maintenanceOperation(root);
    plantOldBuildArtifact(processLockRoot(root), "workers");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, proof),
      OldBuildRuntimeArtifactsError,
    );
    assert.equal(existsSync(suspects), false);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, baselineGeneration(root) + 0);
  });

  it("refuses released old-build singleton evidence without interpreting its generations", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const authorityBytes = readFileSync(authorityPath);
    const proof = maintenanceOperation(root);
    plantOldBuildArtifact(processLockRoot(root));

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, proof),
      OldBuildRuntimeArtifactsError,
    );
    assert.deepEqual(readFileSync(authorityPath), authorityBytes);
    assert.equal(existsSync(suspects), false);
  });

  it("holds exclusive admission through verification and authority replacement", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const proof = maintenanceOperation(root);
    const lifetime = admissionFor(root).lifetime;
    assert.ok(lifetime instanceof RuntimeLifetimeLock);
    let exclusions = 0;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => {
      proof.assertHeld();
      assert.throws(() => admissionFor(root).beginOfflineMaintenance(), /offline-maintenance-busy/u);
      await assert.rejects(RuntimeLifetimeLock.acquire(lifetime.port), RuntimeAlreadyRunningError);
      exclusions++;
      throw new Error("synthetic-root-exclusion-confirmed");
    }, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(restore.restore({ manifestPath }, proof), /synthetic-root-exclusion-confirmed/u);
    assert.equal(exclusions, 1);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, baselineGeneration(root) + 0);
  });

  it("does not fall back when the exact newest manifest is bad", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    database.close();
    const badManifestPath = join(directory, "newest-bad.manifest.json");
    writeFileSync(badManifestPath, "{ invalid");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath: badManifestPath }, maintenanceOperation(root)),
    );
    assert.equal(manifestPaths(directory).length, 2);
    assert.equal(existsSync(suspects), false);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, baselineGeneration(root) + 0);
  });

  it("keeps live and suspect recoverable when projection rebuild fails", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveGeneration = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration;
    writeFileSync(`${authorityPath}-wal`, "live wal bytes", { mode: 0o644 });
    writeFileSync(`${authorityPath}-shm`, "live shm bytes", { mode: 0o644 });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), () => Promise.reject(new Error("injected projection rebuild failure")), CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /injected projection rebuild failure/,
    );
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, liveGeneration);
    assert.equal(readdirSync(suspects).length > 0, true);
    assert.equal(readdirSync(root).some((name) => name.startsWith(".restore-")), false);
  });

  it("leaves live authority untouched on an injected atomic-swap failure", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveGeneration = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration;
    writeFileSync(`${authorityPath}-wal`, "live wal bytes", { mode: 0o644 });
    writeFileSync(`${authorityPath}-shm`, "live shm bytes", { mode: 0o644 });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: () => { throw new Error("injected atomic swap failure"); },
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /injected atomic swap failure/,
    );
    assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    assert.equal(readFileSync(`${authorityPath}-shm`, "utf8"), "live shm bytes");
    assert.equal(inspectFencedAuthority(authorityPath).authorityGeneration, liveGeneration);
    assert.equal(readdirSync(suspects).length > 0, true);
  });

  it("restores a companion when its displacement rename throws after moving it", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    writeFileSync(`${authorityPath}-wal`, "live wal bytes", { mode: 0o644 });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: renameSync,
        renamePath: (source, destination) => {
          renameSync(source, destination);
          if (source === `${authorityPath}-wal` && destination.endsWith(".live-companion")) {
            throw new Error("injected displacement error after rename");
          }
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "unchanged");
    assert.match(failure.message, /injected displacement error after rename/u);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, "injected displacement error after rename");
    assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    assert.equal(readdirSync(root).some((name) => name.endsWith(".live-companion")), false);
  });

  it("reports authority replaced when atomic swap throws after replacing it", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const backupGeneration = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          throw new Error("injected atomic swap error after rename");
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "replaced");
    assert.match(failure.message, /injected atomic swap error after rename/u);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, "injected atomic swap error after rename");
    assert.equal(
      inspectFencedAuthority(authorityPath).authorityGeneration,
      backupGeneration,
    );
  });

  it("leaves settlement unproved and retains the named staged path when a staged file remains after authority replacement", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const context = admissionFor(root).readInstallationContext(); assert.ok(context);
    let stagedPath = "";
    const removed: string[] = [];
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          stagedPath = source;
          copyFileSync(destination, stagedPath);
        },
        removePath: (path) => {
          removed.push(path);
          rmSync(path);
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "replaced");
    assert.match(failure.message, /restore settlement is unproved; durable operation and staging evidence retained/u);
    assert.equal(existsSync(stagedPath), true);
    assert.deepEqual(removed.filter(path => path.startsWith(stagedPath)), []);
    assert.equal(readAuthorityRestoreJournal(context.workspace)?.restore.stagedPath, stagedPath);
  });

  it("preserves primary failure before staged cleanup failure", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let stagedPath = "";
    const primaryError = new Error("injected primary projection failure");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async (path) => {
        stagedPath = path;
        throw primaryError;
      }, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: renameSync,
        removePath: (path) => {
          if (path === stagedPath) throw new Error("injected cleanup after primary failure");
          rmSync(path);
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "unchanged");
    assert.match(failure.message, /injected primary projection failure/u);
    assert.match(failure.message, /injected cleanup after primary failure/u);
    assert.match(failure.message, new RegExp(stagedPath, "u"));
    assert.ok(failure.cause instanceof AggregateError);
    assert.equal(failure.cause.cause, primaryError);
    assert.equal(failure.cause.errors[0], primaryError);
    assert.equal(existsSync(stagedPath), true);
  });

  it.each([
    { operation: "rename", expectedLiveCompanion: false },
    { operation: "fsync", expectedLiveCompanion: true },
  ] as const)("reports uncertain companion state when rollback $operation fails", async ({
    operation,
    expectedLiveCompanion,
  }) => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveAuthorityBytes = readFileSync(authorityPath);
    writeFileSync(`${authorityPath}-wal`, "live wal bytes", { mode: 0o644 });
    let swapAttempted = false;
    const rollbackMessage = `injected rollback ${operation} failure`;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: () => {
          swapAttempted = true;
          throw new Error("injected atomic swap failure");
        },
        renamePath: (source, destination) => {
          if (operation === "rename" && swapAttempted && source.endsWith(".live-companion")) {
            throw new Error(rollbackMessage);
          }
          renameSync(source, destination);
        },
        removePath: (path) => {
          rmSync(path);
        },
        syncPath: (path) => {
          if (operation === "fsync" && swapAttempted && path === root) {
            throw new Error(rollbackMessage);
          }
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(String(failure.authorityState), "companion-state-uncertain");
    assert.match(failure.message, /injected atomic swap failure/u);
    assert.match(failure.message, new RegExp(rollbackMessage, "u"));
    assert.ok(failure.cause instanceof AggregateError);
    assert.equal(
      failure.cause.errors.some((error) => error instanceof Error && error.message === rollbackMessage),
      true,
    );
    assert.deepEqual(readFileSync(authorityPath), liveAuthorityBytes);
    assert.equal(existsSync(`${authorityPath}-wal`), expectedLiveCompanion);
    if (expectedLiveCompanion) {
      assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    }
    assert.equal(
      readdirSync(root).some((name) => name.endsWith(".live-companion")),
      operation === "rename",
    );
  });

  it("refuses when verified backup bytes mutate during the staged copy", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveBytes = readFileSync(authorityPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string };
    const backupPath = join(directory, manifest.backupFileName);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: (source, destination) => {
          if (source === backupPath) {
            const bytes = readFileSync(source);
            bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
            writeFileSync(source, bytes);
          }
          copyFileSync(source, destination);
        },
        atomicReplace: renameSync,
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /staged restore .* checksum does not match verified manifest/u,
    );
    assert.deepEqual(readFileSync(authorityPath), liveBytes);
  });

  it("classifies post-swap directory fsync failure as authority replaced", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const generation = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let swapped = false;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          swapped = true;
        },
        syncPath: () => {
          if (swapped) throw new Error("injected post-swap directory fsync failure");
        },
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      replacedFailure(/post-swap directory fsync failure/u),
    );
    assert.equal(inspectFencedAuthority(authorityPath).authorityGeneration, generation);
  });

  it("classifies post-swap report validation failure as authority replaced", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let swapped = false;
    const reportClock = {
      ...CLOCK,
      now: (): Date => swapped ? new Date(Number.NaN) : CLOCK.now(),
    };
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, reportClock, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          swapped = true;
        },
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      replacedFailure(/Invalid time value/u),
    );
  });

  it("classifies exact operation release failure after swap as authority replaced", async () => {
    const root = await testRoot("profile"), authorityPath = join(root, "state.db"), directory = backupDirectory(root);
    const owner = admissionFor(root), lifetime = owner.lifetime;
    assert.ok(lifetime instanceof RuntimeLifetimeLock);
    const context = owner.readInstallationContext(); assert.ok(context);
    const journal = join(context.workspace, ".tracker", "control", "journal.json");
    const database = openDatabase(authorityPath), { manifestPath } = await createBackup(database, directory); database.close();
    const operation = maintenanceOperation(root), assertHeld = lifetime.assertOfflineMaintenance.bind(lifetime);
    let replaced = false;
    const failedRelease = vi.spyOn(lifetime, "assertOfflineMaintenance").mockImplementation((owned, workspace) => {
      assertHeld(owned, workspace);
      if (replaced && !existsSync(journal)) throw new Error("synthetic-exact-operation-release-failure");
    });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, owner, restoreOptions(root, authorityPath), async () => undefined,
      CLOCK, { copyFile: copyFileSync, atomicReplace(source, target) { renameSync(source, target); replaced = true; } }, boundProfileCredentials(owner));
    try {
      await assert.rejects(restore.restore({ manifestPath }, operation), replacedFailure(/release failed/u));
      assert.equal(isOfflineMaintenanceOperationActive(operation), true);
      await assert.rejects(RuntimeLifetimeLock.acquire(lifetime.port), RuntimeAlreadyRunningError);
      assert.throws(() => lifetime.beginOfflineMaintenance(context.workspace), /offline-maintenance-busy/u);
      assert.throws(() => owner.beginOfflineMaintenance(), /profile-restore-context-expired/u);
      assert.throws(() => owner.assertProfileRuntime());
    } finally { failedRelease.mockRestore(); operation.release(); }
  });

  it("rejects expired, copied, foreign and replayed operations before restore effects", async () => {
    const root = await testRoot("profile"), authorityPath = join(root, "state.db"), directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects"), owner = admissionFor(root), lifetime = owner.lifetime;
    assert.ok(lifetime instanceof RuntimeLifetimeLock);
    const context = owner.readInstallationContext(); assert.ok(context);
    const database = openDatabase(authorityPath), { manifestPath } = await createBackup(database, directory); database.close();
    const before = readFileSync(authorityPath);
    const service = () => new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects),
      async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const expired = maintenanceOperation(root); expired.release();
    await assert.rejects(service().restore({ manifestPath }, expired), /offline-maintenance-unissued/u);
    assert.equal(existsSync(suspects), false); assert.deepEqual(readFileSync(authorityPath), before);

    const current = maintenanceOperation(root);
    await assert.rejects(service().restore({ manifestPath }, { ...current }), /offline-maintenance-unissued/u);
    assert.throws(() => RuntimeAdmission.acquireMachine(context.workspace, "shared", lifetime), /offline-maintenance-unissued/u);
    await assert.rejects(RuntimeLifetimeLock.acquire(lifetime.port), RuntimeAlreadyRunningError);
    assert.equal(existsSync(suspects), false); assert.deepEqual(readFileSync(authorityPath), before);
    current.release();

    const foreignWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-foreign-operation-")));
    const foreignRoot = await RuntimeLifetimeLock.acquire(0), foreign = foreignRoot.beginOfflineMaintenance(foreignWorkspace);
    try {
      await assert.rejects(service().restore({ manifestPath }, foreign), /offline-maintenance-unissued/u);
      assert.equal(existsSync(suspects), false); assert.deepEqual(readFileSync(authorityPath), before);
    } finally { foreign.release(); await foreignRoot.close(); rmSync(foreignWorkspace, { recursive: true }); }

    const once = maintenanceOperation(root), firstService = service(), old = admissionFor(root);
    await firstService.restore({ manifestPath }, once);
    renewAfterRestore(root);
    assert.throws(() => old.assertProfileRuntime(), /released admission/u);
    await assert.rejects(firstService.restore({ manifestPath }, once), /released admission/u);
    const after = readdirSync(suspects).length;
    await assert.rejects(service().restore({ manifestPath }, once), /offline-maintenance-unissued/u);
    assert.equal(readdirSync(suspects).length, after);
  });

  it("rejects a checksum-valid restore copy whose authority record is schema-invalid", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { backupFileName: string };
    const backupPath = join(directory, manifest.backupFileName);
    const corruptBackup = new DatabaseSync(backupPath);

    const snapshotTriggers = corruptBackup.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
    for (const trigger of snapshotTriggers) corruptBackup.exec("DROP TRIGGER " + String(trigger.name));
    corruptBackup.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?")
      .run(JSON.stringify({invalid:"schema"}),CONFIG_SNAPSHOT.configSnapshotId);
    restoreMissingTriggers(corruptBackup,snapshotTriggers);
    corruptBackup.close();
    const bytes = readFileSync(backupPath);
    const byteSize = statSync(backupPath).size;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      byteSize,
      sha256,
    }));

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /settings_snapshots.*native record validation|strict|schema/,
    );
    assert.equal(existsSync(suspects), false);
  });
});

function replacedFailure(message: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof OfflineRestoreFailure
    && error.authorityState === "replaced"
    && message.test(error.message);
}
