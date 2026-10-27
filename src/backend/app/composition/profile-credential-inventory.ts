import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../storage/source-closure.js';
import { assertNoRetainedOwnerClaimBackup } from "../../storage/maintenance/existing-data-backup.js";
import { assertRetainedProfileBrowserRoot, inventoryFileIdentity, enumerateProfileCredentialMembership, credentialCopyProcessCustody, assertCredentialCopyResourcesClosed } from "../../storage/maintenance/profile-inventory.js";
import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames, deriveAuthorityUpgradePlanDigest } from "../../storage/sqlite/migrations.js";
import { readEmergencyFaults } from "../../logs/emergency-faults.js";
import type { CredentialInitializationCopyInspection } from "../../storage/configuration/credential-store.js";
import type { CredentialEraseInput, CredentialStore } from "../../../models/config/credential-store.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import type { SignUpOperation, LogoutOperation } from "../../../models/profiles/profile.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { createHash } from "node:crypto";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { readSettings } from "../../runtime/settings/settings-runtime.js";
import { isOwnedDraftAbortSource, inspectCredentialKeyCopy, inspectCredentialCopy, assertCredentialStoreOwner, readForErasure, attestStoppedControlCredentials, releaseStoppedControlCredentialAttestation } from "../../storage/configuration/credential-store.js";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, type Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { assessCredentialInventory, countProfileCredentialLoginRows, type CredentialInventory } from "../../profiles/credential-inventory.js";
import { verifyBackupManifestAtPath, verifyStoppedBackupManifestAtPath } from "../../storage/sqlite/backup-service.js";
import { withAuthorityDatabaseReadOnly } from "../../storage/sqlite/readonly-authority-snapshot.js";
import { inspectRuntimeProcessOrphans, observeRuntimeLockSnapshot, readRuntimeProcessLock } from "../../storage/sqlite/runtime-process-locks.js";
import { DuoCredentialFileSchema } from "../../../models/config/duo-credential.js";
import { requireStoppedControlProfileInventory, type StoppedControlProfileInventory } from "../../storage/admission/installation.js";
import { RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

export function assertProfileBrowserRoot(admissionInput: RuntimeAdmission, path: string): void {
  const admission = requireRuntimeAdmission(admissionInput);
  admission.assertProfileRuntime();
  assertRetainedProfileBrowserRoot(admission, path);
}



function credentialSearchBytes(capturedSecrets: readonly string[]): readonly Buffer[] {
  return capturedSecrets.flatMap(value => {
    const littleEndian = Buffer.from(value, "utf16le");
    return [Buffer.from(value, "utf8"), littleEndian, Buffer.from(littleEndian).swap16()];
  });
}

function containsCredentialValue(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === "string") return secrets.some(secret => secret.length > 0 && value.includes(secret));
  if (Array.isArray(value)) return value.some(member => containsCredentialValue(member, secrets));
  if (typeof value === "object" && value !== null) return Object.entries(value).some(([key, member]) =>
    containsCredentialValue(key, secrets) || containsCredentialValue(typeof member === "string" && key.endsWith("Json") ? JSON.parse(member) : member, secrets));
  return false;
}

function withProfileCredentialCopy<T>(path: string, before: ReturnType<typeof inventoryFileIdentity>, read: (descriptor: number, identity: Stats) => T): T {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let identity: Stats | undefined;
  let result: { value: T } | undefined, primary: { error: unknown } | undefined;
  try {
    identity = fstatSync(descriptor);
    if (identity.dev !== before.device || identity.ino !== before.inode || identity.size !== before.size) throw new Error('credential-copy-source-changed');
    result = { value: read(descriptor, identity) };
  }
  catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) {
    throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], {
      descriptor: { descriptor, identity: { path, before, opened: identity } },
    });
  }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error('profile-credential-copy-read-unproved');
  return result.value;
}

