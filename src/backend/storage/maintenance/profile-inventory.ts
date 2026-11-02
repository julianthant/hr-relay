import { lstatSync,opendirSync,readdirSync,type Dirent } from "node:fs";
import { basename,join,relative,resolve,sep } from "node:path";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { BrowserSystemIdSchema,type BrowserSystemId } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { resolveConfigWithProvenance } from "../../app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import type { InstallationLease } from "../admission/installation.js";
import { offlineMaintenanceWorkspace,type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { assertOfflineMaintenanceForProcessRoot } from "../admission/process-root.js";
import { createBrowserRoots } from "../browser-roots.js";
import { CredentialLockRecordSchema,readPrivateFile } from "../configuration/credential-safe-file.js";
import { privatePathRejects } from "../private-path.js";
import { AuthoritySourceClosureUnprovedError,hasUnprovedSourceClosure,retainAuthoritySourceClosure,retainUnprovedSourceOwners } from "../source-closure.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { verifyStoppedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { countProfileCredentialLoginRows } from "../sqlite/profile-local-databases.js";
import { inspectRuntimeProcessOrphans,observeRuntimeLockSnapshot } from "../sqlite/runtime-process-locks.js";
import { proveProfileRootsUnused } from "./process-closure.js";
import { assertCredentialCopyResourcesClosed,assertStoppedProfileResourcesClosed,configuredBrowserRoots,retainedBrowserProfiles,type BrowserProfileCustody } from "./profile-custody.js";

type CredentialMembershipCustody = Pick<ReturnType<AuthorityDatabase["readProfileResourceCustody"]>, "slots" | "reservations" | "verificationProfiles" | "browsers" | "configSnapshots" | "controls" | "artifactReferences" | "upgrades">;


export interface ProfileBrowserClosure {
  workerDirectory(input: Readonly<{ profileRoot: string; slotOrdinal: number; system: BrowserSystemId }>): string;
  probeClosed(profiles: readonly RetainedBrowserProfile[], timing: Readonly<{ launchTimeoutMs: number; closeProofMs: number }>, clock: Clock, signal: AbortSignal, owner: RuntimeAdmission | InstallationLease, operation?: OfflineMaintenanceOperation): Promise<void>;
}
export interface RetainedBrowserProfile {
  readonly profileRoot: string;
  readonly profileDirectory: string;
  readonly cleanupCompleted: boolean;
}

export async function probeRetainedBrowsersClosed(input: Readonly<{
  admission: RuntimeAdmission; custody: BrowserProfileCustody; config: import("../../../models/config/schema.js").Config;
  browserClosure: ProfileBrowserClosure; clock: Clock; signal: AbortSignal;
}>): Promise<void> {
  input.admission.assertLive();
  await input.browserClosure.probeClosed(retainedBrowserProfiles(input.admission.stateRoot, input.custody, input.config.paths.browserProfileRoot, input.browserClosure),
    { launchTimeoutMs: input.config.timeouts.sessionAcquireMs, closeProofMs: input.config.browser.closeProofMs }, input.clock, input.signal, input.admission);
  input.admission.assertLive();
}

export async function probeFlatBrowserInventoryClosed(owner: InstallationLease, operation: OfflineMaintenanceOperation, root: string, clock: Clock, browserClosure: ProfileBrowserClosure) {
  const census = flatBackupBrowserCensus(root, operation, clock);
  await browserClosure.probeClosed(census.profiles, census.timing, clock, new AbortController().signal, owner, operation);
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

export async function probeStoppedProfileBrowsersClosed(admission: RuntimeAdmission, clock: Clock, browserClosure: ProfileBrowserClosure, processLockRoot?: string): Promise<void> {
  await probeRetainedBrowsersClosed({admission,...stoppedBrowserFacts(admission,clock,processLockRoot),clock,browserClosure,signal:new AbortController().signal});
}

const stoppedBackupClosureBrand: unique symbol = Symbol("stopped-backup-closure");
export interface StoppedBackupClosure { readonly [stoppedBackupClosureBrand]: true }
const stoppedBackupClosures = new WeakMap<StoppedBackupClosure, {
  admission: RuntimeAdmission; operation: OfflineMaintenanceOperation; processLockRoot: string; clock: Clock;
  census: ReturnType<typeof stoppedBackupBrowserCensus>; layout: Pick<ProfileBrowserClosure, "workerDirectory">;
}>();

export class StorageBackupClosureUnprovedError extends Error {
  readonly code = "STORAGE_BACKUP_CLOSURE_UNPROVED";
  constructor(cause?: unknown) { super(ERROR_CATALOG.STORAGE_BACKUP_CLOSURE_UNPROVED.text, { cause }); this.name = "StorageBackupClosureUnprovedError"; }
}

function proveStoppedBackupSourceUnused(admission: RuntimeAdmission): void {
  try { proveProfileRootsUnused([admission.stateRoot, admission.artifactRoot]); }
  catch (error) {
    if (hasUnprovedSourceClosure(error)) throw error;
    throw new StorageBackupClosureUnprovedError(error);
  }
}

export function flatBackupBrowserCensus(root: string, operation: OfflineMaintenanceOperation, clock: Clock,
  timing?: Readonly<{ launchTimeoutMs: number; closeProofMs: number }>) {
  operation.assertHeld();
  const workspace = offlineMaintenanceWorkspace(operation);
  if (root !== join(workspace, rebuildRuntimeIsolation.stateRoot)) throw new StorageBackupClosureUnprovedError();
  assertOfflineMaintenanceForProcessRoot(operation, join(workspace, rebuildRuntimeIsolation.processLockRoot));
  const profileRoot = join(root, "browsers");
  if (timing === undefined) {
    const { settings } = AuthorityDatabase.readFlatArchiveInventory(join(root, "state.db"), operation);
    const config = resolveConfigWithProvenance(settings, { primaryDisplay: null }, clock, { stateRoot: root, artifactRoot: join(root, "artifacts") }).config;
    if (config.paths.browserProfileRoot !== profileRoot) throw new StorageBackupClosureUnprovedError();
    timing = { launchTimeoutMs: config.timeouts.sessionAcquireMs, closeProofMs: config.browser.closeProofMs };
  }
  const identities: Array<{ path: string; device: number; inode: number; mode: number; owner: number }> = [];
  const profiles: RetainedBrowserProfile[] = [];
  const inspect = (path: string) => {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || privatePathRejects(path, info, "group-write")) throw new StorageBackupClosureUnprovedError();
    identities.push({ path, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid });
  };
  const children = (path: string) => {
    inspect(path);
    const directory = opendirSync(path), entries: Dirent[] = [];
    let primary: { error: unknown } | undefined;
    try {
      for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
        if (entry.isSymbolicLink() || entries.length >= 64) throw new StorageBackupClosureUnprovedError();
        entries.push(entry);
      }
    } catch (error) { primary = { error }; }
    try { directory.closeSync(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { directory, restore: operation }); }
    if (primary !== undefined) throw primary.error;
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  };
  const add = (path: string) => {
    if (profiles.length >= 64) throw new StorageBackupClosureUnprovedError();
    inspect(path); profiles.push({ profileRoot, profileDirectory: path, cleanupCompleted: false });
  };
  if (lstatSync(profileRoot, { throwIfNoEntry: false }) !== undefined) for (const entry of children(profileRoot)) {
    if (!entry.isDirectory()) throw new StorageBackupClosureUnprovedError();
    const path = join(profileRoot, entry.name);
    if (/^w[1-9]\d*$/u.test(entry.name)) {
      for (const system of children(path)) {
        if (!system.isDirectory() || !BrowserSystemIdSchema.safeParse(system.name).success) throw new StorageBackupClosureUnprovedError();
        add(join(path, system.name));
      }
    } else if (/^onboarding-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-){3}g[1-9]\d*$/u.test(entry.name)) add(path);
    else throw new StorageBackupClosureUnprovedError();
  }
  return { profiles, identities, identity: canonicalJsonStringify({ profileRoot, identities, profiles }),
    timing };
}

