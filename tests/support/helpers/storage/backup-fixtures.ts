import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { UnboundPredecessorBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";

import { AuthorityBackupService, verifyBackupBytesAtPath, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../admission-fixture.js";

import type { Clock } from "../../../../src/rules/time/clock.js";

export function createBackupFixtures(cleanups: (() => void | Promise<void>)[], CLOCK: Clock) {
  async function openCurrentWorld() {
    const profile = await createBoundProfileFixture();
    let database: AuthorityDatabase | undefined = undefined;
    let openingFailure: AuthoritySourceClosureUnprovedError | undefined = undefined;
    let cleanupFailure: { error: unknown } | undefined = undefined;
    let closure: { state: "closed" } | { state: "failed"; error: unknown } | undefined = undefined;
    const closeDatabase = () => {
      if (openingFailure !== undefined) throw openingFailure;
      if (closure?.state === "closed") return;
      if (closure?.state === "failed") throw closure.error;
      try { database?.close(); closure = { state: "closed" }; }
      catch (error) { closure = { state: "failed", error }; throw error; }
    };
    cleanups.push(async () => {
      if (openingFailure !== undefined) throw openingFailure;
      if (cleanupFailure !== undefined) throw cleanupFailure.error;
      try { closeDatabase(); await profile.close(); }
      catch (error) { cleanupFailure = { error }; throw error; }
    });
    const admission = profile.admission, credentials = boundProfileCredentials(admission);
    try {
      database = AuthorityDatabase.open(admission, {
      path: profile.path,
      busyTimeoutMs: 250,
      migrationOwner: "backup-test",
      }, CLOCK, undefined, undefined, undefined, credentials);
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) openingFailure = error;
      throw error;
    }
    return {
      workspace: profile.workspace,
      machine: profile.machine,
      admission,
      credentials,
      stateRoot: profile.stateRoot,
      authorityPath: profile.path,
      database,
      closeDatabase,
      backupDirectory: join(profile.stateRoot, "backups", "authority"),
    };
  }

  async function takeBackup(world: Awaited<ReturnType<typeof openCurrentWorld>>) {
    const service = new AuthorityBackupService(world.admission, world.database, { directory: world.backupDirectory }, CLOCK);
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

export async function inspectUnboundBackupFixture(admission: RuntimeAdmission, manifestPath: string) {
  await assert.rejects(verifyBackupManifestAtPath(admission, manifestPath));
  const manifest = UnboundPredecessorBackupManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  await verifyBackupBytesAtPath(backupPath, manifest);
  const copy = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256);
  try {
    const inspected = inspectAuthorityBackupReadOnly(copy, backupPath, manifest.schemaVersion);
    for (const field of ["applicationId", "schemaVersion", "installationId", "profileId", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
      assert.equal(inspected[field], manifest[field]);
    }
  } finally { copy.release(); }
  return { manifestPath, backupPath, manifest };
}
