import { backupHasArchiveTransferCustody } from "../../infra/compat/backup-inspection.js";
import { requireSupportedRecoverySchema } from "../../infra/sqlite/recovery-admission.js";
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, openSync, closeSync, fsyncSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreOptionsSchema, OfflineRestoreFailure } from "../../infra/sqlite/offline-restore.js";
import { OfflineRestoreRequestSchema } from "../../infra/sqlite/recovery-contracts.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { upgradeStorage } from "./upgrade.js";

function syncDirectory(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
/** Explicit old-backup replacement retains suspects and holds stopped admission through conversion.
 * Failures never claim a cross-database rollback; the durable marker blocks ordinary boot. */
export async function restoreHistoricalStorage(optionsInput:z.input<typeof OfflineRestoreOptionsSchema>,
  requestInput:z.input<typeof OfflineRestoreRequestSchema>,environmentFile:string,clock:Clock,
  afterStep?:(step:"restored"|"quarantined"|"converted")=>void) {
  const options=OfflineRestoreOptionsSchema.parse(optionsInput),request=OfflineRestoreRequestSchema.parse(requestInput);
  const root=dirname(options.authorityPath),identity=AuthorityDatabase.sourceDatabaseIdentity(options.authorityPath);
  const verified=await verifyBackupManifestAtPath(request.manifestPath,identity);
  requireSupportedRecoverySchema(verified.manifest.schemaVersion);
  if (backupHasArchiveTransferCustody(verified.backupPath)) throw new Error("paired-lifecycle-backup-required");
  if(verified.manifest.schemaVersion>=CURRENT_AUTHORITY_SCHEMA_VERSION)throw new Error("historical-restore-requires-old-backup");
  const marker=join(root,".archive-restore.json"),binding=canonicalJsonStringify({sourceIdentity:identity,backupSha256:verified.manifest.sha256});
  const admission=acquireRuntimeRestoreAdmission({processLockRoot:options.processLockRoot,pid:process.pid},clock);
  let started=false;
  try {
    const observation=observeRuntimeLockSnapshot({processLockRoot:options.processLockRoot,sourceDatabaseIdentity:identity},clock);
    if(Object.values(observation.processLocks).some(lock=>lock.state==="active"))throw new Error("historical-restore-runtime-active");
    if(existsSync(marker)) {
      if(lstatSync(marker).isSymbolicLink()||!lstatSync(marker).isFile()||readFileSync(marker,"utf8")!==binding)throw new Error("historical-restore-resume-mismatch");
    } else {writeFileSync(marker,binding,{flag:"wx",mode:0o600,flush:true});syncDirectory(root);}
    started=true;
    const borrowed=()=>({...admission,release(){}});
    const report=await new OfflineAuthorityRestoreService(options,async()=>{},clock,undefined,borrowed).restore(request);
    afterStep?.("restored");
    // A pre-lifecycle backup has no independent archive half. Preserve the displaced half,
    // then reconstruct only its authenticated historical sources through the stopped route.
    mkdirSync(options.suspectDirectory,{recursive:true,mode:0o700});
    for(const name of ["archive.sqlite","archive.sqlite-wal","archive.sqlite-shm","archive-files"]) {
      const path=join(root,name);if(!existsSync(path))continue;
      if(lstatSync(path).isSymbolicLink())throw new Error("historical-restore-symlink");
      renameSync(path,join(options.suspectDirectory,`${name}.${randomUUID()}`));
    }
    syncDirectory(root);syncDirectory(options.suspectDirectory);afterStep?.("quarantined");
    const upgrade=await upgradeStorage({stateRoot:root,processLockRoot:options.processLockRoot,environmentFile,plan:false,backupManifest:verified.manifestPath},clock,borrowed);
    afterStep?.("converted");
    unlinkSync(marker);syncDirectory(root);
    return {report,upgrade};
  }catch(error){if(!started)throw error;throw new OfflineRestoreFailure("authority-state-uncertain","historical-restore-incomplete; resume the exact selected backup",error);}
  finally{admission.release();}
}