function stoppedBackupBrowserCensus(admission: RuntimeAdmission, operation: OfflineMaintenanceOperation, clock: Clock, processLockRoot: string,
  layout: Pick<ProfileBrowserClosure, "workerDirectory">) {
  if (admission.isFlatBackup()) return flatBackupBrowserCensus(admission.stateRoot, operation, clock, admission.flatBackupTiming());
  const owner = admission;
  admission = owner.forStoppedMaintenance(operation);
  let retain = false;
  try {
    const { custody, config } = stoppedBrowserFacts(admission, clock, processLockRoot);
    const retained = retainedBrowserProfiles(admission.stateRoot, custody, config.paths.browserProfileRoot, layout);
    const binding = admission.captureBrowserRegistryContext(), rows = createBrowserRoots(admission).inventory().roots.filter(row => row.profileId === binding.profileId);
    if (rows.some(row => row.launch.state !== "closed" || row.native !== undefined)) throw new StorageBackupClosureUnprovedError();
    let physical: ReturnType<typeof restoreBrowserCensus>;
    try { physical = restoreBrowserCensus(admission, "browser-roots"); }
    catch (error) { if (hasUnprovedSourceClosure(error)) throw error; throw new StorageBackupClosureUnprovedError(error); }
    const present = retained.filter(row => lstatSync(row.profileDirectory, { throwIfNoEntry: false }) !== undefined);
    if (rows.length !== present.length || rows.some(row => !present.some(profile => profile.profileDirectory === join(binding.machineRoot, row.directory)))) throw new StorageBackupClosureUnprovedError();
    return { profiles: retained, identity: canonicalJsonStringify({ profiles: physical,
      membership: { slots: custody.slots, verificationProfiles: custody.verificationProfiles, browsers: custody.browsers, configSnapshots: custody.configSnapshots, controls: custody.controls } }),
      timing: { launchTimeoutMs: config.timeouts.sessionAcquireMs, closeProofMs: config.browser.closeProofMs } };
  } catch (error) {
    retain = hasUnprovedSourceClosure(error);
    if (retain) retainUnprovedSourceOwners(error, { admission, restore: operation });
    throw error;
  } finally { if (!retain && admission !== owner) admission.release(); }
}

