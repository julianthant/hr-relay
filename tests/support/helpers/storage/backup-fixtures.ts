import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

import { join } from "node:path";



import { AuthorityBackupService, AuthorityDatabase } from "../synthetic-storage-admission.js";

import type { Clock } from "../../../../src/rules/time/clock.js";

export function createBackupFixtures(temporaryRoot: (prefix: string) => string, databases: AuthorityDatabase[], CLOCK: Clock) {
  function openCurrentWorld() {
    const root = temporaryRoot("hrauto-v3-backup-");
    const stateRoot = join(root, ".tracker");
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const authorityPath = join(stateRoot, "state.db");
    const database = AuthorityDatabase.open({
      path: authorityPath,
      busyTimeoutMs: 250,
      migrationOwner: "backup-test",
    }, CLOCK);
    databases.push(database);
    return {
      stateRoot,
      authorityPath,
      database,
      backupDirectory: join(stateRoot, "backups", "authority"),
    };
  }

  async function takeBackup(world: ReturnType<typeof openCurrentWorld>) {
    const service = new AuthorityBackupService(world.database, { directory: world.backupDirectory }, CLOCK);
    const report = await service.request({
      trigger: "operator",
      requiredGeneration: world.database.getMeta().authorityGeneration,
    });
    const manifest = report.manifests[0];
    assert.ok(manifest !== undefined);
    return {
      report,
      manifest,
      manifestPath: join(world.backupDirectory, `${manifest.backupFileName}.manifest.json`),
    };
  }
  return { openCurrentWorld, takeBackup };
}