export function scanProfileCredentialCopy(path: string, capturedSecrets: readonly string[], privateKeyScan?: Readonly<{ containsKey(value: unknown): boolean; keyScanOverlap: number }>): { digest: string; containsSecret: boolean } {
  const secrets = credentialSearchBytes(capturedSecrets);
  const before = inventoryFileIdentity(path);
  return withProfileCredentialCopy(path, before, (fd, opened) => {
    if (opened.dev !== before.device || opened.ino !== before.inode || opened.size !== before.size) throw new Error("profile-inventory-file-changed");
    const digest = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
    const overlap = Math.max(privateKeyScan?.keyScanOverlap ?? 0, ...secrets.map(secret => secret.length - 1));
    if (overlap > 64 * 1024) throw new Error("profile-inventory-secret-size-invalid");
    let tail = Buffer.alloc(0), containsSecret = false, count = 0;
    for (;;) {
      const size = readSync(fd, chunk, 0, chunk.length, null);
      if (size === 0) break;
      count += size;
      const bytes = chunk.subarray(0, size);
      digest.update(bytes);
      const scan = Buffer.concat([tail, bytes]);
      containsSecret ||= secrets.some(secret => secret.length > 0 && scan.includes(secret)) || privateKeyScan?.containsKey(scan) === true;
      tail = Buffer.from(scan.subarray(Math.max(0, scan.length - overlap)));
    }
    if (count !== before.size || canonicalJsonStringify(before) !== canonicalJsonStringify(inventoryFileIdentity(path))) throw new Error("profile-inventory-file-changed");
    return { digest: digest.digest("hex"), containsSecret };
  });
}