export async function prepareStoppedBackupClosure(browserClosure: ProfileBrowserClosure, admission: RuntimeAdmission,
  operation: OfflineMaintenanceOperation, clock: Clock, processLockRoot: string): Promise<StoppedBackupClosure> {
  const held = () => {
    admission.assertOfflineMaintenance(operation);
    assertOfflineMaintenanceForProcessRoot(operation, processLockRoot);
  };
  const layout = { workerDirectory: (input: Parameters<ProfileBrowserClosure["workerDirectory"]>[0]) => browserClosure.workerDirectory(input) };
  try {
    held();
    const before = stoppedBackupBrowserCensus(admission, operation, clock, processLockRoot, layout);
    await browserClosure.probeClosed(before.profiles, before.timing, clock, new AbortController().signal, admission);
    held();
    const after = stoppedBackupBrowserCensus(admission, operation, clock, processLockRoot, layout);
    if (before.identity !== after.identity) throw new StorageBackupClosureUnprovedError();
    if (admission.isFlatBackup()) proveStoppedBackupSourceUnused(admission);
    held();
    const issued: StoppedBackupClosure = { [stoppedBackupClosureBrand]: true };
    stoppedBackupClosures.set(issued, { admission, operation, processLockRoot, clock, census: after, layout });
    return Object.freeze(issued);
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) retainUnprovedSourceOwners(error, { admission, restore: operation });
    throw error;
  }
}

export function assertStoppedBackupClosure(closure: StoppedBackupClosure, admission: RuntimeAdmission,
  operation: OfflineMaintenanceOperation): Pick<ProfileBrowserClosure, "workerDirectory"> {
  admission.assertOfflineMaintenance(operation);
  const issued = stoppedBackupClosures.get(closure);
  if (issued === undefined || issued.admission !== admission || issued.operation !== operation) throw new StorageBackupClosureUnprovedError();
  assertOfflineMaintenanceForProcessRoot(operation, issued.processLockRoot);
  const census = stoppedBackupBrowserCensus(admission, operation, issued.clock, issued.processLockRoot, issued.layout);
  if (census.identity !== issued.census.identity) {
    const original = issued.census;
    if (!admission.isFlatBackup() || admission.flatBackupTiming() === undefined || !("identities" in census) || !("identities" in original)
      || census.identities.some(row => !original.identities.some(prior => canonicalJsonStringify(row) === canonicalJsonStringify(prior)))
      || census.profiles.some(row => !original.profiles.some(prior => canonicalJsonStringify(row) === canonicalJsonStringify(prior)))) throw new StorageBackupClosureUnprovedError();
  }
  if (admission.isFlatBackup()) proveStoppedBackupSourceUnused(admission);
  admission.assertOfflineMaintenance(operation);
  return issued.layout;
}

