import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { createTimeoutDeadlineScheduler } from "../../runtime/scheduling/timeout-deadline-scheduler.js";
import { assertNativeBrowserProfilesClosed, assertPrivateProfilePath, NativeBrowserClosureUnprovedError, probeClosedBrowserProfile, workerProfileDirectory } from "../../runtime/browser/native-profile-probe.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { CredentialLockRecordSchema, readPrivateFile } from "../configuration/credential-safe-file.js";
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { observeRuntimeLockSnapshot, inspectRuntimeProcessOrphans } from "../sqlite/runtime-process-locks.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { ProfileBrowserRootRefusalError } from "../admission/admission-identity.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { resolveConfigWithProvenance } from "../../app/config/resolve.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { verifyStoppedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { countProfileCredentialLoginRows } from "../sqlite/profile-local-databases.js";
import { readRuntimeProcessLock } from "../sqlite/runtime-process-locks.js";

type CredentialMembershipCustody = Pick<ReturnType<AuthorityDatabase["readProfileResourceCustody"]>, "slots" | "reservations" | "verificationProfiles" | "browsers" | "configSnapshots" | "controls" | "artifactReferences" | "upgrades">;

export function retainedBrowserProfiles(root: string, custody: CredentialMembershipCustody, savedBrowserRoot: string) {
  const profiles = new Map<string, { profileRoot: string; profileDirectory: string; cleanupCompleted: boolean }>();
  const roots = [...new Set([...custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot), savedBrowserRoot])];
  for (const path of roots) assertBrowserRoot(root, path);
  for (const browser of custody.browsers) {
    const slot = custody.slots.find(value => value.workerId === browser.workerId);
    if (slot === undefined) throw new Error("profile-inventory-browser-membership-unavailable");
    const verification = custody.verificationProfiles.find(value => value.workerId === slot.workerId);
    const selectedRoots = verification === undefined
      ? [...new Set(custody.configSnapshots.filter(snapshot => snapshot.fingerprint === browser.configFingerprint).map(snapshot => snapshot.config.paths.browserProfileRoot))]
      : [join(root, "scratch", "live-smoke", verification.profileRunId, "browsers")];
    const profileRoot = selectedRoots[0];
    if (selectedRoots.length !== 1 || profileRoot === undefined || verification !== undefined && verification.system !== browser.system
      || browser.profileDirectory !== workerProfileDirectory({profileRoot,slotOrdinal:slot.ordinal,system:browser.system})) throw new Error("profile-inventory-browser-membership-unavailable");
    const control = custody.controls.find(value => value.commandId === slot.retirementCommandId);
    const acknowledgement = control?.phase.state === "succeeded" && control.auditedAt !== undefined ? control.phase.acknowledgement : undefined;
    const proof = acknowledgement?.kind === "remove" ? acknowledgement.retirement
      : acknowledgement?.kind === "plan" ? acknowledgement.retirements.find(value => value.workerId === slot.workerId) : undefined;
    const cleanupCompleted = slot.retiredAt !== null && (verification !== undefined ? verification.cleanup === "closed"
      : proof !== undefined && proof.workerId === slot.workerId && proof.membershipRevision + 1 === slot.membershipRevision);
    profiles.set(browser.profileDirectory, {profileRoot,profileDirectory:browser.profileDirectory,cleanupCompleted});
  }
  return [...profiles.values()];
}

function nativeProbeProfiles(root: string, custody: CredentialMembershipCustody, config: import("../../../models/config/schema.js").Config) {
  const profiles = retainedBrowserProfiles(root, custody, config.paths.browserProfileRoot).filter(profile => {
    assertPrivateProfilePath(profile.profileRoot, profile.profileDirectory);
    if (lstatSync(profile.profileDirectory, {throwIfNoEntry:false}) !== undefined) return true;
    if (!profile.cleanupCompleted) throw new NativeBrowserClosureUnprovedError([new Error("retained-browser-profile-missing-without-owned-cleanup")]);
    return false;
  }).map(({profileRoot,profileDirectory})=>({profileRoot,profileDirectory}));
  return profiles;
}

