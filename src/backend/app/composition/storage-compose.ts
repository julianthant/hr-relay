import { hasPendingShutdownBackupRetirement, resumeShutdownBackupRetirement } from "../../storage/maintenance/clean-shutdown-backups.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { LogoutOperationSchema,type LogoutOperation } from "../../../models/profiles/profile.js";
import { runClaim } from "../../../models/run/record.js";
import { createChatGptAccountService } from "../../accounts/chatgpt-account-service.js";
import { createAssistantAuthorization } from "../../assistant/authorization.js";
import type { ProfileOnboardingDuoProvider } from "../../profiles/onboarding-duo.js";
import { ProfileSessionRefusedError } from "../../profiles/profile-errors.js";
import { createProfileSession } from "../../profiles/profile-session.js";
import type { CommandKernel } from "../../runs/commands/command-kernel.js";
import { requireLifecycleApplied,RunRecordService } from "../../runs/lifecycle/run-record-service.js";
import { reconcileExitedWorker,reconcileStoppedLogout,reconcileStoppedStartupCrash } from "../../runs/lifecycle/startup-crash-recovery.js";
import { profileBrowserClosure } from "../../runtime/browser/profile-browser-closure.js";
import { activeSettingsConfig,activeSettingsRuntimeIdentity,readBootSettings } from "../../runtime/settings/settings-runtime.js";
import { isOfflineMaintenanceOperationActive,OfflineMaintenanceOperationUnavailableError,offlineMaintenanceWorkspace,RuntimeLifetimeLock,type OfflineMaintenanceOperation } from "../../storage/admission/lifetime-lock.js";
import { readPrivateFile } from "../../storage/configuration/credential-safe-file.js";
import { assertCredentialStoreOwner,createCredentialStore,type CredentialStoreHooks } from "../../storage/configuration/credential-store.js";
import { prepareStoppedBackupClosure,probeRestoreProfileBrowsersClosed,type StoppedBackupClosure } from "../../storage/maintenance/profile-inventory.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure } from "../../storage/source-closure.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../storage/sqlite/migrations.js";
import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { composeProfileSettings } from "./dashboard/settings.js";
import { assertProfileBrowserRoot,composeProfileClosureInventory } from "./profile-credential-inventory.js";

import { randomUUID } from "node:crypto";
import { existsSync,readdirSync } from "node:fs";
import { join,resolve } from "node:path";
import { z } from "zod";
import { SETTINGS_CATALOG } from "../../../models/config/catalog.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";

import { workerPoolMember,type WorkerPoolMember } from "../../../models/run/worker-slot.js";
import { IsoInstantSchema,LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { systemClock,type Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { createRunQueueProjection } from "../../runs/projections/run-queue-projection.js";
import { OfflineSpanRootRepairService,type SpanRootRepairReport } from "../../runs/recovery/span-root-repair.js";
import { createNativeBrowserProbe } from "../../runtime/browser/native-browser.js";
import type { DashboardWorkerProcessSupervisor } from "../../runtime/workers/worker-supervisor.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import { acquireRecoveryRuntimeRestore,RuntimeAdmission as StorageAdmission,type RuntimeAdmission } from "../../storage/admission/admission.js";
import { AuthorityDatabase,doctorAuthorityStorage,OfflineAuthorityRestoreService,summarizeSpanAuthorityReconciliation } from "../../storage/sqlite/index.js";

import { resumeAutomaticAuthorityRestore } from "../../storage/sqlite/offline-restore.js";
import { type StorageDoctorReport } from "../../storage/sqlite/recovery-contracts.js";
import { createTransactionHistory } from "../../storage/sqlite/transaction-history.js";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { DESCRIPTORS,descriptorSetHash,SERVER_REGISTRY } from "../registries/workflow-registry.js";

import { lstatSync } from "node:fs";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { recoverFixedLayoutPublication,withDefaultLayoutSource,type FixedLayoutPublication } from "../../storage/admission/installation.js";
import { file as layoutFile,hash as layoutHash } from "../../storage/maintenance/existing-data-backup-files.js";
import { activateFixedLayoutProfiles,assertFixedLayoutSourceFence,createFixedLayoutDirectory,fixedLayoutEntries,FixedLayoutIntentSchema,fixedLayoutOutputPaths,readFixedLayoutIntent,type FixedLayoutActivation } from "../../storage/maintenance/fixed-layout.js";



export interface StorageCommandOutcome {
  readonly output: string;
  readonly exitCode: number;
}

async function withStoppedMachineStorage<Result>(workspace: string, lifetime: RuntimeLifetimeLock,
  work: (machine: RuntimeAdmission, owned: RuntimeAdmission[]) => Promise<Result>): Promise<Result> {
  const machine = StorageAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime), owned: RuntimeAdmission[] = [];
  let outcome: { value: Result } | undefined, primary: { error: unknown } | undefined;
  try { outcome = { value: await work(machine, owned) }; }
  catch (error) { primary = { error }; }
  if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) {
    machine.retainSourceClosure(primary.error);
    throw retainAuthoritySourceClosure([primary.error], { admission: { machine, owned } });
  }
  const failures: unknown[] = [];
  for (const child of owned) try { child.release(); } catch (error) { failures.push(error); }
  if (failures.length === 0) try { machine.release(); } catch (error) { failures.push(error); }
  if (failures.length !== 0) {
    const failure = retainAuthoritySourceClosure(primary === undefined ? failures : [primary.error, ...failures], { admission: { machine, owned } });
    lifetime.retainSourceClosure(failure); throw failure;
  }
  if (primary !== undefined) throw primary.error;
  if (outcome === undefined) throw new Error("storage-startup-result-missing");
  return outcome.value;
}

export class RegisteredPersonUpgradeRefusedError extends Error {
  readonly code = "STORAGE_PROFILE_UPGRADE_REFUSED";
  constructor(cause: unknown) { super(ERROR_CATALOG.STORAGE_PROFILE_UPGRADE_REFUSED.text, { cause }); this.name = "RegisteredPersonUpgradeRefusedError"; }
}

export async function resumePendingAutomaticRestore(workspace: string, lifetime: RuntimeLifetimeLock): Promise<void> {
  lifetime.assertExclusiveWorkspaceTarget(workspace);
  const path = join(workspace, ".tracker", "control", "journal.json");
  const file = readPrivateFile(path, { label: "lock", maxBytes: 16 * 1024 * 1024 });
  if (file === undefined) return;
  const pending = z.object({ schemaVersion: z.literal(3), phase: z.literal("restoring"), restore: z.object({ operationId: z.uuid() }) }).parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
  const operation = lifetime.beginOfflineMaintenance(workspace);
  let admission: RuntimeAdmission | undefined;
  try {
    admission = acquireRecoveryRuntimeRestore(workspace, lifetime, pending.restore.operationId, operation).admission;
    await resumeAutomaticAuthorityRestore({ browserClosure: profileBrowserClosure, admission, operationId: pending.restore.operationId,
      processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot), restoreAdmission: operation });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission, restore: operation });
    try { operation.release(); admission?.release(); } catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission, restore: operation }); }
    throw error;
  }
  operation.release(); admission.release();
}

async function repairRegisteredPerson(workspace: string, lifetime: RuntimeLifetimeLock, profileId: string, clock: Clock): Promise<void> {
  await withStoppedMachineStorage(workspace, lifetime, async (machine, owned) => {
    const operation = machine.maintenanceOperation(), admission = machine.admitStoppedProfileRepair(profileId, operation);
    owned.push(admission);
    await restoreNewestPersonBackup(admission, operation, clock);
  });
}

export async function restoreNewestPersonBackup(admission: RuntimeAdmission, operation: OfflineMaintenanceOperation, clock: Clock) {
  const context = admission.readInstallationContext(); if (context === undefined) throw new Error("automatic-repair-installation-required");
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
  const service = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: join(admission.stateRoot, "state.db"),
    suspectDirectory: join(admission.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
    processLockRoot: join(context.workspace, rebuildRuntimeIsolation.processLockRoot) },
    rebuildStagedProjections(admission.stateRoot, "startup", clock, admission), clock, undefined, credentials);
  return service.restoreNewest(operation);
}

async function recoverRegisteredPersonCrash(workspace: string, lifetime: RuntimeLifetimeLock, profileId: string, clock: Clock): Promise<void> {
  await withStoppedMachineStorage(workspace, lifetime, async (machine, owned) => {
    const admission = machine.admitStoppedProfileRepair(profileId, machine.maintenanceOperation()); owned.push(admission);
    let database: AuthorityDatabase | undefined, primary: { error: unknown } | undefined;
    try {
      await probeRestoreProfileBrowsersClosed(admission, join(workspace, rebuildRuntimeIsolation.processLockRoot), machine.maintenanceOperation(), clock, profileBrowserClosure);
      database = AuthorityDatabase.openStoppedStartupRecovery(admission, clock);
      const lifecycle = new RunRecordService({ database, clock, ids: { uuid: randomUUID },
        publishQueued: () => { throw new Error("startup-crash-recovery-cannot-enqueue"); } });
      reconcileStoppedStartupCrash({ machine, admission, database, lifecycle, clock, lock: lifetime });
    } catch (error) { primary = { error }; }
    if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) throw retainAuthoritySourceClosure([primary.error], { admission, ...(database === undefined ? {} : { database }) });
    try { database?.close(); } catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { admission, ...(database === undefined ? {} : { database }) }); }
    if (primary !== undefined) throw primary.error;
  });
}

