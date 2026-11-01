import { assertOfflineMaintenanceForProcessRoot } from "../admission/installation.js";
import { type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../source-closure.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath, verifyStoppedBackupManifestAtPath, type VerifiedBackup } from "../sqlite/backup-service.js";
import { openAuthorityBackupSourceReadOnly, inspectAuthorityBackupReadOnly } from "../sqlite/backup-inspection.js";
import { requireDatabaseSourcePath } from "../sqlite/recovery-admission.js";
import { pendingDiagnosticArtifacts } from "../artifacts/content-addressed-artifact-writer.js";
import { readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, deriveAuthorityUpgradePlanDigest } from "../sqlite/migrations.js";
import { type RuntimeAdmission, type RegisteredProfileStorageClaim } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { prepareStoppedBackupClosure, assertStoppedBackupClosure, StorageBackupClosureUnprovedError, type StoppedBackupClosure, readStoppedProfileUpgradeInventory, type ProfileBrowserClosure } from "./profile-inventory.js";



export const StorageUpgradeReportSchema = z.strictObject({
  state: z.enum(["planned", "initialized", "upgraded", "already-upgraded"]),
  fromSchemaVersion: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]),
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
function requireStopped(admission:RuntimeAdmission,input:StorageUpgradeInput,_clock:Clock,backup=false):void {
  if (backup) admission.assertStoppedAuthorityBackup(join(input.stateRoot,"state.db"),input.processLockRoot);
  else admission.assertStoppedProfileUpgrade(join(input.stateRoot,"state.db"),input.processLockRoot);
  const operation = admission.maintenanceOperation();
  admission.assertOfflineMaintenance(operation);
  assertOfflineMaintenanceForProcessRoot(operation, input.processLockRoot);
}
export async function backupStoppedAuthority(closure: StoppedBackupClosure, admission:RuntimeAdmission,stateRoot:string,clock:Clock,processLockRoot:string,restore:OfflineMaintenanceOperation) {
  requireRuntimeAdmission(admission).assertStoppedAuthorityBackup(join(stateRoot,"state.db"),processLockRoot);admission.assertStateRoot(stateRoot);
  const input={stateRoot,processLockRoot,plan:false};
  requireStopped(admission,input,clock,true);
  assertStoppedBackupClosure(closure, admission, restore);
  const verifyHeld=()=>{ admission.assertOfflineMaintenance(restore); assertOfflineMaintenanceForProcessRoot(restore,processLockRoot); assertStoppedBackupClosure(closure,admission,restore); };
  let operationFailure: { error: unknown } | undefined;
  let result: Awaited<ReturnType<AuthorityBackupService["request"]>> | undefined;
  try {
    verifyHeld();
    requireStopped(admission,input,clock,true);
    const schemaVersion=AuthorityDatabase.inspectStoppedUpgrade(admission,join(stateRoot,"state.db"),processLockRoot,clock).schemaVersion;
    const source=openAuthorityBackupSourceReadOnly(admission,join(stateRoot,"state.db"),250,schemaVersion);
    let report: Awaited<ReturnType<AuthorityBackupService["request"]>> | undefined;
    let primary: { error: unknown } | undefined;
    try {report=await new AuthorityBackupService(admission,source,{directory:join(stateRoot,"backups","authority")},clock)
      .request({trigger:"operator",requiredGeneration:source.getMeta().authorityGeneration});verifyHeld();requireStopped(admission,input,clock,true);
    }catch(error){primary={error};}
    const failures: unknown[] = [];
    try{source.close();}catch(error){failures.push(error);}
    if(failures.length===0)try{verifyHeld();}catch(error){failures.push(error);}
    if(failures.length!==0){
      const errors=primary===undefined?failures:[primary.error,...failures];
      if(errors.some(error=>hasUnprovedSourceClosure(error)))throw retainAuthoritySourceClosure(errors,{backupSource:source,admission,restore});
      if(errors.length===1)throw errors[0];
      throw new AggregateError(errors,"authority-backup-source-close-failed",{cause:errors[0]});
    }
    if(primary!==undefined)throw primary.error;
    if(report===undefined)throw new Error("upgrade-backup-result-unavailable");
    result=report;
  }catch(error){operationFailure={error};}
  if(operationFailure !== undefined && hasUnprovedSourceClosure(operationFailure.error))throw retainAuthoritySourceClosure([operationFailure.error],{restore,admission});
  if(operationFailure!==undefined)throw operationFailure.error;
  if(result===undefined)throw new Error("authority-backup-result-missing");
  return result;
}

