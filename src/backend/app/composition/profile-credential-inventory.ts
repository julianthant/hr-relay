
import { inspectStoppedCanonicalConversion } from "../../storage/configuration/canonical-credential-store.js";
import { prepareStoppedCredentialConversion, releaseStoppedCredentialConversion, type StoppedCredentialCopyInspection } from "../../storage/configuration/credential-conversion.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../../storage/source-closure.js";
import { profileBrowserClosure } from "../../runtime/browser/native-profile-probe.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../storage/source-closure.js';
import { assertRetainedProfileBrowserRoot, inventoryFileIdentity, enumerateProfileCredentialMembership, assertCredentialCopyResourcesClosed, assertRetainedBrowsersClosed, probeRetainedBrowsersClosed } from "../../storage/maintenance/profile-inventory.js";

import { migrationTableNames } from "../../storage/sqlite/migrations.js";
import { readEmergencyFaults } from "../../logs/emergency-faults.js";

import { initialSettingsFileRecord } from "../../../models/config/settings.js";

import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { createHash } from "node:crypto";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { readSettings } from "../../runtime/settings/settings-runtime.js";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { countProfileCredentialLoginRows } from "../../profiles/credential-inventory.js";
import { verifyBackupManifestAtPath, verifyStoppedBackupManifestAtPath } from "../../storage/sqlite/backup-service.js";
import { withAuthorityDatabaseReadOnly } from "../../storage/sqlite/readonly-authority-snapshot.js";

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
    if (overlap > 128 * 1024) throw new Error("profile-inventory-secret-size-invalid");
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