export async function backupRegisteredPeopleAtCleanShutdown(workspace: string, lifetime: RuntimeLifetimeLock,
  hostFacts: HostConfigFacts, clock: Clock = systemClock): Promise<void> {
  lifetime.assertHeld();
  if (!existsSync(join(workspace, ".tracker", "control", "installation.json"))) throw new Error("shutdown-backup-installation-missing");
  try {
    await withStoppedMachineStorage(workspace, lifetime, async (machine, owned) => {
      const operation = machine.maintenanceOperation(); operation.consume();
      const registry = machine.readProfileRegistry();
      for (const row of registry.profiles.filter(profile => profile.lifecycle === "ready" && profile.credentialState === "saved")) {
        if (hasPendingShutdownBackupRetirement(join(machine.stateRoot, "profiles", row.profileId))) {
          const repair = machine.admitStoppedProfileRepair(row.profileId, operation); owned.push(repair);
          await resumeShutdownBackupRetirement(repair, clock);
        }
        const admission = await machine.forStoppedProfileUpgrade(profileBrowserClosure, row.profileId, operation, clock, hostFacts); owned.push(admission);
        const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
        const closure = await prepareStoppedBackupClosure(profileBrowserClosure, admission, operation, clock, processLockRoot);
        const { backupStoppedAuthority } = await import("../../storage/maintenance/upgrade.js");
        await backupStoppedAuthority(closure, admission, admission.stateRoot, clock, processLockRoot, operation, "graceful-drain");
        const { retainCleanShutdownBackups } = await import("../../storage/maintenance/clean-shutdown-backups.js");
        await retainCleanShutdownBackups(admission, clock);
      }
    });
  } catch (error) {
    throw new AutomaticShutdownBackupError(error);
  }
}

export class AutomaticShutdownBackupError extends Error {
  readonly code = "STORAGE_AUTOMATIC_BACKUP_FAILED";
  constructor(cause: unknown) { super(ERROR_CATALOG.STORAGE_AUTOMATIC_BACKUP_FAILED.text, { cause }); this.name = "AutomaticShutdownBackupError"; }
}

