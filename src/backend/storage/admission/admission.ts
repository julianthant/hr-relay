import { createReadonlyAuthoritySnapshot } from "../sqlite/readonly-authority-snapshot.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";
import { ProfileVerifierDocumentSchema } from "../../../models/profiles/profile.js";
import { emailKey, passwordMatches } from "../configuration/synthetic-verifier.js";
import { profileAuthorityFileWitnesses } from "../maintenance/existing-data-backup-files.js";
import { captureStoppedIncompleteCredentials, captureStoppedCanonicalCredentialHead, captureCanonicalCredentialPublication } from "../configuration/canonical-credential-store.js";
import { authenticateDocument } from "../configuration/credential-store.js";
import { DuoCredentialRecordSchema } from "../../../models/config/duo-credential-store.js";
import { validateDuoKeyPair } from "../configuration/duo-signing.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import type { AuthorityBackupExpectedSource } from "../sqlite/database-identity.js";
import { inspectAuthorityBackupReadOnly } from "../sqlite/backup-inspection.js";
import { readProfilePublicationRegistry, type ProfilePublicationRead, PROFILE_CUSTODY_PROOF, acquireInstallation, assertInstallationLease, acquireStoppedProfileControlUpgrade, assertStoppedMachineMaintenance, requireStoppedControlProfileInventory, type ExistingAuthorityEvidence, type InstallationLease, type ExclusiveInstallationLease, type FreshInitializationWitness, type RelocationCompletionReceipt, type RelocationInventory, type RelocationPlanBinding, type RelocationPreparationVerifier, type RelocationActivationVerifier, type RelocationVerifier, type RuntimeLocator, type RuntimePair, type ProfileRestoreContext, type VerifiedSourceControlEntries, type AuthorityRestoreInput, type AuthorityRestoreVerifier, type CompletedRestoreCustody, type StoppedControlProfileInventory, type StoppedProfileControlUpgradeAdmission } from "./installation.js";
import { assertOfflineMaintenanceForProcessRoot } from "./process-root.js";
import { type OfflineMaintenanceOperation, RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "./lifetime-lock.js";
import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure, retainUnprovedSourceOwners, rememberUnprovedSourceClosure, assertSourceClosuresProved, hasUnprovedSourceClosure } from "../source-closure.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";
import { ProfileStorageRelocationUnsupportedError, registerRuntimeAdmission, requireRuntimeAdmission } from "./admission-identity.js";
import { z } from "zod";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, existsSync, readdirSync, type BigIntStats, type Stats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { assertFinishedProfileOnboarding, deriveProfileNames, SignUpOperationSchema, LogoutOperationSchema, type SignUpOperation, type LogoutOperation, type ProfileOperation, type ProfileRegistryDocument, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { readPrivateFile, unpublishedDraftAbortMembership, noSymlinkAncestry, ensureChildDirectory, outermostOperationProof, type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { privatePathRejects } from "../private-path.js";
import { assertLiveProfileDatabaseBinding, assertCanonicalProfileBinding, assertProfileRestoreDatabaseBinding, readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";


export class ProfileUpgradeSourceRefusalError extends Error {
  readonly code = "PROFILE_UPGRADE_UNAVAILABLE";
  constructor() { super(ERROR_CATALOG.PROFILE_UPGRADE_UNAVAILABLE.text); this.name = "ProfileUpgradeSourceRefusalError"; }
}

export class ProfileFlatStoreMigrationError extends Error {
  readonly code = "PROFILE_FLAT_STORE_MIGRATION_FAILED";
  constructor(cause: unknown) { super(ERROR_CATALOG.PROFILE_FLAT_STORE_MIGRATION_FAILED.text, { cause }); this.name = "ProfileFlatStoreMigrationError"; }
}

interface ProfileAccess {
  readonly profileId: string;
  readonly phase: "setup" | "runtime" | "settlement";
  readonly operationId?: string;
  verify(purpose: "issue" | "custody" | "runtime", publication?: ProfilePublicationRead): void;
}

const issuanceToken = Symbol("runtime-admission-issuance");
const stoppedMaintenanceRestores = new WeakMap<InstallationLease, OfflineMaintenanceOperation>();

function within(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith("../") && !part.startsWith("..\\") && !isAbsolute(part));
}

function assertSyntheticDirectory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("runtime-admission: fixture path must be absolute");
  const temp = [resolve(tmpdir()), realpathSync(tmpdir())].find((candidate) => within(candidate, path) && path !== candidate);
  if (temp === undefined) throw new Error("runtime-admission: fixture must be beneath system temp");
  let ancestor = path;
  while (ancestor !== temp) {
    const info = lstatSync(ancestor, { throwIfNoEntry: false });
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink()
      || privatePathRejects(ancestor, info, "group-write"))) {
      throw new Error("runtime-admission: unsafe synthetic fixture ancestor");
    }
    if (lstatSync(join(ancestor, ".tracker/control"), { throwIfNoEntry: false }) !== undefined
      || lstatSync(join(ancestor, ".runtime-owner.json"), { throwIfNoEntry: false }) !== undefined
      || lstatSync(join(ancestor, ".runtime-source-fence.json"), { throwIfNoEntry: false }) !== undefined) {
      throw new Error("runtime-admission: fixture overlaps installation witness");
    }
    ancestor = dirname(ancestor);
  }
}

function assertActiveRootSafe(path: string): void {
  let component = parse(path).root;
  for (const part of relative(component, path).split(/[\\/]/u)) {
    if (part === "") continue;
    component = join(component, part);
    const info = lstatSync(component);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("runtime-admission: storage root path changed shape");
  }
  const root = lstatSync(path);
  if (privatePathRejects(path, root, "group-write")) {
    throw new Error("runtime-admission: storage root ownership changed");
  }
}