export async function probeRestoreProfileBrowsersClosed(admission: RuntimeAdmission, processLockRoot: string,
  restore: OfflineMaintenanceOperation, clock: Clock, browserClosure: ProfileBrowserClosure): Promise<void> {
  const owner = admission;
  admission = owner.forStoppedMaintenance(restore);
  let retain = false;
  try {
    let custody: ReturnType<typeof AuthorityDatabase.readProfileRestoreBrowserInventory>;
    try { custody = AuthorityDatabase.readProfileRestoreBrowserInventory(admission, processLockRoot, restore); }
    catch (error) {
      if (!unreadableRestoreSqlite(error)) throw error;
      await probeUnreadableRestoreBrowsersClosed(admission, processLockRoot, restore, clock, browserClosure);
      return;
    }
    const settings = custody.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
      : custody.settingsAuthority.record.saved?.settings ?? custody.settingsAuthority.record.initialization.settings.settings;
    const config = resolveConfigWithProvenance(settings, { primaryDisplay: null }, clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
    await probeRetainedBrowsersClosed({ admission, custody, config, browserClosure, clock, signal: new AbortController().signal });
  } catch (error) {
    retain = hasUnprovedSourceClosure(error);
    if (retain) retainUnprovedSourceOwners(error, { admission, restore });
    throw error;
  } finally { if (!retain && admission !== owner) admission.release(); }
}

export class ProfileRestoreBrowserCustodyUnprovedError extends Error {
  readonly code = "PROFILE_RESTORE_BROWSER_CUSTODY_UNPROVED";
  constructor() { super(ERROR_CATALOG.PROFILE_RESTORE_BROWSER_CUSTODY_UNPROVED.text); this.name = "ProfileRestoreBrowserCustodyUnprovedError"; }
}

function unreadableRestoreSqlite(error: unknown): boolean {
  if (error instanceof AuthoritySourceClosureUnprovedError) return false;
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every((failure: unknown) => unreadableRestoreSqlite(failure));
  return error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && typeof error.errcode === "number" && [11, 26].includes(error.errcode & 0xff);
}

function restoreBrowserCensus(admission: RuntimeAdmission, scope: "browser-roots" | "profile-root") {
  if (process.platform !== "darwin") throw new ProfileRestoreBrowserCustodyUnprovedError();
  const binding = admission.captureBrowserRegistryContext();
  const rows = createBrowserRoots(admission).inventory().roots.filter(row => row.profileId === binding.profileId);
  const roots = [...new Set([join(admission.stateRoot, "browsers"), ...rows.map(row => join(binding.machineRoot, row.profileRoot))])];
  const identities: Array<{ path: string; device: number; inode: number; mode: number; owner: number }> = [];
  const profiles: RetainedBrowserProfile[] = [];
  const inspect = (path: string) => {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || privatePathRejects(path, stat, "group-write")) throw new ProfileRestoreBrowserCustodyUnprovedError();
    identities.push({ path, device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid });
  };
  const children = (path: string) => {
    inspect(path);
    const directory = opendirSync(path), entries: Dirent[] = [];
    let primary: { error: unknown } | undefined;
    try {
      for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
        if (entry.isSymbolicLink() || entries.length >= 64) throw new ProfileRestoreBrowserCustodyUnprovedError();
        entries.push(entry);
      }
    } catch (error) { primary = { error }; }
    try { directory.closeSync(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { directory, admission }); }
    if (primary !== undefined) throw primary.error;
    return entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  };
  const addProfile = (profileRoot: string, path: string) => {
    if (profiles.length >= 64) throw new ProfileRestoreBrowserCustodyUnprovedError();
    inspect(path);
    profiles.push({ profileRoot, profileDirectory: path, cleanupCompleted: false });
  };
  if (scope === "profile-root") {
    for (const entry of children(admission.stateRoot)) {
      if (entry.isFile() && ["state.db", "state.db-wal", "state.db-shm", "state.db-journal"].includes(entry.name)) continue;
      if (!entry.isDirectory() || !["browsers", "credentials", "backups", "artifacts", "logs", "scratch"].includes(entry.name)) throw new ProfileRestoreBrowserCustodyUnprovedError();
    }
  } else inspect(admission.stateRoot);
  for (const profileRoot of roots) if (lstatSync(profileRoot, { throwIfNoEntry: false }) !== undefined) for (const entry of children(profileRoot)) {
    if (!entry.isDirectory()) throw new ProfileRestoreBrowserCustodyUnprovedError();
    const name = entry.name, path = join(profileRoot, name);
    if (/^w[1-9]\d*$/u.test(name)) {
      for (const system of children(path)) {
        if (!system.isDirectory() || !BrowserSystemIdSchema.safeParse(system.name).success) throw new ProfileRestoreBrowserCustodyUnprovedError();
        addProfile(profileRoot, join(path, system.name));
      }
    } else if (/^onboarding-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-){3}g[1-9]\d*$/u.test(name)) addProfile(profileRoot, path);
    else throw new ProfileRestoreBrowserCustodyUnprovedError();
  }
  if (rows.length !== profiles.length || rows.some(row => !profiles.some(profile => profile.profileDirectory === join(binding.machineRoot, row.directory)))) throw new ProfileRestoreBrowserCustodyUnprovedError();
  return { identities, profiles, membership: rows.map(({ launch: _launch, native: _native, ...row }) => row) };
}