export function assertRetainedBrowsersClosed(admission: RuntimeAdmission, custody: CredentialMembershipCustody, config: import("../../../models/config/schema.js").Config): void {
  admission.assertLive();
  assertNativeBrowserProfilesClosed(nativeProbeProfiles(admission.stateRoot, custody, config), {
    launchTimeoutMs: config.timeouts.sessionAcquireMs, closeProofMs: config.browser.closeProofMs,
  });
  admission.assertLive();
}

export async function probeRetainedBrowsersClosed(input: Readonly<{
  admission: RuntimeAdmission; custody: CredentialMembershipCustody; config: import("../../../models/config/schema.js").Config;
  clock: Clock; signal: AbortSignal;
}>): Promise<void> {
  input.admission.assertLive();
  await probeProfileSet(nativeProbeProfiles(input.admission.stateRoot,input.custody,input.config),input.config,input.clock,input.signal);
  input.admission.assertLive();
}

async function probeProfileSet(profiles: ReturnType<typeof nativeProbeProfiles>, config: import("../../../models/config/schema.js").Config, clock: Clock, signal: AbortSignal) {
  for (const profile of profiles) {
    await probeClosedBrowserProfile({profileRoot:profile.profileRoot,
      launch:{profileDirectory:profile.profileDirectory,extensionDirectory:"",downloadsPath:profile.profileDirectory,
        viewport:{width:800,height:600},timeoutMs:config.timeouts.sessionAcquireMs},
      clock,scheduler:createTimeoutDeadlineScheduler(clock),closeProofMs:config.browser.closeProofMs,signal});
  }
}

export async function probeFlatBrowserInventoryClosed(root: string, custody: ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>, clock: Clock) {
  const settings = custody.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
    : custody.settingsAuthority.record.saved?.settings ?? custody.settingsAuthority.record.initialization.settings.settings;
  const config = resolveConfigWithProvenance(settings,{primaryDisplay:null},clock,{stateRoot:root,artifactRoot:join(root,"artifacts")}).config;
  await probeProfileSet(nativeProbeProfiles(root,custody,config),config,clock,new AbortController().signal);
}

function stoppedBrowserFacts(admission: RuntimeAdmission, clock: Clock, processLockRoot?: string) {
  admission.assertLive();
  const custody = processLockRoot === undefined ? AuthorityDatabase.readProfileMaintenanceInventory(admission)
    : AuthorityDatabase.readStoppedBrowserInventory(admission,processLockRoot,clock);
  const settings = custody.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
    : custody.settingsAuthority.record.saved?.settings ?? custody.settingsAuthority.record.initialization.settings.settings;
  const config = resolveConfigWithProvenance(settings,{primaryDisplay:null},clock,
    {stateRoot:admission.stateRoot,artifactRoot:admission.artifactRoot}).config;
  return {custody,config};
}

export function assertStoppedProfileBrowsersClosed(admission: RuntimeAdmission, clock: Clock): void {
  const {custody,config}=stoppedBrowserFacts(admission,clock);
  assertRetainedBrowsersClosed(admission,custody,config);
}

export async function probeStoppedProfileBrowsersClosed(admission: RuntimeAdmission, clock: Clock, processLockRoot?: string): Promise<void> {
  await probeRetainedBrowsersClosed({admission,...stoppedBrowserFacts(admission,clock,processLockRoot),clock,signal:new AbortController().signal});
}

export function assertRetainedProfileBrowserRoot(admissionInput: RuntimeAdmission, path: string): void {
  const admission = requireRuntimeAdmission(admissionInput), root = admission.stateRoot;
  assertBrowserRoot(root, path);
  admission.assertStateRoot(path);
}

