import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createSessionBackups, SESSION_BACKUP_INTERVAL_MS } from "../../../../src/backend/storage/maintenance/session-backups.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import * as snapshots from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function restoredFrom(order: "session-newer" | "shutdown-newer"): Promise<string> {
  const bound = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-16T09:00:00.000Z")), credentials = boundProfileCredentials(bound.admission);
  const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250, migrationOwner: "restore-newest" },
    clock, undefined, undefined, undefined, credentials);
  cleanups.push(async () => { database.close(); await bound.close(); });
  const directory = join(bound.stateRoot, "backups", "authority");
  let occurrence = 0;
  const commitChange = () => {
    const at = clock.now().toISOString();
    database.withAuthorityTransaction(repositories => repositories.notificationHealth.put({ concern: "disk-space", active: true, occurrence: ++occurrence, samples: [], observedAt: at, createdAt: at }));
  };
  const shutdownBackup = () => new AuthorityBackupService(bound.admission, database, { directory, purpose: "clean-shutdown" }, clock)
    .request({ trigger: "graceful-drain", requiredGeneration: database.getMeta().authorityGeneration });
  const sessionBackup = async () => {
    const sessionBackups = createSessionBackups({ admission: bound.admission, database, clock, directory });
    try { expect(await sessionBackups.check()).toBe("taken"); } finally { sessionBackups.requestCancellation(); await sessionBackups.awaitCancellation(); }
  };
  commitChange();
  if (order === "session-newer") { await shutdownBackup(); clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); commitChange(); await sessionBackup(); }
  else { await sessionBackup(); clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); commitChange(); await shutdownBackup(); }
  database.close();
  const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, bound.admission, { authorityPath: bound.path, suspectDirectory: join(bound.stateRoot, "backups", "suspects"),
    busyTimeoutMs: 250, processLockRoot: join(bound.workspace, rebuildRuntimeIsolation.processLockRoot) }, async () => undefined, clock, undefined, credentials);
  const reads = vi.spyOn(snapshots, "withReadonlyAuthoritySnapshot");
  try {
    const restored = await restore.restoreNewest(bound.admission.acquireOfflineMaintenance());
    expect(reads.mock.calls.filter(([path]) => path === bound.path)).toHaveLength(3);
    return restored.backupFileName;
  } finally { reads.mockRestore(); }
}

describe("automatic repair with in-session backups", () => {
  it("restores from a newer in-session backup", async () => {
    expect(await restoredFrom("session-newer")).toMatch(/\.session\.sqlite$/u);
  });
  it("restores from a newer shutdown backup", async () => {
    expect(await restoredFrom("shutdown-newer")).toMatch(/\.shutdown\.sqlite$/u);
  });
});