export async function upgradeRegisteredPersonStores(workspace: string, lifetime: RuntimeLifetimeLock,
  hostFacts: HostConfigFacts, clock: Clock = systemClock): Promise<void> {
  lifetime.assertHeld();
  if (!existsSync(join(workspace, ".tracker", "control", "installation.json"))) return;
  try {
    const profiles = await withStoppedMachineStorage(workspace, lifetime, async machine => {
      if (machine.requiresFlatStoreMigration()) return [];
      const registry = machine.readProfileRegistry();
      return registry.profiles.filter(row => row.lifecycle === "ready").flatMap(row => {
        const inspection = AuthorityDatabase.inspectRegisteredPersonAtStartup(machine, row.profileId);
        return inspection.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION ? [] : [row.profileId];
      });
    });
    for (const profileId of profiles) await withStoppedMachineStorage(workspace, lifetime, async machine => {
      const { upgradeProfileAtStartup } = await import("../../storage/maintenance/upgrade.js");
      const report = await upgradeProfileAtStartup(profileBrowserClosure, machine, profileId, hostFacts, clock);
      if (report.state !== "upgraded" || report.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("profile-startup-upgrade-unproved");
    });
    if (profiles.length !== 0) await withStoppedMachineStorage(workspace, lifetime, async machine => {
      for (const profileId of profiles) if (AuthorityDatabase.inspectRegisteredPersonAtStartup(machine, profileId).schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("profile-startup-readback-unproved");
    });
  } catch (error) { throw new RegisteredPersonUpgradeRefusedError(error); }
}

export async function initializeRegisteredPersonStores(workspace: string, lifetime: RuntimeLifetimeLock,
  hostFacts: HostConfigFacts, clock: Clock = systemClock): Promise<void> {
  lifetime.assertHeld();
  if (!existsSync(join(workspace, ".tracker", "control", "installation.json"))) return;
  try {
    await resumePendingAutomaticRestore(workspace, lifetime);
    const registered = await withStoppedMachineStorage(workspace, lifetime, async machine => machine.requiresFlatStoreMigration() ? []
      : machine.readProfileRegistry().profiles.filter(row => row.lifecycle === "ready").map(row => row.profileId));
    for (const profileId of registered) {
      try { await withStoppedMachineStorage(workspace, lifetime, async machine => AuthorityDatabase.inspectRegisteredPersonAtStartup(machine, profileId)); }
      catch (error) { if (hasUnprovedSourceClosure(error)) throw error; await repairRegisteredPerson(workspace, lifetime, profileId, clock); }
    }
    await withStoppedMachineStorage(workspace, lifetime, async (machine, owned) => {
      for (const profileId of registered) if (hasPendingShutdownBackupRetirement(join(machine.stateRoot, "profiles", profileId))) {
        const admission = machine.admitStoppedProfileRepair(profileId, machine.maintenanceOperation()); owned.push(admission);
        await resumeShutdownBackupRetirement(admission, clock);
      }
    });
    await upgradeRegisteredPersonStores(workspace, lifetime, hostFacts, clock);
    for (const profileId of registered) {
      try { await recoverRegisteredPersonCrash(workspace, lifetime, profileId, clock); }
      catch (error) {
        if (hasUnprovedSourceClosure(error)) throw error;
        await repairRegisteredPerson(workspace, lifetime, profileId, clock);
        await upgradeRegisteredPersonStores(workspace, lifetime, hostFacts, clock);
        await recoverRegisteredPersonCrash(workspace, lifetime, profileId, clock);
      }
    }
  } catch (error) {
    if (error instanceof RegisteredPersonUpgradeRefusedError) throw error;
    throw new AutomaticPersonRepairRefusedError(error);
  }
}

export class AutomaticPersonRepairRefusedError extends Error {
  readonly code = "STORAGE_AUTOMATIC_REPAIR_REFUSED";
  constructor(cause: unknown) { super(ERROR_CATALOG.STORAGE_AUTOMATIC_REPAIR_REFUSED.text, { cause }); this.name = "AutomaticPersonRepairRefusedError"; }
}

export async function prepareApplicationDataWorkspace(sourceWorkspace: string, targetWorkspace: string, lifetime: RuntimeLifetimeLock,
  hostFacts: HostConfigFacts, clock: Clock = systemClock): Promise<void> {
  if (sourceWorkspace === targetWorkspace) throw new Error("fixed-layout-source-target-equal");
  lifetime.assertHeld();
  const journal = readFixedLayoutIntent(targetWorkspace);
  if (journal !== undefined && journal.phase !== "complete" && journal.sourceWorkspace !== sourceWorkspace) throw new Error("fixed-layout-recovery-source-foreign");
  let publication: FixedLayoutPublication | undefined;
  if (journal !== undefined && journal.phase !== "complete") publication = recoverFixedLayoutPublication(targetWorkspace, lifetime);
  else {
    const targetControl = lstatSync(join(targetWorkspace, ".tracker", "control"), { throwIfNoEntry: false });
    const sourceControl = lstatSync(join(sourceWorkspace, ".tracker", "control"), { throwIfNoEntry: false });
    const sourceData = lstatSync(join(sourceWorkspace, rebuildRuntimeIsolation.stateRoot), { throwIfNoEntry: false });
    if (journal?.phase === "complete" || targetControl !== undefined) {
      if (targetControl === undefined || !existsSync(join(targetWorkspace, ".tracker", "control", "installation.json"))
        || !existsSync(join(targetWorkspace, ".tracker", "control", "locator.json"))
        || !existsSync(join(targetWorkspace, rebuildRuntimeIsolation.stateRoot))) throw new Error("fixed-layout-target-established-missing");
      if (sourceControl !== undefined || sourceData !== undefined && journal?.sourceWorkspace !== sourceWorkspace) throw new Error("fixed-layout-two-installations-present");
      if (sourceData !== undefined && journal !== undefined) assertFixedLayoutSourceFence(journal);
      return;
    }
    if (lstatSync(join(targetWorkspace, rebuildRuntimeIsolation.stateRoot), { throwIfNoEntry: false }) !== undefined) throw new Error("fixed-layout-target-established-missing-control");
    if (sourceControl === undefined) {
      if (sourceData !== undefined) throw new Error("fixed-layout-source-established-missing-control");
      const tracker = join(targetWorkspace, ".tracker");
      if (lstatSync(tracker, { throwIfNoEntry: false }) !== undefined && readdirSync(tracker).length !== 0) throw new Error("fixed-layout-target-membership-unknown");
      createFixedLayoutDirectory(targetWorkspace); return;
    }
    publication = await withDefaultLayoutSource(sourceWorkspace, lifetime, async () => {
      await resumePendingAutomaticRestore(sourceWorkspace, lifetime);
      await withStoppedMachineStorage(sourceWorkspace, lifetime, async convert => {
        if (convert.requiresFlatStoreMigration()) await convert.startCleanFlatStore(profileBrowserClosure);
      });
      await withStoppedMachineStorage(sourceWorkspace, lifetime, async control => {
        const { upgradeStoppedMachineControl } = await import("../../storage/maintenance/upgrade.js");
        const { composeStoppedControlCredentialInventory } = await import("./profile-credential-inventory.js");
        await upgradeStoppedMachineControl(control, { plan: false, hostFacts }, clock, composeStoppedControlCredentialInventory, createNativeBrowserProbe);
      });
      await initializeRegisteredPersonStores(sourceWorkspace, lifetime, hostFacts, clock);
      return withStoppedMachineStorage(sourceWorkspace, lifetime, async (machine, owned) => {
        const sources: Array<{ admission: RuntimeAdmission; closure: StoppedBackupClosure }> = [], profiles: FixedLayoutActivation[] = [];
        const registry = machine.readProfileRegistry(), operation = machine.maintenanceOperation();
        if (registry.profiles.some(row => row.lifecycle !== "ready" || row.credentialState !== "saved")) throw new Error("fixed-layout-ready-people-required");
        for (const row of registry.profiles) {
          const admission = await machine.forStoppedProfileLayout(profileBrowserClosure, row.profileId, operation, clock, hostFacts);
          owned.push(admission);
          const processLockRoot = join(sourceWorkspace, rebuildRuntimeIsolation.processLockRoot);
          const closure = await prepareStoppedBackupClosure(profileBrowserClosure, admission, operation, clock, processLockRoot);
          sources.push({ admission, closure });
          const { backupStoppedAuthority } = await import("../../storage/maintenance/upgrade.js");
          const backup = await backupStoppedAuthority(closure, admission, admission.stateRoot, clock, processLockRoot, operation, "schema-migration");
          const manifest = backup.manifests[0];
          if (backup.manifests.length !== 1 || manifest === undefined || manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("fixed-layout-current-backup-required");
          const database = AuthorityDatabase.openFixedLayoutSource(machine, admission, clock);
          let primary: { error: unknown } | undefined;
          try {
            const saved = readBootSettings(database.authority), priorActive = database.authority.runtimeConfig.get();
            if (priorActive === undefined) throw new Error("fixed-layout-active-settings-required");
            const targetRoot = join(targetWorkspace, rebuildRuntimeIsolation.stateRoot, "profiles", row.profileId);
            const previousBrowserRoot = saved.settings.paths?.browserProfileRoot;
            if (previousBrowserRoot !== undefined && previousBrowserRoot !== join(admission.stateRoot, "browsers")) throw new Error("fixed-layout-custom-browser-root-unsupported");
            const priorSnapshot = database.authority.configSnapshots.get(priorActive.configSnapshotId);
            if (priorSnapshot === undefined || priorSnapshot.fingerprint !== priorActive.configFingerprint) throw new Error("fixed-layout-active-snapshot-required");
            const outputPaths = fixedLayoutOutputPaths(saved.settings, priorSnapshot.config.paths, admission.stateRoot, targetRoot);
            const settingsUpdate = previousBrowserRoot === undefined && Object.keys(outputPaths).length === 0 ? undefined
              : { commandId: randomUUID(), auditId: randomUUID(), ...(previousBrowserRoot === undefined ? {} : { previousBrowserRoot }), outputPaths };
            const settings = settingsUpdate === undefined ? saved.settings : { ...saved.settings, paths: { ...saved.settings.paths, ...outputPaths,
              ...(previousBrowserRoot === undefined ? {} : { browserProfileRoot: join(targetRoot, "browsers") }) } };
            const resolved = resolveConfigWithProvenance(settings, hostFacts, clock, { stateRoot: targetRoot, artifactRoot: join(targetRoot, "artifacts") });
            profiles.push({ profileId: row.profileId, sourceRoot: admission.stateRoot, authorityPath: join(targetRoot, "state.db"), backupFileName: manifest.backupFileName,
              backupSha256: manifest.sha256, backupManifestSha256: layoutHash(layoutFile(join(admission.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`), "managed data").bytes),
              preAuthorityGeneration: manifest.authorityGeneration, preAuthorityContentFingerprint: manifest.authorityContentFingerprint,
              settingsRevision: saved.revision, settingsFingerprint: saved.settingsFingerprint, priorActive,
              ...(settingsUpdate === undefined ? {} : { settingsUpdate }),
              snapshot: ConfigSnapshotRecordSchema.parse({ configSnapshotId: randomUUID(), revision: saved.revision + (settingsUpdate === undefined ? 0 : 1),
                config: resolved.config, provenance: resolved.provenance, fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(), capturedBy: LOCAL_OPERATOR_ACTOR_ID }) });
          } catch (error) { primary = { error }; }
          try { database.close(); } catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { database, admission }); }
          if (primary !== undefined) throw primary.error;
        }
        return machine.prepareFixedLayoutPublication(FixedLayoutIntentSchema.parse({ schemaVersion: 1, operationId: operation.operationId,
          installationId: machine.locator.installationId, sourceWorkspace, targetWorkspace, phase: "moving",
          data: fixedLayoutEntries(machine.stateRoot), control: fixedLayoutEntries(join(sourceWorkspace, ".tracker", "control")),
          bindings: machine.fixedLayoutBindings(targetWorkspace), profiles }), sources);
      });
    });
  }
  if (publication === undefined) throw new Error("fixed-layout-publication-required");
  await lifetime.transferFixedLayout(publication);
  await withStoppedMachineStorage(targetWorkspace, lifetime, activateFixedLayoutProfiles);
}

export class RuntimeCustodyUncertainError extends AggregateError {
  readonly code = "RUNTIME_CUSTODY_UNCERTAIN";
  constructor(causes: readonly unknown[]) {
    super(causes, ERROR_CATALOG.RUNTIME_CUSTODY_UNCERTAIN.text, { cause: causes[0] });
    this.name = "RuntimeCustodyUncertainError";
  }
}

function profileResourceCustodyBusy(before: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>): boolean {
  for (const browser of before.browsers) if (!before.slots.some(slot => slot.workerId === browser.workerId)) throw new Error("profile-browser-membership-unavailable");
  let busy = false;
  for (const slot of before.slots) {
    const reservation = before.reservations.find(value => value.workerId === slot.workerId);
    if (reservation === undefined || reservation.reservationCommandId !== slot.reservationCommandId) throw new Error("profile-worker-reservation-authority-unavailable");
    if (reservation.state === "pending") busy = true;
    const lease = before.leases.find(value => value.workerId === slot.workerId);
    if (lease === undefined && slot.retiredAt === null) {
      const plan = before.controls.find(control => control.commandId === slot.reservationCommandId);
      if (reservation.state !== "settled" || plan?.request.type !== "plan-worker-count" || plan.phase.state !== "succeeded" || plan.auditedAt === undefined
        || !plan.roster?.selected.some(member => member.workerId === slot.workerId)
        || before.controls.some(control => control.request.type === "spawn-worker" && control.request.payload.workerId === slot.workerId)
        || before.browsers.some(browser => browser.workerId === slot.workerId) || before.runs.some(run => runClaim(run)?.workerId === slot.workerId)
        || before.duoLeases.some(lease => lease.holder.workerId === slot.workerId)) throw new Error("profile-worker-lifetime-unavailable");
    }
    if (lease !== undefined && lease.lifecycle.state !== "stopped") busy = true;
  }
  if (before.leases.some(lease => !before.slots.some(slot => slot.workerId === lease.workerId))) throw new Error("profile-worker-membership-unavailable");
  return busy || before.browsers.some(browser => browser.health !== "closed") || before.controls.some(control => control.auditedAt === undefined)
    || before.runs.some(run => run.lifecycle.state !== "terminal") || before.writeIntents.some(intent => intent.status !== "committed" && intent.status !== "observed-present")
    || before.duoLeases.some(lease => lease.state === "held") || before.pendingArtifacts.length > 0;
}

export function composeProfileActivity(input: Readonly<{
  admission: RuntimeAdmission; database: AuthorityDatabase; clock: Clock;
  supervisor: Pick<DashboardWorkerProcessSupervisor, "memberEvidence" | "drainOwnedChildren"> | { readonly state: "not-constructed" };
  lifecycle: Pick<RunRecordService, "read" | "transition">;
}>) {
  const profileId = input.admission.profileBinding.profileId;
  let drain: { state: "pending"; completion: Promise<void> } | { state: "complete" } | { state: "failed"; error: unknown } | undefined;
  const observe = () => {
    input.admission.assertLive();
    const before = input.database.readProfileResourceCustody();
    let busy = profileResourceCustodyBusy(before);
    for (const slot of before.slots) {
      const lease = before.leases.find(value => value.workerId === slot.workerId);
      if (slot.retiredAt !== null) continue;
      if ("state" in input.supervisor) throw new Error("profile-worker-supervisor-custody-unavailable");
      const evidence = input.supervisor.memberEvidence(workerPoolMember(slot));
      if (lease !== undefined && evidence === undefined) {
        if (lease.lifecycle.state !== "stopped") {
          throw new Error("profile-worker-supervisor-custody-unavailable");
        }
        input.database.assertWorkerLifecycleRelease(lease.workerId);
      }
      if (evidence !== undefined && (evidence.state !== "exited" || evidence.reportedBy !== "os")) busy = true;
    }
    const after = input.database.readProfileResourceCustody();
    if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new Error("profile-resource-custody-changed");
    return busy;
  };
  return Object.freeze({
    hasUnquiescedWork(requestedProfileId: string): boolean {
      if (requestedProfileId !== profileId) throw new Error("profile-resource-owner-mismatch");
      if (drain?.state === "failed") throw drain.error;
      return drain?.state === "pending" || observe();
    },
    requestCancellation(requestedProfileId: string): void {
      if (requestedProfileId !== profileId) throw new Error("profile-resource-owner-mismatch");
      if (drain !== undefined) return;
      for (const run of input.database.readProfileResourceCustody().runs) {
        const current = input.lifecycle.read(run.envelope.runId);
        if (current.state !== "present") throw new Error("profile-run-custody-unavailable");
        if (current.run.lifecycle.state === "terminal" || current.run.lifecycle.state === "parked-write") continue;
        requireLifecycleApplied(input.lifecycle.transition({ commandId: randomUUID(), runId: current.run.envelope.runId,
          expectedVersion: current.run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: input.clock.now().toISOString() } }));
      }
      const completion = "state" in input.supervisor
        ? (observe() ? Promise.reject(new Error("profile-resource-closure-unproved")) : Promise.resolve())
        : input.supervisor.drainOwnedChildren({ requestedAt: IsoInstantSchema.parse(input.clock.now().toISOString()),
          requestedBy: LOCAL_OPERATOR_ACTOR_ID, reason: "profile-logout" });
      drain = { state: "pending", completion };
      void completion.then(() => { drain = { state: "complete" }; }, error => { drain = { state: "failed", error }; });
    },
    awaitCancellation(): Promise<void> {
      if (drain === undefined) throw new Error("profile-cancellation-unrequested");
      if (drain.state === "failed") throw drain.error;
      return drain.state === "pending" ? drain.completion : Promise.resolve();
    },
  });
}

export function captureSelectedProfileStorage(machineAdmission: RuntimeAdmission) {
  const machine = requireRuntimeAdmission(machineAdmission);
  const selection = machine.readProfileRegistry();
  const profileId = selection.activeProfileId, epoch = selection.sessionGeneration;
  if (profileId === null) throw new Error("profile-session-stale");
  const authorityPath = join(machine.stateRoot, "profiles", profileId, "state.db");
  const assertCurrent = (): void => {
    machine.assertStateRoot(authorityPath);
    const current = machine.readProfileRegistry();
    if (current.activeProfileId !== profileId || current.sessionGeneration !== epoch
      || !current.profiles.some(row => row.profileId === profileId && row.lifecycle === "ready" && row.credentialState === "saved")) {
      throw new Error("profile-session-stale");
    }
  };
  assertCurrent();
  return Object.freeze({ profileId, epoch, authorityPath, assertCurrent });
}

export function composeSelectedProfileStorage(input: Readonly<{
  machineAdmission: RuntimeAdmission;
  admission: RuntimeAdmission;
  credentials: CredentialStore;
  hostFacts: HostConfigFacts;
  clock: Clock;
  assertOrdinaryOwner?: () => void;
}>) {
  const admission = requireRuntimeAdmission(input.admission);
  const machine = requireRuntimeAdmission(input.machineAdmission);
  admission.assertProfileRuntime();
  const binding = admission.profileBinding;
  const selected = captureSelectedProfileStorage(machine);
  if (selected.profileId !== binding.profileId || selected.authorityPath !== join(admission.stateRoot, "state.db")) throw new Error("profile-account-owner-mismatch");
  const assertCurrent = (): void => {
    input.assertOrdinaryOwner?.();
    admission.assertProfileRuntime();
    selected.assertCurrent();
  };
  assertCurrent();
  const stateRoot = admission.stateRoot;
  const resolveSettings = (settings: unknown) => {
    assertCurrent();
    const resolved = resolveConfigWithProvenance(settings, input.hostFacts, input.clock, { stateRoot, artifactRoot: admission.artifactRoot });
    assertProfileBrowserRoot(admission, resolved.config.paths.browserProfileRoot);
    return resolved;
  };
  const database = AuthorityDatabase.open(admission, {
    path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "selected-profile-runtime",
  }, input.clock, undefined, undefined, undefined, input.credentials);
  try {
    database.withAuthorityTransaction(repositories => {
      assertCurrent();
      const saved = readBootSettings(repositories);
      if (repositories.runtimeConfig.get() !== undefined) return;
      const resolved = resolveSettings(saved.settings);
      const now = input.clock.now().toISOString(), configSnapshotId = randomUUID();
      const snapshot = { configSnapshotId, revision: saved.revision, fingerprint: resolved.fingerprint, capturedAt: now,
        capturedBy: LOCAL_OPERATOR_ACTOR_ID, config: resolved.config, provenance: resolved.provenance };
      repositories.runtimeConfig.initialize(snapshot);
    });
    assertProfileBrowserRoot(admission, database.withAuthorityReadSnapshot(() => activeSettingsConfig(database.authority)).paths.browserProfileRoot);
    const account = createChatGptAccountService({ admission, stateRoot, clock: input.clock });
    const reader = composeProfileSettings({ database, hostFacts: input.hostFacts, clock: input.clock,
      runtimeStoragePair: { stateRoot, artifactRoot: admission.artifactRoot }, active: activeSettingsRuntimeIdentity });
    const settings = Object.freeze({ read: () => {
      assertCurrent();
      const value = reader.read();
      assertCurrent();
      return value;
    } });
    const protectedSecrets = Object.freeze({ read: () => { assertCurrent(); return input.credentials.read(); } });
    const accountAuthority = Object.freeze({
      readAuthority: async (expectedAdmission: RuntimeAdmission = admission) => {
        if (expectedAdmission !== admission) throw new Error("profile-account-owner-mismatch");
        assertCurrent();
        const captured = await account.readAuthority(admission);
        assertCurrent();
        return captured;
      },
      revalidateAuthority: (captured: Parameters<typeof account.revalidateAuthority>[0], expectedAdmission: RuntimeAdmission = admission) => {
        if (expectedAdmission !== admission) throw new Error("profile-account-owner-mismatch");
        assertCurrent();
        return account.revalidateAuthority(captured, admission);
      },
    });
    return Object.freeze({ admission, profileEpoch: selected.epoch, credentials: input.credentials, database, account, accountAuthority, settings, protectedSecrets, assertCurrent, resolveSettings });
  } catch (error) {
    try { database.close(); }
    catch (closeError) { throw new RuntimeCustodyUncertainError([error, closeError]); }
    throw error;
  }
}

const pendingLogoutServices = Object.freeze({ browserClosure: profileBrowserClosure, recover: reconcileStoppedLogout });

export function composeProfileRuntime(input: Readonly<{
  admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock;
  credentialHooks?: CredentialStoreHooks;
  onboardingDuo?: ProfileOnboardingDuoProvider;
}>) {
  const machine = requireRuntimeAdmission(input.admission);
  type Context = ReturnType<typeof composeSelectedProfileStorage>;
  type Preparation = { state: "pending"; completion: Promise<void> } | { state: "ready" } | { state: "failed"; error: unknown };
  type Supervisor = Pick<DashboardWorkerProcessSupervisor, "memberEvidence" | "drainOwnedChildren">;
  type Supervision = { state: "not-constructed" } | { state: "constructing" } | { state: "bound"; owner: Supervisor };
  type LogoutClosure = { epoch: number; source: ReturnType<AuthorityDatabase["capturePendingLogoutSource"]>;
    custody: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>;
    exits: Map<string, Readonly<{ member: WorkerPoolMember; processId: number; leaseGeneration: number; valid(): boolean }>>;
    operationId?: string; busy?: boolean; stopped?: Awaited<ReturnType<AuthorityDatabase["settlePendingLogout"]>> };
  type Owned = { logout?: LogoutClosure; supervision: Supervision; admission: RuntimeAdmission; credentials: CredentialStore; context?: Context; activity?: ReturnType<typeof composeProfileActivity>;
    inventory?: ReturnType<typeof composeProfileClosureInventory>; preparation?: Preparation; state: "open" | "closing" | "closed" };
  const completedLogouts = new Map<string, Readonly<{ profileId: string; epoch: number }>>();
  const coldLogouts = new Map<string, { operationId: string; completion: Promise<void>; state: "pending" | "ready" | "failed"; busy?: boolean; error?: unknown }>();
  const resources = new Map<string, { ordinary?: Owned; settlement?: Pick<Owned, "admission" | "credentials"> }>();
  const contextFor = (expected?: RuntimeAdmission): Context => {
    const selected = captureSelectedProfileStorage(machine), entry = resources.get(selected.profileId)?.ordinary;
    if (entry === undefined || expected !== undefined && expected !== entry.admission) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    if (entry.state !== "open" || entry.preparation !== undefined) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    entry.context ??= composeSelectedProfileStorage({ machineAdmission: machine, admission: entry.admission, credentials: entry.credentials,
      hostFacts: input.hostFacts, clock: input.clock, assertOrdinaryOwner: () => { if (entry.state !== "open") throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE"); } });
    return entry.context;
  };
  const initializeOwners = (profileId: string, expected: RuntimeAdmission): Owned => {
    const context = contextFor(expected), entry = resources.get(profileId)?.ordinary;
    if (entry === undefined) throw new Error("profile-authority-unavailable");
    if (entry.supervision.state === "constructing") throw new RuntimeCustodyUncertainError([new Error("profile-supervisor-construction-unproved")]);
    if (entry.activity === undefined) entry.activity = composeProfileActivity({ admission: entry.admission, database: context.database,
      clock: input.clock, supervisor: entry.supervision.state === "bound" ? entry.supervision.owner : entry.supervision,
      lifecycle: new RunRecordService({ database: context.database, clock: input.clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("profile custody cannot enqueue runs"); } }) });
    entry.inventory ??= composeProfileClosureInventory({ admission: entry.admission, database: context.database, hostFacts: input.hostFacts, clock: input.clock });
    return entry;
  };
  const pendingLogout = (profileId: string, entry: Owned): LogoutOperation => {
    try {
    if (entry.logout === undefined) throw new Error("profile-logout-source-unprepared");
    const directory = join(machine.stateRoot, "machine", "operations");
    const operations = readdirSync(directory).filter(name => name.endsWith(".json")).flatMap(name => {
      const file = readPrivateFile(join(directory, name), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) throw new Error("profile-logout-operation-missing");
      const parsed = LogoutOperationSchema.safeParse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
      return parsed.success && parsed.data.profileId === profileId && parsed.data.phase !== "complete" ? [parsed.data] : [];
    });
    const operation = operations[0];
    if (operations.length !== 1 || operation === undefined || operation.sessionGeneration !== entry.logout.epoch
      || canonicalJsonStringify(operation.source) !== canonicalJsonStringify(entry.logout.source)
      || entry.logout.operationId !== undefined && entry.logout.operationId !== operation.operationId) throw new Error("profile-logout-operation-source-changed");
    entry.logout.operationId = operation.operationId;
    return operation;
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { machine.retainSourceClosure(error); entry.admission.retainSourceClosure(error); }
      throw error;
    }
  };
  const prepareClosure = (profileId: string): void => {
    const entry = resources.get(profileId)?.ordinary;
    if (entry?.activity === undefined || entry.context === undefined || entry.inventory === undefined) throw new Error("profile-resource-custody-unavailable");
    if (entry.preparation !== undefined) return;
    entry.activity.requestCancellation(profileId);
    const completion = (async () => {
      await entry.activity!.awaitCancellation();
      if (entry.logout !== undefined) {
        const lifetime = machine.lifetime;
        if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-logout-controller-required");
        await lifetime.awaitOwnedChildrenClosed();
        await entry.context!.account.close();
        const operation = pendingLogout(profileId, entry);
        const stopped = await entry.context!.database.settlePendingLogout(machine, operation, [...entry.logout.exits.values()], pendingLogoutServices);
        entry.logout.stopped = stopped;
        entry.logout.busy = profileResourceCustodyBusy(stopped.facts);
        if (!entry.logout.busy) {
          await stopped.complete();
          completedLogouts.set(operation.operationId, { profileId, epoch: operation.sessionGeneration + 1 });
        }
        stopped.dispose(); delete entry.logout.stopped;
        entry.state = "closed";
      } else {
        if (entry.activity!.hasUnquiescedWork(profileId)) { delete entry.preparation; return; }
        await entry.context!.account.close();
        await entry.inventory!.prepare();
      }
      entry.preparation = { state: "ready" };
    })();
    entry.preparation = { state: "pending", completion };
    void completion.catch(error => {
      if (hasUnprovedSourceClosure(error)) { machine.retainSourceClosure(error); entry.admission.retainSourceClosure(error); }
      entry.preparation = { state: "failed", error };
    });
  };
  const prepareColdLogout = (inputOperation: LogoutOperation): void => {
    if (resources.get(inputOperation.profileId)?.ordinary?.logout !== undefined) return;
    if (resources.has(inputOperation.profileId)) throw new Error("profile-logout-cold-owner-already-constructed");
    const existing = coldLogouts.get(inputOperation.profileId);
    if (existing !== undefined) {
      if (existing.operationId !== inputOperation.operationId) throw new Error("profile-logout-cold-operation-changed");
      if (existing.state === "failed") throw existing.error;
      return;
    }
    machine.assertColdPendingLogout(inputOperation);
    const job: { operationId: string; completion: Promise<void>; state: "pending" | "ready" | "failed"; busy?: boolean; error?: unknown } = {
      operationId: inputOperation.operationId, state: "pending", completion: Promise.resolve(),
    };
    coldLogouts.set(inputOperation.profileId, job);
    job.completion = (async () => {
      await Promise.resolve();
      const file = readPrivateFile(join(machine.stateRoot, "machine", "operations", `${inputOperation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) throw new Error("profile-logout-cold-operation-missing");
      const operation = LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
      machine.assertColdPendingLogout(operation);
      const stopped = await AuthorityDatabase.resumePendingLogout(machine, operation, pendingLogoutServices, input.clock);
      job.busy = profileResourceCustodyBusy(stopped.facts);
      if (!job.busy) {
        await stopped.complete();
        completedLogouts.set(operation.operationId, { profileId: operation.profileId, epoch: operation.sessionGeneration + 1 });
      }
      stopped.dispose(); job.state = "ready";
    })();
    void job.completion.catch(error => {
      if (hasUnprovedSourceClosure(error)) machine.retainSourceClosure(error);
      job.state = "failed"; job.error = error;
    });
  };
  const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine, clock: input.clock,
    ...(input.onboardingDuo === undefined ? {} : { onboardingDuo: input.onboardingDuo }),
    credentialsFor: (admission, purpose) => {
      const profileId = admission.profileBinding.profileId, entry = resources.get(profileId) ?? {};
      const current = entry[purpose];
      if (current?.admission === admission) { assertCredentialStoreOwner(current.credentials, admission); return current.credentials; }
      if (purpose === "ordinary" && entry.ordinary?.context !== undefined && entry.ordinary.state !== "closed") throw new Error("profile-resource-custody-unavailable");
      const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, hooks: input.credentialHooks });
      assertCredentialStoreOwner(credentials, admission);
      if (purpose === "ordinary") entry.ordinary = { admission, credentials, supervision: { state: "not-constructed" }, state: "open" };
      else entry.settlement = { admission, credentials };
      resources.set(profileId, entry);
      return credentials;
    },
    prepareLogoutContinuation: prepareColdLogout,
    completedLogout: operationId => completedLogouts.get(operationId),
    settings: { read: () => contextFor().settings.read() },
    account: { readAuthority: admission => contextFor(admission).accountAuthority.readAuthority(admission),
      revalidateAuthority: (capture, admission) => contextFor(admission).accountAuthority.revalidateAuthority(capture, admission) },
    sessionChange: profileId => resources.get(profileId)?.ordinary?.context !== undefined && resources.get(profileId)?.ordinary?.state !== "closed"
      ? { state: "refused", code: "PROFILE_TRANSITION_BLOCKED", message: ERROR_CATALOG.PROFILE_TRANSITION_BLOCKED.text } : { state: "closed" },
    prepareLogout: (profileId, admission) => {
      const entry = initializeOwners(profileId, admission);
      const source = entry.context!.database.capturePendingLogoutSource();
      entry.logout = { epoch: machine.readProfileRegistry().sessionGeneration, source, custody: entry.context!.database.readProfileResourceCustody(), exits: new Map() };
      entry.activity!.requestCancellation(profileId);
      entry.state = "closing";
      return { source, intentFailed(error: unknown): never {
        const failure = new RuntimeCustodyUncertainError([error]);
        entry.preparation = { state: "failed", error: failure };
        throw failure;
      } };
    },
    activity: {
      hasUnquiescedWork: profileId => {
        const resource = resources.get(profileId), entry = resource?.ordinary;
        if (entry === undefined) {
          const cold = coldLogouts.get(profileId);
          if (cold === undefined) throw new Error("profile-resource-custody-unavailable");
          if (cold.state === "failed") throw cold.error;
          return cold.state !== "ready" || cold.busy !== false;
        }
        if (entry.activity === undefined) throw new Error("profile-resource-custody-unavailable");
        if (entry.preparation?.state === "failed") throw entry.preparation.error;
        if (entry.logout !== undefined) return entry.preparation?.state !== "ready" || entry.logout.busy !== false;
        return entry.activity.hasUnquiescedWork(profileId) || entry.preparation?.state !== "ready";
      },
      requestCancellation: profileId => {
        const entry = resources.get(profileId)?.ordinary;
        if (entry?.activity === undefined) {
          if (coldLogouts.has(profileId)) return;
          throw new Error("profile-resource-custody-unavailable");
        }
        if (entry.state === "open") entry.state = "closing";
        entry.activity.requestCancellation(profileId);
      },
    },
    closeStorage: (profileId, admission) => {
      const resource = resources.get(profileId), settlement = resource?.settlement;
      if (settlement?.admission === admission) {
        return;
      }
      const entry = resource?.ordinary;
      if (entry === undefined || entry.admission !== admission) {
        if (entry?.context !== undefined && entry.state !== "closed") throw new RuntimeCustodyUncertainError([new Error("profile-resource-owner-mismatch")]);
        return;
      }
      if (entry.context !== undefined && entry.state !== "closed") {
        if (entry.preparation?.state === "failed") throw new RuntimeCustodyUncertainError([entry.preparation.error]);
        if (entry.preparation?.state !== "ready") throw new RuntimeCustodyUncertainError([new Error("profile-account-closure-unproved")]);
        try { entry.context.database.close(); }
        catch (error) { throw new RuntimeCustodyUncertainError([error]); }
        entry.state = "closed";
      }
    },
  });
  const assertCurrent = (token: string): void => {
    const available = session.prepareCurrentStorage(token);
    if (available.state !== "available") throw new ProfileSessionRefusedError(available.code);
    const selected = captureSelectedProfileStorage(machine), entry = resources.get(selected.profileId)?.ordinary;
    if (entry === undefined || entry.state !== "open" || entry.preparation !== undefined) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    entry.admission.assertProfileRuntime();
    selected.assertCurrent();
  };
  const beginClose = (): void => {
    let initializationFailure: { error: unknown } | undefined;
    for (const [profileId, entry] of resources) {
      const ordinary = entry.ordinary;
      if (ordinary?.context === undefined || ordinary.state !== "open") continue;
      try { if (ordinary.activity === undefined || ordinary.inventory === undefined) initializeOwners(profileId, ordinary.admission); }
      catch (error) { initializationFailure = { error }; break; }
    }
    for (const entry of resources.values()) if (entry.ordinary?.state === "open") entry.ordinary.state = "closing";
    if (initializationFailure !== undefined) throw new RuntimeCustodyUncertainError([initializationFailure.error]);
    try {
      for (const [profileId, entry] of resources) {
        const ordinary = entry.ordinary;
        if (ordinary?.context === undefined || ordinary.state === "closed") continue;
        if (ordinary.activity === undefined) throw new Error("profile-resource-custody-unavailable");
        ordinary.activity.requestCancellation(profileId);
      }
    } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
  };
  return Object.freeze({ session, beginClose,
    assertMachineOwner(admission: RuntimeAdmission): void { if (admission !== machine) throw new Error("profile-machine-owner-mismatch"); machine.assertLive(); },
    assertCurrent,
    selectedContext(token: string): Context { assertCurrent(token); return contextFor(); },
    beginSupervisorConstruction(token: string): void {
      assertCurrent(token);
      const entry = resources.get(contextFor().admission.profileBinding.profileId)?.ordinary;
      if (entry === undefined || entry.supervision.state !== "not-constructed" || entry.activity !== undefined) throw new Error("profile-supervisor-owner-mismatch");
      entry.supervision = { state: "constructing" };
    },
    bindSupervisor(token: string, supervisor: Supervisor): void {
      assertCurrent(token);
      const entry = resources.get(contextFor().admission.profileBinding.profileId)?.ordinary;
      if (entry === undefined || entry.supervision.state !== "constructing" || entry.activity !== undefined) throw new Error("profile-supervisor-owner-mismatch");
      entry.supervision = { state: "bound", owner: supervisor };
    },
    workerExited(owner: RuntimeAdmission, member: WorkerPoolMember, processId: number | undefined, valid: () => boolean): void {
      const profileId = owner.profileBinding.profileId, entry = resources.get(profileId)?.ordinary;
      if (entry === undefined || entry.admission !== owner || entry.context === undefined || entry.supervision.state !== "bound") throw new Error("profile-exit-owner-mismatch");
      const evidence = entry.supervision.owner.memberEvidence(member);
      if (!valid() || evidence?.state !== "exited" || evidence.reportedBy !== "os" || evidence.pid !== processId) throw new Error("profile-exit-native-source-unproved");
      try { owner.assertProfileRuntime(); }
      catch (error) {
        if (hasUnprovedSourceClosure(error)) { owner.retainSourceClosure(error); machine.retainSourceClosure(error); throw error; }
        const logout = entry.logout;
        if (logout === undefined) throw error;
        pendingLogout(profileId, entry);
        const slot = logout.custody.slots.find(slot => slot.workerId === member.workerId), lease = logout.custody.leases.find(lease => lease.workerId === member.workerId);
        if (processId === undefined || slot === undefined || lease === undefined || lease.processId !== processId || slot.workflow !== member.workflowId || slot.ordinal !== member.ordinal
          || slot.poolIndex !== member.poolIndex || slot.membershipRevision !== member.membershipRevision) throw new Error("profile-exit-captured-source-changed", { cause: error });
        if (!logout.exits.has(member.workerId)) logout.exits.set(member.workerId, { member, processId, leaseGeneration: lease.leaseGeneration, valid });
        return;
      }
      const lease = entry.context.database.authority.workerLeases.get(member.workerId), slot = entry.context.database.authority.workerSlots.get(member.workerId);
      if (lease === undefined) return;
      if (lease.processId !== processId || slot?.membershipRevision !== member.membershipRevision) throw new Error("worker-exit-lifetime-changed");
      const lifetime = machine.lifetime;
      if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-exit-controller-required");
      reconcileExitedWorker({ machine, admission: owner, database: entry.context.database,
        lifecycle: new RunRecordService({ database: entry.context.database, clock: input.clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("profile custody cannot enqueue runs"); } }),
        clock: input.clock, workerId: member.workerId, leaseGeneration: lease.leaseGeneration, lock: lifetime });
    },
    async awaitClosurePreparation(profileId: string): Promise<void> {
      const cold = coldLogouts.get(profileId);
      if (cold !== undefined) {
        await cold.completion;
        if (cold.state !== "ready") {
          if (cold.error instanceof Error) throw cold.error;
          throw new Error("profile-logout-cold-closure-unproved", { cause: cold.error });
        }
        return;
      }
      const resource = resources.get(profileId), entry = resource?.ordinary;
      if (entry?.context !== undefined && entry.state !== "closed") prepareClosure(profileId);
      if (entry?.preparation?.state === "pending") await entry.preparation.completion;
      if (entry?.preparation?.state === "failed") throw entry.preparation.error;
      if (entry?.preparation?.state !== "ready") throw new Error("profile-work-drain-unproved");
    },
    async close(): Promise<void> {
      beginClose();
      for (const cold of coldLogouts.values()) { await cold.completion; if (cold.state === "failed") throw cold.error; }
      try { await session.closeOnboarding(); }
      catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      for (const [profileId, entry] of resources) {
        const ordinary = entry.ordinary;
        if (ordinary?.context === undefined || ordinary.state === "closed") continue;
        prepareClosure(profileId);
        if (ordinary.preparation?.state === "pending") {
          try { await ordinary.preparation.completion; }
          catch (error) { throw new RuntimeCustodyUncertainError([error]); }
        }
        if (ordinary.preparation?.state === "failed") throw new RuntimeCustodyUncertainError([ordinary.preparation.error]);
        if (ordinary.preparation?.state !== "ready") throw new RuntimeCustodyUncertainError([new Error("profile-resource-closure-unproved")]);
        try { ordinary.context.database.close(); ordinary.state = "closed"; }
        catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      }
      try {
        session.close();
      } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
    },
  });
}

const STORAGE_USAGE = [
  "usage: storage doctor [--json]",
  "       storage upgrade [--plan] [--machine-control] [--timeline-from <verified-copy-directory>] [--json]",
  "       storage cancel-queued-runs --plan [--json]",
  "       storage cancel-queued-runs --capture <digest> --apply [--json]",
  "       storage repair-span-root --run <run-id> [--json]",
  "  doctor   read-only authority + span reconciliation + backup report (ref dashboard-surfaces); exit 0 only when",
  "           authority, recovery inspection, credentials and span reconciliation are healthy; backup is reported, not gated",
  "  backup   write ONE verified authority backup + manifest under the state root's backups/authority;",
  "           this command is the only backup writer — the dashboard runs no cadence",
  "           rebuilding projections against the staged copy first; the runtime must be",
  "           stopped and the manifest is never chosen for you",
  "  repair-span-root  append one marked SQLite run.queued root reconstructed from exact",
  "           run/session/start-plan authority; existing span bytes stay unchanged and",
  "           the runtime must be stopped",
].join("\n");

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h${String(minutes % 60)}m`;
}

function formatReport(report: StorageDoctorReport): string {
  const lines: string[] = [];
  lines.push(`authority storage doctor — ${report.mode} — checked ${report.checkedAt}`);
  if (report.authority.state === "healthy") {
    const { schemaVersion, authorityGeneration, pageCount } = report.authority.inspection;
    lines.push(
      `authority: healthy (schema v${String(schemaVersion)}, generation ${String(authorityGeneration)}, `
      + `${String(pageCount)} pages, quick_check ok)`,
    );
  } else {
    lines.push(`authority: DEGRADED — ${report.authority.cause.code}: ${report.authority.cause.summary}`);
  }
  lines.push(report.recovery.state === "clear" ? "recovery: clear (no interruption markers; not runtime admission)"
    : `recovery: ${report.recovery.state.toUpperCase()}${report.recovery.state === "unavailable" ? ` — ${report.recovery.cause.summary}` : " — preserve evidence and settle the exact interrupted operation"}`);
  if (report.recovery.state !== "clear") for (const finding of report.recovery.findings) {
    lines.push(`  ${finding.marker}: ${finding.state}`);
  }
  lines.push(report.protectedSettings.state === "available"
    ? `protected settings: ${report.protectedSettings.entries.map(({ name, present }) => `${name}=${present ? "present" : "absent"}`).join(" · ")}`
    : `protected settings: unavailable — ${report.protectedSettings.cause.summary}`);
  lines.push(report.authorityUpgrades.state === "available"
    ? `authority upgrades: ${report.authorityUpgrades.phases.map(({ phase, fromSchemaVersion, toSchemaVersion }) => `${phase} v${String(fromSchemaVersion)} → v${String(toSchemaVersion)}`).join(" · ")}`
    : `authority upgrades: ${report.authorityUpgrades.state}`);
  if (report.counts.state === "available") {
    const values = report.counts.values;
    lines.push(
      `pending: commands ${String(values.pendingCommands)} · write intents ${String(values.unresolvedWriteIntents)} `
      + `· leases ${String(values.leases)} `
      + `· provider reservations ${String(values.providerReservations)} `
      + `· artifact outbox ${String(values.artifactOutbox)}`,
    );
  } else {
    lines.push(`pending: unavailable — ${report.counts.cause.code}: ${report.counts.cause.summary}`);
  }
  if (report.spanAuthority.state === "reconciled") {
    lines.push(
      `span authority: reconciled (${String(report.spanAuthority.streamRunCount)} stream runs; `
      + `${String(report.spanAuthority.archived.length)} archived; `
      + `${String(report.spanAuthority.deleted.length)} deleted)`,
    );
  } else if (report.spanAuthority.state === "degraded") {
    const problemSummary = report.spanAuthority.problems.map((problem) => {
      switch (problem.state) {
        case "missing": return `${problem.runId} missing authority${problem.possibleExternalWrite === true ? "; possibleExternalWrite=true" : ""}`;
        case "restore-loss": return `${problem.runId} newer preserved authority evidence${problem.possibleExternalWrite === true ? "; possibleExternalWrite=true" : ""}`;
        case "missing-span": return `${problem.runId} missing span root`;
        case "malformed": return `${problem.runId} malformed in ${problem.table}`;
        case "malformed-authority": return `${problem.recordKey} malformed in ${problem.source} authority`;
      }
    }).join(", ");
    lines.push(`span authority: DEGRADED — ${problemSummary}`);
  } else {
    lines.push(
      `span authority: unavailable — ${report.spanAuthority.cause.code}: ${report.spanAuthority.cause.summary}`,
    );
  }
  if (report.tombstoneOrdinals.state === "available") {
    for (const finding of report.tombstoneOrdinals.findings) {
      lines.push(`tombstone-ordinal-unknown: ${finding.runId} missing ${finding.missingFields.join(", ")}`);
    }
  } else {
    lines.push("tombstone ordinals: unavailable");
  }
  if (report.backup.state === "current") {
    const latest = report.backup.latest;
    const gap = latest.generationGap.state === "known"
      ? `generation gap ${String(latest.generationGap.value)}`
      : `generation gap unknown (${latest.generationGap.reason})`;
    lines.push(`backup: current — ${latest.backupFileName} (age ${formatAge(latest.ageMs)}, ${gap})`);
  } else {
    lines.push(`backup: ${report.backup.state.toUpperCase()} — ${report.backup.cause.code}: ${report.backup.cause.summary}`);
  }
  const reconciliation = summarizeSpanAuthorityReconciliation(report.spanAuthority);
  lines.push(`span/authority: ${reconciliation.state === "healthy" ? "healthy" : "DEGRADED"} — ${reconciliation.summary}`);
  if (report.spanAuthority.state !== "unavailable") {
    for (const archived of report.spanAuthority.archived) {
      lines.push(`  archived: ${archived.runId}`);
    }

    for (const deleted of report.spanAuthority.deleted) {
      lines.push(
        `  deleted: ${deleted.runId} — ${deleted.workflow} · trace ${deleted.traceId} `
        + `· ${deleted.origin} · ${deleted.deletedAt}`,
      );
    }
  }
  if (report.spanAuthority.state === "degraded") {
    for (const problem of report.spanAuthority.problems) {
      lines.push(`  ${problem.state}: ${"runId" in problem ? problem.runId : problem.recordKey}`);
    }
  }
  lines.push(`restore candidates (${String(report.restoreCandidates.length)}):`);
  for (const candidate of report.restoreCandidates) {
    if (candidate.state === "verified-compatible") {
      lines.push(
        `  verified bytes ${candidate.manifestFileName} — ${candidate.selection}; restore ${candidate.restoreEligibility.state}; created ${candidate.createdAt}, `
        + `generation ${String(candidate.authorityGeneration)}, age ${formatAge(candidate.ageMs)}`,
      );
    } else {
      lines.push(`  INVALID ${candidate.manifestFileName} — ${candidate.cause.code}: ${candidate.cause.summary}`);
    }
  }
  return lines.join("\n");
}

function formatSpanRootRepairReport(report: SpanRootRepairReport): string {
  return [
    `span root repair — ${report.state} ${report.repairedAt}`,
    `run: ${report.runId}`,
    `timeline event: ${report.eventId}`,
    `authority: generation ${String(report.sourceAuthorityGeneration)} · ${report.sourceAuthorityFingerprint}`,
    `prior ingestion cursor: ${String(report.priorCursor)}`,
  ].join("\n");
}

/** The whole `cause` chain, so a refusal names the condition and not just its wrapper. */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join(" ← ");
}


function rebuildStagedProjections(
  stateRoot: string,
  appVersion: string,
  clock: Clock,
  admission: RuntimeAdmission,
): (stagedPath: string, restoreAdmission: OfflineMaintenanceOperation) => Promise<void> {
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
  return async (stagedPath: string, restoreAdmission: OfflineMaintenanceOperation): Promise<void> => {
    const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission);
    let staged: AuthorityDatabase;
    try {
      staged = AuthorityDatabase.openStoppedRestoreProjection(
        stagedAdmission,
        { path: stagedPath, busyTimeoutMs: 5000, migrationOwner: "rebuild-storage-restore" },
        clock,
      );
    } catch (error) {
      stagedAdmission.release();
      throw error;
    }
    try {
      const projection = createRunQueueProjection({
        timeline: staged.authority.timelineEvents,
        reader: new RunRecordService({ database: staged, clock,
          ids: { uuid: () => { throw new Error("restore projector cannot mint ids"); } },
          publishQueued: () => { throw new Error("restore projector cannot publish runs"); },
        }),
        stateRoot,
        clock,
        appVersion,
        descriptorSetHash: setHash,
        ledger: createTransactionHistory(staged.authority),
        authority: {
          listNotifications: (actorId) => staged.authority.notifications.listByActor(actorId),
          latestNotificationSource: (notificationId) => staged.authority.notificationPublications.latest(notificationId),
          listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => staged.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
          listCheckpoints: (workflowId, itemId) => staged.authority.runCheckpoints.listByItem(workflowId, itemId),
          listGateResults: runId => staged.authority.gateResults.listByRun(runId),
          listLiveWorkerLeases: () => staged.authority.workerLeases.listLive(),
          getWorkerLease: (workerId) => staged.authority.workerLeases.get(workerId),
          listWorkerPools: () => staged.authority.workerPools.list(),
          listRunBatches: () => staged.authority.runSessions.list(),
          getRunBatch: (id) => staged.authority.runSessions.get(id),
          getFailure: (failureId) => staged.authority.failures.get(failureId),
          getReceipt: (runId) => staged.authority.evidenceReceipts.findByRun(runId),
          canonicalPerson: (runId) => staged.canonicalPerson(runId),
          latestCheckpoint: (workflowId, itemId, nodeId) =>
            staged.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
        },
        descriptors: { resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor },
      });
      projection.rebuildFromTimeline();
      const health = projection.health();
      if (health.state === "degraded") {
        // A failed projection rebuild refuses restore instead of serving empty surfaces.
        throw new Error(
          `projection rebuild over the staged restore is degraded: ${health.lastError ?? "unknown"}`,
        );
      }
    } finally {
      staged.close();
      stagedAdmission.release();
    }
  };
}

async function repairSpanRootCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  _repoRoot: string,
  admission: RuntimeAdmission,
): Promise<StorageCommandOutcome> {
  const runIndex = rest.indexOf("--run");
  const runId = runIndex === -1 ? undefined : rest[runIndex + 1];
  if (runId === undefined || runId.startsWith("--")) {
    return {
      output: `storage repair-span-root requires one exact run id: --run <run-id>\n${STORAGE_USAGE}`,
      exitCode: 2,
    };
  }
  const operation = admission.acquireOfflineMaintenance();
  try {
    const json = rest.includes("--json");
    const stateRoot = admission.stateRoot;
    const authorityPath = join(stateRoot, "state.db");
    const processLockRoot = join(offlineMaintenanceWorkspace(operation), isolation.processLockRoot);
    const service = new OfflineSpanRootRepairService(profileBrowserClosure, admission, {
      stateRoot,
      authorityPath,
      processLockRoot,
      busyTimeoutMs: 5000,
    }, clock);
    const report = await service.repair({ runId }, operation);
    return {
      output: json ? JSON.stringify(report, null, 2) : formatSpanRootRepairReport(report),
      exitCode: 0,
    };
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission, restore: operation });
    try { if (isOfflineMaintenanceOperationActive(operation)) operation.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission, restore: operation }); }
    return {
      output: [
        `span root repair REFUSED — ${messageChain(error)}`,
        "rerun doctor before deciding the next action; an exact repeat reuses the retained marked event without another append",
      ].join("\n"),
      exitCode: 1,
    };
  }
}


export async function composeStorageCommand(
  isolation: RuntimeIsolation,
  args: readonly string[],
  clock: Clock = systemClock,
  repoRoot: string = process.cwd(),
  admissionInput?: RuntimeAdmission,
  credentials?: CredentialStore,
): Promise<StorageCommandOutcome> {
  const admission = requireRuntimeAdmission(admissionInput);
  const [subcommand, ...rest] = args;
  if (subcommand === "upgrade") {
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === "--plan" || argument === "--json" || argument === "--machine-control") continue;
      return { output: `unsupported storage upgrade argument: ${argument ?? "missing"}\n${STORAGE_USAGE}`, exitCode: 2 };
    }
    const operation = admission.acquireOfflineMaintenance();
    try {
      if (rest.includes("--machine-control")) {
        const allowed = new Set(["--machine-control", "--plan", "--json"]);
        if (rest.some((argument) => !allowed.has(argument)) || new Set(rest).size !== rest.length) {
          operation.release();
          return { output: `unsupported storage upgrade argument: ${rest.find((argument) => !allowed.has(argument)) ?? "duplicate"}\n${STORAGE_USAGE}`, exitCode: 2 };
        }
        const { upgradeStoppedMachineControl } = await import("../../storage/maintenance/upgrade.js");
        const { composeStoppedControlCredentialInventory } = await import("./profile-credential-inventory.js");
        const { hostConfigFacts } = await import("../../../models/config/host-display.js");
        const { workerBootstrapEnvironment } = await import("../../../models/config/secrets.js");
        const report = await upgradeStoppedMachineControl(admission, { plan: rest.includes("--plan"), hostFacts: hostConfigFacts(workerBootstrapEnvironment()) }, clock, composeStoppedControlCredentialInventory, createNativeBrowserProbe);
        operation.release();
        return { output: rest.includes("--json") ? JSON.stringify(report) : `storage upgrade: machine-control ${report.state} (${String(report.profileCount)} profiles)\nruntime access: ${report.runtimeAccess}${report.state === "planned" ? "\nBrowser closure will be checked when the upgrade runs." : ""}`, exitCode: 0 };
      }
      const { upgradeStorage } = await import("../../storage/maintenance/upgrade.js");
      const report = await upgradeStorage(profileBrowserClosure, admission,{ stateRoot: admission.stateRoot,
        processLockRoot: join(offlineMaintenanceWorkspace(operation), isolation.processLockRoot), plan: rest.includes("--plan") }, clock, operation);
      operation.release();
      return { output: rest.includes("--json") ? JSON.stringify(report, null, 2) : [
        `storage upgrade: ${report.state} (v${String(report.fromSchemaVersion)} → v${String(report.toSchemaVersion)})`,
        "credentials: unchanged",
        ...(report.diagnostics === undefined ? [] : [
          `diagnostic stages: ${String(report.diagnostics.reclaimedStages)} reclaimed, ${String(report.diagnostics.retainedStages)} retained${report.diagnostics.capacityWarning ? "; retained evidence remains budget-accounted" : ""}`,
        ]),
      ].join("\n"), exitCode: 0 };
    } catch (error) {
      if (error instanceof OfflineMaintenanceOperationUnavailableError && error.reason === "offline-maintenance-already-consumed") throw error;
      if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission, restore: operation });
      operation.release();
      // Unvalidated parser/OS error text can contain input. Emit only a named outcome.
      const code = error instanceof Error ? /^([a-z]+(?:-[a-z]+)+)(?:[: {]|$)/u.exec(error.message)?.[1] : undefined;
      const candidateKey = error instanceof Error ? /\{ key: ([A-Za-z0-9.*_-]+) \}/u.exec(error.message)?.[1] : undefined;
      const key = candidateKey !== undefined && SETTINGS_CATALOG.some((row) => row.key === candidateKey
        || (row.key.startsWith("urls.") && candidateKey.startsWith(`${row.key}.`))) ? candidateKey : undefined;
      const report = { state: "refused-or-incomplete", code: code ?? "upgrade-validation-failed", ...(key === undefined ? {} : { key }) };
      return { output: rest.includes("--json") ? JSON.stringify(report) : `storage upgrade: ${report.code}${key === undefined ? "" : ` { key: ${key} }`}; inspect state before retrying`, exitCode: 1 };
    }
  }
  if (subcommand === "repair-span-root") return repairSpanRootCommand(isolation, rest, clock, repoRoot, admission);
  if (subcommand !== "doctor") {
    return { output: STORAGE_USAGE, exitCode: subcommand === undefined ? 1 : 2 };
  }
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const report = await doctorAuthorityStorage(admission, {
    stateRootTrustAnchor: resolve(stateRoot, ".."),
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    busyTimeoutMs: 5000,
  }, clock, credentials);
  const healthy = report.authority.state === "healthy"
    && report.recovery.state === "clear"
    && report.spanAuthority.state === "reconciled"
    && report.protectedSettings.state === "available";
  return {
    output: json ? JSON.stringify(report, null, 2) : formatReport(report),
    exitCode: healthy ? 0 : 1,
  };
}

export function composeProfileAssistantAuthorization(
  runtime: ReturnType<typeof composeProfileRuntime>, token: string, kernel: CommandKernel, clock: Clock,
) {
  runtime.assertCurrent(token);
  const context = runtime.selectedContext(token);
  return createAssistantAuthorization({ database: context.database, kernel, clock, current: () => {
    runtime.assertCurrent(token);
    if (runtime.selectedContext(token) !== context) throw new Error("assistant-profile-owner-changed");
    return { profileId: context.admission.profileBinding.profileId, epoch: context.profileEpoch };
  } });
}