function assertBrowserRoot(root: string, path: string): void {
  const child = relative(root, path);
  if (!isAbsolute(path) || resolve(path) !== path || child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new ProfileBrowserRootRefusalError();
  if (["credentials", "backups", "artifacts", "logs", "scratch", "state.db", "state.db-wal", "state.db-shm"].includes(child.split(sep)[0] ?? "")) throw new ProfileBrowserRootRefusalError();
  for (let current = path;; current = dirname(current)) {
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink() || process.getuid !== undefined && info.uid !== process.getuid() || (info.mode & 0o022) !== 0)) throw new ProfileBrowserRootRefusalError();
    if (current === root) break;
  }
}

export function inventoryFileIdentity(path: string) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || info.isFile() && info.nlink !== 1
    || process.getuid !== undefined && info.uid !== process.getuid() || (info.mode & 0o022) !== 0) throw new Error("profile-inventory-path-unsafe");
  return { path, directory: info.isDirectory(), device: info.dev, inode: info.ino, size: info.size,
    mode: info.mode, modified: info.mtimeMs, changed: info.ctimeMs };
}

export function enumerateProfileCredentialMembership<Custody extends CredentialMembershipCustody>(admission: RuntimeAdmission, custody: Custody, savedBrowserRoot: string, ownedWriter?: Readonly<{ acquisitionId: string; pid: number }>) {
  admission.assertLive();
  const root = admission.stateRoot, flat = admission.profileMaintenanceSchemaVersion() === 6;
  if (admission.artifactRoot !== join(root, "artifacts")) throw new Error("profile-inventory-artifact-root-unavailable");
  return enumerateCredentialMembership(root, flat, custody, savedBrowserRoot, path => admission.assertStateRoot(path), ownedWriter);
}

export function enumerateFlatBackupRecoveryMembership<Custody extends CredentialMembershipCustody>(root: string, custody: Custody) {
  return enumerateCredentialMembership(root, true, custody, join(root, "browsers"), path => {
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("flat-backup-recovery-path-refused");
  });
}