function assessProfileCredentialCopies(admission: RuntimeAdmission, before: ReturnType<typeof enumerateProfileCredentialMembership>,
  backups: readonly Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[], fields: Readonly<{ capturedSecrets: readonly string[];
    capturedSecretsComplete: boolean; containsKey(value: unknown): boolean; readonly keyScanOverlap: number; inspectEncrypted(path: string): Readonly<{ containsUcsd: boolean; containsCaptured: boolean }> }>,
  purpose: CredentialMaintenancePurpose) {
  const root = admission.stateRoot, backupPlaintext: string[] = [], unknownFormats = [...before.unsupported];
  if (purpose.kind === "stopped-control") {
    const issued = requireStoppedControlProfileInventory(purpose.claim);
    if (issued.binding.profileId !== admission.profileBinding.profileId || issued.stateRoot !== root) throw new Error("profile-control-upgrade-inventory-owner-mismatch");
  }
      for (const path of [...before.copies, ...before.backupPaths]) {
        const scanned = scanProfileCredentialCopy(path, fields.capturedSecrets, fields), backup = backups.find(value => value.backupPath === path);
        const suspect = before.suspects.find(value => value.path === path);
        if (backup !== undefined && scanned.digest !== backup.manifest.sha256) throw new Error("profile-inventory-backup-changed");
        if (suspect !== undefined && scanned.digest !== suspect.sha256) throw new Error("profile-inventory-suspect-changed");
        let containsSecret = scanned.containsSecret;
        const enginePath = join(root, "credentials", "duo-webauthn.json");
        const retainedEngine = purpose.kind === "stopped-control" && path === enginePath;
        if (purpose.kind === "ordinary" && path === enginePath) unknownFormats.push(path);
        if (backup === undefined && suspect === undefined && basename(path) !== "Login Data" && !before.unsupported.includes(path)) {
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
        if (backup !== undefined || suspect !== undefined && !suspect.companion) {
          const digest = backup?.manifest.sha256 ?? suspect?.sha256;
          if (digest === undefined) throw new Error("profile-inventory-copy-custody-unproved");
          const copyAdmission = admission.verifiedReadOnlyCopy(path, digest);
          try {
            const schemaVersion = backup?.manifest.schemaVersion ?? AuthorityDatabase.inspectExistingReadOnly(copyAdmission, path).schemaVersion;
            containsSecret ||= withAuthorityDatabaseReadOnly(copyAdmission, path, database => {
              const bytes = credentialSearchBytes(fields.capturedSecrets);
              for (const table of migrationTableNames(schemaVersion)) for (const row of database.prepare(`SELECT * FROM ${table}`).iterate()) {
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



export function composeProfileClosureInventory(input: Readonly<{ admission: RuntimeAdmission; database: AuthorityDatabase; hostFacts: HostConfigFacts; clock: Clock }>) {
  const prepare = async (admission: RuntimeAdmission, custody: ReturnType<AuthorityDatabase["readProfileResourceCustody"]> | ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>) => {
    assertCredentialCopyResourcesClosed(custody);
    const settings = "settingsAuthority" in custody ? custody.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
      : custody.settingsAuthority.record.saved?.settings ?? custody.settingsAuthority.record.initialization.settings.settings
      : readSettings(input.database.authority).settings;
    const config = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
    await probeRetainedBrowsersClosed({ browserClosure: profileBrowserClosure, admission, custody, config,
      clock: input.clock, signal: new AbortController().signal });
    admission.assertReadable();
    enumerateProfileCredentialMembership(admission, custody, config.paths.browserProfileRoot, profileBrowserClosure);
  };
  return Object.freeze({
    async prepare(): Promise<void> {
      input.admission.assertProfileRuntime();
      const custody = input.database.readProfileResourceCustody();
      await prepare(input.admission, custody);
      input.admission.assertProfileRuntime();
      if (canonicalJsonStringify(input.database.readProfileResourceCustody()) !== canonicalJsonStringify(custody)) throw new Error("profile-closure-source-changed");
    },
    async prepareStopped(admission: RuntimeAdmission): Promise<void> {
      admission.assertPendingLogoutSettlementDatabase(join(admission.stateRoot, "state.db"));
      await prepare(admission, AuthorityDatabase.readProfileMaintenanceInventory(admission));
      admission.assertPendingLogoutSettlementDatabase(join(admission.stateRoot, "state.db"));
    },
  });
}

export function composeStoppedControlCredentialInventory(input: Readonly<{ claim: StoppedControlProfileInventory; hostFacts: HostConfigFacts; clock: Clock }>) {
  const admission = RuntimeAdmission.forStoppedControlInventory(input.claim);
  try {
    const source = admission.readStoppedControlCredentialInventorySource(input.claim);
    const assess = (copies: StoppedCredentialCopyInspection) => {
      const observe = () => {
        source.revalidateSource();
        const plan = source.pendingPlan();
        if (plan !== undefined) inspectStoppedCanonicalConversion(admission, input.claim, plan);
        const stages = plan === undefined ? [] : ["protected", "chatgpt"].map(kind => join(admission.stateRoot, "credentials", `.${source.binding.profileId}.${plan.operation.operationId}.${kind}.canonical.tmp`));
        const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
        assertCredentialCopyResourcesClosed(facts);
        const settings = facts.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
          : facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
        const config = resolveConfigWithProvenance(settings, input.hostFacts, input.clock,
          { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
        assertRetainedBrowsersClosed(admission, facts, config, profileBrowserClosure);
        const membership = enumerateProfileCredentialMembership(admission, facts, config.paths.browserProfileRoot, profileBrowserClosure, undefined, stages);
        const backups = membership.manifests.map(path => verifyStoppedBackupManifestAtPath(admission, path));
        if (membership.backupPaths.length !== backups.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("credential-maintenance-backup-membership-unproved");
        const currentRecord = join(admission.stateRoot, "credentials", "chatgpt-account.json");
        const assessment = assessProfileCredentialCopies(admission, { ...membership, copies: membership.copies.filter(path => path !== currentRecord) }, backups, copies,
          { kind: "stopped-control", claim: input.claim });
        if (assessment.backupPlaintext.length !== 0 || assessment.unknownFormats.length !== 0) throw new Error("credential-maintenance-copy-capture-incomplete");
        const login = countProfileCredentialLoginRows(membership.loginDataPaths);
        if (login === "unreadable" || typeof login === "number" && login > 0) throw new Error("credential-maintenance-login-copy-present");
        const database = join(admission.stateRoot, "state.db");
        for (const suffix of ["", "-wal", "-shm"]) {
          const path = `${database}${suffix}`;
          if (lstatSync(path, { throwIfNoEntry: false }) !== undefined && scanProfileCredentialCopy(path, copies.capturedSecrets, copies).containsSecret) throw new Error("credential-maintenance-live-authority-copy-present");
        }
        withAuthorityDatabaseReadOnly(admission, database, db => {
          for (const table of migrationTableNames(source.schemaVersion)) for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
            if (containsCredentialValue(row, copies.capturedSecrets) || copies.containsKey(row)) throw new Error("credential-maintenance-live-authority-copy-present");
          }
        });
        source.revalidateSource();
        const credentials = join(admission.stateRoot, "credentials"), protectedPath = join(credentials, "protected.json");
        return canonicalJsonStringify({ ...membership,
          copies: membership.copies.filter(path => path !== currentRecord),
          identities: membership.identities.filter(entry => entry.path !== currentRecord && entry.path !== protectedPath && !stages.includes(entry.path)).map(entry =>
            entry.path === credentials ? { path: entry.path, directory: entry.directory, device: entry.device, inode: entry.inode, mode: entry.mode } : entry),
          binding: source.binding });
      };
      const before = observe();
      const revalidate = () => { if (observe() !== before) throw new Error("credential-maintenance-inventory-changed"); };
      return { revalidateBeforeKeyIntent: revalidate, revalidate: () => { revalidate(); return revalidate; } };
    };
    const proof = prepareStoppedCredentialConversion(admission, input.claim, assess);
    return Object.freeze({ proof, dispose() {
      try { releaseStoppedCredentialConversion(proof); admission.release(); }
      catch (error) { throw retainAuthoritySourceClosure([error], { admission: { admission, proof } }); }
    } });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); throw error; }
    try { admission.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
    throw error;
  }
}