type CredentialMaintenancePurpose = Readonly<{ kind: "ordinary" }> | Readonly<{ kind: "stopped-control"; claim: StoppedControlProfileInventory }>;
function observeStoppedControlProcessCustody(processLockRoot: string, admission: RuntimeAdmission, clock: Clock) {
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")) }, clock);
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (Object.values(snapshot.processLocks).some((lock) => lock.state !== "stopped") || orphans.staleWorkerRecords > 0 || orphans.staleServerRecords > 0) {
    throw new Error("profile-control-upgrade-process-custody-unproved");
  }
  const { recordedAt: _recordedAt, ...custody } = snapshot;
  return { snapshot: custody, orphans };
}
function assessProfileCredentialCopies(admission: RuntimeAdmission, before: ReturnType<typeof enumerateProfileCredentialMembership>,
  backups: readonly Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[], fields: Readonly<{ capturedSecrets: readonly string[];
    abortSource?: CredentialInitializationCopyInspection["abortSource"]; capturedSecretsComplete: boolean; containsKey(value: unknown): boolean; readonly keyScanOverlap: number; inspectEncrypted(path: string): Readonly<{ containsUcsd: boolean; containsCaptured: boolean }> }>,
  purpose: CredentialMaintenancePurpose) {
  const root = admission.stateRoot, backupPlaintext: string[] = [], unknownFormats = [...before.unsupported];
  if (purpose.kind === "stopped-control") {
    const issued = requireStoppedControlProfileInventory(purpose.claim);
    if (issued.binding.profileId !== admission.profileBinding.profileId || issued.stateRoot !== root) throw new Error("profile-control-upgrade-inventory-owner-mismatch");
  }
      for (const path of [...before.copies, ...before.backupPaths]) {
        if (isOwnedDraftAbortSource(fields.abortSource, path, admission)) continue;
        const scanned = scanProfileCredentialCopy(path, fields.capturedSecrets, fields), backup = backups.find(value => value.backupPath === path);
        if (backup !== undefined && scanned.digest !== backup.manifest.sha256) throw new Error("profile-inventory-backup-changed");
        let containsSecret = scanned.containsSecret;
        const enginePath = join(root, "credentials", "duo-webauthn.json");
        const retainedEngine = purpose.kind === "stopped-control" && path === enginePath;
        if (purpose.kind === "ordinary" && path === enginePath) unknownFormats.push(path);
        if (backup === undefined && basename(path) !== "Login Data" && !before.unsupported.includes(path)) {
          try {
            const bootLog = path === join(root, "logs", "boot.jsonl");
            if (bootLog && readEmergencyFaults(root).state !== "present") throw new Error("profile-inventory-log-unavailable");
            const bytes = withProfileCredentialCopy(path, inventoryFileIdentity(path), (descriptor, info) => {
              const limit = bootLog ? 5 * 1024 * 1024
                : dirname(path) === join(root, "credentials") ? Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 : 16 * 1024 * 1024;
              if (!info.isFile() || info.size > limit) throw new Error("profile-inventory-copy-size-invalid");
              const bytes = Buffer.alloc(info.size + 1);
              let count = 0;
              while (count < bytes.length) {
                const size = readSync(descriptor, bytes, count, bytes.length - count, count);
                if (size === 0) break;
                count += size;
              }
              if (count !== info.size) throw new Error("profile-inventory-copy-changed");
              return bytes.subarray(0, count);
            });
            if (createHash("sha256").update(bytes).digest("hex") !== scanned.digest) throw new Error("profile-inventory-copy-changed");
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            const documents: unknown[] = bootLog ? text.trimEnd().split("\n").map(line => JSON.parse(line) as unknown) : [JSON.parse(text) as unknown];
            if (retainedEngine) DuoCredentialFileSchema.parse(documents[0]);
            else if (documents.some(value => value === null || typeof value !== "object" || Array.isArray(value))) throw new Error("profile-inventory-json-unsupported");
            if (documents.some(value => typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === 4)) {
              const inspected = fields.inspectEncrypted(path);
              containsSecret ||= inspected.containsUcsd || inspected.containsCaptured;
            }
            containsSecret ||= documents.some(value => containsCredentialValue(value, fields.capturedSecrets) || fields.containsKey(value));
            for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
              if (containsCredentialValue(JSON.parse(token[0]) as unknown, fields.capturedSecrets) || fields.containsKey(JSON.parse(token[0]) as unknown)) containsSecret = true;
            }
          } catch (error) {
            if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
            unknownFormats.push(path);
          }
        }
        if (backup !== undefined) {
          const copyAdmission = admission.verifiedReadOnlyCopy(path, backup.manifest.sha256);
          try {
            containsSecret ||= withAuthorityDatabaseReadOnly(copyAdmission, path, database => {
              const bytes = credentialSearchBytes(fields.capturedSecrets);
              for (const table of migrationTableNames(backup.manifest.schemaVersion)) for (const row of database.prepare(`SELECT * FROM ${table}`).iterate()) {
                for (const [column, value] of Object.entries(row)) {
                  if (fields.containsKey(value)) return true;
                  if (containsCredentialValue(typeof value === "string" && column.endsWith("_json") ? JSON.parse(value) : value, fields.capturedSecrets)) return true;
                  if (value instanceof Uint8Array && bytes.some(secret => secret.length > 0 && Buffer.from(value).includes(secret))) return true;
                }
              }
              return false;
            });
          } finally { copyAdmission.release(); }
        }
        if (containsSecret) backupPlaintext.push(path);
        if (!fields.capturedSecretsComplete && !retainedEngine) unknownFormats.push(path);
      }
  return { backupPlaintext, unknownFormats };
}



function assertCredentialBackupBinding(admission: RuntimeAdmission, backup: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>,
  upgrades: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>["upgrades"]) {
  const { manifest } = backup;
  if (manifest.profileId !== admission.profileBinding.profileId || manifest.installationId !== admission.profileBinding.installationId
    || manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))) throw new Error("profile-inventory-backup-binding-mismatch");
  if (manifest.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) return;
  if (manifest.schemaVersion !== 7 && manifest.schemaVersion !== 8) throw new Error("profile-inventory-backup-binding-mismatch");
  const matching = upgrades.filter(record => record.phase !== "baseline" && (record.backup.manifestPath === backup.manifestPath
    || record.backup.sha256 === manifest.sha256 || record.upgradeId === manifest.authorityContentFingerprint));
  const record = matching[0];
  const destination = manifest.schemaVersion === 7 && record?.toSchemaVersion === 8 ? 8 : 9;
  if (destination > CURRENT_AUTHORITY_SCHEMA_VERSION || matching.length !== 1 || record?.phase !== "settled" || record.fromSchemaVersion !== manifest.schemaVersion
    || record.toSchemaVersion !== destination || record.backup.manifestPath !== backup.manifestPath
    || record.backup.sha256 !== manifest.sha256 || record.backup.authorityGeneration !== manifest.authorityGeneration
    || record.upgradeId !== manifest.authorityContentFingerprint
    || record.planDigest !== (destination === 8
      ? deriveAuthorityUpgradePlanDigest(7, manifest.authorityContentFingerprint, 8)
      : deriveAuthorityUpgradePlanDigest(manifest.schemaVersion, manifest.authorityContentFingerprint))) throw new Error("profile-inventory-backup-upgrade-unproved");
}

function composeProfileCredentialMaintenanceInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock }>, owner: CredentialMaintenancePurpose, authorize: () => void) {
  return (writer: Readonly<{ acquisitionId: string; pid: number }> | undefined, copies: CredentialInitializationCopyInspection) => {
    const { admission } = input;
    authorize();
    const authorityWitness = () => owner.kind === "ordinary"
      ? canonicalJsonStringify(input.machine.readProfileRegistry())
      : canonicalJsonStringify({ binding: requireStoppedControlProfileInventory(owner.claim).binding, locator: requireStoppedControlProfileInventory(owner.claim).locator });
    const registry = authorityWitness();
    const installation = owner.kind === "ordinary" ? input.machine.readInstallationContext() : admission.readInstallationContext();
    if (installation === undefined) throw new Error("credential-maintenance-installation-required");
    const processLockRoot = join(installation.workspace, rebuildRuntimeIsolation.processLockRoot);
    const assertProcessRoot = () => {
      if (owner.kind === "ordinary") input.machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
      else requireStoppedControlProfileInventory(owner.claim);
    };
    assertProcessRoot();
    const enumerate = () => {
      admission.assertLive();
      assertNoRetainedOwnerClaimBackup(input.machine, admission.profileBinding.profileId);
      assertProcessRoot();
      const profileRoot = admission.stateRoot;
      const processCustody = owner.kind === "ordinary" ? credentialCopyProcessCustody(input) : observeStoppedControlProcessCustody(processLockRoot, admission, input.clock);
      const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
      assertCredentialCopyResourcesClosed(facts);
      const settings = facts.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
        : facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
      const savedBrowserRoot = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
        { stateRoot: profileRoot, artifactRoot: admission.artifactRoot }).config.paths.browserProfileRoot;
      const membership = enumerateProfileCredentialMembership(admission, facts, savedBrowserRoot, writer);
      const backups = membership.manifests.map(manifest => verifyStoppedBackupManifestAtPath(admission, manifest,
        AuthorityDatabase.sourceDatabaseIdentity(join(profileRoot, "state.db"))));
      if (membership.backupPaths.length !== backups.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("credential-maintenance-backup-membership-unproved");
      const assessment = assessProfileCredentialCopies(admission, membership, backups, copies, owner);
      if (assessment.backupPlaintext.length > 0 || assessment.unknownFormats.length > 0) throw new Error("credential-maintenance-copy-capture-incomplete");
      const login = countProfileCredentialLoginRows(membership.loginDataPaths);
      if (login === "unreadable" || typeof login === "number" && login > 0) throw new Error("credential-maintenance-login-copy-present");
      const credentialsRoot = join(profileRoot, "credentials");
      const stable = { ...membership, ...processCustody, identities: membership.identities.filter(entry => entry.path !== credentialsRoot
        && entry.path !== join(credentialsRoot, "protected.json") && entry.path !== join(credentialsRoot, ".protected.lock")) };
      return canonicalJsonStringify(stable);
    };
    const before = enumerate();
    const root = admission.stateRoot, profileId = admission.profileBinding.profileId;
    const duoRoot = owner.kind === "ordinary" ? input.machine.stateRoot : requireStoppedControlProfileInventory(owner.claim).machineRoot;
    const physicalMembership = (): string => {
      const entries: (ReturnType<typeof inventoryFileIdentity> | { path: string; absent: true })[] = [];
      const visit = (path: string): void => {
        if (lstatSync(path, { throwIfNoEntry: false }) === undefined) { entries.push({ path, absent: true }); return; }
        const entry = inventoryFileIdentity(path); entries.push(entry);
        if (entry.directory) for (const name of readdirSync(path).sort()) visit(join(path, name));
      };
      const duoDocument = join(duoRoot, "machine", "duo-credentials", `${profileId}.json`);
      const duoBackups = join(duoRoot, "machine", "duo-purpose-backups");
      for (const path of [root, processLockRoot, duoDocument, duoBackups]) visit(path);
      if (lstatSync(duoDocument, { throwIfNoEntry: false })?.isFile()) {
        const scanned = scanProfileCredentialCopy(duoDocument, copies.capturedSecrets, copies);
        if (scanned.containsSecret) throw new Error("duo-purpose-plaintext-refused");
      }
      return canonicalJsonStringify(entries);
    };
    const beforeKeyIntent = physicalMembership();
    return Object.freeze({ assessCurrent(entriesAbsent: boolean): CredentialInventory {
      authorize();
      if (enumerate() !== before) throw new Error("credential-maintenance-inventory-changed");
      const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
      const settings = facts.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
        : facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
      const savedBrowserRoot = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
        { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config.paths.browserProfileRoot;
      const membership = enumerateProfileCredentialMembership(admission, facts, savedBrowserRoot, writer);
      const assessment = assessCredentialInventory({ profileRoot: root, entriesAbsent, inspectEncrypted: path => copies.inspectEncrypted(path),
        backupPaths: [], loginDataPaths: membership.loginDataPaths, capturedSecrets: copies.capturedSecrets, capturedSecretsComplete: copies.capturedSecretsComplete });
      if (enumerate() !== before) throw new Error("credential-maintenance-inventory-changed");
      return assessment;
    }, revalidateBeforeKeyIntent: () => {
      if (physicalMembership() !== beforeKeyIntent) throw new Error("credential-maintenance-inventory-changed");
    }, revalidate: () => {
      authorize();
      if (authorityWitness() !== registry || enumerate() !== before) throw new Error("credential-maintenance-inventory-changed");
      const publicationMembership = physicalMembership();
      return () => { if (physicalMembership() !== publicationMembership) throw new Error("credential-maintenance-inventory-changed"); };
    } });
  };
}

export function composeProfileCredentialInitializationInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock }>) {
  return (operation: SignUpOperation, writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection) =>
    {
      let current = operation;
      const inventory = composeProfileCredentialMaintenanceInventory(input, { kind: "ordinary" }, () => { input.machine.assertProfileCredentialInitialization(input.admission, current); })(writer, copies);
      return Object.freeze({ revalidateBeforeKeyIntent: inventory.revalidateBeforeKeyIntent, revalidate: (next: SignUpOperation) => {
        if (canonicalJsonStringify({ ...next, credentialInitialization: operation.credentialInitialization }) !== canonicalJsonStringify(operation)
          || next.credentialInitialization?.mode !== operation.credentialInitialization?.mode
          || next.credentialInitialization?.keyId !== operation.credentialInitialization?.keyId
          || operation.credentialInitialization?.keyDocumentDigest !== undefined && next.credentialInitialization?.keyDocumentDigest !== operation.credentialInitialization.keyDocumentDigest
          || operation.credentialInitialization?.keyFile !== undefined && canonicalJsonStringify(next.credentialInitialization?.keyFile) !== canonicalJsonStringify(operation.credentialInitialization.keyFile)
          || canonicalJsonStringify(next.credentialInitialization !== undefined && next.credentialInitialization.mode !== "initial" ? next.credentialInitialization.source : null)
            !== canonicalJsonStringify(operation.credentialInitialization !== undefined && operation.credentialInitialization.mode !== "initial" ? operation.credentialInitialization.source : null)) throw new Error("credential-initialization-inventory-owner-changed");
        current = next;
        return inventory.revalidate();
      } });
    };
}

export function composeProfileCredentialRepairInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock }>) {
  return (request: CredentialEraseInput, writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection) => {
    const admission = input.admission.forCredentialRepairInventory(request);
    try {
      const inventory = composeProfileCredentialMaintenanceInventory({ ...input, admission }, { kind: "ordinary" }, () => admission.assertLive())(writer, copies);
      return Object.freeze({ revalidate: inventory.revalidate, dispose: () => {
        try { admission.release(); }
        catch (error) { throw retainAuthoritySourceClosure([error], { admission }); }
      } });
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission });
      try { admission.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
      throw error;
    }
  };
}


export function composeProfilePendingLogoutInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock }>) {
  return (purpose: RuntimeAdmission, operation: LogoutOperation, copies: CredentialInitializationCopyInspection & Readonly<{ entriesAbsent: boolean }>) => {
    purpose.assertPendingLogoutInventory(input.admission, operation);
    const authorize = () => {
      purpose.assertPendingLogoutInventory(input.admission, operation);
      const installation = input.machine.readInstallationContext();
      if (installation === undefined) throw new Error("credential-maintenance-installation-required");
      const processLockRoot = join(installation.workspace, rebuildRuntimeIsolation.processLockRoot);
      input.machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
      const orphans = inspectRuntimeProcessOrphans(processLockRoot), server = readRuntimeProcessLock(processLockRoot, "server");
      if (orphans.staleServerRecords > 0 || server?.releasedAt === null && server.pid !== process.pid) {
        throw new Error("credential-pending-logout-process-custody-unproved");
      }
    };
    const inventory = composeProfileCredentialMaintenanceInventory({ ...input, admission: purpose }, { kind: "ordinary" }, authorize)(undefined, copies);
    return Object.freeze({ assessment: inventory.assessCurrent(copies.entriesAbsent), revalidate: () => {
      inventory.revalidateBeforeKeyIntent(); inventory.revalidate(); inventory.revalidateBeforeKeyIntent();
    } });
  };
}