function enumerateCredentialMembership<Custody extends CredentialMembershipCustody>(root: string, flat: boolean, custody: Custody,
  savedBrowserRoot: string, assertPath: (path: string) => void,
  ownedWriter?: Readonly<{ acquisitionId: string; pid: number }>) {
    const profiles = retainedBrowserProfiles(root, custody, savedBrowserRoot);
    const browserRootPaths = [...new Set([...custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot), savedBrowserRoot,
      ...profiles.map(profile => profile.profileRoot)])];
    for (const path of browserRootPaths) assertPath(path);
    if (browserRootPaths.some(path => browserRootPaths.some(other => other !== path && path.startsWith(`${other}${sep}`)))) throw new Error("profile-inventory-browser-root-ambiguous");
    const identities: ReturnType<typeof inventoryFileIdentity>[] = [], copies: string[] = [], loginDataPaths: string[] = [], unsupported: string[] = [];
    const backupPaths: string[] = [], manifests: string[] = [];
    if (custody.browsers.some(browser => browser.health !== "closed")) throw new Error("profile-inventory-browser-closure-unproved");
    const browserRoots = new Set(profiles.map(profile => profile.profileDirectory));
    const visit = (path: string): void => {
      assertPath(path);
      const entry = inventoryFileIdentity(path);
      identities.push(entry);
      const local = relative(root, path), parts = local.split(sep), top = parts[0];
      if (flat && (local === ".runtime-owner.json" || local === "artifacts/.runtime-owner.json" || local === "locks")) return;
      if (top === "files") {
        if (entry.directory) for (const name of readdirSync(path).sort()) visit(join(path, name));
        else { copies.push(path); unsupported.push(path); }
        return;
      }
      if (local === "") { for (const name of readdirSync(path).sort()) visit(join(path, name)); return; }
      const configuredBrowserRoot = browserRootPaths.find(browserRoot => path === browserRoot || path.startsWith(`${browserRoot}${sep}`));
      const browserAncestor = browserRootPaths.some(browserRoot => browserRoot.startsWith(`${path}${sep}`));
      if (top === undefined || !configuredBrowserRoot && !browserAncestor && !["credentials", "backups", "browsers", "artifacts", "logs", "scratch", "state.db", "state.db-wal", "state.db-shm"].includes(top)) {
        throw new Error("profile-inventory-unowned-entry");
      }
      if (entry.directory) {
        if (configuredBrowserRoot !== undefined) {
          const browserParts = relative(configuredBrowserRoot, path).split(sep).filter(Boolean);
          if (browserParts.length === 1 && !custody.slots.some(slot => `w${slot.ordinal}` === browserParts[0])) throw new Error("profile-inventory-browser-membership-unavailable");
          if (browserParts.length === 2 && !browserRoots.has(path)) throw new Error("profile-inventory-browser-membership-unavailable");
        }
        if (top === "backups" && parts.length === 2 && !["authority", "suspects"].includes(parts[1] ?? "")) throw new Error("profile-inventory-backup-unowned");
        if (top === "credentials" && parts.length !== 1 || top === "artifacts" && parts.length !== 1 || top === "logs" && parts.length !== 1) throw new Error("profile-inventory-unowned-entry");
        for (const name of readdirSync(path).sort()) visit(join(path, name));
        return;
      }
      if (top.startsWith("state.db")) { if (parts.length !== 1) throw new Error("profile-inventory-unowned-entry"); return; }
      if (top === "credentials") {
        if (parts.length === 2 && parts[1] === ".protected.lock" && ownedWriter !== undefined) {
          const file = readPrivateFile(path, { label: "lock", maxBytes: 4096 });
          if (file === undefined) throw new Error("credential-maintenance-writer-required");
          const lock = CredentialLockRecordSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
          if (lock.acquisitionId !== ownedWriter.acquisitionId || lock.pid !== ownedWriter.pid || lock.kind !== "writer") throw new Error("credential-maintenance-writer-mismatch");
          return;
        }
        if (parts.length !== 2 || !["protected.json", "chatgpt-account.json", "duo-webauthn.json"].includes(parts[1] ?? "")
          && !/^\.protected\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/u.test(parts[1] ?? "")) throw new Error("profile-inventory-credential-unowned");
        if (parts[1] !== "protected.json") copies.push(path);
        return;
      }
      if (top === "backups") {
        if (parts.length !== 3 || parts[1] !== "authority") throw new Error("profile-inventory-backup-unverified");
        if (path.endsWith(".manifest.json")) manifests.push(path);
        else backupPaths.push(path);
        return;
      }
      if (configuredBrowserRoot !== undefined || top === "browsers") {
        if (configuredBrowserRoot === undefined) throw new Error("profile-inventory-browser-root-unowned");
        const browserParts = relative(configuredBrowserRoot, path).split(sep);
        if (browserParts.length < 3 || !browserRoots.has(join(configuredBrowserRoot, ...browserParts.slice(0, 2)))) throw new Error("profile-inventory-browser-membership-unavailable");
        if (basename(path) === "Login Data") loginDataPaths.push(path);
        else if (!["Local State", "Preferences", "Secure Preferences"].includes(basename(path))) unsupported.push(path);
        copies.push(path);
        return;
      }
      if (top === "artifacts") {
        if (!custody.artifactReferences.some(ref => basename(path) === `${ref.sha256}.artifact`)) throw new Error("profile-inventory-artifact-unowned");
        unsupported.push(path);
      } else if (top !== "logs" || parts.length !== 2 || parts[1] !== "boot.jsonl") throw new Error("profile-inventory-unowned-entry");
      copies.push(path);
    };
    visit(root);
    for (const ref of custody.artifactReferences) {
      if (!identities.some(entry => entry.path === join(root, "artifacts", `${ref.sha256}.artifact`))) throw new Error("profile-inventory-artifact-missing");
    }
    return { custody, savedBrowserRoot, identities, copies, loginDataPaths, unsupported, backupPaths, manifests };
}

