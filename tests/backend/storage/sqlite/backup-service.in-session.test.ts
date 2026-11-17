import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { AuthorityBackupService, verifyBackupManifestAtPath, type AuthorityBackupSource } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { copyAuthorityOffThread } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function liveStore() {
  const bound = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250, migrationOwner: "in-session-backup" },
    undefined, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
  cleanups.push(async () => { database.close(); await bound.close(); });
  return { bound, database, directory: join(bound.stateRoot, "backups", "authority"), clock: capturedInstantClock(NOW) };
}

function commitChange(database: AuthorityDatabase): void {
  const at = NOW, occurrence = database.getMeta().authorityGeneration + 1;
  database.withAuthorityTransaction(repositories => repositories.notificationHealth.put({ concern: "disk-space", active: true, occurrence, samples: [], observedAt: at, createdAt: at }));
}

describe("in-session authority backup", () => {
  it("writes a .session backup and manifest that verify against the live profile", async () => {
    const { bound, database, directory, clock } = await liveStore();
    const source: AuthorityBackupSource = { getMeta: () => database.getMeta(), getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      onlineBackupTo: async destination => { await copyAuthorityOffThread(bound.admission, bound.path, destination, {}); return 0; } };
    const report = await new AuthorityBackupService(bound.admission, source, { directory, purpose: "in-session" }, clock)
      .request({ trigger: "interval", requiredGeneration: database.getMeta().authorityGeneration });
    const manifest = report.manifests.at(-1)!;
    expect(manifest.backupFileName).toMatch(/\.session\.sqlite$/u);
    const verified = await verifyBackupManifestAtPath(bound.admission, join(directory, `${manifest.backupFileName}.manifest.json`));
    expect(verified.manifest.authorityGeneration).toBe(database.getMeta().authorityGeneration);
    expect(readdirSync(directory).filter(name => name.startsWith("."))).toEqual([]);
    expect(inspectAuthorityBackupReadOnly(bound.admission, join(directory, manifest.backupFileName)).authorityGeneration).toBe(manifest.authorityGeneration);
  });

  it("is not failed by a commit on the live database after its copy", async () => {
    const { bound, database, directory, clock } = await liveStore();
    const copied = database.getMeta();
    let snapshot = copied;
    const source: AuthorityBackupSource = { getMeta: () => snapshot, getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      onlineBackupTo: async destination => {
        snapshot = database.getMeta();
        await copyAuthorityOffThread(bound.admission, bound.path, destination, {});
        commitChange(database);
        return 0;
      } };
    const report = await new AuthorityBackupService(bound.admission, source, { directory, purpose: "in-session" }, clock)
      .request({ trigger: "interval", requiredGeneration: copied.authorityGeneration });
    expect(database.getMeta().authorityGeneration).toBe(copied.authorityGeneration + 1);
    expect(report.state).toBe("verified");
    expect(existsSync(join(directory, report.manifests.at(-1)!.backupFileName))).toBe(true);
  });
});
