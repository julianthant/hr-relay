import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

it("refuses a foreign physical origin even with matching profile UUIDs before staging", async () => {
  const f = await createBoundProfileFixture();
  try {
    const directory = join(f.stateRoot, "backups", "authority");
    const database = AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"backup-origin-refusal"},systemClock,
      undefined,undefined,undefined,boundProfileCredentials(f.admission));
    let manifestPath: string;
    try {
      const report = await new AuthorityBackupService(f.admission,database,{directory},systemClock)
        .request({trigger:"operator",requiredGeneration:database.getMeta().authorityGeneration});
      const manifest = report.manifests[0]; assert.ok(manifest);
      manifestPath = join(directory,manifest.backupFileName+".manifest.json");
    } finally { database.close(); }
    const original = AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(manifestPath,"utf8")));
    const foreign = AuthorityBackupManifestSchema.parse({...original,sourceDatabaseIdentity:"f".repeat(64)});
    assert.equal(foreign.installationId,f.admission.profileBinding.installationId);
    assert.equal(foreign.profileId,f.admission.profileBinding.profileId);
    writeFileSync(manifestPath,JSON.stringify(foreign),{mode:0o600});
    const processLockRoot = join(f.workspace,rebuildRuntimeIsolation.processLockRoot);
    const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
    const proofs = new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},systemClock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:identity},systemClock));
    const stoppedSystemProof = proofs.issue({observedBy:"local-operator",sourceDatabaseIdentity:identity});
    const suspects = join(f.stateRoot,"backups","suspects");
    const before = storageTree(f.workspace), bytes = readFileSync(f.path);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure,f.admission,{authorityPath:f.path,suspectDirectory:suspects,
      busyTimeoutMs:250,processLockRoot,stoppedProofMaxAgeMs:60_000},async()=>{},systemClock,undefined,undefined,boundProfileCredentials(f.admission));
    await assert.rejects(restore.restore({manifestPath,stoppedSystemProof}),/different authority database/u);
    assert.deepEqual(readFileSync(f.path),bytes);
    assert.deepEqual(storageTree(f.workspace),before);
    assert.equal(existsSync(suspects),false);
    assert.equal(existsSync(join(f.workspace,".tracker","control","journal.json")),false);
    assert.equal(existsSync(join(processLockRoot,"restore-admission.lock.json")),false);
    f.admission.assertProfileRuntime();
  } finally { await f.close(); }
});
