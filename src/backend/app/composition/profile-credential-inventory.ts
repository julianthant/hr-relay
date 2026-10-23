import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames, deriveAuthorityUpgradePlanDigest } from "../../storage/sqlite/migrations.js";
import { workerProfileDirectory } from "../../runtime/browser/browser-session-factory.js";
import { CredentialLockRecordSchema, readPrivateFile } from "../../storage/configuration/credential-safe-file.js";
import { readEmergencyFaults } from "../../logs/emergency-faults.js";
import type { CredentialInitializationCopyInspection } from "../../storage/configuration/credential-store.js";
import type { CredentialEraseInput, CredentialStore } from "../../../models/config/credential-store.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import type { SignUpOperation } from "../../../models/profiles/profile.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { createHash } from "node:crypto";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { readSettings } from "../../runtime/settings/settings-runtime.js";
import { inspectCredentialKeyCopy, inspectCredentialCopy, assertCredentialStoreOwner, readForErasure } from "../../storage/configuration/credential-store.js";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { assessCredentialInventory, countProfileCredentialLoginRows, type CredentialInventory } from "../../profiles/credential-inventory.js";
import { verifyBackupManifestAtPath, verifyStoppedBackupManifestAtPath } from "../../storage/sqlite/backup-service.js";
import { withAuthorityDatabaseReadOnly } from "../../storage/sqlite/readonly-authority-snapshot.js";
import { observeRuntimeLockSnapshot, inspectRuntimeProcessOrphans } from "../../storage/sqlite/runtime-process-locks.js";
import { ProfileBrowserRootRefusalError, type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

export function assertProfileBrowserRoot(admissionInput: RuntimeAdmission, path: string): void {
  const admission = requireRuntimeAdmission(admissionInput);
  admission.assertProfileRuntime();
  assertRetainedProfileBrowserRoot(admission, path);
}

function assertRetainedProfileBrowserRoot(admissionInput: RuntimeAdmission, path: string): void {
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

function inventoryFileIdentity(path: string) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || info.isFile() && info.nlink !== 1
    || process.getuid !== undefined && info.uid !== process.getuid() || (info.mode & 0o022) !== 0) throw new Error("profile-inventory-path-unsafe");
  return { path, directory: info.isDirectory(), device: info.dev, inode: info.ino, size: info.size,
    mode: info.mode, modified: info.mtimeMs, changed: info.ctimeMs };
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

export function scanProfileCredentialCopy(path: string, capturedSecrets: readonly string[], privateKeyScan?: Readonly<{ containsKey(value: unknown): boolean; keyScanOverlap: number }>): { digest: string; containsSecret: boolean } {
  const secrets = credentialSearchBytes(capturedSecrets);
  const before = inventoryFileIdentity(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
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
  } finally { closeSync(fd); }
}

type CredentialMembershipCustody = Pick<ReturnType<AuthorityDatabase["readProfileResourceCustody"]>, "slots" | "reservations" | "browsers" | "configSnapshots" | "artifactReferences" | "upgrades">;
function enumerateProfileCredentialMembership<Custody extends CredentialMembershipCustody>(admission: RuntimeAdmission, custody: Custody, savedBrowserRoot: string, ownedWriter?: Readonly<{ acquisitionId: string; pid: number }>) {
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

function assessProfileCredentialCopies(admission: RuntimeAdmission, before: ReturnType<typeof enumerateProfileCredentialMembership>,
  backups: readonly Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[], fields: Readonly<{ capturedSecrets: readonly string[];
    capturedSecretsComplete: boolean; containsKey(value: unknown): boolean; readonly keyScanOverlap: number; inspectEncrypted(path: string): Readonly<{ containsUcsd: boolean; containsCaptured: boolean }> }>) {
  const root = admission.stateRoot, backupPlaintext: string[] = [], unknownFormats = [...before.unsupported];
      for (const path of [...before.copies, ...before.backupPaths]) {
        const scanned = scanProfileCredentialCopy(path, fields.capturedSecrets, fields), backup = backups.find(value => value.backupPath === path);
        if (backup !== undefined && scanned.digest !== backup.manifest.sha256) throw new Error("profile-inventory-backup-changed");
        let containsSecret = scanned.containsSecret;
        if (backup === undefined && basename(path) !== "Login Data" && !before.unsupported.includes(path)) {
          try {
            const bootLog = path === join(root, "logs", "boot.jsonl");
            if (bootLog && readEmergencyFaults(root).state !== "present") throw new Error("profile-inventory-log-unavailable");
            const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            let bytes: Buffer;
            try {
              const info = fstatSync(descriptor), limit = bootLog ? 5 * 1024 * 1024
                : dirname(path) === join(root, "credentials") ? Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 : 16 * 1024 * 1024;
              if (!info.isFile() || info.size > limit) throw new Error("profile-inventory-copy-size-invalid");
              bytes = Buffer.alloc(info.size + 1);
              let count = 0;
              while (count < bytes.length) {
                const size = readSync(descriptor, bytes, count, bytes.length - count, count);
                if (size === 0) break;
                count += size;
              }
              if (count !== info.size) throw new Error("profile-inventory-copy-changed");
              bytes = bytes.subarray(0, count);
            } finally { closeSync(descriptor); }
            if (createHash("sha256").update(bytes).digest("hex") !== scanned.digest) throw new Error("profile-inventory-copy-changed");
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            const documents: unknown[] = bootLog ? text.trimEnd().split("\n").map(line => JSON.parse(line) as unknown) : [JSON.parse(text) as unknown];
            if (documents.some(value => value === null || typeof value !== "object" || Array.isArray(value))) throw new Error("profile-inventory-json-unsupported");
            if (documents.some(value => typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === 4)) {
              const inspected = fields.inspectEncrypted(path);
              containsSecret ||= inspected.containsUcsd || inspected.containsCaptured;
            }
            containsSecret ||= documents.some(value => containsCredentialValue(value, fields.capturedSecrets) || fields.containsKey(value));
            for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
              if (containsCredentialValue(JSON.parse(token[0]) as unknown, fields.capturedSecrets) || fields.containsKey(JSON.parse(token[0]) as unknown)) containsSecret = true;
            }
          } catch { unknownFormats.push(path); }
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
        if (!fields.capturedSecretsComplete) unknownFormats.push(path);
      }
  return { backupPlaintext, unknownFormats };
}

function credentialCopyProcessCustody(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; clock: Clock }>) {
  const { machine, admission } = input;
  machine.assertLive(); admission.assertLive();
  const installation = machine.readInstallationContext();
  if (installation === undefined) throw new Error("credential-maintenance-installation-required");
  if (admission.profileBinding.installationId !== installation.locator.installationId
    || admission.stateRoot !== join(machine.stateRoot, "profiles", admission.profileBinding.profileId)) throw new Error("profile-inventory-owner-mismatch");
  const processLockRoot = join(installation.workspace, rebuildRuntimeIsolation.processLockRoot);
  machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
  const locks = observeRuntimeLockSnapshot({ processLockRoot,
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")) }, input.clock);
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (Object.entries(locks.processLocks).some(([name, state]) => name !== "server" && state.state !== "stopped")
    || orphans.staleWorkerRecords > 0) throw new Error("credential-maintenance-process-custody-unproved");
  return { processLocks: locks.processLocks, runtimeGeneration: locks.runtimeGeneration, orphans };
}

function assertCredentialCopyResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  if (facts.reservations.some(reservation => reservation.state === "pending")
    || facts.slots.some(slot => slot.retiredAt === null && !facts.leases.some(lease => lease.workerId === slot.workerId))
    || facts.leases.some(lease => !facts.slots.some(slot => slot.workerId === lease.workerId))
    || facts.writeIntents.some(intent => intent.status !== "committed" && intent.status !== "observed-present") || facts.pendingArtifacts.length > 0
    || facts.leases.some(lease => lease.lifecycle.state !== "stopped") || facts.browsers.some(browser => browser.health !== "closed")
    || facts.duoLeases.some(lease => lease.state === "held") || facts.controls.some(control => control.auditedAt === undefined)
    || facts.runs.some(run => run.lifecycle.state !== "terminal")) throw new Error("credential-maintenance-custody-unproved");
}

function assertCredentialBackupBinding(admission: RuntimeAdmission, backup: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>,
  upgrades: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>["upgrades"]) {
  const { manifest } = backup;
  if (manifest.profileId !== admission.profileBinding.profileId || manifest.installationId !== admission.profileBinding.installationId
    || manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))) throw new Error("profile-inventory-backup-binding-mismatch");
  if (manifest.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) return;
  if (manifest.schemaVersion !== 7) throw new Error("profile-inventory-backup-binding-mismatch");
  const matching = upgrades.filter(record => record.phase !== "baseline" && (record.backup.manifestPath === backup.manifestPath
    || record.backup.sha256 === manifest.sha256 || record.upgradeId === manifest.authorityContentFingerprint));
  const record = matching[0];
  if (matching.length !== 1 || record?.phase !== "settled" || record.fromSchemaVersion !== 7
    || record.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || record.backup.manifestPath !== backup.manifestPath
    || record.backup.sha256 !== manifest.sha256 || record.backup.authorityGeneration !== manifest.authorityGeneration
    || record.upgradeId !== manifest.authorityContentFingerprint
    || record.planDigest !== deriveAuthorityUpgradePlanDigest(7, manifest.authorityContentFingerprint)) throw new Error("profile-inventory-backup-upgrade-unproved");
}

function composeProfileCredentialMaintenanceInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock }>, authorize: () => void) {
  return (writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection): Readonly<{ revalidate(): () => void; revalidateBeforeKeyIntent(): void }> => {
    const { machine, admission } = input;
    authorize();
    const registry = canonicalJsonStringify(machine.readProfileRegistry());
    const installation = machine.readInstallationContext();
    if (installation === undefined) throw new Error("credential-maintenance-installation-required");
    const processLockRoot = join(installation.workspace, rebuildRuntimeIsolation.processLockRoot);
    machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
    const enumerate = () => {
      admission.assertLive();
      machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
      const processCustody = credentialCopyProcessCustody(input);
      const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
      assertCredentialCopyResourcesClosed(facts);
      const settings = facts.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
        : facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
      const savedBrowserRoot = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
        { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config.paths.browserProfileRoot;
      const membership = enumerateProfileCredentialMembership(admission, facts, savedBrowserRoot, writer);
      const backups = membership.manifests.map(manifest => verifyStoppedBackupManifestAtPath(admission, manifest,
        AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))));
      if (membership.backupPaths.length !== backups.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("credential-maintenance-backup-membership-unproved");
      const assessment = assessProfileCredentialCopies(admission, membership, backups, copies);
      if (assessment.backupPlaintext.length > 0 || assessment.unknownFormats.length > 0) throw new Error("credential-maintenance-copy-capture-incomplete");
      const login = countProfileCredentialLoginRows(membership.loginDataPaths);
      if (login === "unreadable" || typeof login === "number" && login > 0) throw new Error("credential-maintenance-login-copy-present");
      const stable = { ...membership, ...processCustody, identities: membership.identities.filter(entry => entry.path !== join(admission.stateRoot, "credentials")
        && entry.path !== join(admission.stateRoot, "credentials", "protected.json") && entry.path !== join(admission.stateRoot, "credentials", ".protected.lock")) };
      return canonicalJsonStringify(stable);
    };
    const before = enumerate();
    const root = admission.stateRoot;
    const physicalMembership = (): string => {
      const entries: (ReturnType<typeof inventoryFileIdentity> | { path: string; absent: true })[] = [];
      const visit = (path: string): void => {
        if (lstatSync(path, { throwIfNoEntry: false }) === undefined) { entries.push({ path, absent: true }); return; }
        const entry = inventoryFileIdentity(path); entries.push(entry);
        if (entry.directory) for (const name of readdirSync(path).sort()) visit(join(path, name));
      };
      for (const path of [root, processLockRoot]) visit(path);
      return canonicalJsonStringify(entries);
    };
    const beforeKeyIntent = physicalMembership();
    return Object.freeze({ revalidateBeforeKeyIntent: () => {
      if (physicalMembership() !== beforeKeyIntent) throw new Error("credential-maintenance-inventory-changed");
    }, revalidate: () => {
      authorize();
      if (canonicalJsonStringify(machine.readProfileRegistry()) !== registry || enumerate() !== before) throw new Error("credential-maintenance-inventory-changed");
      const publicationMembership = physicalMembership();
      return () => { if (physicalMembership() !== publicationMembership) throw new Error("credential-maintenance-inventory-changed"); };
    } });
  };
}

export function composeProfileCredentialInitializationInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock }>) {
  return (operation: SignUpOperation, writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection) =>
    {
      let current = operation;
      const inventory = composeProfileCredentialMaintenanceInventory(input, () => { input.machine.assertProfileCredentialInitialization(input.admission, current); })(writer, copies);
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
      const inventory = composeProfileCredentialMaintenanceInventory({ ...input, admission }, () => admission.assertLive())(writer, copies);
      return Object.freeze({ revalidate: inventory.revalidate, dispose: () => admission.release() });
    } catch (error) { admission.release(); throw error; }
  };
}


export function composeProfileCredentialInventory(input: Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; database: AuthorityDatabase; hostFacts: HostConfigFacts; clock: Clock }>) {
  const root = input.admission.stateRoot, profileId = input.admission.profileBinding.profileId;
  const enumerate = () => input.database.withAuthorityReadSnapshot(() => {
    input.admission.assertLive();
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
      const stopped = backups.some(backup => backup.manifest.schemaVersion === 7) ? credentialCopyProcessCustody(input) : undefined;
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
          inspectEncrypted: path => inspectCredentialCopy(fields.credentials, path, fields.capturedSecrets) });
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