export function credentialCopyProcessCustody(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; clock: Clock }>) {
  const { machine, admission } = input;
  machine.assertLive(); admission.assertLive();
  const installation = machine.readInstallationContext();
  if (installation === undefined) throw new Error("credential-maintenance-installation-required");
  const binding = admission.profileBinding, profileRoot = admission.stateRoot;
  if (binding.installationId !== installation.locator.installationId
    || profileRoot !== join(machine.stateRoot, "profiles", binding.profileId)) throw new Error("profile-inventory-owner-mismatch");
  const processLockRoot = join(installation.workspace, rebuildRuntimeIsolation.processLockRoot);
  machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
  const locks = observeRuntimeLockSnapshot({ processLockRoot,
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(profileRoot, "state.db")) }, input.clock);
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (Object.entries(locks.processLocks).some(([name, state]) => name !== "server" && state.state !== "stopped")
    || orphans.staleWorkerRecords > 0) throw new Error("credential-maintenance-process-custody-unproved");
  return { processLocks: locks.processLocks, runtimeGeneration: locks.runtimeGeneration, orphans };
}

export function assertCredentialCopyResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  if (facts.reservations.some(reservation => reservation.state === "pending")
    || facts.slots.some(slot => slot.retiredAt === null && !facts.leases.some(lease => lease.workerId === slot.workerId))
    || facts.leases.some(lease => !facts.slots.some(slot => slot.workerId === lease.workerId))
    || facts.writeIntents.some(intent => intent.status !== "committed" && intent.status !== "observed-present") || facts.pendingArtifacts.length > 0
    || facts.leases.some(lease => lease.lifecycle.state !== "stopped") || facts.browsers.some(browser => browser.health !== "closed")
    || facts.duoLeases.some(lease => lease.state === "held") || facts.controls.some(control => control.auditedAt === undefined)
    || facts.runs.some(run => run.lifecycle.state !== "terminal")) throw new Error("credential-maintenance-custody-unproved");
}

export function readStoppedProfileUpgradeInventory(input: Readonly<{
  machine: RuntimeAdmission; admission: RuntimeAdmission; clock: Clock; hostFacts: HostConfigFacts;
}>) {
  const { machine, admission } = input;
  admission.assertReadyStoppedProfileUpgradeOwner(machine);
  const process = credentialCopyProcessCustody(input);
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("profile-stopped-upgrade-installation-required");
  const processLockRoot = resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  const geocode = readRuntimeProcessLock(processLockRoot, "geocode");
  if (Object.values(process.processLocks).some(lock => lock.state !== "stopped")
    || process.orphans.staleServerRecords !== 0 || process.orphans.staleWorkerRecords !== 0
    || geocode?.releasedAt === null) throw new Error("profile-stopped-upgrade-process-custody-unproved");
  const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
  assertCredentialCopyResourcesClosed(facts);
  if (facts.settingsAuthority.state !== "initialized") throw new Error("profile-stopped-upgrade-settings-required");
  const settings = facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
  const probeConfig = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
    { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
  assertRetainedBrowsersClosed(admission,facts,probeConfig);
  const savedBrowserRoot = probeConfig.paths.browserProfileRoot;
  const membership = enumerateProfileCredentialMembership(admission, facts, savedBrowserRoot);
  if (membership.unsupported.length !== 0) throw new Error("profile-stopped-upgrade-copy-custody-unproved");
  const backups = membership.manifests.map(path => verifyStoppedBackupManifestAtPath(admission, path,
    AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))));
  if (membership.backupPaths.length !== backups.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))
    || backups.some(backup => backup.manifest.installationId !== admission.profileBinding.installationId
      || backup.manifest.profileId !== admission.profileBinding.profileId)) throw new Error("profile-stopped-upgrade-backup-membership-unproved");
  const login = countProfileCredentialLoginRows(membership.loginDataPaths);
  if (login === "unreadable" || typeof login === "number" && login > 0) throw new Error("profile-stopped-upgrade-login-copy-present");
  admission.assertReadyStoppedProfileUpgradeOwner(machine);
  return Object.freeze({ ...process, facts, membership, backups });
}
