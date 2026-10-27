import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { captureIncompleteProfileDraft, CredentialErasureHeadSchema, erasureRequestIdentity } from "../configuration/credential-store.js";
import { CredentialEraseInputSchema } from "../../../models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";
import type { UnpublishedDraftAbortWitness, CredentialErasureHead, VerifiedCredentialErasureHead, VerifiedCredentialErasureIntent, CommittedCredentialWitness, CommittedCredentialInitialization, CommittedCredentialKeyStage, CredentialKeyStagePublication } from "../configuration/credential-store.js";
import { registerRuntimeAdmission, requireRuntimeAdmission } from "./admission-identity.js";
import { z } from "zod";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, existsSync, readdirSync, type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { acquireInstallation, assertInstallationLease, acquireStoppedProfileControlUpgrade, assertStoppedMachineMaintenance, completeStoppedDuoPublicationRecovery as completeStoppedDuoRecoveryClaim, issueStoppedDuoPublicationRecovery as issueStoppedDuoRecoveryClaim, readIssuedDuoContinuity, requireStoppedControlProfileInventory, type DuoPublicationRecoveryClaim, type ExistingAuthorityEvidence, type InstallationLease,
  type ExclusiveInstallationLease, type FreshInitializationWitness, type RelocationCompletionReceipt, type RelocationInventory,
  type RelocationPlanBinding, type RelocationPreparationVerifier, type RelocationActivationVerifier,
  type RelocationVerifier, type RuntimeLocator, type RuntimePair } from "./installation.js";
import type { ProfileRestoreContext, ErasureRequestIdentity, VerifiedSourceControlEntries, AuthorityRestoreInput, AuthorityRestoreVerifier } from "./installation.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { acquireRuntimeRestoreAdmission, assertRuntimeRestoreAdmission, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";