async function probeUnreadableRestoreBrowsersClosed(admission: RuntimeAdmission, processLockRoot: string,
  restore: OfflineMaintenanceOperation, clock: Clock, browserClosure: ProfileBrowserClosure): Promise<void> {
  const operation = restore;
  let primary: { error: unknown } | undefined;
  const assertHeld = () => {
    admission.assertStoppedProfile(operation);
    const context = admission.readInstallationContext();
    if (context === undefined) throw new ProfileRestoreBrowserCustodyUnprovedError();
    admission.assertFixedProcessLockRoot(context.workspace, processLockRoot);
    assertOfflineMaintenanceForProcessRoot(restore, processLockRoot);
  };
  try {
    assertHeld();
    const census = restoreBrowserCensus(admission, "profile-root");
    await browserClosure.probeClosed(census.profiles, { launchTimeoutMs: 5_000, closeProofMs: 3_000 }, clock, new AbortController().signal, admission);
    assertHeld();
    if (JSON.stringify(restoreBrowserCensus(admission, "profile-root")) !== JSON.stringify(census)) throw new ProfileRestoreBrowserCustodyUnprovedError();
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: { admission, operation }, restore });
    primary = { error };
  }
  if (primary !== undefined) throw primary.error;
}

export function inventoryFileIdentity(path: string) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || info.isFile() && info.nlink !== 1
    || privatePathRejects(path, info, "group-write")) throw new Error("profile-inventory-path-unsafe");
  return { path, directory: info.isDirectory(), device: info.dev, inode: info.ino, size: info.size,
    mode: info.mode, modified: info.mtimeMs, changed: info.ctimeMs };
}

export function enumerateProfileCredentialMembership<Custody extends CredentialMembershipCustody>(admission: RuntimeAdmission, custody: Custody, savedBrowserRoot: string, browserClosure: Pick<ProfileBrowserClosure, "workerDirectory">, ownedWriter?: Readonly<{ acquisitionId: string; pid: number }>, ownedCredentialStages: readonly string[] = []) {
  admission.assertLive();
  const root = admission.stateRoot, flat = admission.profileMaintenanceSchemaVersion() === 6;
  if (admission.artifactRoot !== join(root, "artifacts")) throw new Error("profile-inventory-artifact-root-unavailable");
  const restores = flat ? [] : admission.readCompletedRestores();
  const suspects = restores.flatMap(row => [{ path: join(root, row.suspect.relativePath), sha256: row.suspect.file.sha256,
    companion: false }, ...row.companions.map(companion => ({ path: `${join(root, row.suspect.relativePath)}${companion.suffix}`,
      sha256: companion.file.sha256, companion: true }))]);
  return enumerateCredentialMembership(root, flat, custody, savedBrowserRoot, path => admission.assertStateRoot(path), suspects, browserClosure, ownedWriter, ownedCredentialStages);
}

