import { createHash } from "node:crypto";
import { copyFileSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,expect,it } from "vitest";
import { acquireExclusiveRuntimeAdmission,type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService,verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { validateStorageRelocationRestoreCandidate } from "../../../../src/backend/storage/sqlite/relocation-restore-candidate.js";
import { FingerprintSchema,PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { cleanupFixtureRoots,clock,installation,plan,relocate } from "../../../support/helpers/storage/storage-relocation-fixture.js";

afterEach(cleanupFixtureRoots);

async function backup(admission: RuntimeAdmission) {
  const path = join(admission.stateRoot,"state.db");
  const directory = join(admission.stateRoot,"backups","authority");
  const database = AuthorityDatabase.open(admission,{path,busyTimeoutMs:250,migrationOwner:"relocation-candidate-fixture"},clock);
  try {
    const report = await new AuthorityBackupService(admission,database,{directory},clock).request({
      trigger:"operator",requiredGeneration:database.getMeta().authorityGeneration});
    const manifest = report.manifests.at(-1);
    if(manifest === undefined) throw new Error("fixture native backup missing");
    return await verifyBackupManifestAtPath(admission,join(directory,manifest.backupFileName+".manifest.json"),
      AuthorityDatabase.sourceDatabaseIdentity(path));
  } finally {database.close();}
}

it("requires the entire receipt-backed plan history and activation snapshot in a moved restore candidate", async () => {
  const f = await installation();
  const initial = acquireExclusiveRuntimeAdmission(f.workspace, f.lifetime);
  try {
    const withoutRelocation = await backup(initial);
    expect(validateStorageRelocationRestoreCandidate({admission:initial,activeAuthorityPath:f.authorityPath,
      verifiedBackup:withoutRelocation})).toBeUndefined();
  } finally {initial.release();}
  const firstDestination = {stateRoot:join(f.root,"moved-state"),artifactRoot:join(f.root,"first-artifacts")};
  const firstPlan = plan(f.workspace, f.lifetime,firstDestination);
  await relocate(f.workspace, f.lifetime,firstPlan.commandId);
  const first = acquireExclusiveRuntimeAdmission(f.workspace, f.lifetime);
  let withoutHistory: Awaited<ReturnType<typeof backup>>;
  try {withoutHistory = await backup(first);} finally {first.release();}
  const destination = {stateRoot:firstDestination.stateRoot,artifactRoot:join(f.root,"second-artifacts")};
  const secondPlan = plan(f.workspace, f.lifetime,destination);
  const planned = acquireExclusiveRuntimeAdmission(f.workspace, f.lifetime);
  let withoutSnapshot: Awaited<ReturnType<typeof backup>>;
  try {withoutSnapshot = await backup(planned);} finally {planned.release();}
  await relocate(f.workspace, f.lifetime,secondPlan.commandId);
  const active = acquireExclusiveRuntimeAdmission(f.workspace, f.lifetime);
  const path = join(active.stateRoot,"state.db");
  try {
    const complete = await backup(active);
    expect(() => validateStorageRelocationRestoreCandidate({admission:active,activeAuthorityPath:path,
      verifiedBackup:withoutHistory})).toThrow(/activation receipt has no matching plan command/u);
    expect(() => validateStorageRelocationRestoreCandidate({admission:active,activeAuthorityPath:path,
      verifiedBackup:withoutSnapshot})).toThrow(/activation snapshot missing/u);
    expect(() => validateStorageRelocationRestoreCandidate({admission:active,
      activeAuthorityPath:join(f.root,"former","state.db"),verifiedBackup:complete}))
      .toThrow(/active authority path differs from locator/u);
    expect(validateStorageRelocationRestoreCandidate({admission:active,activeAuthorityPath:path,
      verifiedBackup:complete})).toMatchObject({revision:2,sourceGeneration:2,pending:null});
    const snapshotId = active.readInstallationContext()?.receipts.at(-1)?.evidence.configSnapshotId;
    expect(snapshotId).toBeDefined();
    const tamperedPath = join(active.stateRoot,"backups","authority","tampered.sqlite");
    copyFileSync(complete.backupPath,tamperedPath);
    const raw = new DatabaseSync(tamperedPath);
    try {
      const row = raw.prepare("SELECT payload_json FROM settings_snapshots WHERE id=?").get(String(snapshotId));
      if(typeof row?.payload_json !== "string") throw new Error("fixture activation snapshot missing");
      const snapshot = JSON.parse(row.payload_json) as {config:{paths:Record<string,unknown>}};
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
      for(const trigger of triggers) raw.exec("DROP TRIGGER "+String(trigger.name));
      try {
        raw.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?").run(JSON.stringify({...snapshot,
          config:{...snapshot.config,paths:{...snapshot.config.paths,reportsDir:join(f.root,"tampered")}}}),String(snapshotId));
      } finally {for(const trigger of triggers) raw.exec(String(trigger.sql));}
    } finally {raw.close();}
    const bytes = readFileSync(tamperedPath);
    const sha256 = FingerprintSchema.parse(createHash("sha256").update(bytes).digest("hex"));
    expect(() => validateStorageRelocationRestoreCandidate({admission:active,activeAuthorityPath:path,
      verifiedBackup:{...complete,backupPath:tamperedPath,manifest:{...complete.manifest,sha256,byteSize:PositiveIntSchema.parse(bytes.length)}}}))
      .toThrow(/config-snapshot-fingerprint-mismatch/u);
  } finally {active.release();}
});
