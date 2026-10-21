import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { openAuthorityBackupSourceReadOnly, inspectAuthorityBackupReadOnly } from "../sqlite/backup-inspection.js";
import { requireDatabaseSourcePath } from "../sqlite/recovery-admission.js";
import { pendingDiagnosticArtifacts } from "../artifacts/content-addressed-artifact-writer.js";
import { readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot, observeProcessIdentity, RestoreAdmissionFileSchema, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";

export const StorageUpgradeReportSchema = z.strictObject({
  state: z.enum(["planned", "initialized", "upgraded", "already-upgraded"]),
  fromSchemaVersion: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]),
  toSchemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  credentials: z.literal("unchanged"),
  diagnostics: z.strictObject({ reclaimedStages: z.number().int().nonnegative(), retainedStages: z.number().int().nonnegative(), capacityWarning: z.boolean() }).optional(),
});
export type StorageUpgradeReport = z.infer<typeof StorageUpgradeReportSchema>;
export interface StorageUpgradeInput {
  readonly stateRoot: string;
  readonly processLockRoot: string;
  readonly plan: boolean;
}
function requireStopped(admission:RuntimeAdmission,input:StorageUpgradeInput,clock:Clock):void {
  admission.assertExclusive();
  const snapshot=observeRuntimeLockSnapshot({processLockRoot:input.processLockRoot,
    sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(join(input.stateRoot,"state.db"))},clock);
  if(Object.values(snapshot.processLocks).some(lock=>lock.state==="active"))throw new Error("runtime-active: stop server, workers and geocode before storage upgrade");
}
export async function backupStoppedAuthority(admission:RuntimeAdmission,stateRoot:string,clock:Clock,processLockRoot:string,heldRestore?:RestoreAdmissionHandle) {
  requireRuntimeAdmission(admission).assertExclusive();admission.assertStateRoot(stateRoot);
  const input={stateRoot,processLockRoot,plan:false};
  requireStopped(admission,input,clock);
  const restore=heldRestore??acquireRuntimeRestoreAdmission({processLockRoot:input.processLockRoot,pid:process.pid},clock);
  const verifyHeld=()=>{const path=join(processLockRoot,"restore-admission.lock.json"),stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o777)!==0o600)throw new Error("restore-admission-invalid");
    const record=RestoreAdmissionFileSchema.parse(JSON.parse(readFileSync(path,"utf8"))),identity=observeProcessIdentity(process.pid);
    if(record.schemaVersion!==2||record.admissionId!==restore.admissionId||record.pid!==process.pid||identity.state!=="alive"||record.processIdentity.platform!==identity.identity.platform||record.processIdentity.startToken!==identity.identity.startToken)throw new Error("restore-admission-identity-mismatch");};
  verifyHeld();
  try {
    requireStopped(admission,input,clock);
    const schemaVersion=AuthorityDatabase.inspectStoppedUpgrade(admission,join(stateRoot,"state.db"),processLockRoot,clock).schemaVersion;
    const source=openAuthorityBackupSourceReadOnly(admission,join(stateRoot,"state.db"),250,schemaVersion);
    try {const report=await new AuthorityBackupService(admission,source,{directory:join(stateRoot,"backups","authority")},clock)
      .request({trigger:"operator",requiredGeneration:source.getMeta().authorityGeneration});verifyHeld();requireStopped(admission,input,clock);return report;
    }finally{source.close();}
  }finally{if(heldRestore===undefined)restore.release();}
}
export async function upgradeStorage(admission:RuntimeAdmission,input:StorageUpgradeInput,clock:Clock,
  acquireAdmission=acquireRuntimeRestoreAdmission):Promise<StorageUpgradeReport> {
  const sourceAdmission = admission;
  requireRuntimeAdmission(admission).assertStateRoot(input.stateRoot);
  const path=join(input.stateRoot,"state.db");admission.assertAuthorityDatabase(path);requireDatabaseSourcePath(path);
  requireStopped(admission,input,clock);
  const inspection=existsSync(path)?AuthorityDatabase.inspectStoppedUpgrade(admission,path,input.processLockRoot,clock):undefined;
  if (inspection !== undefined && admission.isProfileInitialization() && readProfileDatabaseBinding(path).state === "unbound") admission = sourceAdmission.forStoppedProfileUpgrade();
  try {
  const report=(state:StorageUpgradeReport["state"])=>StorageUpgradeReportSchema.parse({state,
    fromSchemaVersion:inspection?.schemaVersion??0,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  if(input.plan)return report("planned");
  const restore=acquireAdmission({processLockRoot:input.processLockRoot,pid:process.pid},clock);
  try {
    requireStopped(admission,input,clock);
    if(inspection!==undefined){const again=AuthorityDatabase.inspectStoppedUpgrade(admission,path,input.processLockRoot,clock);
      if(again.authorityGeneration!==inspection.authorityGeneration||again.authorityContentFingerprint!==inspection.authorityContentFingerprint)throw new Error("source-changed: re-plan upgrade");
      if (inspection.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
        const backupReport=await backupStoppedAuthority(admission,input.stateRoot,clock,input.processLockRoot,restore);
        const manifest=backupReport.manifests.at(-1);
        if(manifest===undefined)throw new Error("upgrade-verified-backup-required");
        const backup=await verifyBackupManifestAtPath(admission,join(input.stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`),AuthorityDatabase.sourceDatabaseIdentity(path));
        AuthorityDatabase.upgradeStopped(admission,path,input.processLockRoot,clock,inspection.authorityContentFingerprint,backup);
        requireStopped(admission,input,clock);
        inspectAuthorityBackupReadOnly(admission,path);
        return report("upgraded");
      }
      const pending = pendingDiagnosticArtifacts(admission);
      if (pending.length === 0) return report("already-upgraded");
      const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "diagnostic-maintenance" }, clock);
      let reclaimedStages: number;
      try { reclaimedStages = database.reclaimPendingDiagnostics(); } finally { database.close(); }
      requireStopped(admission,input,clock);
      const final = inspectAuthorityBackupReadOnly(admission,path);
      if (final.authorityGeneration !== inspection.authorityGeneration || final.authorityContentFingerprint !== inspection.authorityContentFingerprint) throw new Error("source-changed: diagnostic maintenance authority changed");
      const retainedStages = pendingDiagnosticArtifacts(admission).length;
      return StorageUpgradeReportSchema.parse({ ...report("already-upgraded"), diagnostics: {
        reclaimedStages, retainedStages, capacityWarning: retainedStages > 0,
      } });}
    if(existsSync(path))throw new Error("source-changed: re-plan upgrade");
    AuthorityDatabase.initializeProfile(admission, clock);
    return report("initialized");
  }finally{restore.release();}
  } finally { if (admission !== sourceAdmission) admission.release(); }
}