import type { PreparedProfileVerifier } from "../../profiles/verifier-store.js";
import { assertFinishedProfileOnboarding, SignUpOperationSchema, LogoutOperationSchema, type SignUpOperation, type LogoutOperation, type ProfileOperation } from "../../../models/profiles/profile.js";
import { readPrivateFile, noSymlinkAncestry, ensureChildDirectory, type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { assertLiveProfileDatabaseBinding, assertCanonicalProfileBinding, captureCanonicalProfileBinding, assertProfileRestoreDatabaseBinding, readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import type { ProfileRegistryDocument, ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { type IssuedDuoTransaction } from "../configuration/duo-credential-store.js";
import { type StoppedControlProfileInventory, type StoppedProfileControlUpgradeAdmission } from "./installation.js";

export class ProfileStorageRelocationUnsupportedError extends Error {
  readonly code = "PROFILE_STORAGE_RELOCATION_UNSUPPORTED";
  constructor() { super(ERROR_CATALOG.PROFILE_STORAGE_RELOCATION_UNSUPPORTED.text); this.name = "ProfileStorageRelocationUnsupportedError"; }
}

export class ProfileBrowserRootRefusalError extends Error {
  readonly code = "PROFILE_BROWSER_ROOT_REFUSED";
  constructor() { super(ERROR_CATALOG.PROFILE_BROWSER_ROOT_REFUSED.text); this.name = "ProfileBrowserRootRefusalError"; }
}

export class ProfileUpgradeSourceRefusalError extends Error {
  readonly code = "PROFILE_UPGRADE_UNAVAILABLE";
  constructor() { super(ERROR_CATALOG.PROFILE_UPGRADE_UNAVAILABLE.text); this.name = "ProfileUpgradeSourceRefusalError"; }
}

export interface RegisteredProfileStorageClaim {
  readonly profileId: string;
  readonly phase: "setup" | "runtime" | "settlement";
}
const storageClaims = new WeakMap<RegisteredProfileStorageClaim, { readonly admission: RuntimeAdmission; readonly operationId?: string; readonly verify: (purpose: "issue" | "custody") => void }>();

function requireRegisteredProfileStorageClaim(claim: RegisteredProfileStorageClaim, admission: RuntimeAdmission, purpose: "issue" | "custody"): void {
  const issued = storageClaims.get(claim);
  if (issued === undefined || issued.admission !== admission) throw new Error("profile-storage-claim-unissued");
  issued.verify(purpose);
}


const issuanceToken = Symbol("runtime-admission-issuance");
const stoppedMaintenanceRestores = new WeakMap<InstallationLease, RestoreAdmissionHandle>();

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
      || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0)) {
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
  if ((process.getuid && root.uid !== process.getuid()) || (root.mode & 0o022) !== 0) {
    throw new Error("runtime-admission: storage root ownership changed");
  }
}

type AdmissionAuthority = Readonly<{
  assertHeld(): void;
  captureRestoreContext?(witness: VerifiedCredentialErasureHead): ProfileRestoreContext;
  beginAuthorityRestore?(input: AuthorityRestoreInput, restore: RestoreAdmissionHandle): void;
  settleAuthorityRestore?(input: AuthorityRestoreInput, outcome: "unchanged" | "replaced", verify: AuthorityRestoreVerifier, restore: RestoreAdmissionHandle): void;
  readAuthorityRestore?(operationId: string): AuthorityRestoreInput;
  assertAuthorityRestoreCurrent?(input: AuthorityRestoreInput, restore: RestoreAdmissionHandle): void;
  assertCredentialErasureHead?(head: CredentialErasureHead): void;
  resumeCredentialErasure?(request: ErasureRequestIdentity, head: CredentialErasureHead): void;
  beginCredentialErasure?(witness: VerifiedCredentialErasureIntent): void;
  settleCredentialErasure?(request: ErasureRequestIdentity, witness: VerifiedCredentialErasureHead): void;
  assertProfileRuntime?(): void;
  assertCredentialErasureObservation?(operationId: string): void;
  assertPendingLogoutCustody?(operationId: string): void;
  assertCredentialErasure?(request: Readonly<{ commandId: string; writeId: string; expectedRevision: number; updatedAt: string; commandFingerprint: string }>): void;
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

type AdmissionScope = "profile-restore" | "installation" | "adoption-inspection" | "stopped-staged" | "stopped-projection" | "synthetic-stopped-staged"
  | "verified-copy" | "synthetic-verified-copy" | "synthetic" | "relocation-destination" | "relocation-source-verification"
  | "adoption-initialization" | "profile-initialization" | "profile-upgrade" | "profile-ready-upgrade" | "profile" | "profile-settlement" | "profile-repair-inventory" | "profile-pending-logout-inventory" | "stopped-control-inventory" | "stopped-incomplete-profile-inventory";

type ReadyProfileUpgrade = Readonly<{ sourcePath: string; processLockRoot: string; sourceSchemaVersion: 8 | 9; copyPath?: string;
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
  #stoppedControlInventory: StoppedControlProfileInventory | undefined;
  readonly #profileBinding: ProfileDatabaseBinding | undefined;
  readonly #profileParent: RuntimeAdmission | undefined;
  readonly #pendingLogout: Readonly<{ owner: RuntimeAdmission; operation: string; copyPath?: string }> | undefined;
  readonly #readyUpgrade: ReadyProfileUpgrade | undefined;

  private constructor(token: typeof issuanceToken, authority: AdmissionAuthority, stateRoot: string, artifactRoot: string,
    authorityDatabasePaths: readonly string[],
    scope: AdmissionScope,
    mode: "shared" | "exclusive" | "synthetic", locator?: RuntimeLocator, binding?: ProfileDatabaseBinding, profileParent?: RuntimeAdmission,
    pendingLogout?: Readonly<{ owner: RuntimeAdmission; operation: string; copyPath?: string }>, readyUpgrade?: ReadyProfileUpgrade) {
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
    this.assertLive();
    if (this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade") throw new Error("profile-initialization-authority-required");
  }
  assertReleasedProfileInitialization(machine: RuntimeAdmission): void {
    machine.assertWritable();
    if (!this.#released || this.#scope !== "profile-initialization" || this.#profileParent !== machine) throw new Error("profile-draft-closure-unproved");
  }
  assertProfileUpgradeCredentialSource(claim: RegisteredProfileStorageClaim): void {
    this.assertLive();
    if (this.#scope !== "installation" || (this.#mode !== "shared" && this.#mode !== "exclusive")) throw new Error("profile-upgrade-handoff-installation-required");
    requireRegisteredProfileStorageClaim(claim, this, "issue");
    if (claim.phase !== "runtime") throw new Error("profile-upgrade-handoff-runtime-claim-required");
    const observed = readProfileDatabaseBinding(join(this.#stateRoot, "profiles", claim.profileId, "state.db"));
    if (observed.state !== "bound" || observed.schemaVersion !== 8 || observed.binding.profileId !== claim.profileId
      || observed.binding.installationId !== this.locator.installationId) throw new Error("profile-upgrade-handoff-binding-refused");
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    if (!lease.assertProfileCredentialKeyAnchor(claim.profileId)) throw new Error("profile-upgrade-handoff-key-required");
  }
  captureProfileUpgradeHandoff(claim: RegisteredProfileStorageClaim): Readonly<{ consume(next: RuntimeAdmission): RegisteredProfileStorageClaim }> | undefined {
    this.assertLive();
    if (this.#scope !== "installation") throw new Error("profile-upgrade-handoff-installation-required");
    requireRegisteredProfileStorageClaim(claim, this, "issue");
    const profileId = claim.profileId;
    const path = join(this.#stateRoot, "profiles", profileId, "state.db");
    const ancestry = new Map<string, DirectoryIdentity>();
    noSymlinkAncestry(dirname(path), ancestry);
    const observed = readProfileDatabaseBinding(path);
    if (observed.schemaVersion !== 8) return undefined;
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
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n || (file.mode & 0o022n) !== 0n
        || process.getuid !== undefined && file.uid !== BigInt(process.getuid())) throw new Error("profile-upgrade-handoff-source-unsafe");
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
    return Object.freeze({ consume(next: RuntimeAdmission): RegisteredProfileStorageClaim {
      const nextLease = next.#exclusiveInstallationLease();
      capture.consume(nextLease);
      if (!noSymlinkAncestry(dirname(path), ancestry)) throw new Error("profile-upgrade-handoff-source-changed");
      if (canonicalJsonStringify(source()) !== before) throw new Error("profile-upgrade-handoff-source-changed");
      const current = next.issueRegisteredProfileClaim(profileId);
      if (current.phase !== "runtime") throw new Error("profile-upgrade-handoff-runtime-claim-required");
      return current;
    } });
  }
  forStoppedProfileUpgrade(): RuntimeAdmission;
  forStoppedProfileUpgrade(claim: RegisteredProfileStorageClaim, restore: RestoreAdmissionHandle, clock: Clock, hostFacts: HostConfigFacts): Promise<RuntimeAdmission>;
  forStoppedProfileUpgrade(claim?: RegisteredProfileStorageClaim, restore?: RestoreAdmissionHandle, clock?: Clock, hostFacts?: HostConfigFacts): RuntimeAdmission | Promise<RuntimeAdmission> {
    if (claim !== undefined || restore !== undefined) return this.#readyStoppedProfileUpgrade(claim, restore, clock, hostFacts);
    this.assertExclusive();
    this.assertProfileInitialization();
    const database = join(this.#stateRoot, "state.db");
    if (readProfileDatabaseBinding(database).state !== "unbound") throw new Error("profile-stopped-conversion-not-required");
    return new RuntimeAdmission(issuanceToken, { assertHeld: () => this.assertLive(), release() {} }, this.#stateRoot, this.#artifactRoot,
      [database], "profile-upgrade", this.#mode, this.#locator, this.profileBinding);
  }
  async #readyStoppedProfileUpgrade(claim: RegisteredProfileStorageClaim | undefined, restore: RestoreAdmissionHandle | undefined,
    clock: Clock | undefined, hostFacts: HostConfigFacts | undefined): Promise<RuntimeAdmission> {
    const lease = this.#exclusiveInstallationLease();
    if (claim === undefined || restore === undefined || clock === undefined || hostFacts === undefined || claim.phase !== "runtime") throw new Error("profile-stopped-upgrade-runtime-claim-required");
    requireRegisteredProfileStorageClaim(claim, this, "issue");
    const context = lease.readInstallationContext();
    const processLockRoot = resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot);
    lease.assertFixedProcessLockRoot(context.workspace, processLockRoot);
    assertRuntimeRestoreAdmission(restore, processLockRoot);
    const root = join(this.#stateRoot, "profiles", claim.profileId), artifacts = join(root, "artifacts");
    const path = join(root, "state.db");
    const binding = { installationId: this.locator.installationId, profileId: claim.profileId };
    const observed = readProfileDatabaseBinding(path);
    if (observed.state !== "bound" || (observed.schemaVersion !== 8 && observed.schemaVersion !== 9)) throw new Error("profile-stopped-upgrade-bound-required");
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
        assertRuntimeRestoreAdmission(restore, processLockRoot);
        requireRegisteredProfileStorageClaim(claim, this, "issue");
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
      readStoppedProfileUpgradeInventory({ machine: this, admission, clock, hostFacts });
      const after = AuthorityDatabase.inspectStoppedUpgrade(admission, path, processLockRoot, clock);
      if (before.schemaVersion !== observed.schemaVersion || before.authorityGeneration !== after.authorityGeneration
        || before.authorityContentFingerprint !== after.authorityContentFingerprint) throw new Error("profile-stopped-upgrade-source-changed");
      qualification.current = { kind: "qualified", sourceFingerprint: before.authorityContentFingerprint };
      assertHeld();
      return admission;
    } catch (error) { admission.release(); throw error; }
  }
  assertStoppedProfileUpgrade(path: string, processLockRoot: string): void {
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
      if (this.#readyUpgrade.sourceSchemaVersion !== 8 || sourceVersion !== 8) throw new Error("profile-stopped-upgrade-version-refused");
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
  assertAuthorityBackupWrite(path: string): void {
    if (this.#readyUpgrade !== undefined) {
      this.assertLive();
      const directory = join(this.#stateRoot, "backups", "authority");
      if (this.#readyUpgrade.copyPath !== undefined || this.#readyUpgrade.qualification.current.kind !== "qualified"
        || !isAbsolute(path) || resolve(path) !== path || path !== directory && (dirname(path) !== directory
          || !/^(?:\.authority-[0-9a-f-]{36}\.(?:sqlite|manifest\.json)\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite(?:\.manifest\.json)?)$/u.test(path.slice(directory.length + 1)))) throw new Error("profile-stopped-upgrade-backup-refused");
      this.assertStateRoot(path);
      return;
    }
    this.assertWritable();
  }
  assertAuthorityBackupSource(path: string, sourceFingerprint: string): void {
    this.assertReadOnlyAuthorityDatabase(path);
    if (this.#readyUpgrade !== undefined) {
      const proof = this.#readyUpgrade.qualification.current;
      if (this.#readyUpgrade.copyPath !== undefined || path !== this.#readyUpgrade.sourcePath || proof.kind !== "qualified"
        || proof.sourceFingerprint !== sourceFingerprint) {
        this.#readyUpgrade.qualification.current = { kind: "revoked" };
        throw new Error("profile-stopped-upgrade-source-changed");
      }
    }
  }
  profileMaintenanceSchemaVersion(): 8 | 9 {
    this.assertLive();
    if (this.#readyUpgrade === undefined) return 9;
    const observed = readProfileDatabaseBinding(this.#readyUpgrade.copyPath ?? this.#readyUpgrade.sourcePath);
    if (observed.state !== "bound" || (observed.schemaVersion !== 8 && observed.schemaVersion !== 9) || observed.binding.installationId !== this.profileBinding.installationId
      || observed.binding.profileId !== this.profileBinding.profileId) throw new Error("profile-stopped-upgrade-binding-changed");
    return observed.schemaVersion;
  }
  assertProfileRuntime(): void {
    this.assertLive();
    this.#assertProfileRuntime();
  }
  #assertProfileRuntime(): void {
    if (this.#scope !== "profile") throw new Error("profile-bound-authority-required");
    if (this.#authority.assertProfileRuntime === undefined) throw new Error("profile-runtime-authority-unavailable");
    this.#authority.assertProfileRuntime();
  }
  get profileBinding(): ProfileDatabaseBinding {
    this.assertLive();
    if (this.#profileBinding === undefined) throw new Error("profile-bound-authority-required");
    return this.#profileBinding;
  }
  commitProfileDuo(transaction: IssuedDuoTransaction): void {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    (this.#authority as InstallationLease).commitProfileDuo(transaction);
  }
  abortUnpublishedProfile(witness: UnpublishedDraftAbortWitness): void {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    (this.#authority as InstallationLease).abortUnpublishedProfile(witness);
  }
  commitProfileDuoIntent(transaction: IssuedDuoTransaction): void {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    (this.#authority as InstallationLease).commitProfileDuoIntent(transaction);
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
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    (this.#authority as InstallationLease).publishProfileRegistry(expected, document);
  }
  publishProfileRegistration(operation: SignUpOperation, witness: CommittedCredentialWitness, verifier: PreparedProfileVerifier): void {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    (this.#authority as InstallationLease).publishProfileRegistration(operation, witness, verifier);
  }
  assertProfileCredentialKeyAnchor(profile: RuntimeAdmission, keyId: string): void {
    this.assertProfileCredentialKey(profile, join(this.#stateRoot, "machine", "credential-keys", `${profile.profileBinding.profileId}.json`));
    if ((this.#authority as InstallationLease).assertProfileCredentialKeyAnchor(profile.profileBinding.profileId)) return;
    if (profile.#scope !== "profile-initialization") throw new Error("credential-key-anchor-required");
    const directory = join(this.#stateRoot, "machine", "operations");
    const matching = readdirSync(directory).filter(name => name.endsWith(".json")).flatMap(name => {
      const file = readPrivateFile(join(directory, name), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) throw new Error("profile-credential-initialization-changed");
      const parsed = z.union([SignUpOperationSchema, LogoutOperationSchema]).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
      return parsed.kind === "sign-up" && parsed.profileId === profile.profileBinding.profileId
        && parsed.credentialInitialization?.keyId === keyId ? [parsed] : [];
    });
    if (matching.length !== 1) throw new Error("credential-key-anchor-required");
    profile.assertProfileInitialization();
  }
  publishProfileCredentialInitialization(profile: RuntimeAdmission, witness: CommittedCredentialInitialization): void {
    this.assertProfileCredentialKey(profile, join(this.#stateRoot, "machine", "credential-keys", `${profile.profileBinding.profileId}.json`));
    (this.#authority as InstallationLease).publishProfileCredentialInitialization(profile.profileBinding.profileId, witness);
  }
  beginProfileSignUp(fields: Omit<SignUpOperation, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding">): SignUpOperation {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    return (this.#authority as InstallationLease).beginProfileSignUp(fields);
  }
  assertProfileCredentialKeyStageOwner(profile: RuntimeAdmission, operation: SignUpOperation): void {
    this.assertWritable();
    if (this.#scope !== "installation" || profile.#released || profile.#profileParent !== this || profile.#scope !== "profile-initialization"
      || profile.#profileBinding?.profileId !== operation.profileId || profile.#profileBinding.installationId !== this.locator.installationId
      || profile.#stateRoot !== join(this.#stateRoot, "profiles", operation.profileId)) throw new Error("profile-credential-key-stage-owner-mismatch");
    noSymlinkAncestry(profile.#stateRoot, new Map());
  }
  publishProfileCredentialKeyStage(profile: RuntimeAdmission, operation: SignUpOperation, witness: CommittedCredentialKeyStage): void {
    this.assertProfileCredentialKeyStageOwner(profile, operation);
    (this.#authority as InstallationLease).publishProfileOperation(operation, witness);
  }
  readProfileCredentialKeyStage(profile: RuntimeAdmission, operation: SignUpOperation): CredentialKeyStagePublication | undefined {
    this.assertProfileCredentialInitialization(profile, operation);
    return (this.#authority as InstallationLease).readProfileCredentialKeyStage(operation);
  }
  publishProfileOperation(operation: ProfileOperation | string, keyStage?: CommittedCredentialKeyStage): void {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    (this.#authority as InstallationLease).publishProfileOperation(operation, keyStage);
  }
  issueRegisteredProfileClaim(profileId: string): RegisteredProfileStorageClaim {
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
        lastName: operation.lastName, createdAt: operation.createdAt, commandFingerprint: operation.commandFingerprint });
      if (row === undefined && pendingOperation === undefined) throw new Error("profile-storage-claim-unregistered");
      const fingerprint = createHash("sha256").update(canonicalJsonStringify(phase === "setup" && pendingOperation !== undefined ? operationIdentity(pendingOperation) : {
        profileId: row?.profileId, createdAt: row?.createdAt, firstName: row?.firstName, lastName: row?.lastName, registration: row?.registration,
      })).digest("hex");
      const claim = Object.freeze({ profileId: id, phase });
      storageClaims.set(claim, { admission: this, verify: purpose => {
        const current = read();
        const registered = current.profiles.find(entry => entry.profileId === id);
        let authority: unknown;
        if (phase === "setup") {
          if (pendingOperation === undefined || (row === undefined && registered !== undefined)) throw new Error("profile-storage-claim-changed");
          const file = readPrivateFile(join(path, `${pendingOperation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
          if (file === undefined) throw new Error("profile-storage-claim-changed");
          authority = operationIdentity(SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes))));
        } else {
          if (registered === undefined) throw new Error("profile-storage-claim-changed");
          authority = { profileId: registered.profileId, createdAt: registered.createdAt, firstName: registered.firstName, lastName: registered.lastName, registration: registered.registration };
        }
        if (purpose === "issue") {
          if (phase === "runtime" && current.sessionGeneration !== document.sessionGeneration) throw new Error("profile-storage-claim-generation-changed");
          const currentOperations = existsSync(path) ? readdirSync(path).filter(name => name.endsWith(".json")).map(name => {
            const file = readPrivateFile(join(path, name), { label: "lock", maxBytes: 1_048_576 });
            if (file === undefined) throw new Error("profile-storage-claim-changed");
            return z.union([SignUpOperationSchema, LogoutOperationSchema]).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
          }) : [];
          if (currentOperations.some(operation => operation.kind === "logout" ? operation.phase !== "complete" : phase === "runtime" && operation.credentialInitialization !== undefined)
            || (phase === "setup" ? current.activeProfileId !== null && current.activeProfileId !== id
              : registered?.lifecycle !== "ready" || registered.credentialState !== "saved" || registered.registration.onboardingCompletion === undefined)) {
            throw new Error("profile-storage-claim-unavailable");
          }
        }
        if (createHash("sha256").update(canonicalJsonStringify(authority)).digest("hex") !== fingerprint) throw new Error("profile-storage-claim-changed");
      } });
      return claim;
    }
  issueProfileSettlementClaim(operationId: string): RegisteredProfileStorageClaim {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    const id = z.uuid().parse(operationId);
    const read = () => {
      const document = this.readProfileRegistry();
      const file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${id}.json`), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) throw new Error("profile-settlement-operation-unavailable");
      const operation = LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
      const row = document.profiles.find(entry => entry.profileId === operation.profileId);
      if (operation.operationId !== id || operation.phase === "complete" || row?.lifecycle !== "cancelling"
        || document.activeProfileId !== null) throw new Error("profile-settlement-operation-unavailable");
      return operation;
    };
    const original = read();
    const claim: RegisteredProfileStorageClaim = Object.freeze({ profileId: original.profileId, phase: "settlement" });
    storageClaims.set(claim, { admission: this, operationId: id, verify: () => {
      const current = read();
      if (current.profileId !== original.profileId || current.at !== original.at) throw new Error("profile-settlement-operation-changed");
    } });
    return claim;
  }
  assertCredentialErasureHead(head: CredentialErasureHead): void {
    this.assertLive();
    if (this.#scope === "profile-pending-logout-inventory") throw new Error("profile-pending-logout-owner-required");
    this.#authority.assertCredentialErasureHead?.(head);
  }
  assertDraftErasureJournalRecovery(profile: RuntimeAdmission, request: ErasureRequestIdentity, digest: string): void {
    this.assertWritable(); profile.assertProfileInitialization();
    if (this.#scope !== "installation" || profile.#profileParent !== this) throw new Error("profile-draft-erasure-owner-required");
    (this.#authority as InstallationLease).assertDraftErasureJournalRecovery(profile.profileBinding.profileId, request, digest);
  }
  resumeCredentialErasure(request: ErasureRequestIdentity, head: CredentialErasureHead): void {
    this.assertCredentialErasure(request);
    this.#authority.resumeCredentialErasure?.(request, head);
  }
  beginCredentialErasure(witness: VerifiedCredentialErasureIntent): void {
    this.assertLive();
    if (this.#scope === "profile-pending-logout-inventory") throw new Error("profile-pending-logout-write-refused");
    this.#authority.beginCredentialErasure?.(witness);
  }
  settleCredentialErasure(request: ErasureRequestIdentity, witness: VerifiedCredentialErasureHead): void {
    this.assertCredentialErasure(request);
    this.#authority.settleCredentialErasure?.(request, witness);
  }
  forPendingLogoutInventory(operation: LogoutOperation): RuntimeAdmission {
    this.assertCredentialErasureObservation(operation.operationId);
    const parent = this.#profileParent;
    if (this.#scope !== "profile-settlement" || parent === undefined || operation.profileId !== this.profileBinding.profileId) {
      throw new Error("profile-pending-logout-owner-required");
    }
    parent.assertWritable();
    const lease = parent.#authority as InstallationLease;
    assertInstallationLease(lease);
    const witness = lease.capturePendingProfileLogout(operation);
    const path = join(this.#stateRoot, "state.db"), original = lstatSync(path), binding = this.profileBinding;
    const snapshot = captureCanonicalProfileBinding(path, binding);
    let invalidated: { error: unknown } | undefined;
    let releaseFailure: { error: unknown } | undefined;
    const assertHeld = () => {
      if (invalidated !== undefined) throw invalidated.error;
      try {
        if (!(#released in this) || this.#released) throw new Error("runtime-admission: missing or released admission");
        if (this.#scope !== "profile-settlement" || this.#authority.assertPendingLogoutCustody === undefined) throw new Error("profile-settlement-operation-unavailable");
        this.#authority.assertPendingLogoutCustody(operation.operationId);
        parent.assertWritable();
        witness.assertHeld();
        snapshot.assertUnchanged();
        const current = lstatSync(path);
        if (current.dev !== original.dev || current.ino !== original.ino) throw new Error("profile-pending-logout-database-changed");
      } catch (error) { invalidated = { error }; throw error; }
    };
    const release = () => {
      if (releaseFailure !== undefined) throw releaseFailure.error;
      try { snapshot.dispose(); }
      catch (error) { invalidated = releaseFailure = { error }; throw error; }
    };
    try {
      assertHeld();
      return new RuntimeAdmission(issuanceToken, { assertHeld, readInstallationContext: () => parent.readInstallationContext(), release },
        this.#stateRoot, this.#artifactRoot, [path], "profile-pending-logout-inventory", this.#mode, this.#locator, binding, parent,
        { owner: this, operation: canonicalJsonStringify(operation) });
    } catch (error) {
      let cleanupFailure: { error: unknown } | undefined;
      try { release(); }
      catch (cleanup) { cleanupFailure = { error: cleanup }; }
      if (cleanupFailure !== undefined) throw new AggregateError([error, cleanupFailure.error], "profile-pending-logout-inventory-release-failed", { cause: error });
      throw error;
    }
  }
  assertPendingLogoutInventory(owner: RuntimeAdmission, operation: LogoutOperation): void {
    this.assertLive();
    if (this.#scope !== "profile-pending-logout-inventory" || this.#pendingLogout?.copyPath !== undefined || this.#pendingLogout?.owner !== owner
      || this.#pendingLogout.operation !== canonicalJsonStringify(operation) || this.#profileParent !== owner.#profileParent
      || this.#profileBinding?.profileId !== operation.profileId || owner.#profileBinding?.profileId !== operation.profileId) {
      throw new Error("profile-pending-logout-owner-required");
    }
  }
  assertPendingLogoutErasureHead(owner: RuntimeAdmission, operation: LogoutOperation, input: CredentialErasureHead, request?: ErasureRequestIdentity): void {
    this.assertPendingLogoutInventory(owner, operation);
    const head = CredentialErasureHeadSchema.parse(input), parent = this.#profileParent;
    if (parent === undefined) throw new Error("profile-pending-logout-owner-required");
    const lease = parent.#authority as InstallationLease;
    assertInstallationLease(lease);
    if (operation.commandId === undefined && operation.writeId === undefined && operation.expectedRevision === undefined) {
      if (request !== undefined) throw new Error("profile-pending-logout-request-refused");
      lease.assertProfileErasureHead(operation.profileId, head);
    } else {
      if (operation.commandId === undefined || operation.writeId === undefined || operation.expectedRevision === undefined || request === undefined) {
        throw new Error("profile-pending-logout-request-refused");
      }
      const expected = erasureRequestIdentity(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
        expectedRevision: operation.expectedRevision, updatedAt: operation.at, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }));
      if (request === undefined || canonicalJsonStringify(request) !== canonicalJsonStringify(expected)) throw new Error("profile-pending-logout-request-refused");
      lease.resumeProfileErasure(operation.profileId, request, head);
    }
    this.assertPendingLogoutInventory(owner, operation);
  }
  forCredentialRepairInventory(request: Readonly<{ commandId: string; writeId: string; expectedRevision: number; updatedAt: string; commandFingerprint: string }>): RuntimeAdmission {
    this.assertLive();
    if (this.#scope !== "profile" && this.#scope !== "profile-settlement") throw new Error("profile-repair-inventory-purpose-refused");
    const binding = this.profileBinding;
    const assertHeld = () => {
      if (this.#scope === "profile") this.assertProfileRuntime();
      else this.assertCredentialErasure(request);
    };
    assertHeld();
    return new RuntimeAdmission(issuanceToken, { assertHeld, release() {}, readInstallationContext: () => this.#profileParent?.readInstallationContext() },
      this.#stateRoot, this.#artifactRoot, [join(this.#stateRoot, "state.db")], "profile-repair-inventory", this.#mode, this.#locator, binding, this.#profileParent);
  }
  assertCredentialRead(): void {
    this.assertLive();
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-credential-read-refused");
    if (this.#readyUpgrade !== undefined) throw new Error("profile-stopped-upgrade-credential-read-refused");
    if (this.#scope === "profile-settlement" || this.#scope === "profile-restore" || this.#scope === "profile-repair-inventory" || this.#scope === "profile-pending-logout-inventory") throw new Error("profile-settlement-credential-read-refused");
    if (this.#scope === "profile") this.#assertProfileRuntime();
  }
  assertCredentialErasureObservation(operationId: string): void {
    this.assertLive();
    if (this.#scope !== "profile-settlement" || this.#authority.assertCredentialErasureObservation === undefined) throw new Error("profile-settlement-operation-unavailable");
    this.#authority.assertCredentialErasureObservation(operationId);
  }
  assertCredentialErasure(request: Readonly<{ commandId: string; writeId: string; expectedRevision: number; updatedAt: string; commandFingerprint: string }>): void {
    if (this.#scope !== "profile-settlement" && this.#scope !== "profile") { this.assertWritable(); return; }
    this.assertLive();
    if (this.#authority.assertCredentialErasure === undefined) throw new Error("profile-settlement-operation-unavailable");
    this.#authority.assertCredentialErasure(request);
  }
  admitProfile(claim: RegisteredProfileStorageClaim): RuntimeAdmission {
    this.assertWritable();
    if (this.#scope !== "installation") throw new Error("profile-machine-authority-required");
    requireRegisteredProfileStorageClaim(claim, this, "issue");
    const root = join(this.#stateRoot, "profiles", claim.profileId);
    this.assertStateRoot(root);
    if (claim.phase === "setup") {
      ensureChildDirectory(this.#stateRoot, join(this.#stateRoot, "profiles"), "profiles", 0o700, 0o700);
      ensureChildDirectory(join(this.#stateRoot, "profiles"), root, "profile", 0o700, 0o700);
      ensureChildDirectory(root, join(root, "artifacts"), "profile artifacts", 0o700, 0o700);
      if (existsSync(join(root, "state.db"))) {
        const observed = readProfileDatabaseBinding(join(root, "state.db"));
        if (observed.state === "bound") assertCanonicalProfileBinding(join(root, "state.db"), { installationId: this.locator.installationId, profileId: claim.profileId });
      }
    } else if (claim.phase === "runtime") assertLiveProfileDatabaseBinding(join(root, "state.db"), { installationId: this.locator.installationId, profileId: claim.profileId });
    else assertCanonicalProfileBinding(join(root, "state.db"), { installationId: this.locator.installationId, profileId: claim.profileId });
    const ancestry = new Map<string, DirectoryIdentity>();
    noSymlinkAncestry(root, ancestry);
    let restoreCustody: { input: AuthorityRestoreInput; restore: RestoreAdmissionHandle } | undefined;
    let restoreSettled = false;
    const assertHeld = () => {
      this.assertLive();
      if (restoreSettled) throw new Error("profile-restore-context-expired");
      if (restoreCustody !== undefined) {
        this.#exclusiveInstallationLease().assertProfileRestoreHeld(restoreCustody.input, restoreCustody.restore);
        return;
      }
      if (!noSymlinkAncestry(root, ancestry)) throw new Error("profile-storage-root-disappeared");
      requireRegisteredProfileStorageClaim(claim, this, "custody");
    };
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    return new RuntimeAdmission(issuanceToken, { assertHeld,
      captureRestoreContext: witness => this.#exclusiveInstallationLease().captureProfileRestore(claim.profileId, witness),
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
      assertCredentialErasureHead: head => lease.assertProfileErasureHead(claim.profileId, head),
      resumeCredentialErasure: (request, head) => lease.resumeProfileErasure(claim.profileId, request, head),
      beginCredentialErasure: witness => lease.beginProfileErasure(claim.profileId, witness),
      settleCredentialErasure: (request, witness) => lease.settleProfileErasure(claim.profileId, request, witness),
      assertProfileRuntime: () => {
        if (restoreCustody !== undefined || restoreSettled) throw new Error("profile-restore-runtime-refused");
        requireRegisteredProfileStorageClaim(claim, this, "issue");
      },
      assertCredentialErasureObservation: operationId => {
        if (claim.phase !== "settlement" || storageClaims.get(claim)?.operationId !== operationId) throw new Error("profile-settlement-operation-unavailable");
        requireRegisteredProfileStorageClaim(claim, this, "custody");
      },
      assertPendingLogoutCustody: operationId => {
        this.assertLive();
        if (restoreSettled) throw new Error("profile-restore-context-expired");
        if (restoreCustody !== undefined) {
          this.#exclusiveInstallationLease().assertProfileRestoreHeld(restoreCustody.input, restoreCustody.restore);
        } else if (!noSymlinkAncestry(root, ancestry)) throw new Error("profile-storage-root-disappeared");
        const issued = storageClaims.get(claim);
        if (issued === undefined || issued.admission !== this) throw new Error("profile-storage-claim-unissued");
        if (claim.phase !== "settlement" || issued.operationId !== operationId) throw new Error("profile-settlement-operation-unavailable");
      },
      assertCredentialErasure: request => {
        this.readProfileRegistry();
        const directory = join(this.#stateRoot, "machine", "operations");
        const matches = readdirSync(directory).filter(name => name.endsWith(".json")).flatMap(name => {
          const file = readPrivateFile(join(directory, name), { label: "lock", maxBytes: 1_048_576 });
          if (file === undefined) throw new Error("profile-settlement-operation-unavailable");
          const result = LogoutOperationSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
          return result.success && result.data.profileId === claim.profileId && result.data.phase === "erasing" ? [result.data] : [];
        });
        const operation = matches[0];
        if (matches.length !== 1 || operation?.commandId !== request.commandId || operation.writeId !== request.writeId
          || operation.expectedRevision !== request.expectedRevision || operation.at !== request.updatedAt || request.commandFingerprint !== "b".repeat(64)) {
          throw new Error("profile-settlement-erase-refused");
        }
      }, readInstallationContext: () => this.readInstallationContext(), release() {} }, root, join(root, "artifacts"),
      [join(root, "state.db")], claim.phase === "setup" ? "profile-initialization" : claim.phase === "settlement" ? "profile-settlement" : "profile", this.#mode, this.#locator,
      { installationId: this.locator.installationId, profileId: claim.profileId }, this);
  }
  get stateRoot(): string { this.assertLive(); return this.#stateRoot; }
  get artifactRoot(): string { this.assertLive(); return this.#artifactRoot; }
  readInstallationContext(): Readonly<{ workspace: string; locator: RuntimeLocator;
    receipts: readonly RelocationCompletionReceipt[] }> | undefined {
    this.assertLive();
    if (this.#scope === "synthetic") return undefined;
    if (this.#scope === "stopped-incomplete-profile-inventory" || this.#scope === "stopped-control-inventory" || this.#scope === "profile-restore" || this.#scope === "stopped-staged" || this.#scope === "stopped-projection" || this.#scope === "synthetic-stopped-staged") {
      if (this.#authority.readInstallationContext === undefined) throw new Error("runtime-admission: staged installation context unavailable");
      return this.#authority.readInstallationContext();
    }
    if (this.#scope === "profile" || this.#scope === "profile-initialization") {
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
    if (this.#scope === "profile") {
      this.assertProfileRuntime();
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
  assertLive(): void {
    if (!(#released in this) || this.#released) throw new Error("runtime-admission: missing or released admission");
    this.#authority.assertHeld();
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
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-write-refused");
    if (this.#readyUpgrade !== undefined) throw new Error("profile-stopped-upgrade-exclusive-refused");
    if (this.#scope === "profile-pending-logout-inventory") throw new Error("profile-pending-logout-write-refused");
    if (this.#mode !== "exclusive" && this.#mode !== "synthetic") throw new Error("runtime-admission: exclusive offline admission required");
  }
  assertWritable(): void {
    this.assertLive();
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-write-refused");
    if (this.#readyUpgrade !== undefined) throw new Error("profile-stopped-upgrade-runtime-refused");
    if (this.#scope === "profile-settlement" || this.#scope === "profile-restore" || this.#scope === "profile-repair-inventory" || this.#scope === "profile-pending-logout-inventory") throw new Error("profile-settlement-runtime-refused");
    if (this.#scope === "profile") this.#assertProfileRuntime();
    if (this.#scope === "profile-initialization") assertCanonicalProfileBinding(join(this.#stateRoot, "state.db"), this.profileBinding);
    if (this.#scope === "adoption-inspection") throw new Error("runtime-admission: adoption inspection is read-only");
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization has database-only write authority");
    if (this.#scope === "verified-copy" || this.#scope === "synthetic-verified-copy"
      || this.#scope === "relocation-source-verification") throw new Error("runtime-admission: verification is read-only");
  }
  assertAuthorityDatabase(path: string): void {
    if (this.#scope === "installation") throw new Error("profile-bound-authority-required");
    if (this.#scope === "adoption-initialization" || this.#scope === "profile-initialization" || this.#scope === "profile-upgrade") this.assertLive();
    else this.assertWritable();
    this.assertStorageRootsSafe();
    if (path === ":memory:" && this.#scope !== "relocation-destination" && this.#scope !== "adoption-initialization"
      && this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade" && this.#scope !== "profile") return;
    if (!this.#authorityDatabasePaths.has(path === ":memory:" ? path : resolve(path))) throw new Error("runtime-admission: authority database path is outside admission");
  }
  assertReadOnlyAuthorityDatabase(path: string): void {
    this.assertLive();
    if (this.#scope === "stopped-incomplete-profile-inventory" && resolve(path) !== join(this.#stateRoot, "state.db")) throw new Error("profile-incomplete-inventory-path-refused");
    if (this.#scope === "stopped-control-inventory" && path === ":memory:") throw new Error("profile-control-upgrade-inspection-path-refused");
    if (this.#readyUpgrade !== undefined) {
      if (path === ":memory:" || this.#readyUpgrade.copyPath !== undefined && path !== this.#readyUpgrade.copyPath) throw new Error("profile-stopped-upgrade-path-refused");
      if (this.#readyUpgrade.copyPath === undefined && path !== this.#readyUpgrade.sourcePath
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
      && this.#scope !== "profile" && this.#scope !== "profile-restore" && this.#scope !== "profile-initialization" && this.#scope !== "profile-upgrade") return;
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
  assertProfileCredentialInitialization(profile: RuntimeAdmission, input: SignUpOperation): SignUpOperation {
    this.assertWritable();
    this.assertProfileCredentialKey(profile, join(this.#stateRoot, "machine", "credential-keys", `${profile.profileBinding.profileId}.json`));
    const operation = SignUpOperationSchema.parse(input);
    if (operation.profileId !== profile.profileBinding.profileId || operation.phase !== "applying" || operation.credentialInitialization === undefined) throw new Error("profile-credential-initialization-required");
    const file = readPrivateFile(join(this.#stateRoot, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined || canonicalJsonStringify(SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)))) !== canonicalJsonStringify(operation)) throw new Error("profile-credential-initialization-changed");
    return operation;
  }

  assertProfileCredentialKey(profile: RuntimeAdmission, keyPath: string): void {
    this.assertLive();
    profile.assertLive();
    if (this.#scope !== "installation" || profile.#profileParent !== this
      || !["profile", "profile-initialization", "profile-settlement"].includes(profile.#scope)) {
      throw new Error("profile-credential-key-owner-mismatch");
    }
    const binding = profile.#profileBinding;
    if (binding === undefined) throw new Error("profile-bound-authority-required");
    const locator = this.#locator;
    if (locator === undefined) throw new Error("runtime-admission: synthetic fixture has no installation locator");
    if (binding.installationId !== locator.installationId
      || profile.#stateRoot !== join(this.#stateRoot, "profiles", binding.profileId)
      || !isAbsolute(keyPath) || resolve(keyPath) !== keyPath
      || keyPath !== join(this.#stateRoot, "machine", "credential-keys", `${binding.profileId}.json`)) {
      throw new Error("profile-credential-key-owner-mismatch");
    }
    this.assertStorageRootsSafe();
    noSymlinkAncestry(dirname(keyPath), new Map());
    this.assertStateRoot(keyPath);
  }

  assertProfileErasureJournal(profile: RuntimeAdmission, journalPath: string): void {
    this.assertLive();
    profile.assertLive();
    if (!isAbsolute(journalPath) || resolve(journalPath) !== journalPath) throw new Error("runtime-admission: noncanonical profile erasure path");
    const profileId = relative(join(this.#stateRoot, "profiles"), profile.stateRoot);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(profileId)
      || resolve(journalPath) !== join(this.#stateRoot, "machine", "erasures", `${profileId}.json`)) {
      throw new Error("runtime-admission: profile erasure paths differ from admission");
    }
    for (let path = dirname(journalPath); path !== this.#stateRoot; path = dirname(path)) {
      const info = lstatSync(path, { throwIfNoEntry: false });
      if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink()
        || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0)) throw new Error("runtime-admission: unsafe profile erasure path");
    }
    profile.assertStateRoot(profile.stateRoot);
    this.assertStateRoot(journalPath);
    this.assertStateRoot(`${journalPath}.authority`);
  }
  assertArtifactRoot(path: string): void {
    this.assertLive();
    if (this.#scope === "stopped-control-inventory" || this.#scope === "stopped-incomplete-profile-inventory") throw new Error("profile-control-upgrade-artifact-refused");
    if (this.#scope === "profile-pending-logout-inventory") throw new Error("profile-pending-logout-write-refused");
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization cannot write artifacts");
    this.#assertPhysicalStorageRootsSafe();
    if (!within(this.#artifactRoot, resolve(path))) throw new Error("runtime-admission: artifact path is outside admission");
  }
  release(): void {
    if (this.#released) return;
    const restore = this.#scope === "installation" ? stoppedMaintenanceRestores.get(this.#authority as InstallationLease) : undefined;
    this.#authority.release();
    this.#released = true;
    if (restore !== undefined) {
      stoppedMaintenanceRestores.delete(this.#authority as InstallationLease);
      try { restore.release(); }
      catch (error) { throw retainAuthoritySourceClosure([error], { restore }); }
    }
  }
  maintenanceRestore(): RestoreAdmissionHandle | undefined {
    this.assertLive();
    if (this.#scope !== "installation") return undefined;
    return stoppedMaintenanceRestores.get(this.#authority as InstallationLease);
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

  captureProfileRestore(witness: VerifiedCredentialErasureHead): ProfileRestoreContext {
    this.assertExclusive(); this.assertProfileRuntime();
    if (this.#authority.captureRestoreContext === undefined) throw new Error("profile-restore-authority-required");
    return this.#authority.captureRestoreContext(witness);
  }
  beginAuthorityRestore(input: AuthorityRestoreInput, restore: RestoreAdmissionHandle): void {
    this.assertExclusive();
    if (this.#authority.beginAuthorityRestore === undefined) throw new Error("profile-restore-authority-required");
    this.#authority.beginAuthorityRestore(input, restore);
  }
  settleAuthorityRestore(input: AuthorityRestoreInput, outcome: "unchanged" | "replaced", verify: AuthorityRestoreVerifier,
    restore: RestoreAdmissionHandle): void {
    this.assertExclusive();
    if (this.#authority.settleAuthorityRestore === undefined) throw new Error("profile-restore-authority-required");
    this.#authority.settleAuthorityRestore(input, outcome, verify, restore);
  }
  assertAuthorityRestoreCurrent(input: AuthorityRestoreInput, restore: RestoreAdmissionHandle): void {
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
    if (locator === undefined || existsSync(join(locator.stateRoot, "machine")) || existsSync(join(locator.stateRoot, "profiles"))) throw new ProfileStorageRelocationUnsupportedError();
  }
  beginRelocation(destination: RuntimePair, plan: RelocationPlanBinding,
    restore: RestoreAdmissionHandle): RuntimeRelocationOperation {
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

  stoppedRestoreProjection(path: string, restore: RestoreAdmissionHandle): RuntimeAdmission {
    this.assertExclusive();
    this.assertProfileRuntime();
    if (!isAbsolute(path) || resolve(path) !== path || dirname(path) !== this.#stateRoot
      || !/^\.restore-[0-9a-f-]{36}\.sqlite\.tmp$/u.test(path.slice(this.#stateRoot.length + 1))) throw new Error("profile-restore-projection-path-refused");
    const context = this.readInstallationContext();
    if (context === undefined) throw new Error("profile-restore-projection-parent-required");
    const assertHeld = () => {
      this.assertLive();
      assertRuntimeRestoreAdmission(restore, resolve(context.workspace, rebuildRuntimeIsolation.processLockRoot));
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
    if ((this.#scope !== "profile" && this.#scope !== "synthetic") || dirname(resolve(path)) !== this.#stateRoot
      || !/^\.restore-[0-9a-f-]{36}\.sqlite\.tmp$/u.test(resolve(path).slice(this.#stateRoot.length + 1))) {
      throw new Error("runtime-admission: staged authority path is not an owned restore copy");
    }
    return new RuntimeAdmission(issuanceToken, { assertHeld: () => this.assertLive(), readInstallationContext: () => this.readInstallationContext(), release() {} },
      this.#stateRoot, this.#artifactRoot, [resolve(path)], this.#scope === "synthetic" ? "synthetic-stopped-staged" : "stopped-staged", "exclusive", this.#locator, this.#profileBinding);
  }

  verifiedReadOnlyCopy(path: string, expectedSha256: string): RuntimeAdmission {
    this.assertLive();
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
    if (this.#scope === "stopped-control-inventory" && !within(this.#stateRoot, checked)) throw new Error("profile-control-upgrade-copy-path-refused");
    if (!within(this.#stateRoot, checked)) this.assertExclusive();
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
      this.assertLive();
      const file = lstatSync(canonical);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (process.getuid && file.uid !== process.getuid()) || (file.mode & 0o022) !== 0) {
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

  resumeProfileAuthorityRestore(operationId: string, restore: RestoreAdmissionHandle): RuntimeAdmission {
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
      }, release: () => this.release() }, root, join(root, "artifacts"), [join(root, "state.db")], "profile-restore", "exclusive", this.#locator, input.profile.binding);
  }

  captureDuoCredentialCustody(profile: RuntimeAdmission): Readonly<{ binding: ProfileDatabaseBinding; generation: number; assertHeld(): void; readDuoContinuity(): ReturnType<typeof readIssuedDuoContinuity> }> {
    this.assertWritable();
    profile.assertProfileRuntime();
    const binding = profile.profileBinding;
    this.assertProfileCredentialKey(profile, join(this.#stateRoot, "machine", "credential-keys", `${binding.profileId}.json`));
    const generation = this.readProfileRegistry().sessionGeneration;
    profile.assertProfileRuntime();
    const ancestry = new Map<string, DirectoryIdentity>();
    if (!noSymlinkAncestry(profile.#stateRoot, ancestry)) throw new Error("duo-profile-root-required");
    const readDuoContinuity = () => {
      this.assertLive();
      if (this.#scope !== "installation") throw new Error("duo-profile-custody-expired");
      return readIssuedDuoContinuity(this.#authority as InstallationLease, binding.profileId);
    };
    return Object.freeze({ binding, generation, readDuoContinuity, assertHeld: () => {
      this.assertLive();
      if (profile.#released || profile.#profileParent !== this || profile.#scope !== "profile") throw new Error("duo-profile-custody-expired");
      if (!noSymlinkAncestry(profile.#stateRoot, ancestry)) throw new Error("duo-profile-root-required");
      assertLiveProfileDatabaseBinding(join(profile.#stateRoot, "state.db"), binding);
      readDuoContinuity();
    } });
  }
  captureDraftDuoCredentialCustody(profile: RuntimeAdmission, operationId: string, generation: number) {
    this.assertWritable();
    profile.assertProfileInitialization();
    const binding = profile.profileBinding;
    this.assertProfileCredentialKey(profile, join(this.#stateRoot, "machine", "credential-keys", `${binding.profileId}.json`));
    const path = join(this.#stateRoot, "machine", "operations", `${z.uuid().parse(operationId)}.json`);
    const readOperation = () => {
      this.assertWritable();
      profile.assertProfileInitialization();
      if (profile.#profileParent !== this) throw new Error("duo-draft-owner-mismatch");
      const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) throw new Error("duo-draft-operation-required");
      const operation = SignUpOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
      if (operation.operationId !== operationId || operation.profileId !== binding.profileId || operation.phase !== "applying" && operation.phase !== "publishing"
        || operation.onboarding?.generation !== generation || operation.onboarding.duo.profileId !== binding.profileId
        || this.readProfileRegistry().profiles.some(row => row.profileId === binding.profileId)) throw new Error("duo-draft-authority-changed");
      if (operation.phase === "publishing") assertFinishedProfileOnboarding(operation);
      return operation;
    };
    const original = readOperation();
    const stable = (operation: typeof original) => canonicalJsonStringify({ operationId: operation.operationId, profileId: operation.profileId,
      commandId: operation.commandId, writeId: operation.writeId, emailKey: operation.emailKey, firstName: operation.firstName,
      lastName: operation.lastName, createdAt: operation.createdAt, commandFingerprint: operation.commandFingerprint });
    const identity = stable(original), ancestry = new Map<string, DirectoryIdentity>();
    if (!noSymlinkAncestry(profile.#stateRoot, ancestry)) throw new Error("duo-profile-root-required");
    const assertHeld = () => {
      const current = readOperation();
      if (stable(current) !== identity || !noSymlinkAncestry(profile.#stateRoot, ancestry)) throw new Error("duo-draft-authority-changed");
      assertLiveProfileDatabaseBinding(join(profile.#stateRoot, "state.db"), binding);
    };
    const assertPublicationRecovery = () => {
      this.assertWritable();
      if (profile.#released || profile.#profileParent !== this || profile.#scope !== "profile-initialization"
        || !noSymlinkAncestry(profile.#stateRoot, ancestry)) throw new Error("duo-draft-recovery-custody-expired");
      const operation = (this.#authority as InstallationLease).assertDraftDuoPublicationRecovery(operationId, binding.profileId, generation);
      if (stable(operation) !== identity) throw new Error("duo-draft-authority-changed");
      assertLiveProfileDatabaseBinding(join(profile.#stateRoot, "state.db"), binding);
    };
    return Object.freeze({ binding, generation, draftOperationId: operationId, assertHeld, assertPublicationRecovery,
      readDuoContinuity: () => { assertHeld(); const operation = readOperation();
        if (operation.onboarding === undefined) throw new Error("duo-draft-operation-required");
        return operation.onboarding.duo;
      } });
  }
  static forStoppedControlInventory(value: StoppedControlProfileInventory): RuntimeAdmission {
    const issued = requireStoppedControlProfileInventory(value);
    const admission = new RuntimeAdmission(issuanceToken, { assertHeld: issued.assertHeld, readInstallationContext: issued.readInstallationContext, release() {} },
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
  beginStoppedMachineControlUpgrade(restore: RestoreAdmissionHandle): StoppedProfileControlUpgradeAdmission {
    this.assertLive();
    this.assertExclusive();
    if (this.#scope !== "installation") throw new Error("profile-control-upgrade-machine-membership-unknown");
    const context = this.readInstallationContext();
    if (context === undefined) throw new Error("profile-control-upgrade-machine-membership-unknown");
    return acquireStoppedProfileControlUpgrade(context.workspace, restore, this.#authority as InstallationLease);
  }
  static fromInstallationLease(lease: InstallationLease): RuntimeAdmission {
    assertInstallationLease(lease);
    const { stateRoot, artifactRoot } = lease.locator;
    return new RuntimeAdmission(issuanceToken, lease, stateRoot, artifactRoot,
      [join(stateRoot, "state.db")], "installation", lease.mode, lease.locator);
  }

  #stoppedDuoRecovery(): { lease: InstallationLease; restore: RestoreAdmissionHandle } {
    this.assertLive();
    this.assertExclusive();
    if (this.#scope !== "installation") throw new Error("profile-control-upgrade-machine-membership-unknown");
    const lease = this.#authority as InstallationLease;
    const restore = stoppedMaintenanceRestores.get(lease);
    if (restore === undefined) throw new Error("profile-control-upgrade-machine-membership-unknown");
    return { lease, restore };
  }
  forStoppedIncompleteProfileInventory(profileId: string): RuntimeAdmission {
    const { lease, restore } = this.#stoppedDuoRecovery();
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
      assertLiveProfileDatabaseBinding(join(root, "state.db"), binding);
    };
    assertHeld();
    return new RuntimeAdmission(issuanceToken, { assertHeld, release() {}, readInstallationContext: () => this.readInstallationContext() },
      root, join(root, "artifacts"), [join(root, "state.db")], "stopped-incomplete-profile-inventory", "exclusive", this.#locator, binding, this);
  }
  async reclassifyIncompleteProfileAsDraft(profileId: string): Promise<void> {
    const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
    const { lease } = this.#stoppedDuoRecovery(), admission = this.forStoppedIncompleteProfileInventory(profileId);
    try {
      const assertEmpty = () => {
        if (!AuthorityDatabase.readIncompleteOnboardingInventory(admission).empty) throw new Error("profile-incomplete-activity-present");
      };
      const witness = captureIncompleteProfileDraft(this, admission, assertEmpty);
      lease.reclassifyIncompleteProfile(witness);
    } finally { admission.release(); }
  }
  assertStoppedIncompleteProfileInventory(): void {
    this.assertLive();
    if (this.#scope !== "stopped-incomplete-profile-inventory") throw new Error("profile-incomplete-inventory-purpose-required");
  }
  issueStoppedDuoPublicationRecovery(): DuoPublicationRecoveryClaim {
    const { lease, restore } = this.#stoppedDuoRecovery();
    return issueStoppedDuoRecoveryClaim(lease, restore);
  }
  completeStoppedDuoPublicationRecovery(claim: DuoPublicationRecoveryClaim): { revision: number } {
    this.#stoppedDuoRecovery();
    return completeStoppedDuoRecoveryClaim(claim);
  }
  recoverInterruptedDuoPublication(): { revision: number } {
    const claim = this.issueStoppedDuoPublicationRecovery();
    return this.completeStoppedDuoPublicationRecovery(claim);
  }
  static acquireStoppedMachineControlMaintenance(workspace: string): RuntimeAdmission {
    const canonical = realpathSync(workspace);
    const processLockRoot = join(canonical, rebuildRuntimeIsolation.processLockRoot);
    const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid });
    let lease: InstallationLease | undefined;
    try {
      lease = acquireInstallation(canonical, "exclusive");
      assertStoppedMachineMaintenance(lease, restore);
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { restore, admission: lease });
      try { lease?.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { restore, admission: lease }); }
      try { restore.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { restore }); }
      throw error;
    }
    stoppedMaintenanceRestores.set(lease, restore);
    return RuntimeAdmission.fromInstallationLease(lease);
  }
  static acquireMachine(workspace: string, mode: "shared" | "exclusive"): RuntimeAdmission {
    const canonical = realpathSync(workspace);
    const control = join(canonical, ".tracker/control/installation.json");
    if (lstatSync(control, { throwIfNoEntry: false }) === undefined) {
      const lease = acquireInstallation(canonical, "exclusive", { machine: true, defaultPair: {
        stateRoot: resolve(canonical, rebuildRuntimeIsolation.stateRoot), artifactRoot: resolve(canonical, rebuildRuntimeIsolation.artifactRoot),
      } });
      if (mode === "exclusive") return RuntimeAdmission.fromInstallationLease(lease);
      lease.release();
    }
    const lease = mode === "exclusive" ? acquireInstallation(canonical, "exclusive", { machine: true })
      : acquireInstallation(canonical, "shared", { machine: true });
    return RuntimeAdmission.fromInstallationLease(lease);
  }

  static acquireInitial(workspace: string,
    verifyExisting: (pair: RuntimePair, inspection: RuntimeAdmission) => ExistingAuthorityEvidence,
    initializeFresh: (pair: RuntimePair, initialization: RuntimeAdmission) => void): RuntimeAdmission {
    const canonical = realpathSync(workspace);
    const defaults = Object.freeze({
      stateRoot: resolve(canonical, rebuildRuntimeIsolation.stateRoot),
      artifactRoot: resolve(canonical, rebuildRuntimeIsolation.artifactRoot),
    });
    const lease = acquireInstallation(canonical, "exclusive", {
      defaultPair: defaults,
      verifyExisting: (pair) => {
        const inspection = new RuntimeAdmission(issuanceToken, { assertHeld() {}, release() {} }, pair.stateRoot, pair.artifactRoot,
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
        || (process.getuid && file.uid !== process.getuid()) || (file.mode & 0o022) !== 0)) {
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

export function acquireSharedRuntimeAdmission(workspace: string): RuntimeAdmission {
  return RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "shared"));
}

export function acquireExclusiveRuntimeAdmission(workspace: string): RuntimeAdmission {
  return RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "exclusive"));
}

export function acquireInitialRuntimeAdmission(workspace: string,
  verifyExisting: (pair: RuntimePair, inspection: RuntimeAdmission) => ExistingAuthorityEvidence,
  initializeFresh: (pair: RuntimePair, initialization: RuntimeAdmission) => void): RuntimeAdmission {
  return RuntimeAdmission.acquireInitial(workspace, verifyExisting, initializeFresh);
}

export function acquireRecoveryRuntimeRelocation(workspace: string,
  binding: Readonly<{ installationId: string; fromGeneration: number; operationId: string }>,
  restore: RestoreAdmissionHandle): Readonly<{ admission: RuntimeAdmission; operation: RuntimeRelocationOperation }> {
  const lease = acquireInstallation(workspace, "exclusive", { recoverRelocation: { ...binding, restoreAdmission: restore } });
  try {
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    return Object.freeze({ admission, operation: admission.resumeRelocation(binding.operationId) });
  } catch (error) {
    lease.release();
    throw error;
  }
}

export function acquireRecoveryRuntimeRestore(workspace: string, operationId: string,
  restore: RestoreAdmissionHandle): Readonly<{ admission: RuntimeAdmission; input: AuthorityRestoreInput }> {
  const lease = acquireInstallation(workspace, "exclusive", { recoverAuthorityRestore: { operationId, restoreAdmission: restore } });
  try {
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    return Object.freeze({ admission: admission.resumeProfileAuthorityRestore(operationId, restore), input: lease.readAuthorityRestore(operationId) });
  } catch (error) { lease.release(); throw error; }
}
