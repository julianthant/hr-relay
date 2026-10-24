import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { workerProfileDirectory } from "../../runtime/browser/browser-session-factory.js";
import { CredentialLockRecordSchema, readPrivateFile } from "../configuration/credential-safe-file.js";
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { observeRuntimeLockSnapshot, inspectRuntimeProcessOrphans } from "../sqlite/runtime-process-locks.js";
import { ProfileBrowserRootRefusalError, type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { resolveConfigWithProvenance } from "../../app/config/resolve.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { verifyStoppedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { countProfileCredentialLoginRows } from "../../profiles/credential-inventory.js";
import { readRuntimeProcessLock } from "../sqlite/runtime-process-locks.js";

type CredentialMembershipCustody = Pick<ReturnType<AuthorityDatabase["readProfileResourceCustody"]>, "slots" | "reservations" | "browsers" | "configSnapshots" | "artifactReferences" | "upgrades">;

export function assertRetainedProfileBrowserRoot(admissionInput: RuntimeAdmission, path: string): void {
  const admission = requireRuntimeAdmission(admissionInput), root = admission.stateRoot;
  const child = relative(root, path);
  if (!isAbsolute(path) || resolve(path) !== path || child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new ProfileBrowserRootRefusalError();
  if (["credentials", "backups", "artifacts", "logs", "scratch", "state.db", "state.db-wal", "state.db-shm"].includes(child.split(sep)[0] ?? "")) throw new ProfileBrowserRootRefusalError();
  for (let current = path;; current = dirname(current)) {
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink() || process.getuid !== undefined && info.uid !== process.getuid() || (info.mode & 0o022) !== 0)) throw new ProfileBrowserRootRefusalError();
    if (current === root) break;
  }
  admission.assertStateRoot(path);
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
  const root = admission.stateRoot;
    const browserRootPaths = [...new Set([...custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot), savedBrowserRoot])];
    if (browserRootPaths.length === 0) throw new Error("profile-inventory-config-unavailable");
    for (const path of browserRootPaths) assertRetainedProfileBrowserRoot(admission, path);
    if (browserRootPaths.some(path => browserRootPaths.some(other => other !== path && path.startsWith(`${other}${sep}`)))) throw new Error("profile-inventory-browser-root-ambiguous");
    const identities: ReturnType<typeof inventoryFileIdentity>[] = [], copies: string[] = [], loginDataPaths: string[] = [], unsupported: string[] = [];
    const backupPaths: string[] = [], manifests: string[] = [];
    const browserRoots = new Set(custody.browsers.map(browser => {
      const slot = custody.slots.find(value => value.workerId === browser.workerId);
      const roots = [...new Set(custody.configSnapshots.filter(snapshot => snapshot.fingerprint === browser.configFingerprint).map(snapshot => snapshot.config.paths.browserProfileRoot))];
      if (slot === undefined || roots.length !== 1 || browser.profileDirectory === undefined
        || browser.profileDirectory !== workerProfileDirectory({ profileRoot: roots[0], slotOrdinal: slot.ordinal, system: browser.system })) {
        throw new Error("profile-inventory-browser-membership-unavailable");
      }
      if (browser.health !== "closed") throw new Error("profile-inventory-browser-closure-unproved");
      return browser.profileDirectory;
    }));
    const visit = (path: string): void => {
      admission.assertStateRoot(path);
      const entry = inventoryFileIdentity(path);
      identities.push(entry);
      const local = relative(root, path), parts = local.split(sep), top = parts[0];
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
    if (admission.artifactRoot !== join(root, "artifacts")) throw new Error("profile-inventory-artifact-root-unavailable");
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
  const savedBrowserRoot = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
    { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config.paths.browserProfileRoot;
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