export function composeProfileCredentialInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; database: AuthorityDatabase; hostFacts: HostConfigFacts; clock: Clock }>) {
  const root = input.admission.stateRoot, profileId = input.admission.profileBinding.profileId;
  const enumerate = () => input.database.withAuthorityReadSnapshot(() => {
    input.admission.assertLive();
    assertNoRetainedOwnerClaimBackup(input.machine, profileId);
    const custody = input.database.readProfileResourceCustody();
    const saved = readSettings(input.database.authority);
    const savedBrowserRoot = resolveConfigWithProvenance(saved.settings, input.hostFacts, input.clock,
      { stateRoot: root, artifactRoot: input.admission.artifactRoot }).config.paths.browserProfileRoot;
    return enumerateProfileCredentialMembership(input.admission, custody, savedBrowserRoot);
  });
  let prepared: { membership: ReturnType<typeof enumerate>; backups: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[];
    stopped?: ReturnType<typeof credentialCopyProcessCustody> } | undefined;
  return Object.freeze({
    async prepare(): Promise<void> {
      const before = enumerate();
      const backups: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[] = [];
      for (const path of before.manifests) {
        const verified = await verifyBackupManifestAtPath(input.admission, path, input.database.getSourceDatabaseIdentity());
        assertCredentialBackupBinding(input.admission, verified, before.custody.upgrades);
        backups.push(verified);
      }
      if (before.backupPaths.length !== backups.length || before.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("profile-inventory-backup-unverified");
      const stopped = backups.some(backup => backup.manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) ? credentialCopyProcessCustody(input) : undefined;
      const after = enumerate();
      if (stopped !== undefined) {
        assertCredentialCopyResourcesClosed(after.custody);
        if (canonicalJsonStringify(stopped) !== canonicalJsonStringify(credentialCopyProcessCustody(input))) throw new Error("profile-inventory-membership-changed");
      }
      if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new Error("profile-inventory-membership-changed");
      prepared = { membership: after, backups, ...(stopped === undefined ? {} : { stopped }) };
    },
    assess(fields: Readonly<{ admission: RuntimeAdmission; credentials: CredentialStore; operationId?: string;
      capturedSecrets: readonly string[]; capturedSecretsComplete: boolean }>): CredentialInventory {
      if (prepared === undefined) throw new Error("profile-inventory-unprepared");
      if (fields.admission.stateRoot !== root || fields.admission.profileBinding.profileId !== profileId) throw new Error("profile-inventory-owner-mismatch");
      assertCredentialStoreOwner(fields.credentials, fields.admission);
      const stopped = prepared.stopped === undefined ? undefined : credentialCopyProcessCustody(input);
      const before = enumerate();
      if (stopped !== undefined) {
        assertCredentialCopyResourcesClosed(before.custody);
        if (canonicalJsonStringify(stopped) !== canonicalJsonStringify(prepared.stopped)) throw new Error("profile-inventory-membership-changed");
      }
      const stable = (value: ReturnType<typeof enumerate>) => ({ ...value, identities: value.identities.filter(entry => entry.path !== join(root, "credentials", "protected.json") && entry.path !== join(root, "credentials")) });
      if (canonicalJsonStringify(stable(before)) !== canonicalJsonStringify(stable(prepared.membership))) throw new Error("profile-inventory-membership-changed");
      const record = fields.operationId === undefined ? fields.credentials.read() : readForErasure(fields.credentials, fields.operationId);
      const inventory = assessCredentialInventory({ profileRoot: root, entriesAbsent: record.entries.ucpathUserId === undefined && record.entries.ucpathPassword === undefined,
        inspectEncrypted: path => inspectCredentialCopy(fields.credentials, path, fields.capturedSecrets),
        backupPaths: [], loginDataPaths: before.loginDataPaths, capturedSecrets: fields.capturedSecrets, capturedSecretsComplete: fields.capturedSecretsComplete });
      const backupPlaintext = [...inventory.backupPlaintext], unknownFormats = [...inventory.unknownFormats, ...before.unsupported];
      const copies = assessProfileCredentialCopies(input.admission, before, prepared.backups,
        { ...fields, containsKey: value => inspectCredentialKeyCopy(fields.credentials, value), keyScanOverlap: 4095,
          inspectEncrypted: path => inspectCredentialCopy(fields.credentials, path, fields.capturedSecrets) }, { kind: "ordinary" });
      backupPlaintext.push(...copies.backupPlaintext); unknownFormats.push(...copies.unknownFormats);
      const after = enumerate();
      if (stopped !== undefined) {
        assertCredentialCopyResourcesClosed(after.custody);
        if (canonicalJsonStringify(stopped) !== canonicalJsonStringify(credentialCopyProcessCustody(input))) throw new Error("profile-inventory-membership-changed");
      }
      if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new Error("profile-inventory-membership-changed");
      return { ...inventory, backupPlaintext, unknownFormats, logoutComplete: inventory.logoutComplete && backupPlaintext.length === 0 && unknownFormats.length === 0 };
    },
  });
}

export function composeStoppedControlCredentialInventory(input: Readonly<{ claim: StoppedControlProfileInventory; hostFacts: HostConfigFacts; clock: Clock }>) {
  const admission = RuntimeAdmission.forStoppedControlInventory(input.claim);
  try {
    const proof = attestStoppedControlCredentials(admission, input.claim, (copies) => composeProfileCredentialMaintenanceInventory({
      machine: admission, admission, hostFacts: input.hostFacts, clock: input.clock,
    }, { kind: "stopped-control", claim: input.claim }, () => admission.assertLive())(undefined, copies));
    return Object.freeze({ proof, dispose() {
      try { releaseStoppedControlCredentialAttestation(proof); admission.release(); }
      catch (error) { throw retainAuthoritySourceClosure([error], { admission: { admission, proof } }); }
    } });
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission });
    try { admission.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
    throw error;
  }
}