export async function upgradeStorage(browserClosure: ProfileBrowserClosure, admission:RuntimeAdmission,input:StorageUpgradeInput,clock:Clock,
  restore:OfflineMaintenanceOperation):Promise<StorageUpgradeReport> {
  const sourceAdmission = admission;
  admission.assertOfflineMaintenance(restore); restore.consume();
  const path=join(input.stateRoot,"state.db");
  let inspection: ReturnType<typeof AuthorityDatabase.inspectStoppedUpgrade> | undefined;
  let result: StorageUpgradeReport | undefined;
  let primary: { error: unknown } | undefined;
  try {
  requireRuntimeAdmission(admission).assertStateRoot(input.stateRoot);
  admission.assertAuthorityDatabase(path);requireDatabaseSourcePath(path);
  requireStopped(admission,input,clock);
  inspection=existsSync(path)?AuthorityDatabase.inspectStoppedUpgrade(admission,path,input.processLockRoot,clock):undefined;
  if (inspection !== undefined && admission.isProfileInitialization() && readProfileDatabaseBinding(path).state === "unbound") admission = sourceAdmission.forStoppedProfileUpgrade();
  result = await (async () => {
  const report=(state:StorageUpgradeReport["state"])=>StorageUpgradeReportSchema.parse({state,
    fromSchemaVersion:inspection?.schemaVersion??0,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  if(input.plan)return report("planned");
  admission.assertOfflineMaintenance(restore);
    requireStopped(admission,input,clock);
    if(inspection!==undefined){const again=AuthorityDatabase.inspectStoppedUpgrade(admission,path,input.processLockRoot,clock);
      if(again.authorityGeneration!==inspection.authorityGeneration||again.authorityContentFingerprint!==inspection.authorityContentFingerprint)throw new Error("source-changed: re-plan upgrade");
      if (inspection.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
        const closure = await prepareStoppedBackupClosure(browserClosure, admission, restore, clock, input.processLockRoot);
        const backupReport=await backupStoppedAuthority(closure, admission,input.stateRoot,clock,input.processLockRoot,restore);
        const manifest=backupReport.manifests.at(-1);
        if(manifest===undefined)throw new Error("upgrade-verified-backup-required");
        const backup=await verifyBackupManifestAtPath(admission,join(input.stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`),AuthorityDatabase.sourceDatabaseIdentity(path));
        AuthorityDatabase.upgradeStopped(admission,path,input.processLockRoot,clock,inspection.authorityContentFingerprint,backup,verifyStoppedBackupManifestAtPath);
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
  })();
  } catch (error) { primary = { error }; }
  if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) throw retainAuthoritySourceClosure([primary.error], {
    admission, restore,
  });
  const failures: unknown[] = [];
  try { if (admission !== sourceAdmission) admission.release(); } catch (error) { failures.push(error); }
  if (failures.length !== 0) throw retainAuthoritySourceClosure(primary === undefined ? failures : [primary.error, ...failures], {
    admission, restore,
  });
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error('storage-upgrade-result-unavailable');
  return result;
}

type ReadyUpgradeInventory = ReturnType<typeof readStoppedProfileUpgradeInventory>;

function assertReadyUpgradeInventory(before: ReadyUpgradeInventory, after: ReadyUpgradeInventory, path: string,
  publication: Readonly<{ kind: "unchanged" }> | Readonly<{ kind: "upgraded"; sourceFingerprint: string; sourceSchemaVersion: number }>, backup?: VerifiedBackup): void {
  if (before.operationId !== after.operationId) throw new Error("profile-stopped-upgrade-operation-changed");
  const { upgrades: priorUpgrades, ...priorFacts } = before.facts;
  const { upgrades: nextUpgrades, ...nextFacts } = after.facts;
  if (canonicalJsonStringify(priorFacts) !== canonicalJsonStringify(nextFacts)) throw new Error("profile-stopped-upgrade-resources-changed");
  if (publication.kind === "unchanged") {
    if (canonicalJsonStringify(priorUpgrades) !== canonicalJsonStringify(nextUpgrades)) throw new Error("profile-stopped-upgrade-journal-changed");
  } else {
    const added = nextUpgrades.at(-1);
    if (backup === undefined || nextUpgrades.length !== priorUpgrades.length + 1
      || canonicalJsonStringify(nextUpgrades.slice(0, -1)) !== canonicalJsonStringify(priorUpgrades)
      || added?.phase !== "settled" || added.fromSchemaVersion !== publication.sourceSchemaVersion || added.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION
      || added.upgradeId !== publication.sourceFingerprint || added.planDigest !== deriveAuthorityUpgradePlanDigest(publication.sourceSchemaVersion, publication.sourceFingerprint)
      || added.backup.manifestPath !== backup.manifestPath || added.backup.sha256 !== backup.manifest.sha256
      || added.backup.authorityGeneration !== backup.manifest.authorityGeneration) throw new Error("profile-stopped-upgrade-publication-unproved");
  }
  const sourcePaths = new Set([path, `${path}-wal`, `${path}-shm`]);
  const allowed = new Set(backup === undefined ? [] : [backup.backupPath, backup.manifestPath, join(dirname(path), "backups"), join(dirname(path), "backups", "authority")]);
  const publishedDirectories = new Set([dirname(path), join(dirname(path), "backups"), join(dirname(path), "backups", "authority")]);
  const directoryIdentity = (entry: ReadyUpgradeInventory["membership"]["identities"][number]) => ({ path: entry.path, device: entry.device, inode: entry.inode, mode: entry.mode });
  for (const entry of before.membership.identities) {
    if (publication.kind === "upgraded" && sourcePaths.has(entry.path)) continue;
    const current = after.membership.identities.find(value => value.path === entry.path);
    if (current === undefined || canonicalJsonStringify(entry.directory && publishedDirectories.has(entry.path) ? directoryIdentity(entry) : entry)
      !== canonicalJsonStringify(current.directory && publishedDirectories.has(current.path) ? directoryIdentity(current) : current)) throw new Error("profile-stopped-upgrade-copy-changed");
  }
  if (after.membership.identities.some(entry => !before.membership.identities.some(prior => prior.path === entry.path)
    && !allowed.has(entry.path) && !(publication.kind === "upgraded" && sourcePaths.has(entry.path)))) throw new Error("profile-stopped-upgrade-copy-membership-changed");
}

export async function upgradeReadyProfileStorage(browserClosure: ProfileBrowserClosure, machine: RuntimeAdmission, claim: RegisteredProfileStorageClaim,
  input: Readonly<{ plan: boolean; hostFacts: HostConfigFacts }>, clock: Clock): Promise<StorageUpgradeReport> {
  requireRuntimeAdmission(machine).assertExclusive();
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("profile-stopped-upgrade-installation-required");
  const processLockRoot = resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  machine.assertFixedProcessLockRoot(context.workspace, processLockRoot);
  const restore = machine.acquireOfflineMaintenance();
  restore.consume();
  let admission: RuntimeAdmission | undefined;
  let result: StorageUpgradeReport | undefined;
  let primary: { error: unknown } | undefined;
  try {
    admission = await machine.forStoppedProfileUpgrade(browserClosure, claim, restore, clock, input.hostFacts);
    result = await runReadyProfileUpgrade(browserClosure, machine, admission, processLockRoot, restore, input, clock);
  } catch (error) { primary = { error }; }
  if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) throw retainAuthoritySourceClosure([primary.error], { ...(admission === undefined ? {} : { admission }), restore });
  const failures: unknown[] = [];
  try { admission?.release(); } catch (error) { failures.push(error); }
  try { restore.release(); } catch (error) { failures.push(error); }
  if (failures.length !== 0) throw retainAuthoritySourceClosure(primary === undefined ? failures : [primary.error, ...failures], { ...(admission === undefined ? {} : { admission }), restore });
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("profile-stopped-upgrade-result-unavailable");
  return result;
}

async function runReadyProfileUpgrade(browserClosure: ProfileBrowserClosure, machine: RuntimeAdmission, owner: RuntimeAdmission, processLockRoot: string,
  restore: OfflineMaintenanceOperation, input: Readonly<{ plan: boolean; hostFacts: HostConfigFacts }>, clock: Clock): Promise<StorageUpgradeReport> {
  const path = join(owner.stateRoot, "state.db");
  const inspect = () => AuthorityDatabase.inspectStoppedUpgrade(owner, path, processLockRoot, clock);
  const inspectInventory = () => readStoppedProfileUpgradeInventory({ machine, admission: owner, hostFacts: input.hostFacts, clock, browserClosure });
  const initial = inspect();
  const closure = !input.plan && [8, 9, 10].includes(initial.schemaVersion)
    ? await prepareStoppedBackupClosure(browserClosure, owner, restore, clock, processLockRoot) : undefined;
  let inventory = inspectInventory();
  const revalidate = (backup?: VerifiedBackup) => {
    owner.assertReadyStoppedProfileUpgradeOwner(machine);
    const current = inspect();
    if (current.schemaVersion !== initial.schemaVersion || current.authorityGeneration !== initial.authorityGeneration
      || current.authorityContentFingerprint !== initial.authorityContentFingerprint) throw new Error("source-changed: re-plan upgrade");
    const currentInventory = inspectInventory();
    assertReadyUpgradeInventory(inventory, currentInventory, path, { kind: "unchanged" }, backup);
    return currentInventory;
  };
  revalidate();
  const report = (state: StorageUpgradeReport["state"]) => StorageUpgradeReportSchema.parse({ state,
    fromSchemaVersion: initial.schemaVersion, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
  if (input.plan) return report("planned");
  if (initial.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) return report("already-upgraded");
  if (![8, 9, 10].includes(initial.schemaVersion)) throw new Error("profile-stopped-upgrade-version-refused");
  if (closure === undefined) throw new StorageBackupClosureUnprovedError();
  const backed = await backupStoppedAuthority(closure, owner, owner.stateRoot, clock, processLockRoot, restore);
  if (backed.manifests.length !== 1) throw new Error("profile-stopped-upgrade-single-backup-required");
  const manifest = backed.manifests[0];
  if (manifest === undefined) throw new Error("upgrade-verified-backup-required");
  const manifestPath = join(owner.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`);
  const produced = verifyStoppedBackupManifestAtPath(owner, manifestPath, AuthorityDatabase.sourceDatabaseIdentity(path));
  inventory = revalidate(produced);
  const verified = await verifyBackupManifestAtPath(owner, manifestPath, AuthorityDatabase.sourceDatabaseIdentity(path));
  revalidate(verified);
  AuthorityDatabase.upgradeStopped(owner, path, processLockRoot, clock, initial.authorityContentFingerprint, verified, verifyStoppedBackupManifestAtPath);
  const current = inspect();
  if (current.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || current.authorityGeneration !== initial.authorityGeneration
    || current.installationId !== owner.profileBinding.installationId || current.profileId !== owner.profileBinding.profileId) throw new Error("profile-stopped-upgrade-readback-unproved");
  assertReadyUpgradeInventory(inventory, inspectInventory(), path,
    { kind: "upgraded", sourceFingerprint: initial.authorityContentFingerprint, sourceSchemaVersion: initial.schemaVersion }, verified);
  return report("upgraded");
}

type StoppedMachineControl = ReturnType<RuntimeAdmission["beginStoppedMachineControlUpgrade"]>;

export async function upgradeStoppedMachineControl(machine: RuntimeAdmission, input: Readonly<{ plan: boolean; hostFacts: HostConfigFacts }>, clock: Clock,
  composeInventory: (input: Readonly<{ claim: ReturnType<StoppedMachineControl["profileInventory"]>; hostFacts: HostConfigFacts; clock: Clock }>) => { readonly proof: Parameters<StoppedMachineControl["recordProfileInventory"]>[1]; dispose(): void }) {
  requireRuntimeAdmission(machine).assertExclusive();
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("profile-control-upgrade-machine-membership-unknown");
  const processLockRoot = resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  machine.assertFixedProcessLockRoot(context.workspace, processLockRoot);
  const restore = machine.maintenanceOperation();
  restore.consume();
  const ownsRestore = false;
  let control: ReturnType<RuntimeAdmission["beginStoppedMachineControlUpgrade"]> | undefined;
  const inventories: Array<{ dispose(): void }> = [];
  let result: ReturnType<StoppedMachineControl["run"]> | undefined;
  let primary: { error: unknown } | undefined;
  try {
    control = machine.beginStoppedMachineControlUpgrade(restore);
    if (!control.machineControlCurrent() || control.upgradeIntentPresent()) {
      for (const profileId of control.registeredProfileIds()) {
        const claim = control.profileInventory(profileId);
        const inventory = composeInventory({ claim, hostFacts: input.hostFacts, clock });
        inventories.push(inventory);
        control.recordProfileInventory(claim, inventory.proof);
      }
    }
    const report = control.run(input.plan);
    if (!input.plan && report.state === "upgraded") {
      const readback = control.run(false);
      if (readback.state !== "current" || readback.profileCount !== report.profileCount || readback.runtimeAccess !== report.runtimeAccess) throw new Error("profile-control-upgrade-readback-failed");
    }
    result = report;
  } catch (error) { primary = { error }; }
  releaseStoppedMachineControlUpgrade(control, restore, ownsRestore, { primary, inventories, admission: machine });
  if (result === undefined) throw new Error("profile-control-upgrade-readback-failed");
  return result;
}

export function releaseStoppedMachineControlUpgrade(control: { release(): void } | undefined, restore: OfflineMaintenanceOperation, ownsRestore: boolean,
  held: Readonly<{ primary?: { readonly error: unknown }; inventories?: readonly { dispose(): void }[]; admission?: RuntimeAdmission }> = {}): void {
  const retain = (errors: readonly unknown[]): never => {
    throw retainAuthoritySourceClosure(errors, { restore, admission: { admission: held.admission, control, inventories: held.inventories } });
  };
  if (held.primary !== undefined && hasUnprovedSourceClosure(held.primary.error)) retain([held.primary.error]);
  try { control?.release(); }
  catch (error) { retain(held.primary === undefined ? [error] : [held.primary.error, error]); }
  for (const inventory of held.inventories ?? []) {
    try { inventory.dispose(); }
    catch (error) { retain(held.primary === undefined ? [error] : [held.primary.error, error]); }
  }
  if (ownsRestore) {
    try { restore.release(); }
    catch (error) { retain(held.primary === undefined ? [error] : [held.primary.error, error]); }
  }
  if (held.primary !== undefined) throw held.primary.error;
}