type AdmissionAuthority = Readonly<{
  retainSourceClosure?(error: unknown): void;
  assertHeld(publication?: ProfilePublicationRead): void;
  captureRestoreContext?(credentials: ReturnType<typeof captureStoppedCanonicalCredentialHead>): ProfileRestoreContext;
  beginAuthorityRestore?(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void;
  settleAuthorityRestore?(input: AuthorityRestoreInput, outcome: "unchanged" | "replaced", verify: AuthorityRestoreVerifier, restore: OfflineMaintenanceOperation): void;
  readAuthorityRestore?(operationId: string): AuthorityRestoreInput;
  assertAuthorityRestoreCurrent?(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void;
  assertProfileRuntime?(publication?: ProfilePublicationRead): void;
  assertPendingLogoutCustody?(operationId: string): void;
  readRelocationReceipts?(): readonly RelocationCompletionReceipt[];
  readInstallationContext?(): Readonly<{ workspace: string; locator: RuntimeLocator; receipts: readonly RelocationCompletionReceipt[] }> | undefined;
  release(): void;
}>;

export type RuntimeRelocationOperation = Readonly<{
  operationId: string;
  inventory(): RelocationInventory;
  prepareDestinationRoots(): void;
  verifiedSourceControlEntries(): VerifiedSourceControlEntries;
  readPriorReceipts(): readonly RelocationCompletionReceipt[];
  destinationAdmission(): RuntimeAdmission;
  sourceVerificationAdmission(): RuntimeAdmission;
  recordVerifiedPreparation(verify: RelocationPreparationVerifier): void;
  recordActivationIntent(verify: RelocationActivationVerifier): void;
  recordVerifiedStage(verify: RelocationVerifier): void;
  fenceRelocationSource(): void;
  retainRelocationSources(): void;
  switchRelocationLocator(verify: RelocationVerifier): RuntimeLocator;
  settleRelocation(verify: RelocationVerifier): void;
}>;

type AdmissionScope = "profile-maintenance" | "flat-backup" | "profile-restore" | "installation" | "adoption-inspection" | "stopped-staged" | "stopped-projection" | "synthetic-stopped-staged"
  | "verified-copy" | "synthetic-verified-copy" | "synthetic" | "relocation-destination" | "relocation-source-verification"
  | "adoption-initialization" | "profile-initialization" | "profile-upgrade" | "profile-ready-upgrade" | "profile" | "profile-settlement" | "profile-pending-logout-inventory" | "stopped-control-inventory" | "stopped-incomplete-profile-inventory";

type ReadyProfileUpgrade = Readonly<{ sourcePath: string; processLockRoot: string; sourceSchemaVersion: 6 | 8 | 9 | 10 | 11; copyPath?: string;
  qualification: { current: Readonly<{ kind: "inspection" }> | Readonly<{ kind: "qualified"; sourceFingerprint: string }> | Readonly<{ kind: "revoked" }> } }>;

/** A lifetime-bound, path-specific authority to open this installation's physical storage. */
export class RuntimeAdmission {
  readonly #authority: AdmissionAuthority;
  readonly #stateRoot: string;
  readonly #artifactRoot: string;
  readonly #authorityDatabasePaths: ReadonlySet<string>;
  readonly #locator: RuntimeLocator | undefined;
  readonly #scope: AdmissionScope;
  readonly #mode: "shared" | "exclusive" | "synthetic";
  #released = false;
  readonly #sourceFailures = new Set<unknown>();
  #stoppedControlInventory: StoppedControlProfileInventory | undefined;
  #stoppedLogout: { operation: LogoutOperation; restore: OfflineMaintenanceOperation; witness: ReturnType<InstallationLease["capturePendingProfileLogout"]> } | undefined;
  readonly #profileBinding: ProfileDatabaseBinding | undefined;
  readonly #profileParent: RuntimeAdmission | undefined;
  readonly #pendingLogout: Readonly<{ owner: RuntimeAdmission; operation: string; copyPath?: string }> | undefined;
  readonly #readyUpgrade: ReadyProfileUpgrade | undefined;
  readonly #flatBackup: ReadyProfileUpgrade | undefined;

  private constructor(token: typeof issuanceToken, authority: AdmissionAuthority, stateRoot: string, artifactRoot: string,
    authorityDatabasePaths: readonly string[],
    scope: AdmissionScope,
    mode: "shared" | "exclusive" | "synthetic", locator?: RuntimeLocator, binding?: ProfileDatabaseBinding, profileParent?: RuntimeAdmission,
    pendingLogout?: Readonly<{ owner: RuntimeAdmission; operation: string; copyPath?: string }>, readyUpgrade?: ReadyProfileUpgrade, flatBackup?: ReadyProfileUpgrade) {
    if (token !== issuanceToken) throw new Error("runtime-admission: unissued capability");
    this.#authority = authority;
    this.#stateRoot = stateRoot;
    this.#artifactRoot = artifactRoot;
    this.#authorityDatabasePaths = new Set(authorityDatabasePaths);
    this.#scope = scope;
    this.#mode = mode;
    this.#profileParent = profileParent;
    this.#pendingLogout = pendingLogout;
    this.#readyUpgrade = readyUpgrade;
    this.#flatBackup = flatBackup;
    this.#profileBinding = binding === undefined ? undefined : Object.freeze({ ...binding });
    this.#locator = locator === undefined ? undefined : Object.freeze({ ...locator });
    registerRuntimeAdmission(this);
    Object.freeze(this);
  }

  get locator(): RuntimeLocator {
    this.assertLive();
    if (this.#locator === undefined) throw new Error("runtime-admission: synthetic fixture has no installation locator");
    return this.#locator;
  }
  isProfileInitialization(): boolean {
    this.assertLive();
    return this.#scope === "profile-initialization" || this.#scope === "profile-upgrade";
  }
  assertProfileInitialization(): void {
    this.assertReadable();
    if (this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade") throw new Error("profile-initialization-authority-required");
  }
  assertReleasedProfileInitialization(machine: RuntimeAdmission): void {
    machine.assertWritable();
    if (!this.#released || this.#scope !== "profile-initialization" || this.#profileParent !== machine) throw new Error("profile-draft-closure-unproved");
  }
  assertProfileUpgradeCredentialSource(profileId: string): void {
    const claim = this.#captureProfileAccess(profileId);
    this.assertLive();
    if (this.#scope !== "installation" || (this.#mode !== "shared" && this.#mode !== "exclusive")) throw new Error("profile-upgrade-handoff-installation-required");
    claim.verify("issue");
    if (claim.phase !== "runtime") throw new Error("profile-upgrade-handoff-runtime-claim-required");
    const observed = readProfileDatabaseBinding(join(this.#stateRoot, "profiles", claim.profileId, "state.db"));
    if (observed.state !== "bound" || (observed.schemaVersion !== 8 && observed.schemaVersion !== 9 && observed.schemaVersion !== 10) || observed.binding.profileId !== claim.profileId
      || observed.binding.installationId !== this.locator.installationId) throw new Error("profile-upgrade-handoff-binding-refused");
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    if (lease.mode === "shared") lease.lifetime.assertRuntimeAvailable();
  }
  captureProfileUpgradeHandoff(profileId: string): Readonly<{ consume(next: RuntimeAdmission): string }> | undefined {
    try {
      const claim = this.#captureProfileAccess(profileId);
      this.assertLive();
      if (this.#scope !== "installation") throw new Error("profile-upgrade-handoff-installation-required");
      claim.verify("issue");
      const path = join(this.#stateRoot, "profiles", profileId, "state.db");
      const ancestry = new Map<string, DirectoryIdentity>();
      noSymlinkAncestry(dirname(path), ancestry);
      const observed = readProfileDatabaseBinding(path);
      if (observed.schemaVersion !== 8 && observed.schemaVersion !== 9 && observed.schemaVersion !== 10) return undefined;
      if (this.#mode !== "shared") throw new Error("profile-upgrade-handoff-shared-required");
      if (claim.phase !== "runtime") throw new ProfileUpgradeSourceRefusalError();
      if (observed.state !== "bound" || observed.binding.installationId !== this.locator.installationId
        || observed.binding.profileId !== claim.profileId) throw new Error("profile-upgrade-handoff-binding-refused");
      const lease = this.#authority as InstallationLease;
      assertInstallationLease(lease);
      const capture = lease.captureProfileUpgradeHandoff(profileId);
      const source = () => ["", "-wal", "-shm", "-journal"].map(suffix => {
        const filePath = path + suffix;
        const file = lstatSync(filePath, { bigint: true, throwIfNoEntry: false });
        if (file === undefined) return { suffix, absent: true };
        if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n || privatePathRejects(filePath, file, "group-write")) throw new Error("profile-upgrade-handoff-source-unsafe");
        const identity = (value: BigIntStats) => [value.dev, value.ino, value.size, value.mode, value.uid, value.nlink, value.mtimeNs, value.ctimeNs].join(":");
        const expected = identity(file);
        const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let result: { suffix: string; identity: string; digest: string } | undefined;
        let primary: { error: unknown } | undefined;
        try {
          if (identity(fstatSync(descriptor, { bigint: true })) !== expected) throw new Error("profile-upgrade-handoff-source-changed");
          const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
          let length: number;
          while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
          if (identity(fstatSync(descriptor, { bigint: true })) !== expected || identity(lstatSync(filePath, { bigint: true })) !== expected) throw new Error("profile-upgrade-handoff-source-changed");
          result = { suffix, identity: expected, digest: hash.digest("hex") };
        } catch (error) { primary = { error }; }
        try { closeSync(descriptor); }
        catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
          { descriptor: { descriptor, identity: file } }); }
        if (primary !== undefined) throw primary.error;
        if (result === undefined) throw new Error("profile-upgrade-handoff-source-result-missing");
        return result;
      });
      const before = canonicalJsonStringify(source());
      return Object.freeze({ consume(next: RuntimeAdmission): string {
        const nextLease = next.#exclusiveInstallationLease();
        capture.consume(nextLease);
        if (!noSymlinkAncestry(dirname(path), ancestry)) throw new Error("profile-upgrade-handoff-source-changed");
        if (canonicalJsonStringify(source()) !== before) throw new Error("profile-upgrade-handoff-source-changed");
        const current = next.#captureProfileAccess(profileId);
        if (current.phase !== "runtime") throw new Error("profile-upgrade-handoff-runtime-claim-required");
        return current.profileId;
      } });
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { this.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: this }); }
      throw error;
    }
  }
  forStoppedProfileUpgrade(): RuntimeAdmission;
  forStoppedProfileUpgrade(browserClosure: ProfileBrowserClosure, profileId: string, restore: OfflineMaintenanceOperation, clock: Clock, hostFacts: HostConfigFacts): Promise<RuntimeAdmission>;
  forStoppedProfileUpgrade(...args: [] | [ProfileBrowserClosure, string, OfflineMaintenanceOperation, Clock, HostConfigFacts]): RuntimeAdmission | Promise<RuntimeAdmission> {
    if (args.length !== 0) return this.#readyStoppedProfileUpgrade(...args);
    this.assertExclusive();
    if (this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade") throw new Error("profile-initialization-authority-required");
    const operation = this.maintenanceOperation();
    const stopped = this.forStoppedMaintenance(operation);
    try {
      stopped.assertReadable();
      if (readProfileDatabaseBinding(join(this.#stateRoot, "state.db")).state !== "unbound") throw new Error("profile-stopped-conversion-not-required");
      return stopped;
    } catch (error) { if (stopped !== this) stopped.release(); throw error; }
  }
  async #readyStoppedProfileUpgrade(browserClosure: ProfileBrowserClosure, profileId: string | undefined, restore: OfflineMaintenanceOperation | undefined,
    clock: Clock | undefined, hostFacts: HostConfigFacts | undefined): Promise<RuntimeAdmission> {
    const lease = this.#exclusiveInstallationLease();
    if (profileId === undefined || restore === undefined || clock === undefined || hostFacts === undefined) throw new Error("profile-stopped-upgrade-runtime-claim-required");
    const claim = this.#captureProfileAccess(profileId);
    if (claim.phase !== "runtime") throw new Error("profile-stopped-upgrade-runtime-claim-required");
    claim.verify("issue");
    const context = lease.readInstallationContext();
    const processLockRoot = resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot);
    lease.assertFixedProcessLockRoot(context.workspace, processLockRoot);
    lease.assertOfflineMaintenance(restore);
    assertOfflineMaintenanceForProcessRoot(restore, processLockRoot);
    const root = join(this.#stateRoot, "profiles", claim.profileId), artifacts = join(root, "artifacts");
    const path = join(root, "state.db");
    const binding = { installationId: this.locator.installationId, profileId: claim.profileId };
    const observed = readProfileDatabaseBinding(path);
    if (observed.state !== "bound" || (observed.schemaVersion !== 8 && observed.schemaVersion !== 9 && observed.schemaVersion !== 10 && observed.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION)) throw new Error("profile-stopped-upgrade-bound-required");
    assertCanonicalProfileBinding(path, binding);
    const ancestry = new Map<string, DirectoryIdentity>();
    noSymlinkAncestry(root, ancestry);
    noSymlinkAncestry(artifacts, ancestry);
    const physical = lstatSync(path);
    const capture = lease.captureStoppedProfileUpgrade(claim.profileId);
    const qualification: ReadyProfileUpgrade["qualification"] = { current: { kind: "inspection" } };
    const assertHeld = () => {
      if (qualification.current.kind === "revoked") throw new Error("profile-stopped-upgrade-source-changed");
      try {
        this.assertLive();
        lease.assertFixedProcessLockRoot(context.workspace, processLockRoot);
        assertOfflineMaintenanceForProcessRoot(restore, processLockRoot);
        claim.verify("issue");
        capture.assertHeld();
        if (!noSymlinkAncestry(root, ancestry) || !noSymlinkAncestry(artifacts, ancestry)) throw new Error("profile-stopped-upgrade-root-changed");
        const current = lstatSync(path, { throwIfNoEntry: false });
        if (current === undefined || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1
          || current.dev !== physical.dev || current.ino !== physical.ino || current.uid !== physical.uid || current.mode !== physical.mode) throw new Error("profile-stopped-upgrade-source-changed");
      } catch (error) { qualification.current = { kind: "revoked" }; throw error; }
    };
    assertHeld();
    const admission = new RuntimeAdmission(issuanceToken, { assertHeld, readInstallationContext: () => this.readInstallationContext(), release() {} },
      root, artifacts, [path], "profile-ready-upgrade", "exclusive", this.#locator, binding, this, undefined,
      { sourcePath: path, processLockRoot, sourceSchemaVersion: observed.schemaVersion, qualification });
    const assertUnpublishedSource = () => {
      assertHeld();
      const current = lstatSync(path);
      if (current.size !== physical.size || current.mtimeMs !== physical.mtimeMs || current.ctimeMs !== physical.ctimeMs) throw new Error("profile-stopped-upgrade-source-changed");
    };
    try {
      const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
      assertUnpublishedSource();
      const before = AuthorityDatabase.inspectStoppedUpgrade(admission, path, processLockRoot, clock);
      const { readStoppedProfileUpgradeInventory } = await import("../maintenance/profile-inventory.js");
      assertUnpublishedSource();
      readStoppedProfileUpgradeInventory({ machine: this, admission, clock, hostFacts, browserClosure });
      const after = AuthorityDatabase.inspectStoppedUpgrade(admission, path, processLockRoot, clock);
      if (before.schemaVersion !== observed.schemaVersion || before.authorityGeneration !== after.authorityGeneration
        || before.authorityContentFingerprint !== after.authorityContentFingerprint) throw new Error("profile-stopped-upgrade-source-changed");
      qualification.current = { kind: "qualified", sourceFingerprint: before.authorityContentFingerprint };
      assertHeld();
      return admission;
    } catch (error) { admission.release(); throw error; }
  }
  assertStoppedAuthorityBackup(path: string, processLockRoot: string): void {
    if (this.#scope === "profile") {
      this.assertStoppedProfile(this.maintenanceOperation());
      if (resolve(path) !== join(this.#stateRoot, "state.db")) throw new Error("profile-maintenance-source-refused");
      const context = this.readInstallationContext();
      if (context === undefined) throw new Error("profile-parent-context-unavailable");
      this.assertFixedProcessLockRoot(context.workspace, processLockRoot);
      return;
    }
    if (this.#flatBackup === undefined) { this.assertStoppedProfileUpgrade(path, processLockRoot); return; }
    this.assertLive();
    if (path !== this.#flatBackup.sourcePath || processLockRoot !== this.#flatBackup.processLockRoot) throw new Error("flat-backup-source-refused");
  }
  isFlatBackup(): boolean { this.assertLive(); return this.#scope === "flat-backup"; }
  assertStoppedProfileUpgrade(path: string, processLockRoot: string): void {
    if (this.#scope === "profile-maintenance") {
      this.assertReadOnlyAuthorityDatabase(path);
      const context = this.readInstallationContext();
      if (context === undefined) throw new Error("profile-parent-context-unavailable");
      this.assertFixedProcessLockRoot(context.workspace, processLockRoot);
      return;
    }
    if (this.#flatBackup !== undefined) throw new Error("flat-backup-upgrade-refused");
    if (this.#readyUpgrade !== undefined) {
      this.assertLive();
      if (this.#readyUpgrade.copyPath !== undefined || path !== this.#readyUpgrade.sourcePath
        || processLockRoot !== this.#readyUpgrade.processLockRoot) throw new Error("profile-stopped-upgrade-source-refused");
      return;
    }
    this.assertExclusive();
    this.assertAuthorityDatabase(path);
  }
  assertReadyStoppedProfileUpgradeOwner(machine: RuntimeAdmission): void {
    this.assertLive();
    if (this.#readyUpgrade === undefined || this.#readyUpgrade.copyPath !== undefined || this.#profileParent !== machine) throw new Error("profile-stopped-upgrade-owner-required");
    this.assertStoppedProfileUpgrade(this.#readyUpgrade.sourcePath, this.#readyUpgrade.processLockRoot);
  }
  assertProfileMigration(path: string, sourceVersion: number, sourceFingerprint?: string): "ready" | "setup" {
    if (this.#readyUpgrade !== undefined) {
      this.assertStoppedProfileUpgrade(path, this.#readyUpgrade.processLockRoot);
      if (![8, 9, 10].includes(this.#readyUpgrade.sourceSchemaVersion) || sourceVersion !== this.#readyUpgrade.sourceSchemaVersion) throw new Error("profile-stopped-upgrade-version-refused");
      const proof = this.#readyUpgrade.qualification.current;
      if (proof.kind !== "qualified" || sourceFingerprint !== undefined && sourceFingerprint !== proof.sourceFingerprint) {
        this.#readyUpgrade.qualification.current = { kind: "revoked" };
        throw new Error("profile-stopped-upgrade-source-changed");
      }
      return "ready";
    }
    this.assertProfileInitialization();
    return "setup";
  }
  #stoppedControlBackupPath(path: string): boolean {
    if (this.#scope !== "stopped-control-inventory" || this.#stoppedControlInventory === undefined) return false;
    const source = requireStoppedControlProfileInventory(this.#stoppedControlInventory), directory = source.backupDirectory;
    return isAbsolute(path) && resolve(path) === path && (path === directory || dirname(path) === directory
      && /^(?:\.authority-[0-9a-f-]{36}\.(?:sqlite|manifest\.json)\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite(?:\.manifest\.json)?)$/u.test(basename(path)));
  }
  assertAuthorityBackupWrite(path: string): void {
    if (this.#scope === "stopped-control-inventory") {
      this.assertLive();
      if (!this.#stoppedControlBackupPath(path)) throw new Error("profile-control-upgrade-backup-path-refused");
      return;
    }
    if (this.#scope === "profile-maintenance" || (this.#scope === "profile-upgrade" && this.#readyUpgrade === undefined)) {
      this.assertLive();
      const directory = join(this.#stateRoot, "backups", "authority");
      if (!isAbsolute(path) || resolve(path) !== path || path !== directory && (dirname(path) !== directory
        || !/^(?:\.authority-[0-9a-f-]{36}\.(?:sqlite|manifest\.json)\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite(?:\.manifest\.json)?)$/u.test(path.slice(directory.length + 1)))) throw new Error("profile-maintenance-backup-path-refused");
      this.assertStateRoot(path);
      return;
    }
    const backup = this.#flatBackup ?? this.#readyUpgrade;
    if (backup !== undefined) {
      this.assertLive();
      const directory = join(this.#stateRoot, "backups", "authority");
      if (backup.copyPath !== undefined || backup.qualification.current.kind !== "qualified"
        || !isAbsolute(path) || resolve(path) !== path || path !== directory && (dirname(path) !== directory
          || !/^(?:\.authority-[0-9a-f-]{36}\.(?:sqlite|manifest\.json)\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite(?:\.manifest\.json)?)$/u.test(path.slice(directory.length + 1)))) throw new Error("profile-stopped-upgrade-backup-refused");
      this.assertStateRoot(path);
      return;
    }
    this.assertWritable();
  }
  assertAuthorityBackupSource(path: string, sourceFingerprint: string): void {
    const backup = this.#flatBackup ?? this.#readyUpgrade;
    this.assertReadOnlyAuthorityDatabase(path);
    if (backup !== undefined) {
      const proof = backup.qualification.current;
      if (backup.copyPath !== undefined || path !== backup.sourcePath || proof.kind !== "qualified"
        || proof.sourceFingerprint !== sourceFingerprint) {
        backup.qualification.current = { kind: "revoked" };
        throw new Error("profile-stopped-upgrade-source-changed");
      }
    }
  }
  authorityBackupExpectedSource(): AuthorityBackupExpectedSource {
    this.assertLive();
    const path = join(this.#stateRoot, "state.db");
    if (this.#flatBackup !== undefined) {
      const backup = this.#flatBackup, proof = backup.qualification.current;
      if (backup.copyPath !== undefined || backup.sourceSchemaVersion !== 6 || proof.kind !== "qualified") throw new Error("authority-backup-source-unqualified");
      this.assertAuthorityBackupSource(path, proof.sourceFingerprint);
      return Object.freeze({ kind: "unbound-predecessor", schemaVersion: 6, authorityContentFingerprint: proof.sourceFingerprint });
    }
    if (this.#scope === "profile-upgrade") {
      this.assertReadOnlyAuthorityDatabase(path);
      this.assertOfflineMaintenance(this.maintenanceOperation());
      const observed = readProfileDatabaseBinding(path);
      if (observed.state === "unbound") {
        const inspection = inspectAuthorityBackupReadOnly(this, path, observed.schemaVersion);
        this.assertReadable();
        return Object.freeze({ kind: "unbound-predecessor", schemaVersion: observed.schemaVersion,
          authorityContentFingerprint: inspection.authorityContentFingerprint });
      }
      if (this.#profileBinding === undefined || observed.binding.installationId !== this.#profileBinding.installationId
        || observed.binding.profileId !== this.#profileBinding.profileId) throw new Error("authority-backup-profile-binding-mismatch");
    }
    if (this.#profileBinding === undefined) throw new Error("authority-backup-profile-binding-required");
    return Object.freeze({ kind: "profile", binding: this.#profileBinding });
  }
  profileMaintenanceSchemaVersion(): 6 | 8 | 9 | 10 | 11 {
    const backup = this.#flatBackup ?? this.#readyUpgrade;
    this.assertLive();
    if (this.#scope === "stopped-control-inventory" && this.#stoppedControlInventory !== undefined) return requireStoppedControlProfileInventory(this.#stoppedControlInventory).schemaVersion;
    if (backup === undefined) return CURRENT_AUTHORITY_SCHEMA_VERSION;
    const observed = readProfileDatabaseBinding(backup.copyPath ?? backup.sourcePath);
    if (backup.sourceSchemaVersion === 6) {
      if (observed.state !== "unbound" || observed.schemaVersion !== 6) throw new Error("existing-data-owner-source-changed");
      return 6;
    }
    if (observed.state !== "bound" || (observed.schemaVersion !== 8 && observed.schemaVersion !== 9 && observed.schemaVersion !== 10 && observed.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) || observed.binding.installationId !== this.profileBinding.installationId
      || observed.binding.profileId !== this.profileBinding.profileId) throw new Error("profile-stopped-upgrade-binding-changed");
    return observed.schemaVersion;
  }
  assertProfileRuntime(): void {
    this.assertLive();
    this.#assertProfileRuntime();
  }
  #assertProfileRuntime(): void {
    if (this.#scope !== "profile") throw new Error("profile-bound-authority-required");
    this.#assertCurrentProfileAccess();
  }
  #assertCurrentProfileAccess(publication?: ProfilePublicationRead): void {
    if (this.#authority.assertProfileRuntime === undefined) throw new Error("profile-runtime-authority-unavailable");
    if (publication === undefined) this.lifetime.assertRuntimeAvailable();
    else {
      if (this.#released || this.#scope !== "profile-initialization" || this.#profileParent === undefined) throw new Error("profile-credential-key-stage-owner-mismatch");
      this.#profileParent.lifetime.assertRuntimeAvailable();
    }
    this.#authority.assertProfileRuntime(publication);
  }
  assertReadable(): void {
    this.assertLive();
    if (this.#scope === "profile" || this.#scope === "profile-initialization") this.#assertCurrentProfileAccess();
    if (this.#scope === "profile-upgrade") this.assertOfflineMaintenance(this.maintenanceOperation());
  }
  assertProfileRestoreOwner(path: string): void {
    this.assertExclusive();
    if (this.#scope !== "profile") throw new Error("profile-bound-authority-required");
    if (resolve(path) !== join(this.#stateRoot, "state.db")) throw new Error("profile-restore-authority-path-refused");
    this.assertStateRoot(path);
  }
  assertStoppedProfile(operation: OfflineMaintenanceOperation): void {
    this.assertExclusive();
    if (this.#scope !== "profile" && this.#scope !== "profile-maintenance") throw new Error("profile-bound-authority-required");
    this.assertOfflineMaintenance(operation);
    if (this.#authority.assertProfileRuntime === undefined) throw new Error("profile-runtime-authority-unavailable");
    this.#authority.assertProfileRuntime();
  }
  forStoppedMaintenance(operation: OfflineMaintenanceOperation): RuntimeAdmission {
    this.assertOfflineMaintenance(operation);
    if (this.#scope === "profile-maintenance" || this.#scope === "profile-upgrade"
      || this.#readyUpgrade !== undefined || this.#flatBackup !== undefined) return this;
    this.assertExclusive();
    if (this.#scope === "profile-initialization") {
      if (this.#authority.assertProfileRuntime === undefined) throw new Error("profile-runtime-authority-unavailable");
      this.#authority.assertProfileRuntime();
    } else this.assertStoppedProfile(operation);
    return new RuntimeAdmission(issuanceToken, { ...this.#authority,
      assertHeld: () => {
        this.assertLive(); this.assertOfflineMaintenance(operation);
        if (this.#scope === "profile-initialization") this.#authority.assertProfileRuntime?.();
      }, release() {} },
      this.#stateRoot, this.#artifactRoot, [join(this.#stateRoot, "state.db")], this.#scope === "profile-initialization" ? "profile-upgrade" : "profile-maintenance", "exclusive",
      this.#locator, this.profileBinding, this.#profileParent);
  }
  get profileBinding(): ProfileDatabaseBinding {
    this.assertLive();
    if (this.#profileBinding === undefined) throw new Error("profile-bound-authority-required");
    return this.#profileBinding;
  }
  #assertMachineRuntime(): void {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    this.lifetime.assertRuntimeAvailable();
  }
  abortUnpublishedProfile(operation: SignUpOperation, head?: { device: number; inode: number; digest: string }): boolean {
    this.#assertMachineRuntime();
    return (this.#authority as InstallationLease).abortUnpublishedProfile(operation, head);
  }
  readProfileRegistry(): ProfileRegistryDocument {
    if (!(#released in this) || this.#released) throw new Error("runtime-admission: missing or released admission");
    if (this.#scope !== "installation") {
      this.assertLive();
      throw new Error("profile-machine-authority-required");
    }
    return (this.#authority as InstallationLease).readProfileRegistry();
  }
  publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument): void {
    this.#assertMachineRuntime();
    (this.#authority as InstallationLease).publishProfileRegistry(expected, document);
  }
  publishProfileRegistration(profile: RuntimeAdmission, operation: SignUpOperation): void {
    this.#assertMachineRuntime();
    if (profile.#profileParent !== this) throw new Error("profile-publication-owner-required");
    try { (this.#authority as InstallationLease).publishProfileRegistration(operation, profile); }
    catch (error) {
      if (hasUnprovedSourceClosure(error)) retainUnprovedSourceOwners(error, { admission: { machine: this, profile } });
      throw error;
    }
  }
  readProfileRegistration(lease: InstallationLease, operation: SignUpOperation, publication: ProfilePublicationRead) {
    requireRuntimeAdmission(this, publication);
    const machine = this.#profileParent;
    if (machine === undefined || machine.#authority !== lease || !(lease.lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-publication-owner-required");
    assertFinishedProfileOnboarding(operation);
    const captured = captureCanonicalCredentialPublication(machine, this, operation, publication), frame = captured.records.protected;
    if (frame === undefined) throw new Error("profile-registration-credentials-required");
    const document = authenticateDocument(frame.value), latest = document.latestRequest;
    if (document.record.revision !== frame.revision || latest?.kind !== "apply" || operation.expectedRevision === undefined
      || latest.request.commandId !== operation.commandId || latest.request.writeId !== operation.writeId
      || latest.request.commandFingerprint !== operation.commandFingerprint || latest.request.updatedAt !== operation.createdAt
      || latest.request.expectedRevision !== operation.expectedRevision || latest.request.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH
      || document.record.revision !== operation.expectedRevision + 1 || document.history.length !== 1 || document.historyBaseRevision !== 1
      || document.retiredLegacy.commandIds.length !== 0 || document.retiredLegacy.writeIds.length !== 0 || document.retiredLegacy.valueIds.length !== 0) throw new Error("profile-registration-receipt-invalid");
    const email = document.record.entries.ucpathUserId?.value, password = document.record.entries.ucpathPassword?.value;
    if (email === undefined || password === undefined || document.record.entries.timekeeperName?.value !== deriveProfileNames(operation.firstName, operation.lastName).timekeeperName) throw new Error("profile-registration-input-required");
    const draft = operation.onboarding, key = draft?.attempts.findLast(attempt => attempt.generation === draft.generation && attempt.method === "key");
    const duo = DuoCredentialRecordSchema.parse(captured.records.duo?.value), credential = duo.credentials.find(credential => credential.state === "ready" && credential.credentialId === key?.ceremony?.credentialId);
    if (credential === undefined || key?.scope === undefined || canonicalJsonStringify(credential.scope) !== canonicalJsonStringify(key.scope)
      || captured.head.retired.includes(credential.credentialId) || captured.head.counters.some(counter => counter.credentialId === credential.credentialId && counter.publicKeySpki !== credential.publicKeySpki)) throw new Error("profile-registration-duo-required");
    validateDuoKeyPair(credential.privateKeyPkcs8, credential.publicKeySpki);
    machine.assertCanonicalCredentialCreation(this, operation, publication);
    return { revision: frame.revision, credentials: captured.source, email, password };
  }
  beginProfileSignUp(fields: Omit<SignUpOperation, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding" | "credentials">): SignUpOperation {
    this.#assertMachineRuntime();
    return (this.#authority as InstallationLease).beginProfileSignUp(fields);
  }
  publishProfileOperation(operation: ProfileOperation | string): void {
    this.#assertMachineRuntime();
    (this.#authority as InstallationLease).publishProfileOperation(operation);
  }
  #captureProfileAccess(profileId: string): ProfileAccess {
      this.assertWritable();
      if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
      const root = this.stateRoot;
      const read = () => this.readProfileRegistry();
      const id = z.uuid().parse(profileId);
      const document = read();
      const row = document.profiles.find(entry => entry.profileId === id);
      const path = join(root, "machine", "operations");
      const operations = existsSync(path) ? readdirSync(path).filter(name => name.endsWith(".json")).flatMap(name => {
        const file = readPrivateFile(join(path, name), { label: "lock", maxBytes: 1_048_576 });
        if (file === undefined) throw new Error("profile-operation-authority-unavailable");
        const parsed = z.union([SignUpOperationSchema, LogoutOperationSchema]).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
        return [parsed];
      }) : [];
      const pending = operations.filter((entry): entry is SignUpOperation => entry.kind === "sign-up" && entry.profileId === id);
      if (row === undefined && pending.length !== 1) throw new Error("profile-storage-claim-unregistered");
      if (row !== undefined && row.lifecycle !== "ready") throw new Error("profile-storage-claim-unavailable");
      const phase = pending.length === 1 ? "setup" : "runtime";
      const pendingOperation = pending[0];
      const operationIdentity = (operation: SignUpOperation) => ({ operationId: operation.operationId, profileId: operation.profileId,
        commandId: operation.commandId, writeId: operation.writeId, emailKey: operation.emailKey, firstName: operation.firstName,
        lastName: operation.lastName, createdAt: operation.createdAt, commandFingerprint: operation.commandFingerprint,
        credentials: { operationId: operation.credentials.operationId, keyId: operation.credentials.keyId, generation: operation.credentials.generation } });
      if (row === undefined && pendingOperation === undefined) throw new Error("profile-storage-claim-unregistered");
      const fingerprint = createHash("sha256").update(canonicalJsonStringify(phase === "setup" && pendingOperation !== undefined ? operationIdentity(pendingOperation) : {
        profileId: row?.profileId, createdAt: row?.createdAt, firstName: row?.firstName, lastName: row?.lastName, registration: row?.registration,
      })).digest("hex");
      return { profileId: id, phase, verify: (purpose, publication) => {
        if (publication !== undefined) {
          if (phase !== "setup" || pendingOperation === undefined) throw new Error("profile-credential-key-stage-owner-mismatch");
          publication.assertOperation(root, pendingOperation.operationId);
        }
        const current = publication === undefined ? read() : readProfilePublicationRegistry(publication);
        const registered = current.profiles.find(entry => entry.profileId === id);
        let authority: unknown;
        if (phase === "setup") {
          if (pendingOperation === undefined || row === undefined && registered !== undefined
            && (registered.registration.operationId !== pendingOperation.operationId || registered.registration.commandId !== pendingOperation.commandId
              || registered.registration.writeId !== pendingOperation.writeId || purpose !== "custody" && publication === undefined)) throw new Error("profile-storage-claim-changed");
          const file = readPrivateFile(join(path, `${pendingOperation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
          if (file === undefined) throw new Error("profile-storage-claim-changed");
          const operation = SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
          if (purpose !== "custody" && (operation.onboarding?.abort !== undefined || publication === undefined && operation.phase !== "applying")) throw new Error("profile-setup-operation-not-current");
          authority = operationIdentity(operation);
        } else {
          if (registered === undefined) throw new Error("profile-storage-claim-changed");
          authority = { profileId: registered.profileId, createdAt: registered.createdAt, firstName: registered.firstName, lastName: registered.lastName, registration: registered.registration };
        }
        if (purpose !== "custody") {
          if (current.sessionGeneration !== document.sessionGeneration) throw new Error("profile-storage-claim-generation-changed");
          if (purpose === "runtime" && phase === "runtime" && current.activeProfileId !== id) throw new Error("profile-session-not-current");
          const currentOperations = existsSync(path) ? readdirSync(path).filter(name => name.endsWith(".json")).map(name => {
            const file = readPrivateFile(join(path, name), { label: "lock", maxBytes: 1_048_576 });
            if (file === undefined) throw new Error("profile-storage-claim-changed");
            return z.union([SignUpOperationSchema, LogoutOperationSchema]).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
          }) : [];
          if (currentOperations.some(operation => operation.kind === "logout" ? operation.phase !== "complete" : phase === "runtime")
            || (phase === "setup" ? current.activeProfileId !== null && current.activeProfileId !== id
              : registered?.lifecycle !== "ready" || registered.credentialState !== "saved" || registered.registration.onboardingCompletion === undefined)) {
            throw new Error("profile-storage-claim-unavailable");
          }
        }
        if (createHash("sha256").update(canonicalJsonStringify(authority)).digest("hex") !== fingerprint) throw new Error("profile-storage-claim-changed");
      } };
    }
  #captureSettlementAccess(operationId: string): ProfileAccess {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    const id = z.uuid().parse(operationId);
    const read = () => {
      const document = this.readProfileRegistry();
      const file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${id}.json`), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) throw new Error("profile-settlement-operation-unavailable");
      const operation = LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
      const row = document.profiles.find(entry => entry.profileId === operation.profileId);
      if (operation.operationId !== id || operation.phase === "complete" || row?.lifecycle !== "cancelling" && !(row?.lifecycle === "ready" && operation.settlement?.phase === "done")
        || document.activeProfileId !== null || document.sessionGeneration !== operation.sessionGeneration + 1) throw new Error("profile-settlement-operation-unavailable");
      return operation;
    };
    const original = read();
    return { profileId: original.profileId, phase: "settlement", operationId: id, verify: () => {
      const current = read();
      if (current.profileId !== original.profileId || current.at !== original.at || current.sessionGeneration !== original.sessionGeneration) throw new Error("profile-settlement-operation-changed");
    } };
  }
  assertColdPendingLogout(input: LogoutOperation): void {
    this.assertLive();
    if (this.#scope !== "installation") throw new Error("profile-logout-cold-machine-required");
    (this.#authority as InstallationLease).assertColdPendingLogout(input);
  }
  assertPendingLogoutNativeClose(machine: RuntimeAdmission, input: LogoutOperation): void {
    this.assertLive(); requireRuntimeAdmission(machine);
    if (this.#profileParent !== machine || this.#scope !== "profile" || machine.#scope !== "installation"
      || this.#profileBinding?.profileId !== input.profileId) throw new Error("profile-logout-native-owner-mismatch");
    const operation = LogoutOperationSchema.parse(input), document = machine.readProfileRegistry();
    const row = document.profiles.find(profile => profile.profileId === operation.profileId);
    if (document.sessionGeneration !== operation.sessionGeneration + 1 || document.activeProfileId !== null || row?.lifecycle !== "cancelling") throw new Error("profile-logout-native-epoch-changed");
    const file = readPrivateFile(join(machine.#stateRoot, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined || canonicalJsonStringify(LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)))) !== canonicalJsonStringify(operation)) throw new Error("profile-logout-native-operation-changed");
    const lifetime = machine.lifetime;
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-logout-native-controller-required");
    lifetime.assertRuntimeAvailable();
  }
  forStoppedLogoutSettlement(owner: RuntimeAdmission, input: LogoutOperation, restore: OfflineMaintenanceOperation): RuntimeAdmission {
    this.assertLive(); requireRuntimeAdmission(owner);
    if (this.#scope !== "installation" || owner.#profileParent !== this || owner.#profileBinding?.profileId !== input.profileId
      || owner.#scope !== "profile" && owner.#scope !== "profile-settlement") throw new Error("profile-logout-settlement-owner-mismatch");
    const lifetime = this.lifetime, context = this.readInstallationContext();
    if (!(lifetime instanceof RuntimeLifetimeLock) || context === undefined) throw new Error("profile-logout-settlement-controller-required");
    lifetime.assertOfflineMaintenance(restore, context.workspace);
    assertOfflineMaintenanceForProcessRoot(restore, resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot));
    const operation = deepFreeze(LogoutOperationSchema.parse(input)), lease = this.#authority as InstallationLease;
    const state = { operation, restore, witness: lease.capturePendingProfileLogout(operation) };
    const held = (publication?: ProfilePublicationRead) => {
      this.assertLive(); owner.assertLive();
      lifetime.assertOfflineMaintenance(restore, context.workspace); state.witness.assertHeld(publication);
    };
    held();
    const admission = new RuntimeAdmission(issuanceToken, { assertHeld: held, readInstallationContext: () => this.readInstallationContext(),
      retainSourceClosure: error => this.retainSourceClosure(error), release() {} }, owner.#stateRoot, owner.#artifactRoot,
      [join(owner.#stateRoot, "state.db")], "profile-pending-logout-inventory", "exclusive", this.#locator, owner.#profileBinding, this,
      { owner, operation: canonicalJsonStringify(operation) });
    admission.#stoppedLogout = state;
    return admission;
  }
  assertPendingLogoutPublicationOwner(lease: InstallationLease, restore: OfflineMaintenanceOperation, publication: ProfilePublicationRead): void {
    this.assertLive(publication);
    if (this.#stoppedLogout?.restore !== restore || (this.#profileParent === undefined || this.#profileParent.#authority !== lease)) throw new Error("profile-logout-publication-owner-mismatch");
  }
  commitPendingLogoutSettlement(next: LogoutOperation, source: AuthorityDatabase): void {
    const current = this.assertPendingLogoutSettlementDatabase(join(this.#stateRoot, "state.db"));
    const state = this.#stoppedLogout, parent = this.#profileParent;
    if (state === undefined || parent === undefined) throw new Error("profile-logout-settlement-required");
    const lease = parent.#authority as InstallationLease;
    try {
      lease.publishStoppedLogoutSettlement(this, current, next, state.restore, source);
      state.operation = deepFreeze(LogoutOperationSchema.parse(next));
      state.witness = lease.capturePendingProfileLogout(state.operation);
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { this.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: this, restore: state.restore, database: source }); }
      throw error;
    }
  }
  assertPendingLogoutInspectionDatabase(path: string): void {
    this.assertReadOnlyAuthorityDatabase(path);
    if (this.#scope !== "profile-pending-logout-inventory" || this.#pendingLogout?.copyPath !== path) throw new Error("profile-logout-inspection-copy-required");
  }
  completePendingLogout(source: AuthorityDatabase): void {
    const state = this.#stoppedLogout, parent = this.#profileParent;
    assertSourceClosuresProved(this.#sourceFailures);
    if (this.#released || this.#scope !== "profile-pending-logout-inventory" || state?.operation.settlement?.phase !== "done" || parent === undefined) throw new Error("profile-logout-completion-owner-required");
    (parent.#authority as InstallationLease).completeStoppedLogout(this, state.operation, state.restore, source);
  }
  assertPendingLogoutCompletionOwner(lease: InstallationLease, operation: LogoutOperation, restore: OfflineMaintenanceOperation): void {
    assertSourceClosuresProved(this.#sourceFailures);
    if (this.#released || this.#stoppedLogout?.restore !== restore || this.#stoppedLogout.operation.settlement?.phase !== "done"
      || this.#profileParent === undefined || this.#profileParent.#authority !== lease
      || canonicalJsonStringify(this.#stoppedLogout.operation) !== canonicalJsonStringify(operation)) throw new Error("profile-logout-completion-owner-required");
  }
  assertPendingLogoutSettlementDatabase(path: string): LogoutOperation {
    this.assertLive();
    if (this.#scope !== "profile-pending-logout-inventory" || this.#stoppedLogout === undefined || this.#pendingLogout?.copyPath !== undefined
      || resolve(path) !== path || path !== join(this.#stateRoot, "state.db")) throw new Error("profile-logout-settlement-required");
    return this.#stoppedLogout.operation;
  }
  assertCredentialRead(): void {
    this.assertLive();
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-credential-read-refused");
    if (this.#readyUpgrade !== undefined || this.#scope === "profile-upgrade") throw new Error("profile-stopped-upgrade-credential-read-refused");
    if (this.#scope === "profile-maintenance" || this.#scope === "profile-settlement" || this.#scope === "profile-restore" || this.#scope === "profile-pending-logout-inventory") throw new Error("profile-settlement-credential-read-refused");
    if (this.#scope === "profile" || this.#scope === "profile-initialization") this.#assertCurrentProfileAccess();
  }
  admitProfile(profileId: string): RuntimeAdmission {
    this.#assertMachineRuntime();
    return this.#admitProfile(this.#captureProfileAccess(profileId));
  }
  admitProfilePublication(operationId: string): RuntimeAdmission {
    this.#assertMachineRuntime();
    if (!(this.lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-publication-controller-required");
    const id = z.uuid().parse(operationId), file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${id}.json`), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) throw new Error("profile-publication-operation-required");
    const operation = SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
    if (operation.operationId !== id || operation.phase !== "publishing" || operation.onboarding?.finish === undefined
      || operation.onboarding.abort !== undefined || operation.credentials.phase !== "ready") throw new Error("profile-publication-operation-required");
    const access = this.#captureProfileAccess(operation.profileId);
    if (access.phase !== "setup") throw new Error("profile-publication-operation-required");
    return this.#admitProfile(access, undefined, true);
  }
  admitProfileAbort(operationId: string): RuntimeAdmission {
    this.#assertMachineRuntime();
    if (!(this.lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-abort-controller-required");
    const id = z.uuid().parse(operationId), file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${id}.json`), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) throw new Error("profile-abort-operation-required");
    const operation = SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
    if (operation.operationId !== id || operation.phase !== "applying" || operation.onboarding?.abort === undefined
      || operation.onboarding.finish !== undefined) throw new Error("profile-abort-operation-required");
    const access = this.#captureProfileAccess(operation.profileId);
    if (access.phase !== "setup") throw new Error("profile-abort-operation-required");
    return this.#admitProfile(access, undefined, true);
  }
  admitStoppedProfile(profileId: string, operation: OfflineMaintenanceOperation): RuntimeAdmission {
    this.assertExclusive(); this.assertOfflineMaintenance(operation);
    const access = this.#captureProfileAccess(profileId);
    if (access.phase !== "runtime") throw new Error("profile-onboarding-incomplete");
    access.verify("runtime");
    return this.#admitProfile(access, operation);
  }
  admitProfileSettlement(operationId: string): RuntimeAdmission {
    return this.#admitProfile(this.#captureSettlementAccess(operationId));
  }
  #admitProfile(claim: ProfileAccess, maintenance?: OfflineMaintenanceOperation, publication = false): RuntimeAdmission {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    if (maintenance !== undefined) { this.assertOfflineMaintenance(maintenance); claim.verify("runtime"); }
    else claim.verify(publication ? "custody" : "issue");
    const root = join(this.#stateRoot, "profiles", claim.profileId);
    this.assertStateRoot(root);
    if (claim.phase === "setup" && !publication) {
      ensureChildDirectory(this.#stateRoot, join(this.#stateRoot, "profiles"), "profiles", 0o700, 0o700);
      ensureChildDirectory(join(this.#stateRoot, "profiles"), root, "profile", 0o700, 0o700);
      ensureChildDirectory(root, join(root, "artifacts"), "profile artifacts", 0o700, 0o700);
      if (existsSync(join(root, "state.db"))) {
        const observed = readProfileDatabaseBinding(join(root, "state.db"));
        if (observed.state === "bound") assertCanonicalProfileBinding(join(root, "state.db"), { installationId: this.locator.installationId, profileId: claim.profileId });
      }
    } else if (!publication && claim.phase === "runtime") assertLiveProfileDatabaseBinding(join(root, "state.db"), { installationId: this.locator.installationId, profileId: claim.profileId });
    else if (!publication) assertCanonicalProfileBinding(join(root, "state.db"), { installationId: this.locator.installationId, profileId: claim.profileId });
    const ancestry = new Map<string, DirectoryIdentity>();
    noSymlinkAncestry(root, ancestry);
    let restoreCustody: { input: AuthorityRestoreInput; restore: OfflineMaintenanceOperation } | undefined;
    let restoreSettled = false;
    const assertHeld = (scope?: ProfilePublicationRead) => {
      this.assertLive();
      if (restoreSettled) throw new Error("profile-restore-context-expired");
      if (maintenance !== undefined) this.assertOfflineMaintenance(maintenance);
      if (restoreCustody !== undefined) {
        this.#exclusiveInstallationLease().assertProfileRestoreHeld(restoreCustody.input, restoreCustody.restore);
        return;
      }
      if (maintenance !== undefined) claim.verify("runtime");
      const proof = outermostOperationProof();
      const verified = proof?.slots.get(PROFILE_CUSTODY_PROOF);
      if (verified instanceof WeakSet && verified.has(claim)) return;
      if (!noSymlinkAncestry(root, ancestry)) throw new Error("profile-storage-root-disappeared");
      claim.verify("custody", scope);
      if (proof === undefined) return;
      if (verified instanceof WeakSet) verified.add(claim);
      else proof.slots.set(PROFILE_CUSTODY_PROOF, new WeakSet([claim]));
    };
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    return new RuntimeAdmission(issuanceToken, { assertHeld,
      captureRestoreContext: credentials => this.#exclusiveInstallationLease().captureProfileRestore(claim.profileId, credentials),
      beginAuthorityRestore: (input, restore) => {
        if (input.profile.binding.profileId !== claim.profileId || input.profile.binding.installationId !== this.locator.installationId) throw new Error("profile-restore-binding-mismatch");
        this.#exclusiveInstallationLease().beginAuthorityRestore(input, restore);
        restoreCustody = { input, restore };
      },
      settleAuthorityRestore: (input, outcome, verify, restore) => {
        if (restoreCustody === undefined || restoreCustody.restore !== restore || canonicalJsonStringify(restoreCustody.input) !== canonicalJsonStringify(input)) throw new Error("profile-restore-custody-mismatch");
        this.#exclusiveInstallationLease().settleAuthorityRestore(input, outcome, verify, restore);
        restoreSettled = true;
      },
      assertAuthorityRestoreCurrent: (input, restore) => {
        if (restoreCustody === undefined || restoreCustody.restore !== restore || canonicalJsonStringify(restoreCustody.input) !== canonicalJsonStringify(input)) throw new Error("profile-restore-custody-mismatch");
        this.#exclusiveInstallationLease().assertProfileRestoreHeld(input, restore);
      },
      readAuthorityRestore: operationId => {
        if (restoreCustody?.input.operationId !== operationId) throw new Error("profile-restore-custody-mismatch");
        return this.#exclusiveInstallationLease().readAuthorityRestore(operationId);
      },
      assertProfileRuntime: publication => {
        if (restoreCustody !== undefined || restoreSettled) throw new Error("profile-restore-runtime-refused");
        claim.verify("runtime", publication);
      },
      assertPendingLogoutCustody: operationId => {
        this.assertLive();
        if (restoreSettled) throw new Error("profile-restore-context-expired");
        if (restoreCustody !== undefined) {
          this.#exclusiveInstallationLease().assertProfileRestoreHeld(restoreCustody.input, restoreCustody.restore);
        } else if (!noSymlinkAncestry(root, ancestry)) throw new Error("profile-storage-root-disappeared");
        if (claim.phase !== "settlement" || claim.operationId !== operationId) throw new Error("profile-settlement-operation-unavailable");
      },
      readInstallationContext: () => this.readInstallationContext(), release() {} }, root, join(root, "artifacts"),
      [join(root, "state.db")], maintenance !== undefined ? "profile-maintenance" : claim.phase === "setup" ? "profile-initialization" : claim.phase === "settlement" ? "profile-settlement" : "profile", this.#mode, this.#locator,
      { installationId: this.locator.installationId, profileId: claim.profileId }, this);
  }
  get stateRoot(): string { this.assertLive(); return this.#stateRoot; }
  get artifactRoot(): string { this.assertLive(); return this.#artifactRoot; }
  get lifetime(): RuntimeLifetimeLock | WorkerRuntimeLifetimeLock {
    requireRuntimeAdmission(this);
    if (this.#profileParent !== undefined) return this.#profileParent.lifetime;
    if (this.#scope !== "installation") throw new Error("runtime-lifetime-installation-required");
    const lifetime = (this.#authority as InstallationLease).lifetime;
    lifetime.assertHeld();
    return lifetime;
  }
  readInstallationContext(): Readonly<{ workspace: string; locator: RuntimeLocator;
    receipts: readonly RelocationCompletionReceipt[] }> | undefined {
    this.assertLive();
    if (this.#scope === "synthetic") return undefined;
    if ((this.#readyUpgrade !== undefined || this.#flatBackup !== undefined) && this.#profileParent !== undefined) return this.#profileParent.readInstallationContext();
    if (this.#scope === "stopped-incomplete-profile-inventory" || this.#scope === "stopped-control-inventory" || this.#scope === "profile-restore" || this.#scope === "stopped-staged" || this.#scope === "stopped-projection" || this.#scope === "synthetic-stopped-staged") {
      if (this.#authority.readInstallationContext === undefined) throw new Error("runtime-admission: staged installation context unavailable");
      return this.#authority.readInstallationContext();
    }
    if (this.#scope === "profile-maintenance" || this.#scope === "profile" || this.#scope === "profile-initialization" || this.#scope === "profile-upgrade" || this.#scope === "profile-settlement"
      || this.#scope === "profile-pending-logout-inventory") {
      if (this.#authority.readInstallationContext === undefined) throw new Error("profile-parent-context-unavailable");
      return this.#authority.readInstallationContext();
    }
    if (this.#scope !== "installation") throw new Error("runtime-admission: installation context authority required");
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    return lease.readInstallationContext();
  }
  assertFixedProcessLockRoot(workspaceRoot: string, processLockRoot: string): void {
    this.assertLive();
    if (this.#scope === "profile" || this.#scope === "profile-maintenance" || this.#scope === "profile-upgrade") {
      if (this.#profileParent === undefined) throw new Error("profile-parent-context-unavailable");
      this.#profileParent.assertFixedProcessLockRoot(workspaceRoot, processLockRoot);
      return;
    }
    if (this.#scope !== "installation") throw new Error("runtime-admission: installation lock authority required");
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    lease.assertFixedProcessLockRoot(workspaceRoot, processLockRoot);
  }
  readRelocationReceipts(): readonly RelocationCompletionReceipt[] {
    this.assertLive();
    if (this.#scope !== "installation" || this.#authority.readRelocationReceipts === undefined) {
      throw new Error("runtime-admission: installation receipt authority required");
    }
    return this.#authority.readRelocationReceipts();
  }
  assertLive(publication?: ProfilePublicationRead): void {
    if (!(#released in this) || this.#released) throw new Error("runtime-admission: missing or released admission");
    this.#authority.assertHeld(publication);
  }
  assertStorageRootsSafe(): void {
    this.assertLive();
    this.#assertPhysicalStorageRootsSafe();
  }
  #assertPhysicalStorageRootsSafe(): void {
    if (this.#scope === "synthetic" || this.#scope === "synthetic-verified-copy" || this.#scope === "synthetic-stopped-staged") {
      if (this.#stateRoot !== ":memory:") assertSyntheticDirectory(this.#stateRoot);
      if (this.#artifactRoot !== ":memory:") assertSyntheticDirectory(this.#artifactRoot);
      return;
    }
    assertActiveRootSafe(this.#stateRoot);
    assertActiveRootSafe(this.#artifactRoot);
  }
  assertExclusive(): void {
    this.assertLive();
    if (this.#flatBackup !== undefined) throw new Error("flat-backup-exclusive-refused");
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-write-refused");
    if (this.#readyUpgrade !== undefined) throw new Error("profile-stopped-upgrade-exclusive-refused");
    if (this.#scope === "profile-pending-logout-inventory") throw new Error("profile-pending-logout-write-refused");
    if (this.#mode !== "exclusive" && this.#mode !== "synthetic") throw new Error("runtime-admission: exclusive offline admission required");
  }
  assertWritable(): void {
    this.assertLive();
    if (this.#flatBackup !== undefined) throw new Error("flat-backup-runtime-refused");
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-write-refused");
    if (this.#readyUpgrade !== undefined || this.#scope === "profile-upgrade") throw new Error("profile-stopped-upgrade-runtime-refused");
    if (this.#scope === "profile-maintenance" || this.#scope === "profile-settlement" || this.#scope === "profile-restore" || this.#scope === "profile-pending-logout-inventory") throw new Error("profile-settlement-runtime-refused");
    if (this.#scope === "profile" || this.#scope === "profile-initialization") this.#assertCurrentProfileAccess();
    if (this.#scope === "profile-initialization") assertCanonicalProfileBinding(join(this.#stateRoot, "state.db"), this.profileBinding);
    if (this.#scope === "adoption-inspection") throw new Error("runtime-admission: adoption inspection is read-only");
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization has database-only write authority");
    if (this.#scope === "verified-copy" || this.#scope === "synthetic-verified-copy"
      || this.#scope === "relocation-source-verification") throw new Error("runtime-admission: verification is read-only");
  }
  assertAuthorityDatabase(path: string): void {
    if (this.#scope === "installation") throw new Error("profile-bound-authority-required");
    if (this.#scope === "profile-initialization" || this.#scope === "profile-upgrade") this.assertReadable();
    else if (this.#scope === "adoption-initialization") this.assertLive();
    else this.assertWritable();
    this.assertStorageRootsSafe();
    if (path === ":memory:" && this.#scope !== "relocation-destination" && this.#scope !== "adoption-initialization"
      && this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade" && this.#scope !== "profile") return;
    if (!this.#authorityDatabasePaths.has(path === ":memory:" ? path : resolve(path))) throw new Error("runtime-admission: authority database path is outside admission");
  }
  assertReadOnlyAuthorityDatabase(path: string): void {
    this.assertReadable();
    if (this.#scope === "stopped-incomplete-profile-inventory" && resolve(path) !== join(this.#stateRoot, "state.db")) throw new Error("profile-incomplete-inventory-path-refused");
    if (this.#scope === "stopped-control-inventory" && path === ":memory:") throw new Error("profile-control-upgrade-inspection-path-refused");
    const backup = this.#flatBackup ?? this.#readyUpgrade;
    if (backup !== undefined) {
      if (path === ":memory:" || backup.copyPath !== undefined && path !== backup.copyPath) throw new Error("profile-stopped-upgrade-path-refused");
      if (backup.copyPath === undefined && path !== backup.sourcePath
        && (dirname(path) !== join(this.#stateRoot, "backups", "authority")
          || !/^(?:\.authority-[0-9a-f-]{36}\.sqlite\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite)$/u.test(path.slice(dirname(path).length + 1)))) throw new Error("profile-stopped-upgrade-path-refused");
    }
    if (this.#scope === "profile-pending-logout-inventory") {
      if (path === ":memory:" || this.#pendingLogout?.copyPath !== undefined && path !== this.#pendingLogout.copyPath) throw new Error("profile-pending-logout-path-refused");
    }
    if (this.#scope === "relocation-source-verification" || this.#scope === "adoption-initialization") {
      throw new Error("runtime-admission: inspection database authority unavailable");
    }
    this.#assertPhysicalStorageRootsSafe();
    if (path === ":memory:" && this.#scope !== "relocation-destination"
      && this.#scope !== "profile-maintenance" && this.#scope !== "profile" && this.#scope !== "profile-restore" && this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade") return;
    const checked = resolve(path);
    if (this.#authorityDatabasePaths.has(checked)) return;
    if (this.#scope === "adoption-inspection") throw new Error("runtime-admission: adoption inspection path is outside known default authority");
    const parent = dirname(checked);
    if (parent === join(this.#stateRoot, "backups", "suspects") && /^suspect-\d{17}-[0-9a-f-]{36}\.sqlite$/u.test(checked.slice(parent.length + 1))) return;
    if (parent === join(this.#stateRoot, "backups", "authority")
      && /^(?:\.authority-[0-9a-f-]{36}\.sqlite\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite)$/u.test(checked.slice(parent.length + 1))) {
      this.assertStateRoot(parent);
      return;
    }
    throw new Error("runtime-admission: read-only authority database path is outside admission");
  }
  assertStateRoot(path: string): void {
    this.assertLive();
    if (this.#stoppedControlBackupPath(path)) return;
    if (this.#readyUpgrade !== undefined) {
      if (this.#readyUpgrade.copyPath !== undefined && path !== this.#readyUpgrade.copyPath) throw new Error("profile-stopped-upgrade-path-refused");
    }
    if (this.#pendingLogout?.copyPath !== undefined && path !== this.#pendingLogout.copyPath) throw new Error("profile-pending-logout-path-refused");
    if (this.#scope === "profile-settlement" && resolve(path) !== this.#stateRoot && !within(join(this.#stateRoot, "credentials"), resolve(path))) throw new Error("profile-settlement-path-refused");
    if (this.#scope === "profile-upgrade" && resolve(path) !== this.#stateRoot && resolve(path) !== join(this.#stateRoot, "state.db")
      && !within(join(this.#stateRoot, "backups", "authority"), resolve(path))) throw new Error("profile-stopped-upgrade-path-refused");
    this.#assertPhysicalStorageRootsSafe();
    if (this.#scope === "adoption-initialization" && ![this.#stateRoot, join(this.#stateRoot, "state.db")].includes(resolve(path))) {
      throw new Error("runtime-admission: fresh initialization path is outside database authority");
    }
    if (!within(this.#stateRoot, resolve(path))) throw new Error("runtime-admission: state path is outside admission");
  }
  assertCanonicalCredentialCreation(profile: RuntimeAdmission, input: SignUpOperation, publication?: ProfilePublicationRead) {
    this.#assertMachineRuntime();
    if (profile.#released || profile.#profileParent !== this || profile.#scope !== "profile-initialization"
      || profile.#profileBinding?.profileId !== input.profileId || profile.#profileBinding.installationId !== this.#locator?.installationId
      || profile.#stateRoot !== join(this.#stateRoot, "profiles", input.profileId)) throw new Error("profile-credential-creation-owner-mismatch");
    if (publication !== undefined) publication.assertOperation(this.#stateRoot, input.operationId);
    profile.#assertCurrentProfileAccess(publication);
    const operation = SignUpOperationSchema.parse(input);
    if (operation.onboarding?.abort !== undefined) throw new Error("profile-credential-creation-aborted");
    const file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined || canonicalJsonStringify(SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)))) !== canonicalJsonStringify(operation)) throw new Error("profile-credential-creation-changed");
    return { operation, binding: profile.#profileBinding, machineRoot: this.#stateRoot, profileRoot: profile.#stateRoot };
  }

  assertCanonicalCredentialErasure(profile: RuntimeAdmission, input: SignUpOperation) {
    this.#assertMachineRuntime(); profile.assertLive();
    if (profile.#released || profile.#profileParent !== this || profile.#scope !== "profile-initialization"
      || profile.#profileBinding?.profileId !== input.profileId || profile.#profileBinding.installationId !== this.#locator?.installationId
      || profile.#stateRoot !== join(this.#stateRoot, "profiles", input.profileId)) throw new Error("profile-credential-erasure-owner-mismatch");
    const operation = SignUpOperationSchema.parse(input), document = this.readProfileRegistry();
    if (operation.phase !== "applying" || operation.onboarding?.abort === undefined || operation.onboarding.finish !== undefined
      || document.activeProfileId !== null || document.profiles.some(row => row.profileId === operation.profileId)) throw new Error("profile-credential-erasure-operation-required");
    const file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined || canonicalJsonStringify(SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)))) !== canonicalJsonStringify(operation)) throw new Error("profile-credential-erasure-changed");
    return { operation, binding: profile.#profileBinding, machineRoot: this.#stateRoot, profileRoot: profile.#stateRoot };
  }

  assertArtifactRoot(path: string): void {
    this.assertReadable();
    if (this.#flatBackup !== undefined) throw new Error("flat-backup-artifact-refused");
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-artifact-refused");
    if (this.#scope === "profile-pending-logout-inventory") throw new Error("profile-pending-logout-write-refused");
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization cannot write artifacts");
    this.#assertPhysicalStorageRootsSafe();
    if (!within(this.#artifactRoot, resolve(path))) throw new Error("runtime-admission: artifact path is outside admission");
  }
  retainSourceClosure(error: unknown): void {
    if (!rememberUnprovedSourceClosure(this.#sourceFailures, error)) return;
    retainUnprovedSourceOwners(error, { admission: this });
    if (this.#profileParent !== undefined) this.#profileParent.retainSourceClosure(error);
    else if (this.#scope === "installation") {
      (this.#authority as InstallationLease).retainSourceClosure(error);
    } else this.#authority.retainSourceClosure?.(error);
  }
  release(): void {
    assertSourceClosuresProved(this.#sourceFailures);
    if (this.#released) return;
    const restore = this.#scope === "installation" ? stoppedMaintenanceRestores.get(this.#authority as InstallationLease) : undefined;
    if (restore !== undefined) {
      try { restore.release(); }
      catch (error) {
        const failure = retainAuthoritySourceClosure([error], { restore, admission: this });
        this.retainSourceClosure(failure); throw failure;
      }
    }
    try { this.#authority.release(); }
    catch (error) { this.retainSourceClosure(error); throw error; }
    this.#released = true;
    if (restore !== undefined) stoppedMaintenanceRestores.delete(this.#authority as InstallationLease);
  }
  beginOfflineMaintenance(): OfflineMaintenanceOperation {
    this.assertLive();
    if (this.#profileParent !== undefined) return this.#profileParent.beginOfflineMaintenance();
    return this.#exclusiveInstallationLease().beginOfflineMaintenance();
  }

  readCompletedRestores(): readonly CompletedRestoreCustody[] {
    this.assertLive();
    if (this.#scope === "stopped-control-inventory" && this.#stoppedControlInventory !== undefined) {
      const source = requireStoppedControlProfileInventory(this.#stoppedControlInventory);
      source.revalidateSource();
      return [];
    }
    const { profileId } = this.profileBinding;
    let machine: RuntimeAdmission = this.#profileParent ?? this;
    while (machine.#profileParent !== undefined) machine = machine.#profileParent;
    if (machine.#scope !== "installation") throw new Error("completed-restore-installation-required");
    const authority = machine.#authority;
    assertInstallationLease(authority);
    return authority.readCompletedRestores(profileId);
  }

  assertOfflineMaintenance(operation: OfflineMaintenanceOperation): void {
    this.assertLive();
    if (this.#profileParent !== undefined) { this.#profileParent.assertOfflineMaintenance(operation); return; }
    this.#exclusiveInstallationLease().assertOfflineMaintenance(operation);
  }

  acquireOfflineMaintenance(): OfflineMaintenanceOperation {
    this.assertLive();
    if (this.#profileParent !== undefined) return this.#profileParent.acquireOfflineMaintenance();
    const lease = this.#exclusiveInstallationLease();
    const issued = stoppedMaintenanceRestores.get(lease);
    if (issued !== undefined) { lease.assertOfflineMaintenance(issued); issued.assertAvailable(); return issued; }
    return lease.beginOfflineMaintenance();
  }

  maintenanceOperation(): OfflineMaintenanceOperation {
    this.assertLive();
    if (this.#profileParent !== undefined) return this.#profileParent.maintenanceOperation();
    return this.#exclusiveInstallationLease().offlineMaintenanceOperation();
  }

  #exclusiveInstallationLease(): ExclusiveInstallationLease {
    this.assertLive();
    if (this.#scope !== "installation" || this.#mode !== "exclusive") {
      throw new Error("runtime-admission: exclusive installation authority required");
    }
    const lease = this.#authority as ExclusiveInstallationLease;
    assertInstallationLease(lease);
    if (lease.mode !== "exclusive") throw new Error("runtime-admission: exclusive installation lease required");
    return lease;
  }

  captureProfileRestore(operation: OfflineMaintenanceOperation): ProfileRestoreContext {
    this.assertStoppedProfile(operation);
    if (this.#authority.captureRestoreContext === undefined) throw new Error("profile-restore-authority-required");
    const credentials = captureStoppedCanonicalCredentialHead(this, operation);
    this.assertStoppedProfile(operation);
    return this.#authority.captureRestoreContext(credentials);
  }
  beginAuthorityRestore(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void {
    this.assertExclusive();
    if (this.#authority.beginAuthorityRestore === undefined) throw new Error("profile-restore-authority-required");
    this.#authority.beginAuthorityRestore(input, restore);
  }
  settleAuthorityRestore(input: AuthorityRestoreInput, outcome: "unchanged" | "replaced", verify: AuthorityRestoreVerifier,
    restore: OfflineMaintenanceOperation): void {
    this.assertExclusive();
    if (this.#authority.settleAuthorityRestore === undefined) throw new Error("profile-restore-authority-required");
    this.#authority.settleAuthorityRestore(input, outcome, verify, restore);
  }
  assertAuthorityRestoreCurrent(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void {
    this.assertExclusive();
    if (this.#authority.assertAuthorityRestoreCurrent === undefined) throw new Error("profile-restore-authority-required");
    this.#authority.assertAuthorityRestoreCurrent(input, restore);
  }
  readAuthorityRestore(operationId: string): AuthorityRestoreInput {
    this.assertExclusive();
    if (this.#authority.readAuthorityRestore === undefined) throw new Error("profile-restore-authority-required");
    return this.#authority.readAuthorityRestore(operationId);
  }
  assertStorageRelocationSupported(): void {
    this.assertLive();
    const locator = this.#locator;
    if (this.#profileBinding === undefined || locator === undefined || existsSync(join(locator.stateRoot, "machine")) || existsSync(join(locator.stateRoot, "profiles"))) throw new ProfileStorageRelocationUnsupportedError();
  }
  beginRelocation(destination: RuntimePair, plan: RelocationPlanBinding,
    restore: OfflineMaintenanceOperation): RuntimeRelocationOperation {
    this.assertStorageRelocationSupported();
    const lease = this.#exclusiveInstallationLease();
    const operationId = lease.beginRelocation(destination, plan, restore);
    return this.#relocationOperation(lease, operationId);
  }

  resumeRelocation(operationId: string): RuntimeRelocationOperation {
    this.assertStorageRelocationSupported();
    return this.#relocationOperation(this.#exclusiveInstallationLease(), operationId);
  }

  #relocationOperation(lease: ExclusiveInstallationLease, operationId: string): RuntimeRelocationOperation {
    const initial = lease.relocationInventory();
    if (initial.operationId !== operationId || initial.installationId !== this.locator.installationId
      || initial.fromGeneration !== this.locator.generation && initial.fromGeneration + 1 !== this.locator.generation) {
      throw new Error("runtime-admission: relocation operation binding mismatch");
    }
    const binding = canonicalJsonStringify({ operationId: initial.operationId, installationId: initial.installationId,
      fromGeneration: initial.fromGeneration, source: initial.source, destination: initial.destination,
      plan: initial.plan, pinnedEntries: initial.pinnedEntries, retentions: initial.retentions });
    const inventory = (): RelocationInventory => {
      this.assertLive();
      const current = lease.relocationInventory();
      const currentBinding = canonicalJsonStringify({ operationId: current.operationId, installationId: current.installationId,
        fromGeneration: current.fromGeneration, source: current.source, destination: current.destination,
        plan: current.plan, pinnedEntries: current.pinnedEntries, retentions: current.retentions });
      if (currentBinding !== binding) throw new Error("runtime-admission: relocation operation changed");
      return current;
    };
    const child = (pair: RuntimePair, scope: AdmissionScope): RuntimeAdmission => new RuntimeAdmission(issuanceToken,
      { assertHeld: () => { inventory(); }, release() {} }, pair.stateRoot, pair.artifactRoot,
      scope === "relocation-destination" ? [join(pair.stateRoot, "state.db")] : [],
      scope, "exclusive");
    return Object.freeze({ operationId, inventory,
      prepareDestinationRoots: () => { inventory(); lease.prepareDestinationRoots(); },
      verifiedSourceControlEntries: () => { inventory(); return lease.verifiedSourceControlEntries(); },
      readPriorReceipts: () => { inventory(); return lease.readPriorReceipts(); },
      destinationAdmission: () => child(inventory().destination, "relocation-destination"),
      sourceVerificationAdmission: () => {
        const current = inventory();
        if (current.phase !== "retained" && current.phase !== "switched") {
          throw new Error("runtime-admission: fully retained source required for verification");
        }
        const state = current.retentions.find((row) => row.role === "state");
        const artifact = current.retentions.find((row) => row.role === "artifact");
        const stateRoot = state?.retained ?? current.source.stateRoot;
        const artifactRoot = artifact?.retained ?? (state !== undefined
          && (current.source.artifactRoot === current.source.stateRoot
            || current.source.artifactRoot.startsWith(`${current.source.stateRoot}/`))
          ? join(state.retained, relative(current.source.stateRoot, current.source.artifactRoot))
          : current.source.artifactRoot);
        return child({ stateRoot, artifactRoot }, "relocation-source-verification");
      },
      recordVerifiedStage: (verify: RelocationVerifier) => { inventory(); lease.recordVerifiedStage(verify); },
      recordVerifiedPreparation: (verify: RelocationPreparationVerifier) => { inventory(); lease.recordVerifiedPreparation(verify); },
      recordActivationIntent: (verify: RelocationActivationVerifier) => { inventory(); lease.recordActivationIntent(verify); },
      fenceRelocationSource: () => { inventory(); lease.fenceRelocationSource(); },
      retainRelocationSources: () => { inventory(); lease.retainRelocationSources(); },
      switchRelocationLocator: (verify: RelocationVerifier) => { inventory(); return lease.switchRelocationLocator(verify); },
      settleRelocation: (verify: RelocationVerifier) => { inventory(); lease.settleRelocation(verify); },
    });
  }

  stoppedRestoreProjection(path: string, restore: OfflineMaintenanceOperation): RuntimeAdmission {
    this.assertStoppedProfile(restore);
    if (!isAbsolute(path) || resolve(path) !== path || dirname(path) !== this.#stateRoot
      || !/^\.restore-[0-9a-f-]{36}\.sqlite\.tmp$/u.test(path.slice(this.#stateRoot.length + 1))) throw new Error("profile-restore-projection-path-refused");
    const context = this.readInstallationContext();
    if (context === undefined) throw new Error("profile-restore-projection-parent-required");
    const assertHeld = () => {
      this.assertLive();
      assertOfflineMaintenanceForProcessRoot(restore, resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot));
      assertProfileRestoreDatabaseBinding(path, this.profileBinding);
    };
    assertHeld();
    return new RuntimeAdmission(issuanceToken, { assertHeld, readInstallationContext: () => this.readInstallationContext(), release() {} },
      this.#stateRoot, this.#artifactRoot, [path], "stopped-projection", "exclusive", this.#locator, this.profileBinding);
  }
  assertStoppedRestoreProjection(path: string): void {
    this.assertLive();
    if (this.#scope !== "stopped-projection" || resolve(path) !== path || this.#authorityDatabasePaths.size !== 1 || !this.#authorityDatabasePaths.has(path)) throw new Error("profile-restore-projection-capability-required");
    this.assertAuthorityDatabase(path);
    assertProfileRestoreDatabaseBinding(path, this.profileBinding);
  }

  stoppedStagedAuthority(path: string): RuntimeAdmission {
    this.assertExclusive();
    if ((this.#scope !== "profile-maintenance" && this.#scope !== "profile" && this.#scope !== "synthetic") || dirname(resolve(path)) !== this.#stateRoot
      || !/^\.restore-[0-9a-f-]{36}\.sqlite\.tmp$/u.test(resolve(path).slice(this.#stateRoot.length + 1))) {
      throw new Error("runtime-admission: staged authority path is not an owned restore copy");
    }
    return new RuntimeAdmission(issuanceToken, { assertHeld: () => this.assertLive(), readInstallationContext: () => this.readInstallationContext(), release() {} },
      this.#stateRoot, this.#artifactRoot, [resolve(path)], this.#scope === "synthetic" ? "synthetic-stopped-staged" : "stopped-staged", "exclusive", this.#locator, this.#profileBinding);
  }

  capturePendingLogoutSnapshot() {
    const path = join(this.#stateRoot, "state.db");
    const operation = this.assertPendingLogoutSettlementDatabase(path);
    const checkSource = () => {
      this.assertPendingLogoutSettlementDatabase(path);
      const file = lstatSync(path);
      if (!file.isFile() || file.nlink !== 1 || privatePathRejects(path, file, "owner")
        || file.dev !== operation.source.database.device || file.ino !== operation.source.database.inode) throw new Error("profile-logout-native-source-changed");
    };
    checkSource();
    let snapshot: ReturnType<typeof createReadonlyAuthoritySnapshot> | undefined, admission: RuntimeAdmission | undefined;
    try {
      snapshot = createReadonlyAuthoritySnapshot(path);
      const file = readPrivateFile(snapshot.path, { label: "authority database", maxBytes: 512 * 1024 * 1024 });
      if (file === undefined) throw new Error("profile-logout-inspection-copy-missing");
      checkSource(); snapshot.assertUnchanged();
      admission = this.#verifiedReadOnlyCopy(snapshot.path, createHash("sha256").update(file.bytes).digest("hex"), snapshot);
      const ownedSnapshot = snapshot, copy = admission;
      let disposalFailure: { error: unknown } | undefined;
      return Object.freeze({ snapshot: ownedSnapshot, admission: copy, dispose: () => {
        if (disposalFailure !== undefined) throw disposalFailure.error;
        try { copy.release(); ownedSnapshot.dispose(); }
        catch (error) {
          this.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: { owner: this, copy }, snapshot: ownedSnapshot });
          disposalFailure = { error }; throw error;
        }
      } });
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) {
        this.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: { owner: this, admission }, snapshot }); throw error;
      }
      try { admission?.release(); snapshot?.dispose(); }
      catch (cleanup) {
        const failure = retainAuthoritySourceClosure([error, cleanup], { admission: { owner: this, admission }, snapshot });
        this.retainSourceClosure(failure); throw failure;
      }
      throw error;
    }
  }
  verifiedReadOnlyCopy(path: string, expectedSha256: string): RuntimeAdmission {
    if (this.#pendingLogout !== undefined) throw new Error("profile-pending-logout-copy-delegation-refused");
    return this.#verifiedReadOnlyCopy(path, expectedSha256);
  }
  #verifiedReadOnlyCopy(path: string, expectedSha256: string, snapshot?: ReturnType<typeof createReadonlyAuthoritySnapshot>): RuntimeAdmission {
    this.assertReadable();
    if (snapshot !== undefined) {
      this.assertPendingLogoutSettlementDatabase(join(this.#stateRoot, "state.db"));
      if (snapshot.path !== path) throw new Error("profile-logout-inspection-copy-refused");
      snapshot.assertUnchanged();
    }
    if (this.#readyUpgrade !== undefined && (this.#readyUpgrade.copyPath !== undefined
      || !isAbsolute(path) || resolve(path) !== path
      || dirname(resolve(path)) !== join(this.#stateRoot, "backups", "authority")
      || !/^(?:\.authority-[0-9a-f-]{36}\.sqlite\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite)$/u.test(resolve(path).slice(dirname(resolve(path)).length + 1)))) throw new Error("profile-stopped-upgrade-copy-refused");
    if (this.#pendingLogout?.copyPath !== undefined) throw new Error("profile-pending-logout-copy-delegation-refused");
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization cannot delegate copy authority");
    if (this.#scope === "relocation-source-verification") {
      throw new Error("runtime-admission: source verification is limited to retained roots");
    }
    if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) throw new Error("runtime-admission: invalid copy digest");
    const checked = resolve(path);
    if (this.#scope === "stopped-control-inventory" && !within(this.#stateRoot, checked) && !this.#stoppedControlBackupPath(checked)) throw new Error("profile-control-upgrade-copy-path-refused");
    if (snapshot === undefined && !within(this.#stateRoot, checked) && !this.#stoppedControlBackupPath(checked)) this.assertExclusive();
    const canonical = realpathSync(checked);
    const temp = resolve(tmpdir());
    if (canonical !== checked && !(within(temp, checked)
      && canonical === join(realpathSync(tmpdir()), relative(temp, checked)))) {
      throw new Error("runtime-admission: inspected copy path contains symlink");
    }
    let component = parse(canonical).root;
    for (const part of relative(component, canonical).split(/[\\/]/u)) {
      if (part === "") continue;
      component = join(component, part);
      const info = lstatSync(component);
      if (info.isSymbolicLink()) throw new Error("runtime-admission: inspected copy contains symlink");
    }
    const verifyBytes = () => {
      this.assertReadable(); snapshot?.assertUnchanged();
      const file = lstatSync(canonical);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || privatePathRejects(canonical, file, "group-write")) {
        throw new Error("runtime-admission: inspected copy has unsafe shape");
      }
      const descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      let primary: { error: unknown } | undefined;
      let descriptorIdentity = file;
      try {
        const opened = fstatSync(descriptor); descriptorIdentity = opened;
        if (opened.dev !== file.dev || opened.ino !== file.ino || opened.size !== file.size) {
          throw new Error("runtime-admission: inspected copy changed during open");
        }
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let read = 0;
        while ((read = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
        const final = fstatSync(descriptor);
        if (final.dev !== opened.dev || final.ino !== opened.ino || final.size !== opened.size
          || final.mtimeMs !== opened.mtimeMs || hash.digest("hex") !== expectedSha256) {
          throw new Error("runtime-admission: inspected copy digest changed");
        }
      } catch (error) { primary = { error }; }
      try { closeSync(descriptor); }
      catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
        { descriptor: { descriptor, identity: descriptorIdentity } }); }
      if (primary !== undefined) throw primary.error;
      this.assertReadable(); snapshot?.assertUnchanged();
    };
    verifyBytes();
    if (this.#scope === "stopped-control-inventory") return new RuntimeAdmission(issuanceToken,
      { assertHeld: verifyBytes, readInstallationContext: () => this.readInstallationContext(), release() {} },
      this.#stateRoot, this.#artifactRoot, [checked], "stopped-control-inventory", this.#mode, this.#locator, this.profileBinding);
    return new RuntimeAdmission(issuanceToken, { assertHeld: verifyBytes, release() {} },
      this.#stateRoot, this.#artifactRoot, [checked],
      this.#readyUpgrade !== undefined ? "profile-ready-upgrade" : this.#scope === "profile-pending-logout-inventory" ? "profile-pending-logout-inventory"
        : this.#scope === "synthetic" || this.#scope === "synthetic-verified-copy" ? "synthetic-verified-copy" : "verified-copy", this.#mode,
      this.#pendingLogout === undefined && this.#readyUpgrade === undefined ? undefined : this.#locator,
      this.#pendingLogout === undefined && this.#readyUpgrade === undefined ? undefined : this.#profileBinding,
      this.#pendingLogout === undefined && this.#readyUpgrade === undefined ? undefined : this.#profileParent,
      this.#pendingLogout === undefined ? undefined : { ...this.#pendingLogout, copyPath: checked },
      this.#readyUpgrade === undefined ? undefined : { ...this.#readyUpgrade, copyPath: checked });
  }

  resumeProfileAuthorityRestore(operationId: string, restore: OfflineMaintenanceOperation): RuntimeAdmission {
    const lease = this.#exclusiveInstallationLease();
    const input = lease.readAuthorityRestore(operationId);
    let settled = false;
    const held = () => {
      if (settled) throw new Error("profile-restore-context-expired");
      this.assertLive(); lease.assertProfileRestoreHeld(input, restore);
    };
    const root = join(this.#stateRoot, "profiles", input.profile.binding.profileId);
    return new RuntimeAdmission(issuanceToken, { assertHeld: held,
      readInstallationContext: () => this.readInstallationContext(),
      readAuthorityRestore: id => { held(); if (id !== operationId) throw new Error("profile-restore-custody-mismatch"); return input; },
      settleAuthorityRestore: (binding, outcome, verify, handle) => {
        held();
        if (handle !== restore || canonicalJsonStringify(binding) !== canonicalJsonStringify(input)) throw new Error("profile-restore-custody-mismatch");
        lease.settleAuthorityRestore(binding, outcome, verify, handle); settled = true;
      }, release: () => this.release() }, root, join(root, "artifacts"), [join(root, "state.db")], "profile-restore", "exclusive", this.#locator, input.profile.binding, this);
  }

  static forStoppedControlInventory(value: StoppedControlProfileInventory): RuntimeAdmission {
    const issued = requireStoppedControlProfileInventory(value);
    const admission = new RuntimeAdmission(issuanceToken, { assertHeld: issued.assertHeld, readInstallationContext: issued.readInstallationContext, retainSourceClosure: issued.retainSourceClosure, release() {} },
      issued.stateRoot, issued.artifactRoot, [join(issued.stateRoot, "state.db")], "stopped-control-inventory", "exclusive", issued.locator, issued.binding);
    admission.#stoppedControlInventory = value;
    return admission;
  }
  readStoppedControlCredentialInventorySource(claim: StoppedControlProfileInventory): ReturnType<typeof requireStoppedControlProfileInventory> {
    requireRuntimeAdmission(this);
    if (this.#scope !== "stopped-control-inventory" || this.#stoppedControlInventory !== claim) throw new Error("stopped-control-inventory-unissued");
    this.assertLive();
    return requireStoppedControlProfileInventory(claim);
  }
  #installationRootLifetime(): RuntimeLifetimeLock {
    this.assertLive();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    const lifetime = (this.#authority as InstallationLease).lifetime;
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("exclusive-root-lifetime-required");
    lifetime.assertHeld();
    return lifetime;
  }
  beginStoppedMachineControlUpgrade(restore: OfflineMaintenanceOperation): StoppedProfileControlUpgradeAdmission {
    this.assertLive();
    this.assertExclusive();
    if (this.#scope !== "installation") throw new Error("profile-control-upgrade-machine-membership-unknown");
    const context = this.readInstallationContext();
    if (context === undefined) throw new Error("profile-control-upgrade-machine-membership-unknown");
    return acquireStoppedProfileControlUpgrade(context.workspace, restore, this.#installationRootLifetime(), this.#authority as InstallationLease);
  }
  static fromInstallationLease(lease: InstallationLease): RuntimeAdmission {
    assertInstallationLease(lease);
    const { stateRoot, artifactRoot } = lease.locator;
    return new RuntimeAdmission(issuanceToken, lease, stateRoot, artifactRoot,
      [join(stateRoot, "state.db")], "installation", lease.mode, lease.locator);
  }

  #stoppedMachineMaintenance(): { lease: InstallationLease; restore: OfflineMaintenanceOperation } {
    this.assertLive();
    this.assertExclusive();
    if (this.#scope !== "installation") throw new Error("profile-control-upgrade-machine-membership-unknown");
    const lease = this.#authority as InstallationLease;
    const restore = stoppedMaintenanceRestores.get(lease);
    if (restore === undefined) throw new Error("profile-control-upgrade-machine-membership-unknown");
    return { lease, restore };
  }
  forStoppedIncompleteProfileInventory(profileId: string): RuntimeAdmission {
    const { lease, restore } = this.#stoppedMachineMaintenance();
    const id = z.uuid().parse(profileId), document = lease.readProfileRegistry();
    const row = document.profiles.find(profile => profile.profileId === id);
    if (row === undefined || row.registration.onboardingCompletion !== undefined) throw new Error("profile-incomplete-publication-required");
    const source = canonicalJsonStringify(document), root = join(this.#stateRoot, "profiles", id);
    const binding = { installationId: this.locator.installationId, profileId: id };
    const ancestry = new Map<string, DirectoryIdentity>();
    noSymlinkAncestry(root, ancestry);
    const assertHeld = () => {
      this.assertLive(); assertStoppedMachineMaintenance(lease, restore);
      if (canonicalJsonStringify(lease.readProfileRegistry()) !== source || !noSymlinkAncestry(root, ancestry)) throw new Error("profile-incomplete-publication-changed");
      assertCanonicalProfileBinding(join(root, "state.db"), binding);
    };
    assertHeld();
    return new RuntimeAdmission(issuanceToken, { assertHeld, release() {}, readInstallationContext: () => this.readInstallationContext() },
      root, join(root, "artifacts"), [join(root, "state.db")], "stopped-incomplete-profile-inventory", "exclusive", this.#locator, binding, this);
  }
  async startCleanFlatStore(browserClosure: ProfileBrowserClosure): Promise<void> {
    const { lease, restore } = this.#stoppedMachineMaintenance();
    try {
      if (!lease.flatStoreMigrationPending()) {
        lease.eraseFlatStoreCredentials(restore);
        const backup = await this.forStoppedFlatBackup();
        const { backupFlatStorage } = await import("../maintenance/existing-data-backup.js");
        const { prepareStoppedBackupClosure } = await import("../maintenance/profile-inventory.js");
        const closure = await prepareStoppedBackupClosure(browserClosure, backup, restore, systemClock,
          join(lease.readInstallationContext().workspace, rebuildRuntimeIsolation.processLockRoot));
        await backupFlatStorage(closure, backup, systemClock);
      }
      lease.startCleanFlatStore(restore);
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: this });
      throw new ProfileFlatStoreMigrationError(error);
    }
  }
  async forStoppedFlatBackup(): Promise<RuntimeAdmission> {
    const { lease, restore } = this.#stoppedMachineMaintenance(), context = lease.readInstallationContext();
    const root = join(context.workspace, rebuildRuntimeIsolation.stateRoot), path = join(root, "state.db");
    const processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
    const ancestry = new Map<string, DirectoryIdentity>();
    noSymlinkAncestry(root, ancestry); noSymlinkAncestry(join(root, "artifacts"), ancestry);
    const assertSource = () => {
      this.assertLive(); assertStoppedMachineMaintenance(lease, restore);
      if (!noSymlinkAncestry(root, ancestry) || !noSymlinkAncestry(join(root, "artifacts"), ancestry)) throw new Error("flat-backup-source-changed");
      if (this.stateRoot !== root || this.artifactRoot !== join(root, "artifacts")
        || ["machine", "profiles"].some(name => existsSync(join(root, name)))
        || ["profile-registry.json", "profile-flat-claim.json", "profile-publication.json", "profile-owner-claims"].some(name => existsSync(join(context.workspace, ".tracker", "control", name)))) throw new Error("flat-backup-source-refused");
    };
    assertSource();
    if (!this.requiresFlatStoreMigration()) throw new Error("flat-backup-source-required");
    const sources = ["", "-wal", "-shm", "-journal"].map(suffix => {
      const sourcePath = `${path}${suffix}`;
      const value = readPrivateFile(sourcePath, { label: "authority database", maxBytes: 512 * 1024 * 1024 });
      const identity = (info: Stats | undefined) => info === undefined ? undefined : {
        device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid, links: info.nlink,
        size: info.size, modified: info.mtimeMs, changed: info.ctimeMs };
      return { sourcePath, before: canonicalJsonStringify(identity(value?.stat) ?? null), identity };
    });
    const qualification: ReadyProfileUpgrade["qualification"] = { current: { kind: "inspection" } };
    const assertHeld = () => {
      assertSource();
      for (const source of sources) if (canonicalJsonStringify(source.identity(lstatSync(source.sourcePath, { throwIfNoEntry: false })) ?? null) !== source.before) throw new Error("flat-backup-source-changed");
    };
    const child = new RuntimeAdmission(issuanceToken, { assertHeld, readInstallationContext: () => this.readInstallationContext(), release: () => this.release() },
      root, join(root, "artifacts"), [path], "flat-backup", "exclusive", this.#locator, undefined, this, undefined, undefined,
      { sourcePath: path, processLockRoot, sourceSchemaVersion: 6, qualification });
    try {
      const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
      const source = AuthorityDatabase.inspectStoppedUpgrade(child, path, processLockRoot, systemClock);
      if (source.schemaVersion !== 6 || source.installationId !== undefined || source.profileId !== undefined) throw new Error("flat-backup-schema-refused");
      qualification.current = { kind: "qualified", sourceFingerprint: source.authorityContentFingerprint };
      return child;
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: child });
      child.release(); throw error;
    }
  }
  readIncompleteProfileRegistration(lease: InstallationLease, expected?: SignUpOperation) {
    try {
    this.assertStoppedIncompleteProfileInventory();
    if (this.#profileParent === undefined || this.#profileParent.#authority !== lease) throw new Error("profile-incomplete-owner-mismatch");
    const registry = lease.readProfileRegistry(), row = registry.profiles.find(profile => profile.profileId === this.profileBinding.profileId);
    if (row === undefined || row.registration.onboardingCompletion !== undefined || row.duoState !== "not-set-up" || row.lifecycle !== "ready"
      || row.credentialState !== "saved" || row.migratedFromLegacy !== undefined) throw new Error("profile-incomplete-publication-required");
    const captured = captureStoppedIncompleteCredentials(this), document = authenticateDocument(captured.record.value);
    if (captured.record.revision !== document.record.revision || document.latestRequest?.kind !== "apply"
      || document.record.revision !== row.registration.credentialRevision || document.history.length !== 1
      || document.retiredLegacy.commandIds.length !== 0 || document.retiredLegacy.writeIds.length !== 0 || document.retiredLegacy.valueIds.length !== 0) throw new Error("profile-incomplete-original-apply-required");
    const request = document.latestRequest.request;
    if (request.commandId !== row.registration.commandId || request.writeId !== row.registration.writeId) throw new Error("profile-incomplete-original-apply-required");
    const machineRoot = this.#profileParent.stateRoot;
    const verifiers = readPrivateFile(join(machineRoot, "machine", "profile-verifiers.json"), { label: "lock", maxBytes: 1_048_576 });
    if (verifiers === undefined) throw new Error("profile-incomplete-verifier-required");
    const verifier = ProfileVerifierDocumentSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(verifiers.bytes))).profiles.find(profile => profile.profileId === row.profileId);
    const pepper = readPrivateFile(join(machineRoot, "machine", "profile-pepper"), { label: "lock", maxBytes: 32 });
    const email = document.record.entries.ucpathUserId?.value, password = document.record.entries.ucpathPassword?.value;
    if (pepper === undefined || pepper.bytes.length !== 32 || verifier === undefined || email === undefined || password === undefined
      || emailKey(pepper.bytes, email) !== verifier.emailKey || !passwordMatches(password, verifier)) throw new Error("profile-incomplete-verifier-binding-mismatch");
    const membership = unpublishedDraftAbortMembership(this.stateRoot);
    const allowed = new Set(["", "credentials", "credentials/protected.json", "credentials/chatgpt-account.json", "artifacts", "state.db", "state.db-wal", "state.db-shm", "state.db-journal"]);
    if (membership.some(entry => !allowed.has(entry.path)) || membership.some(entry => entry.path === "artifacts" && !entry.directory)) throw new Error("profile-incomplete-copy-membership-unproved");
    const operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId: row.registration.operationId, profileId: row.profileId,
      commandId: request.commandId, writeId: request.writeId, emailKey: verifier.emailKey, firstName: row.firstName, lastName: row.lastName,
      createdAt: request.updatedAt, commandFingerprint: request.commandFingerprint, expectedRevision: request.expectedRevision,
      credentials: { operationId: row.registration.operationId, keyId: captured.keyId, generation: captured.generation, phase: "ready", protectedRevision: captured.record.revision },
      onboarding: { accountId: expected?.onboarding?.accountId ?? randomUUID(), generation: 1, attempts: [] }, phase: "applying" });
    if (expected !== undefined && canonicalJsonStringify(operation) !== canonicalJsonStringify(expected)) throw new Error("profile-incomplete-source-changed");
    return { operation, credentials: captured.credentials, membership, databases: profileAuthorityFileWitnesses(this.stateRoot) };
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { this.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: this }); }
      throw error;
    }
  }
  async reclassifyIncompleteProfileAsDraft(profileId: string): Promise<void> {
    const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
    const { lease, restore } = this.#stoppedMachineMaintenance();
    if (lease.resumeIncompleteProfileDraft(profileId, restore)) return;
    const admission = this.forStoppedIncompleteProfileInventory(profileId);
    try {
      if (!AuthorityDatabase.readIncompleteOnboardingInventory(admission).empty) throw new Error("profile-incomplete-activity-present");
      lease.reclassifyIncompleteProfile(admission);
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { this.retainSourceClosure(error); admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: { owner: this, admission } }); throw error; }
      throw error;
    } finally { admission.release(); }
  }
  assertStoppedIncompleteProfileInventory(): void {
    this.assertLive();
    if (this.#scope !== "stopped-incomplete-profile-inventory") throw new Error("profile-incomplete-inventory-purpose-required");
  }
  static acquireStoppedMachineControlMaintenance(workspace: string, lifetime: RuntimeLifetimeLock): RuntimeAdmission {
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
    lifetime.assertHeld();
    const canonical = realpathSync(workspace);
    lifetime.assertExclusiveWorkspaceTarget(canonical);
    const restore = lifetime.beginOfflineMaintenance(canonical);
    let lease: InstallationLease | undefined;
    try {
      lease = acquireInstallation(canonical, "exclusive", lifetime, { stoppedControlForward: true, offlineOperation: restore });
      assertStoppedMachineMaintenance(lease, restore);
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { restore, admission: lease });
      try { restore.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { restore, admission: lease }); }
      try { lease?.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { restore, admission: lease }); }
      throw error;
    }
    stoppedMaintenanceRestores.set(lease, restore);
    return RuntimeAdmission.fromInstallationLease(lease);
  }
  requiresFlatStoreMigration(): boolean {
    this.assertLive();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    return (this.#authority as InstallationLease).requiresFlatStoreMigration();
  }
  static acquireDashboard(workspace: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock): RuntimeAdmission {
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
    lifetime.assertHeld();
    const canonical = realpathSync(workspace);
    if (!existsSync(join(canonical, ".tracker", "control", "installation.json"))) return RuntimeAdmission.acquireMachine(canonical, mode, lifetime);
    const lease = mode === "exclusive" ? acquireInstallation(canonical, "exclusive", lifetime) : acquireInstallation(canonical, "shared", lifetime);
    try { lease.requiresFlatStoreMigration(); return RuntimeAdmission.fromInstallationLease(lease); }
    catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: lease });
      try { lease.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease }); }
      throw error;
    }
  }
  static acquireWorker(workspace: string, lifetime: WorkerRuntimeLifetimeLock): RuntimeAdmission {
    if (!(lifetime instanceof WorkerRuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
    lifetime.assertHeld();
    const canonical = realpathSync(workspace);
    return RuntimeAdmission.fromInstallationLease(acquireInstallation(canonical, "shared", lifetime, { machine: true, readonlyControl: true }));
  }
  static acquireMachine(workspace: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock): RuntimeAdmission {
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
    lifetime.assertHeld();
    const canonical = realpathSync(workspace);
    const control = join(canonical, ".tracker/control/installation.json");
    if (lstatSync(control, { throwIfNoEntry: false }) === undefined) {
      const lease = acquireInstallation(canonical, "exclusive", lifetime, { machine: true, defaultPair: {
        stateRoot: resolve(canonical, rebuildRuntimeIsolation.stateRoot), artifactRoot: resolve(canonical, rebuildRuntimeIsolation.artifactRoot),
      } });
      if (mode === "exclusive") return RuntimeAdmission.fromInstallationLease(lease);
      lease.release();
    }
    const lease = mode === "exclusive" ? acquireInstallation(canonical, "exclusive", lifetime, { machine: true })
      : acquireInstallation(canonical, "shared", lifetime, { machine: true });
    return RuntimeAdmission.fromInstallationLease(lease);
  }

  static acquireInitial(workspace: string, lifetime: RuntimeLifetimeLock,
    verifyExisting: (pair: RuntimePair, inspection: RuntimeAdmission) => ExistingAuthorityEvidence,
    initializeFresh: (pair: RuntimePair, initialization: RuntimeAdmission) => void): RuntimeAdmission {
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
    lifetime.assertHeld();
    const canonical = realpathSync(workspace);
    const defaults = Object.freeze({
      stateRoot: resolve(canonical, rebuildRuntimeIsolation.stateRoot),
      artifactRoot: resolve(canonical, rebuildRuntimeIsolation.artifactRoot),
    });
    const lease = acquireInstallation(canonical, "exclusive", lifetime, {
      defaultPair: defaults,
      verifyExisting: (pair) => {
        const inspection = new RuntimeAdmission(issuanceToken, { assertHeld: () => lifetime.assertWorkspace(canonical), release() {} }, pair.stateRoot, pair.artifactRoot,
          [join(pair.stateRoot, "state.db")], "adoption-inspection", "exclusive");
        try { return verifyExisting(pair, inspection); }
        finally { inspection.release(); }
      },
      initializeFresh: (witness: FreshInitializationWitness) => {
        const initialization = new RuntimeAdmission(issuanceToken,
          { assertHeld: () => witness.assertHeld(), release() {} }, witness.pair.stateRoot, witness.pair.artifactRoot,
          [join(witness.pair.stateRoot, "state.db")],
          "adoption-initialization", "exclusive");
        try {
          const completed: unknown = initializeFresh(witness.pair, initialization);
          if (completed !== undefined) throw new Error("runtime-admission: fresh initialization must complete synchronously");
        }
        finally { initialization.release(); }
      },
    });
    return RuntimeAdmission.fromInstallationLease(lease);
  }

  /** Bounded synthetic authority for tests; never accepts an installation or checkout path. */
  static syntheticFixture(databasePath: string): RuntimeAdmission {
    if (databasePath !== ":memory:") {
      assertSyntheticDirectory(dirname(databasePath));
      const file = lstatSync(databasePath, { throwIfNoEntry: false });
      if (file !== undefined && (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1
        || privatePathRejects(databasePath, file, "group-write"))) {
        throw new Error("runtime-admission: unsafe synthetic fixture database");
      }
      const components = databasePath.split(/[\\/]/u);
      if (components.some((part, index) => part === ".tracker" && components[index + 1] === "control")) {
        throw new Error("runtime-admission: fixture overlaps installation control");
      }
      for (const forbidden of [".runtime-owner.json", ".runtime-source-fence.json"]) {
        if (components.includes(forbidden)) throw new Error("runtime-admission: fixture overlaps installation control");
      }
    }
    const stateRoot = databasePath === ":memory:" ? ":memory:" : dirname(databasePath);
    const artifactRoot = databasePath === ":memory:" ? ":memory:" : join(stateRoot, "artifacts");
    const authority: AdmissionAuthority = { assertHeld() {}, release() {} };
    return new RuntimeAdmission(issuanceToken, authority, stateRoot, artifactRoot,
      [databasePath], "synthetic", "synthetic");
  }

  static syntheticRoots(stateRoot: string, artifactRoot: string): RuntimeAdmission {
    assertSyntheticDirectory(stateRoot);
    assertSyntheticDirectory(artifactRoot);
    const authority: AdmissionAuthority = { assertHeld() {}, release() {} };
    return new RuntimeAdmission(issuanceToken, authority, stateRoot, artifactRoot,
      [join(stateRoot, "state.db")], "synthetic", "synthetic");
  }
}
Object.freeze(RuntimeAdmission.prototype);

export function acquireSharedRuntimeAdmission(workspace: string, lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock): RuntimeAdmission {
  return RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "shared", lifetime));
}

export function acquireExclusiveRuntimeAdmission(workspace: string, lifetime: RuntimeLifetimeLock): RuntimeAdmission {
  return RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "exclusive", lifetime));
}

export function acquireInitialRuntimeAdmission(workspace: string, lifetime: RuntimeLifetimeLock,
  verifyExisting: (pair: RuntimePair, inspection: RuntimeAdmission) => ExistingAuthorityEvidence,
  initializeFresh: (pair: RuntimePair, initialization: RuntimeAdmission) => void): RuntimeAdmission {
  return RuntimeAdmission.acquireInitial(workspace, lifetime, verifyExisting, initializeFresh);
}

export function acquireRecoveryRuntimeRelocation(workspace: string, lifetime: RuntimeLifetimeLock,
  binding: Readonly<{ installationId: string; fromGeneration: number; operationId: string }>,
  restore: OfflineMaintenanceOperation): Readonly<{ admission: RuntimeAdmission; operation: RuntimeRelocationOperation }> {
  const lease = acquireInstallation(workspace, "exclusive", lifetime, { offlineOperation: restore, recoverRelocation: { ...binding, restoreAdmission: restore } });
  try {
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    return Object.freeze({ admission, operation: admission.resumeRelocation(binding.operationId) });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission: lease, restore });
    try { restore.release(); lease.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore }); }
    throw error;
  }
}

export function acquireRecoveryRuntimeRestore(workspace: string, lifetime: RuntimeLifetimeLock, operationId: string,
  restore: OfflineMaintenanceOperation): Readonly<{ admission: RuntimeAdmission; input: AuthorityRestoreInput }> {
  const lease = acquireInstallation(workspace, "exclusive", lifetime, { offlineOperation: restore, recoverAuthorityRestore: { operationId, restoreAdmission: restore } });
  try {
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    return Object.freeze({ admission: admission.resumeProfileAuthorityRestore(operationId, restore), input: lease.readAuthorityRestore(operationId) });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission: lease, restore });
    try { restore.release(); lease.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore }); }
    throw error;
  }
}
