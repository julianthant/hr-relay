import { retireOrphanVerification } from "../../storage/maintenance/orphan-verification-retirement.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../storage/sqlite/migrations.js";
import { requireLifecycleApplied, RunRecordService } from "../../runs/lifecycle/run-record-service.js";
import { createChatGptAccountService } from "../../accounts/chatgpt-account-service.js";
import { composeProfileSettings } from "./dashboard/settings.js";
import { activeSettingsConfig, activeSettingsRuntimeIdentity } from "../../runtime/settings/settings-runtime.js";
import { workerProfileDirectory } from "../../runtime/browser/browser-session-factory.js";
import { createProfileSession, ProfileSessionRefusedError } from "../../profiles/profile-session.js";
import { readEmergencyFaults } from "../../logs/emergency-faults.js";
import type { CredentialStoreHooks } from "../../storage/configuration/credential-store.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import { createHash, randomUUID } from "node:crypto";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { readBootSettings, readSettings } from "../../runtime/settings/settings-runtime.js";

import { SETTINGS_CATALOG } from "../../../models/config/catalog.js";
import { assertCredentialStoreOwner, readForErasure, ChatGptCredentialError, createChatGptCredentialRepository, createCredentialStore } from "../../storage/configuration/credential-store.js";
import { protectedSettingsReadback } from "../../../models/config/protected-settings.js";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { assessCredentialInventory, type CredentialInventory } from "../../profiles/credential-inventory.js";
import { verifyBackupManifestAtPath } from "../../storage/sqlite/backup-service.js";
import { withAuthorityDatabaseReadOnly } from "../../storage/sqlite/readonly-authority-snapshot.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../models/config/authority.js";
import type { DashboardWorkerProcessSupervisor } from "../../runtime/workers/worker-supervisor.js";
import { workerPoolMember } from "../../../models/run/worker-slot.js";
import { observeRuntimeLockSnapshot, inspectRuntimeProcessOrphans, type ProcessIdentityObserver } from "../../storage/sqlite/runtime-process-locks.js";
import { z } from "zod";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { acquireRecoveryRuntimeRestore, ProfileBrowserRootRefusalError, type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import { descriptorSetHash, DESCRIPTORS, SERVER_REGISTRY } from "../registries/workflow-registry.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import { IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import {
  AuthorityDatabase,
  OfflineAuthorityRestoreService,
  OfflineRestoreFailure,
  RecoveryStopProofStore,
  doctorAuthorityStorage,
  summarizeSpanAuthorityReconciliation,
} from "../../storage/sqlite/index.js";
import { settleInterruptedAuthorityRestore } from "../../storage/sqlite/offline-restore.js";
import { acquireRuntimeRestoreAdmission, type RestoreAdmissionHandle } from "../../storage/sqlite/runtime-process-locks.js";
import type {
  OfflineRestoreReport,
  RecoveryRuntimeLockSnapshot,
  StorageDoctorReport,
} from "../../storage/sqlite/recovery-contracts.js";
import { createRunQueueProjection } from "../../runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../storage/sqlite/transaction-history.js";
import {
  OfflineSpanRootRepairService,
  type SpanRootRepairReport,
} from "../../runs/recovery/span-root-repair.js";

export interface StorageCommandOutcome {
  readonly output: string;
  readonly exitCode: number;
}

export class RuntimeCustodyUncertainError extends AggregateError {
  readonly code = "RUNTIME_CUSTODY_UNCERTAIN";
  constructor(causes: readonly unknown[]) {
    super(causes, ERROR_CATALOG.RUNTIME_CUSTODY_UNCERTAIN.text, { cause: causes[0] });
    this.name = "RuntimeCustodyUncertainError";
  }
}

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