export function enumerateFlatBackupRecoveryMembership<Custody extends CredentialMembershipCustody>(root: string, custody: Custody, browserClosure: ProfileBrowserClosure) {
  return enumerateCredentialMembership(root, true, custody, join(root, "browsers"), path => {
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("flat-backup-recovery-path-refused");
  }, [], browserClosure);
}

function enumerateCredentialMembership<Custody extends CredentialMembershipCustody>(root: string, flat: boolean, custody: Custody,
  savedBrowserRoot: string, assertPath: (path: string) => void,
  suspects: readonly Readonly<{ path: string; sha256: string; companion: boolean }>[],
  browserClosure: Pick<ProfileBrowserClosure, "workerDirectory">, ownedWriter?: Readonly<{ acquisitionId: string; pid: number }>, ownedCredentialStages: readonly string[] = []) {
    const profiles = retainedBrowserProfiles(root, custody, savedBrowserRoot, browserClosure);
    const browserRootPaths = [...new Set([...configuredBrowserRoots(root, custody, savedBrowserRoot), ...profiles.map(profile => profile.profileRoot)])];
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
        if (ownedCredentialStages.includes(path)) return;
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
        if (parts.length === 3 && parts[1] === "suspects") {
          const bound = suspects.find(suspect => suspect.path === path);
          if (bound === undefined) throw new Error("profile-inventory-suspect-custody-unproved");
          copies.push(path);
          return;
        }
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
    for (const suspect of suspects) if (!identities.some(entry => entry.path === suspect.path)) throw new Error("profile-inventory-suspect-missing");
    for (const ref of custody.artifactReferences) {
      if (!identities.some(entry => entry.path === join(root, "artifacts", `${ref.sha256}.artifact`))) throw new Error("profile-inventory-artifact-missing");
    }
    return { custody, savedBrowserRoot, identities, copies, loginDataPaths, unsupported, backupPaths, manifests, suspects };
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
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource()) }, input.clock);
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (Object.entries(locks.processLocks).some(([name, state]) => name !== "server" && state.state !== "stopped")
    || orphans.staleWorkerRecords > 0) throw new Error("credential-maintenance-process-custody-unproved");
  return { processLocks: locks.processLocks, runtimeGeneration: locks.runtimeGeneration, orphans };
}

export function readStoppedProfileUpgradeInventory(input: Readonly<{
  machine: RuntimeAdmission; admission: RuntimeAdmission; clock: Clock; hostFacts: HostConfigFacts; browserClosure: ProfileBrowserClosure;
}>) {
  const { machine, admission } = input;
  const purpose = admission.assertReadyStoppedProfileUpgradeOwner(machine);
  const operation = machine.maintenanceOperation();
  machine.assertOfflineMaintenance(operation);
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("profile-stopped-upgrade-installation-required");
  assertOfflineMaintenanceForProcessRoot(operation, resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot));
  const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
  if (purpose === "startup") assertStoppedProfileResourcesClosed(facts); else assertCredentialCopyResourcesClosed(facts);
  if (facts.settingsAuthority.state !== "initialized") throw new Error("profile-stopped-upgrade-settings-required");
  const settings = facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
  const probeConfig = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
    { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
  const savedBrowserRoot = probeConfig.paths.browserProfileRoot;
  const membership = enumerateProfileCredentialMembership(admission, facts, savedBrowserRoot, input.browserClosure);
  if (purpose !== "startup" && membership.unsupported.length !== 0) throw new Error("profile-stopped-upgrade-copy-custody-unproved");
  const backups = membership.manifests.map(path => verifyStoppedBackupManifestAtPath(admission, path));
  if (membership.backupPaths.length !== backups.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))
    || backups.some(backup => backup.manifest.installationId !== admission.profileBinding.installationId
      || backup.manifest.profileId !== admission.profileBinding.profileId)) throw new Error("profile-stopped-upgrade-backup-membership-unproved");
  const login = countProfileCredentialLoginRows(membership.loginDataPaths);
  if (login === "unreadable" || typeof login === "number" && login > 0) throw new Error("profile-stopped-upgrade-login-copy-present");
  admission.assertReadyStoppedProfileUpgradeOwner(machine);
  return Object.freeze({ operationId: operation.operationId, facts, membership, backups });
}