export function composeProfileActivity(input: Readonly<{
  admission: RuntimeAdmission; database: AuthorityDatabase; processLockRoot: string; clock: Clock;
  supervisor: Pick<DashboardWorkerProcessSupervisor, "memberEvidence" | "drainOwnedChildren"> | { readonly state: "not-constructed" };
  lifecycle: Pick<RunRecordService, "read" | "transition">;
  observeProcessIdentity?: ProcessIdentityObserver;
}>) {
  const profileId = input.admission.profileBinding.profileId;
  let drain: { state: "pending"; completion: Promise<void> } | { state: "complete" } | { state: "failed"; error: unknown } | undefined;
  const observe = () => {
    input.admission.assertLive();
    const before = input.database.readProfileResourceCustody();
    const hooks = { observeProcessIdentity: input.observeProcessIdentity };
    const locks = observeRuntimeLockSnapshot({ processLockRoot: input.processLockRoot,
      sourceDatabaseIdentity: input.database.getSourceDatabaseIdentity() }, input.clock, hooks);
    const orphans = inspectRuntimeProcessOrphans(input.processLockRoot, hooks);
    if (orphans.staleWorkerRecords > 0) throw new Error("profile-worker-process-closure-unproved");
    for (const browser of before.browsers) {
      if (!before.slots.some(slot => slot.workerId === browser.workerId)) throw new Error("profile-browser-membership-unavailable");
    }
    let busy = Object.entries(locks.processLocks).some(([name, state]) => name !== "server" && state.state === "active");
    for (const slot of before.slots) {
      if (slot.reservationCommandId !== null) busy = true;
      const lease = before.leases.find(value => value.workerId === slot.workerId);
      if (lease === undefined && slot.retiredAt === null) throw new Error("profile-worker-lifetime-unavailable");
      if (lease !== undefined && lease.lifecycle.state !== "stopped") busy = true;
      if (slot.retiredAt !== null) continue;
      if ("state" in input.supervisor) throw new Error("profile-worker-supervisor-custody-unavailable");
      const evidence = input.supervisor.memberEvidence(workerPoolMember(slot));
      if (lease !== undefined && evidence === undefined) throw new Error("profile-worker-supervisor-custody-unavailable");
      if (evidence !== undefined && (evidence.state !== "exited" || evidence.reportedBy !== "os")) busy = true;
    }
    if (before.leases.some(lease => !before.slots.some(slot => slot.workerId === lease.workerId))) throw new Error("profile-worker-membership-unavailable");
    busy ||= before.browsers.some(browser => browser.health !== "closed")
      || before.controls.some(control => control.auditedAt === undefined)
      || before.runs.some(run => run.lifecycle.state !== "terminal")
      || before.writeIntents.some(intent => intent.status !== "committed" && intent.status !== "observed-present")
      || before.duoLeases.some(lease => lease.state === "held") || before.pendingArtifacts.length > 0;
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

export function scanProfileCredentialCopy(path: string, capturedSecrets: readonly string[]): { digest: string; containsSecret: boolean } {
  const secrets = credentialSearchBytes(capturedSecrets);
  const before = inventoryFileIdentity(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.device || opened.ino !== before.inode || opened.size !== before.size) throw new Error("profile-inventory-file-changed");
    const digest = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
    const overlap = Math.max(0, ...secrets.map(secret => secret.length - 1));
    if (overlap > 64 * 1024) throw new Error("profile-inventory-secret-size-invalid");
    let tail = Buffer.alloc(0), containsSecret = false, count = 0;
    for (;;) {
      const size = readSync(fd, chunk, 0, chunk.length, null);
      if (size === 0) break;
      count += size;
      const bytes = chunk.subarray(0, size);
      digest.update(bytes);
      const scan = Buffer.concat([tail, bytes]);
      containsSecret ||= secrets.some(secret => secret.length > 0 && scan.includes(secret));
      tail = Buffer.from(scan.subarray(Math.max(0, scan.length - overlap)));
    }
    if (count !== before.size || canonicalJsonStringify(before) !== canonicalJsonStringify(inventoryFileIdentity(path))) throw new Error("profile-inventory-file-changed");
    return { digest: digest.digest("hex"), containsSecret };
  } finally { closeSync(fd); }
}

export function composeProfileCredentialInventory(input: Readonly<{ admission: RuntimeAdmission; database: AuthorityDatabase; hostFacts: HostConfigFacts; clock: Clock }>) {
  const root = input.admission.stateRoot, profileId = input.admission.profileBinding.profileId;
  const enumerate = () => {
    input.admission.assertLive();
    const custody = input.database.readProfileResourceCustody();
    const saved = input.database.withAuthorityReadSnapshot(() => readSettings(input.database.authority));
    const savedBrowserRoot = resolveConfigWithProvenance(saved.settings, input.hostFacts, input.clock,
      { stateRoot: root, artifactRoot: input.admission.artifactRoot }).config.paths.browserProfileRoot;
    const browserRootPaths = [...new Set([...custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot), savedBrowserRoot])];
    if (browserRootPaths.length === 0) throw new Error("profile-inventory-config-unavailable");
    for (const path of browserRootPaths) assertRetainedProfileBrowserRoot(input.admission, path);
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
      input.admission.assertStateRoot(path);
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
        if (parts.length !== 2 || !["protected.json", "chatgpt-account.json", "duo-webauthn.json"].includes(parts[1] ?? "")
          && !/^\.protected\.[0-9a-f-]{36}\.tmp$/u.test(parts[1] ?? "")) throw new Error("profile-inventory-credential-unowned");
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
    if (input.admission.artifactRoot !== join(root, "artifacts")) throw new Error("profile-inventory-artifact-root-unavailable");
    for (const ref of custody.artifactReferences) {
      if (!identities.some(entry => entry.path === join(root, "artifacts", `${ref.sha256}.artifact`))) throw new Error("profile-inventory-artifact-missing");
    }
    return { custody, savedBrowserRoot, identities, copies, loginDataPaths, unsupported, backupPaths, manifests };
  };
  let prepared: { membership: ReturnType<typeof enumerate>; backups: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[] } | undefined;
  return Object.freeze({
    async prepare(): Promise<void> {
      const before = enumerate();
      const backups: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[] = [];
      for (const path of before.manifests) {
        const verified = await verifyBackupManifestAtPath(input.admission, path, input.database.getSourceDatabaseIdentity());
        if (verified.manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || verified.manifest.profileId !== profileId
          || verified.manifest.installationId !== input.admission.profileBinding.installationId) throw new Error("profile-inventory-backup-binding-mismatch");
        backups.push(verified);
      }
      if (before.backupPaths.length !== backups.length || before.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("profile-inventory-backup-unverified");
      const after = enumerate();
      if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new Error("profile-inventory-membership-changed");
      prepared = { membership: after, backups };
    },
    assess(fields: Readonly<{ admission: RuntimeAdmission; credentials: CredentialStore; operationId?: string;
      capturedSecrets: readonly string[]; capturedSecretsComplete: boolean }>): CredentialInventory {
      if (prepared === undefined) throw new Error("profile-inventory-unprepared");
      if (fields.admission.stateRoot !== root || fields.admission.profileBinding.profileId !== profileId) throw new Error("profile-inventory-owner-mismatch");
      assertCredentialStoreOwner(fields.credentials, fields.admission);
      const before = enumerate();
      const stable = (value: ReturnType<typeof enumerate>) => ({ ...value, identities: value.identities.filter(entry => entry.path !== join(root, "credentials", "protected.json") && entry.path !== join(root, "credentials")) });
      if (canonicalJsonStringify(stable(before)) !== canonicalJsonStringify(stable(prepared.membership))) throw new Error("profile-inventory-membership-changed");
      const record = fields.operationId === undefined ? fields.credentials.read() : readForErasure(fields.credentials, fields.operationId);
      const inventory = assessCredentialInventory({ profileRoot: root, entriesAbsent: record.entries.ucpathUserId === undefined && record.entries.ucpathPassword === undefined,
        backupPaths: [], loginDataPaths: before.loginDataPaths, capturedSecrets: fields.capturedSecrets, capturedSecretsComplete: fields.capturedSecretsComplete });
      const backupPlaintext = [...inventory.backupPlaintext], unknownFormats = [...inventory.unknownFormats, ...before.unsupported];
      for (const path of [...before.copies, ...before.backupPaths]) {
        const scanned = scanProfileCredentialCopy(path, fields.capturedSecrets), backup = prepared.backups.find(value => value.backupPath === path);
        if (backup !== undefined && scanned.digest !== backup.manifest.sha256) throw new Error("profile-inventory-backup-changed");
        let containsSecret = scanned.containsSecret;
        if (backup === undefined && basename(path) !== "Login Data" && !before.unsupported.includes(path)) {
          try {
            const bootLog = path === join(root, "logs", "boot.jsonl");
            if (bootLog && readEmergencyFaults(root).state !== "present") throw new Error("profile-inventory-log-unavailable");
            const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            let bytes: Buffer;
            try {
              const info = fstatSync(descriptor), limit = bootLog ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
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
            containsSecret ||= documents.some(value => containsCredentialValue(value, fields.capturedSecrets));
            for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
              if (containsCredentialValue(JSON.parse(token[0]) as unknown, fields.capturedSecrets)) containsSecret = true;
            }
          } catch { unknownFormats.push(path); }
        }
        if (backup !== undefined) {
          const copyAdmission = input.admission.verifiedReadOnlyCopy(path, backup.manifest.sha256);
          try {
            containsSecret ||= withAuthorityDatabaseReadOnly(copyAdmission, path, database => {
              const bytes = credentialSearchBytes(fields.capturedSecrets);
              for (const table of AUTHORITY_TABLE_REGISTRY) for (const row of database.prepare(`SELECT * FROM ${table.name}`).iterate()) {
                for (const [column, value] of Object.entries(row)) {
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
      if (canonicalJsonStringify(before) !== canonicalJsonStringify(enumerate())) throw new Error("profile-inventory-membership-changed");
      return { ...inventory, backupPlaintext, unknownFormats, logoutComplete: inventory.logoutComplete && backupPlaintext.length === 0 && unknownFormats.length === 0 };
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
  machine.assertProfileErasureJournal(admission, join(machine.stateRoot, "machine", "erasures", `${binding.profileId}.json`));
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
    return Object.freeze({ admission, credentials: input.credentials, database, account, accountAuthority, settings, protectedSecrets, assertCurrent, resolveSettings });
  } catch (error) {
    try { database.close(); }
    catch (closeError) { throw new RuntimeCustodyUncertainError([error, closeError]); }
    throw error;
  }
}

export function composeProfileRuntime(input: Readonly<{
  admission: RuntimeAdmission; hostFacts: HostConfigFacts; clock: Clock; processLockRoot: string;
  credentialHooks?: CredentialStoreHooks;
}>) {
  const machine = requireRuntimeAdmission(input.admission);
  type Context = ReturnType<typeof composeSelectedProfileStorage>;
  type Preparation = { state: "pending"; completion: Promise<void> } | { state: "ready" } | { state: "failed"; error: unknown };
  type Supervisor = Pick<DashboardWorkerProcessSupervisor, "memberEvidence" | "drainOwnedChildren">;
  type Supervision = { state: "not-constructed" } | { state: "constructing" } | { state: "bound"; owner: Supervisor };
  type Owned = { supervision: Supervision; admission: RuntimeAdmission; credentials: CredentialStore; context?: Context; activity?: ReturnType<typeof composeProfileActivity>;
    inventory?: ReturnType<typeof composeProfileCredentialInventory>; preparation?: Preparation; state: "open" | "closing" | "closed" };
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
      processLockRoot: input.processLockRoot, clock: input.clock, supervisor: entry.supervision.state === "bound" ? entry.supervision.owner : entry.supervision,
      lifecycle: new RunRecordService({ database: context.database, clock: input.clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("profile custody cannot enqueue runs"); } }) });
    entry.inventory ??= composeProfileCredentialInventory({ admission: entry.admission, database: context.database, hostFacts: input.hostFacts, clock: input.clock });
    return entry;
  };
  const prepareClosure = (profileId: string): void => {
    const entry = resources.get(profileId)?.ordinary;
    if (entry?.activity === undefined || entry.context === undefined || entry.inventory === undefined) throw new Error("profile-resource-custody-unavailable");
    if (entry.preparation !== undefined) return;
    entry.activity.requestCancellation(profileId);
    const completion = (async () => {
      await entry.activity!.awaitCancellation();
      if (entry.activity!.hasUnquiescedWork(profileId)) { delete entry.preparation; return; }
      await entry.context!.account.close();
      await entry.inventory!.prepare();
      entry.preparation = { state: "ready" };
    })();
    entry.preparation = { state: "pending", completion };
    void completion.catch(error => { entry.preparation = { state: "failed", error }; });
  };
  const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine,
    credentialsFor: (admission, purpose) => {
      const profileId = admission.profileBinding.profileId, entry = resources.get(profileId) ?? {};
      const current = entry[purpose];
      if (current?.admission === admission) { assertCredentialStoreOwner(current.credentials, admission); return current.credentials; }
      if (purpose === "ordinary" && entry.ordinary?.context !== undefined && entry.ordinary.state !== "closed") throw new Error("profile-resource-custody-unavailable");
      const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
        erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${profileId}.json`), hooks: input.credentialHooks });
      assertCredentialStoreOwner(credentials, admission);
      if (purpose === "ordinary") entry.ordinary = { admission, credentials, supervision: { state: "not-constructed" }, state: "open" };
      else entry.settlement = { admission, credentials };
      resources.set(profileId, entry);
      return credentials;
    },
    settings: { read: () => contextFor().settings.read() },
    account: { readAuthority: admission => contextFor(admission).accountAuthority.readAuthority(admission),
      revalidateAuthority: (capture, admission) => contextFor(admission).accountAuthority.revalidateAuthority(capture, admission) },
    sessionChange: profileId => resources.get(profileId)?.ordinary?.context !== undefined && resources.get(profileId)?.ordinary?.state !== "closed"
      ? { state: "refused", code: "PROFILE_TRANSITION_BLOCKED", message: ERROR_CATALOG.PROFILE_TRANSITION_BLOCKED.text } : { state: "closed" },
    prepareLogout: (profileId, admission) => { initializeOwners(profileId, admission); },
    activity: {
      hasUnquiescedWork: profileId => {
        const entry = resources.get(profileId)?.ordinary;
        if (entry?.activity === undefined) throw new Error("profile-resource-custody-unavailable");
        if (entry.preparation?.state === "failed") throw entry.preparation.error;
        return entry.activity.hasUnquiescedWork(profileId) || entry.preparation?.state !== "ready";
      },
      requestCancellation: prepareClosure,
    },
    credentialInventory: fields => {
      const entry = resources.get(fields.profileId)?.ordinary;
      if (entry?.inventory === undefined || entry.preparation?.state !== "ready") throw new Error("profile-inventory-unprepared");
      return entry.inventory.assess(fields);
    },
    closeStorage: (profileId, admission) => {
      const entry = resources.get(profileId)?.ordinary;
      if (entry === undefined || entry.admission !== admission) {
        if (entry?.context !== undefined && entry.state !== "closed") throw new RuntimeCustodyUncertainError([new Error("profile-resource-owner-mismatch")]);
        return;
      }
      if (entry.context !== undefined && entry.state !== "closed") {
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
      for (const [profileId, entry] of resources) if (entry.ordinary?.context !== undefined && entry.ordinary.state !== "closed") prepareClosure(profileId);
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
    async awaitClosurePreparation(profileId: string): Promise<void> {
      const entry = resources.get(profileId)?.ordinary;
      if (entry?.preparation?.state === "pending") await entry.preparation.completion;
      if (entry?.preparation?.state === "failed") throw entry.preparation.error;
      if (entry?.preparation?.state !== "ready") throw new Error("profile-work-drain-unproved");
    },
    async close(): Promise<void> {
      beginClose();
      for (const [profileId, entry] of resources) {
        const ordinary = entry.ordinary;
        if (ordinary?.context === undefined || ordinary.state === "closed") continue;
        prepareClosure(profileId);
        if (ordinary.preparation?.state === "pending") {
          try { await ordinary.preparation.completion; }
          catch (error) { throw new RuntimeCustodyUncertainError([error]); }
        }
        if (ordinary.preparation?.state !== "ready") throw new RuntimeCustodyUncertainError([new Error("profile-resource-closure-unproved")]);
        try { ordinary.context.database.close(); ordinary.state = "closed"; }
        catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      }
      try { session.close(); }
      catch (error) { throw new RuntimeCustodyUncertainError([error]); }
    },
  });
}

export function restoreFailureDisposition(error: unknown): Readonly<{
  heading:
    | "authority restore REFUSED"
    | "authority restore COMPANION-STATE FAILURE"
    | "authority restore AUTHORITY-STATE UNCERTAIN"
    | "authority restore POST-SWAP FAILURE";
  authorityLine: string;
}> {
  if (error instanceof OfflineRestoreFailure && error.authorityState === "replaced") {
    return Object.freeze({
      heading: "authority restore POST-SWAP FAILURE",
      authorityLine: "the authority database was replaced; inspect the post-swap failure before restarting runtime",
    });
  }
  if (error instanceof OfflineRestoreFailure && error.authorityState === "companion-state-uncertain") {
    return Object.freeze({
      heading: "authority restore COMPANION-STATE FAILURE",
      authorityLine: "the authority database was not replaced, but live WAL/SHM rollback is unproven; inspect recovery artifacts before restarting runtime",
    });
  }
  if (error instanceof OfflineRestoreFailure && error.authorityState === "authority-state-uncertain") {
    return Object.freeze({
      heading: "authority restore AUTHORITY-STATE UNCERTAIN",
      authorityLine: "the authority replacement outcome is unproven; inspect staged/live paths before restarting runtime",
    });
  }
  return Object.freeze({
    heading: "authority restore REFUSED",
    authorityLine: "the live authority database was not modified",
  });
}

// Stop proofs expire quickly because a process may restart immediately after inspection.
export const RESTORE_STOPPED_PROOF_MAX_AGE_MS = 5 * 60_000;

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

const STORAGE_USAGE = [
  "usage: storage doctor [--json]",
  "       storage backup [--json]",
  "       storage upgrade [--plan] [--timeline-from <verified-copy-directory>] [--json]",
  "       storage restore --from <manifest.json> [--json]",
  "       storage recover-restore --operation <id> --from <manifest.json> --outcome <unchanged|replaced> [--json]",
  "       storage relocate --plan <command-id> | --resume <operation-id> | --status [--json]",
  "       storage repair-span-root --run <run-id> [--json]",
  "       storage recover-chatgpt-lock",
  "       storage retire-orphan-verification --acquisition <uuid> [--plan] [--json]",
  "  doctor   read-only authority + span reconciliation + backup report (ref dashboard-surfaces); exit 0 only when",
  "           authority, recovery inspection, credentials and span reconciliation are healthy; backup is reported, not gated",
  "  backup   write ONE verified authority backup + manifest under the state root's backups/authority;",
  "           this command is the only backup writer — the dashboard runs no cadence",
  "  restore  quarantine the suspect authority and swap in one EXACT verified backup,",
  "           rebuilding projections against the staged copy first; the runtime must be",
  "           stopped and the manifest is never chosen for you",
  "  relocate  move the exact pending Settings storage plan while dashboard and workers are stopped;",
  "            an interrupted operation requires its exact --resume <operation-id>",
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

function formatLockSnapshot(snapshot: RecoveryRuntimeLockSnapshot): string {
  return Object.entries(snapshot.processLocks)
    .map(([name, lock]) => (lock.state === "active"
      ? `${name}=ACTIVE pid ${String(lock.pid)} (generation ${String(lock.generation)})`
      : `${name}=stopped (generation ${String(lock.generation)})`))
    .join(" · ");
}

function formatRestoreReport(report: OfflineRestoreReport): string {
  return [
    `authority restore — ${report.state} ${report.restoredAt}`,
    `from manifest: ${report.manifestFileName}`,
    `from backup:   ${report.backupFileName} (generation ${String(report.authorityGeneration)})`,
    `suspect kept:  ${report.suspectFileName}`,
    `schema: v${String(report.schemaVersion)}${report.schemaVersion < CURRENT_AUTHORITY_SCHEMA_VERSION ? "; storage upgrade required before runtime boot" : ""}`,
    `projections rebuilt: ${String(report.projectionRebuilt)} · `
    + `authority preserved across rebuild: ${String(report.authorityPreservedAcrossProjectionRebuild)}`,
  ].join("\n");
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
): (stagedPath: string, restoreAdmission: RestoreAdmissionHandle) => Promise<void> {
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
  return async (stagedPath: string, restoreAdmission: RestoreAdmissionHandle): Promise<void> => {
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

export async function runOfflineAuthorityRestoreRecovery(workspace: string, args: readonly string[], clock: Clock = systemClock) {
  const fields = new Map<string, string>(); let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const field = args[index];
    if (field === "--json" && !json) { json = true; continue; }
    const value = args[index + 1];
    if (field === undefined || !["--operation", "--from", "--outcome"].includes(field)
      || fields.has(field) || value === undefined || value.startsWith("--")) throw new Error("storage-recover-restore-usage");
    fields.set(field, value); index += 1;
  }
  const operationId = z.uuid().parse(fields.get("--operation"));
  const manifestPath = z.string().min(1).parse(fields.get("--from"));
  const outcome = z.enum(["unchanged", "replaced"]).parse(fields.get("--outcome"));
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, clock);
  let admission: RuntimeAdmission | undefined;
  try {
    const recovered = acquireRecoveryRuntimeRestore(workspace, operationId, restore);
    admission = recovered.admission;
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(recovered.input.authorityPath);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS }, clock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock));
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity });
    const report = await settleInterruptedAuthorityRestore({ admission, operationId, manifestPath: resolve(manifestPath),
      outcome, processLockRoot, stoppedSystemProof, restoreAdmission: restore, clock });
    return { report, json };
  } finally {
    try { admission?.release(); } finally { restore.release(); }
  }
}

async function restoreCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
  admission: RuntimeAdmission,
  credentials: CredentialStore | undefined,
): Promise<StorageCommandOutcome> {
  const fromIndex = rest.indexOf("--from");
  const manifestArgument = fromIndex === -1 ? undefined : rest[fromIndex + 1];
  if (manifestArgument === undefined || manifestArgument.startsWith("--")) {
    return {
      output: `storage restore requires the exact backup manifest: --from <manifest.json>\n${STORAGE_USAGE}`,
      exitCode: 2,
    };
  }
  if (credentials === undefined) throw new Error("profile-restore-credential-owner-required");
  assertCredentialStoreOwner(credentials, admission);
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const authorityPath = join(stateRoot, "state.db");
  const processLockRoot = join(repoRoot, isolation.processLockRoot);
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
  ).version;
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);

  try {
    // The snapshot is an OBSERVATION of the two role locks, taken now — the
    // stop-proof store re-reads it at consume time and refuses if it moved.
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
    const proofs = new RecoveryStopProofStore(
      { processLockRoot, maxProofAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS },
      clock,
    );
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({
      observedBy: LOCAL_OPERATOR_ACTOR_ID,
      sourceDatabaseIdentity,
    });
    const service = new OfflineAuthorityRestoreService(
      admission,
      {
        authorityPath,
        suspectDirectory: join(stateRoot, "backups", "suspects"),
        busyTimeoutMs: 5000,
        processLockRoot,
        stoppedProofMaxAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS,
      },
      rebuildStagedProjections(stateRoot, appVersion, clock, admission),
      clock,
      undefined,
      undefined,
      credentials,
    );
    const report = await service.restore({ manifestPath: resolve(manifestArgument), stoppedSystemProof });
    // Observe credentials only AFTER successful SQLite replacement. Their failure
    // neither authorizes a rollback nor changes the reported restore outcome.
    const observation = (() => {
      try { return { state: "available" as const, ...protectedSettingsReadback(credentials.read()) }; }
      catch { return { state: "unavailable" as const, code: "credential-store-unavailable" as const }; }
    })();
    const availability = observation.state === "available"
      ? `credentials: revision ${String(observation.revision)}; ${Object.entries(observation.entries).map(([name, entry]) => `${name}=${entry.present ? "present" : "absent"}`).join(" · ")}`
      : "credentials: unavailable — credential-store-unavailable";
    return {
      output: json ? JSON.stringify({ ...report, credentials: observation }, null, 2) : `${formatRestoreReport(report)}\n${availability}`,
      exitCode: 0,
    };
  } catch (error) {

    const snapshotLine = describeLocksForRefusal(processLockRoot, sourceDatabaseIdentity, clock);
    const disposition = restoreFailureDisposition(error);
    return {
      output: [
        `${disposition.heading} — ${messageChain(error)}`,
        `process locks: ${snapshotLine}`,
        disposition.authorityLine,
      ].join("\n"),
      exitCode: 1,
    };
  }
}

async function repairSpanRootCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
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
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const authorityPath = join(stateRoot, "state.db");
  const processLockRoot = join(repoRoot, isolation.processLockRoot);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  try {
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
    const proofs = new RecoveryStopProofStore(
      { processLockRoot, maxProofAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS },
      clock,
    );
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({
      observedBy: LOCAL_OPERATOR_ACTOR_ID,
      sourceDatabaseIdentity,
    });
    const service = new OfflineSpanRootRepairService(admission, {
      stateRoot,
      authorityPath,
      processLockRoot,
      stoppedProofMaxAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS,
      busyTimeoutMs: 5000,
    }, clock);
    const report = service.repair({ runId, stoppedSystemProof });
    return {
      output: json ? JSON.stringify(report, null, 2) : formatSpanRootRepairReport(report),
      exitCode: 0,
    };
  } catch (error) {
    return {
      output: [
        `span root repair REFUSED — ${messageChain(error)}`,
        `process locks: ${describeLocksForRefusal(processLockRoot, sourceDatabaseIdentity, clock)}`,
        "rerun doctor before deciding the next action; an exact repeat reuses the retained marked event without another append",
      ].join("\n"),
      exitCode: 1,
    };
  }
}


function describeLocksForRefusal(
  processLockRoot: string,
  sourceDatabaseIdentity: string,
  clock: Clock,
): string {
  try {
    return formatLockSnapshot(
      observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock),
    );
  } catch (error) {
    return `unreadable (${messageChain(error)})`;
  }
}

// Backup opens existing authority only; missing authority is a refusal, never an empty backup.
async function backupCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
  admission: RuntimeAdmission,
): Promise<StorageCommandOutcome> {
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const authorityPath = join(stateRoot, "state.db");
  if (!existsSync(authorityPath)) {
    return {
      output: `storage backup REFUSED — no authority database exists at ${basename(stateRoot)}/state.db; `
        + "start the dashboard once to create it, then back it up",
      exitCode: 1,
    };
  }
  const { backupStoppedAuthority } = await import("../../storage/maintenance/upgrade.js");
  const report = await backupStoppedAuthority(admission,stateRoot, clock,join(repoRoot,isolation.processLockRoot));
    const manifest = report.manifests.at(-1);
    if (manifest === undefined) {
      throw new Error("verified backup run reported no manifest");
    }
    return {
      output: json
        ? JSON.stringify(report, null, 2)
        : [
            `backup: verified — ${manifest.backupFileName}`,
            `  generation ${String(manifest.authorityGeneration)}, ${String(manifest.byteSize)} bytes, sha256 ${manifest.sha256}`,
            `  manifest ${manifest.backupFileName}.manifest.json (restore with: storage restore --from <that manifest>)`,
          ].join("\n"),
      exitCode: 0,
    };

}

/** Clears a ChatGPT credential lock whose recorded owner process is gone; a live owner is refused. */
async function recoverChatGptLockCommand(rest: readonly string[], admission: RuntimeAdmission): Promise<StorageCommandOutcome> {
  if (rest.length !== 0) return { output: `unsupported storage recover-chatgpt-lock argument: ${rest[0] ?? ""}\n${STORAGE_USAGE}`, exitCode: 2 };
  if (!existsSync(join(admission.stateRoot, "credentials", ".chatgpt-account.lock"))) {
    return { output: "storage recover-chatgpt-lock: no ChatGPT credential lock", exitCode: 0 };
  }
  try {
    await createChatGptCredentialRepository({ admission, stateRoot: admission.stateRoot }).withLock(async () => undefined);
  } catch (error) {
    if (error instanceof ChatGptCredentialError) return { output: `storage recover-chatgpt-lock: ${error.code}: ${error.message}`, exitCode: 1 };
    throw error;
  }
  return { output: "storage recover-chatgpt-lock: cleared an abandoned ChatGPT credential lock", exitCode: 0 };
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
      if (argument === "--plan" || argument === "--json") continue;
      return { output: `unsupported storage upgrade argument: ${argument ?? "missing"}\n${STORAGE_USAGE}`, exitCode: 2 };
    }
    try {
      const { upgradeStorage } = await import("../../storage/maintenance/upgrade.js");
      const report = await upgradeStorage(admission,{ stateRoot: admission.stateRoot,
        processLockRoot: join(repoRoot, isolation.processLockRoot), plan: rest.includes("--plan") }, clock);
      return { output: rest.includes("--json") ? JSON.stringify(report, null, 2) : [
        `storage upgrade: ${report.state} (v${String(report.fromSchemaVersion)} → v${String(report.toSchemaVersion)})`,
        "credentials: unchanged",
        ...(report.diagnostics === undefined ? [] : [
          `diagnostic stages: ${String(report.diagnostics.reclaimedStages)} reclaimed, ${String(report.diagnostics.retainedStages)} retained${report.diagnostics.capacityWarning ? "; retained evidence remains budget-accounted" : ""}`,
        ]),
      ].join("\n"), exitCode: 0 };
    } catch (error) {
      // Unvalidated parser/OS error text can contain input. Emit only a named outcome.
      const code = error instanceof Error ? /^([a-z]+(?:-[a-z]+)+)(?:[: {]|$)/u.exec(error.message)?.[1] : undefined;
      const candidateKey = error instanceof Error ? /\{ key: ([A-Za-z0-9.*_-]+) \}/u.exec(error.message)?.[1] : undefined;
      const key = candidateKey !== undefined && SETTINGS_CATALOG.some((row) => row.key === candidateKey
        || (row.key.startsWith("urls.") && candidateKey.startsWith(`${row.key}.`))) ? candidateKey : undefined;
      const report = { state: "refused-or-incomplete", code: code ?? "upgrade-validation-failed", ...(key === undefined ? {} : { key }) };
      return { output: rest.includes("--json") ? JSON.stringify(report) : `storage upgrade: ${report.code}${key === undefined ? "" : ` { key: ${key} }`}; inspect state before retrying`, exitCode: 1 };
    }
  }
  if (subcommand === "retire-orphan-verification") {
    const parsed = z.tuple([z.literal("--acquisition"), z.uuid()]).safeParse(rest.slice(0, 2));
    if (!parsed.success || rest.slice(2).some(arg => arg !== "--plan" && arg !== "--json")
      || new Set(rest).size !== rest.length) return { output: STORAGE_USAGE, exitCode: 2 };
    let database: AuthorityDatabase | undefined;
    try {
      admission.assertExclusive();
      if (admission.readInstallationContext() !== undefined) admission.assertFixedProcessLockRoot(repoRoot, join(repoRoot, isolation.processLockRoot));
      database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
        migrationOwner: "orphan-verification-retirement" }, clock);
      const report = retireOrphanVerification(admission, database, { acquisitionId: parsed.data[1], plan: rest.includes("--plan") }, clock);
      return { output: rest.includes("--json") ? JSON.stringify(report) : `orphan verification: ${report.state} ${report.workerId}`, exitCode: 0 };
    } catch {
      const code = "ORPHAN_VERIFICATION_RETIREMENT_REFUSED";
      return { output: rest.includes("--json") ? JSON.stringify({ state: "refused", code }) : `${code}: ${ERROR_CATALOG[code].text}`, exitCode: 1 };
    } finally { database?.close(); }
  }
  if (subcommand === "restore") return restoreCommand(isolation, rest, clock, repoRoot, admission, credentials);
  if (subcommand === "backup") return backupCommand(isolation, rest, clock, repoRoot, admission);
  if (subcommand === "repair-span-root") return repairSpanRootCommand(isolation, rest, clock, repoRoot, admission);
  if (subcommand === "recover-chatgpt-lock") return recoverChatGptLockCommand(rest, admission);
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
  }, clock);
  const healthy = report.authority.state === "healthy"
    && report.recovery.state === "clear"
    && report.spanAuthority.state === "reconciled"
    && report.protectedSettings.state === "available";
  return {
    output: json ? JSON.stringify(report, null, 2) : formatReport(report),
    exitCode: healthy ? 0 : 1,
  };
}
