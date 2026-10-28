import { RuntimeLifetimeLock } from "../../../storage/admission/lifetime-lock.js";
import { probeStoppedProfileBrowsersClosed } from "../../../storage/maintenance/profile-inventory.js";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { ConfigSnapshotWriteSchema } from "../../../../models/config/snapshot.js";
import type { StorageRelocationPlanView } from "../../../../rules/commands/commands.js";
import { capturedInstantClock, systemClock, type Clock } from "../../../../rules/time/clock.js";
import { hostConfigFacts, type HostConfigFacts } from "../../../../models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../config/resolve.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import { hostAwareResolutionEnvironment } from "../../../../models/config/secrets.js";
import { inspectAuthorityBackupReadOnly } from "../../../storage/sqlite/backup-inspection.js";
import { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../../storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../storage/sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission } from "../../../storage/sqlite/runtime-process-locks.js";
import { acquireRecoveryRuntimeRelocation, type RuntimeAdmission, type RuntimeRelocationOperation } from "../../../storage/admission/admission.js";
import { inspectPendingRelocationRecovery, type RelocationPlanBinding, type VerifiedRelocationActivationIntent,
  type VerifiedRelocationEvidence, type VerifiedRelocationPreparation } from "../../../storage/admission/installation.js";
import { probePrimaryDisplay } from "../../host/primary-display.js";
import { projectStorageRelocationPlanHistory } from "../../../storage/maintenance/storage-relocation-plans.js";
import { readSettings } from "../../../runtime/settings/settings-runtime.js";
import { backupStoppedAuthority } from "../../../storage/maintenance/upgrade.js";
import { copyRelocationFile, inspectRelocationFiles, prepareRelocationDirectories, verifyRelocationBackupTree,
  verifyRelocationFileCopies, verifyRelocationLiveReferences, verifyRetainedRelocationCopies,
  type RelocationFileInventory } from "../../../storage/maintenance/relocation-inventory.js";

const UUID = z.uuid();

export class StorageRelocationIncompleteError extends Error {
  constructor(readonly operationId: string, cause: unknown) {
    super(`storage-relocation-incomplete: operation ${operationId} needs explicit recovery`, { cause });
  }
}

export type RelocationCommand = Readonly<{ kind: "plan" | "resume"; id: string; json: boolean }>;
export type ParsedRelocationCommand = RelocationCommand | Readonly<{ kind: "status"; json: boolean }>;
export function parseRelocationCommand(args: readonly string[]): ParsedRelocationCommand {
  if (args[0] === "--status" && (args.length === 1 || (args.length === 2 && args[1] === "--json"))) {
    return Object.freeze({ kind: "status", json: args.length === 2 });
  }
  const [selector, value, ...tail] = args;
  if ((selector !== "--plan" && selector !== "--resume") || value === undefined || !UUID.safeParse(value).success
    || tail.some((item) => item !== "--json") || tail.filter((item) => item === "--json").length > 1) {
    throw new Error("storage-relocation-usage: use storage relocate --plan <command-id>, --resume <operation-id>, or --status [--json]");
  }
  return Object.freeze({ kind: selector === "--plan" ? "plan" : "resume", id: value, json: tail.length === 1 });
}

function digest(path: string, expectedLinks = 1): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== expectedLinks || (process.getuid && stat.uid !== process.getuid())
    || (stat.mode & 0o022) !== 0) throw new Error("storage-relocation: unsafe verification file");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function sync(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }

export function copyNativeSnapshot(source: string, destination: string, expectedSha256: string, operationId: string,
  admission: RuntimeAdmission, afterPublish?: () => void): void {
  admission.assertAuthorityDatabase(destination);
  if (digest(source) !== expectedSha256) throw new Error("storage-relocation: native snapshot digest changed");
  const parent = dirname(destination);
  const candidate = join(parent, `.relocation-${operationId}-${basename(destination)}.tmp`);
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing !== undefined) {
    const temporary = lstatSync(candidate, { throwIfNoEntry: false });
    if (temporary !== undefined) {
      if (existing.nlink !== 2 || temporary.nlink !== 2 || existing.dev !== temporary.dev
        || existing.ino !== temporary.ino) throw new Error("storage-relocation: ambiguous native snapshot publication");
      if (digest(destination, 2) !== expectedSha256) throw new Error("storage-relocation: linked native snapshot differs");
      unlinkSync(candidate);
      sync(parent);
    } else if (digest(destination) !== expectedSha256) {
      throw new Error("storage-relocation: existing native snapshot differs");
    }
    return;
  }
  if (lstatSync(candidate, { throwIfNoEntry: false }) !== undefined) {
    if (digest(candidate) !== expectedSha256) throw new Error("storage-relocation: incomplete native snapshot differs");
  } else {
    copyFileSync(source, candidate, constants.COPYFILE_EXCL);
    sync(candidate);
    if (digest(candidate) !== expectedSha256) throw new Error("storage-relocation: copied native snapshot differs");
  }
  linkSync(candidate, destination);
  sync(parent);
  afterPublish?.();
  unlinkSync(candidate);
  sync(parent);
  if (digest(destination) !== expectedSha256) throw new Error("storage-relocation: published native snapshot differs");
}

function bindingFromPlan(view: StorageRelocationPlanView): RelocationPlanBinding {
  const pending = view.pending;
  if (pending === null) throw new Error("storage-relocation: no pending plan");
  return { commandId: pending.commandId, revision: view.revision, expectedRevision: view.revision - 1,
    requestFingerprint: pending.requestFingerprint, desiredDigest: pending.desiredDigest };
}

function requireExactPlan(operation: RuntimeRelocationOperation, authority: AuthorityDatabase, workspace: string): void {
  const inventory = operation.inventory();
  const epoch = { installationId: inventory.installationId, generation: inventory.fromGeneration,
    stateRoot: inventory.source.stateRoot, artifactRoot: inventory.source.artifactRoot };
  const view = authority.withAuthorityReadSnapshot(() =>
    projectStorageRelocationPlanHistory(authority.authority, epoch, operation.readPriorReceipts(), workspace));
  const pending = view.pending;
  if (pending === null || canonicalJsonStringify(bindingFromPlan(view)) !== canonicalJsonStringify(inventory.plan)
    || pending.desiredPair.stateRoot !== inventory.destination.stateRoot
    || pending.desiredPair.artifactRoot !== inventory.destination.artifactRoot) {
    throw new Error("storage-relocation: pending plan changed");
  }
}

async function verifyPreparation(admission: RuntimeAdmission, evidence: VerifiedRelocationPreparation): Promise<void> {
  if (digest(evidence.backupManifestPath) !== evidence.backupManifestSha256
    || digest(evidence.backupFilePath) !== evidence.backupFileSha256) {
    throw new Error("storage-relocation: prepared backup bytes changed");
  }
  const verified = await verifyBackupManifestAtPath(admission, evidence.backupManifestPath, evidence.sourceDatabaseIdentity);
  if (verified.backupPath !== evidence.backupFilePath || verified.manifest.sha256 !== evidence.backupFileSha256
    || verified.manifest.authorityGeneration !== evidence.sourceAuthorityGeneration
    || verified.manifest.authorityContentFingerprint !== evidence.sourceAuthorityContentFingerprint
    || verified.manifest.schemaVersion !== evidence.sourceSchemaVersion) {
    throw new Error("storage-relocation: prepared backup identity changed");
  }

}

function inventoryDigest(files: RelocationFileInventory): string {
  const transientNative = new Set(["state.db-wal", "state.db-shm"]);
  return createHash("sha256").update(canonicalJsonStringify({
    directories: files.directories.map((row) => [row.role, row.relativePath]),
    files: files.files.filter((row) => row.role !== "state" || !transientNative.has(row.relativePath))
      .map((row) => [row.role, row.relativePath]),
  })).digest("hex");
}

function selectActivationIntent(operation: RuntimeRelocationOperation, admission: RuntimeAdmission,
  stageAuthority: VerifiedRelocationActivationIntent["stageAuthority"],
  sourceFiles: RelocationFileInventory,
  preAuthority: Readonly<{ generation: number; fingerprint: string }>,
  clock: Clock, hostFactsInput?: HostConfigFacts): VerifiedRelocationActivationIntent {
  const inventory = operation.inventory();
  const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
    busyTimeoutMs: 5000, migrationOwner: "storage-relocation", openMode: "storage-doctor-read-only-no-migrate" }, clock);
  try {
    const previous = database.withAuthorityReadSnapshot(() => ({
      settings: readSettings(database.authority), active: database.authority.runtimeConfig.get() ?? null,
    }));
    const facts = hostFactsInput ?? hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay));
    const resolved = resolveConfigWithProvenance(previous.settings.settings, facts, clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
    const nativePath = join(admission.stateRoot, "state.db");
    return {
      operationId: inventory.operationId, installationId: inventory.installationId,
      sourceGeneration: inventory.fromGeneration, source: inventory.source, destination: inventory.destination,
      plan: inventory.plan, stageAuthority,
      nativeDestinationPath: nativePath,
      nativeDestinationSha256: inventory.source.stateRoot === inventory.destination.stateRoot ? null : digest(nativePath),
      preAuthorityGeneration: preAuthority.generation,
      preAuthorityContentFingerprint: preAuthority.fingerprint,
      managedInventoryDigest: inventoryDigest(sourceFiles),
      settingsRevision: previous.settings.revision, settingsFingerprint: previous.settings.settingsFingerprint,
      priorActive: previous.active,
      snapshot: ConfigSnapshotWriteSchema.parse({ configSnapshotId: randomUUID(), revision: 1, fingerprint: resolved.fingerprint,
        capturedAt: clock.now().toISOString(), capturedBy: LOCAL_OPERATOR_ACTOR_ID,
        config: resolved.config, provenance: resolved.provenance }),
    };
  } finally { database.close(); }
}

function applyActivationIntent(admission: RuntimeAdmission, intent: VerifiedRelocationActivationIntent,
  verifiedStageBackupPath = intent.stageAuthority.backupPath, beforeTransaction?: () => void): void {
  const clock = capturedInstantClock(intent.snapshot.capturedAt);
  const inspect = () => {
    const database = AuthorityDatabase.open(admission, { path: intent.nativeDestinationPath,
      busyTimeoutMs: 5000, migrationOwner: "storage-relocation", openMode: "storage-doctor-read-only-no-migrate" }, clock);
    try { return database.classifyRelocationActivation(intent, verifiedStageBackupPath); }
    finally { database.close(); }
  };
  const state = inspect();
  if (state === "committed") return;
  const database = AuthorityDatabase.open(admission, { path: intent.nativeDestinationPath,
    busyTimeoutMs: 5000, migrationOwner: "storage-relocation" }, clock);
  try {
    beforeTransaction?.();
    database.withAuthorityTransaction((repositories) => {
      repositories.configSnapshots.insert(intent.snapshot);
      repositories.runtimeConfig.activate({ settingsRevision: intent.settingsRevision,
        settingsFingerprint: intent.settingsFingerprint, configSnapshotId: intent.snapshot.configSnapshotId,
        configFingerprint: intent.snapshot.fingerprint, activatedAt: intent.snapshot.capturedAt });
    });
  } finally { database.close(); }
  if (inspect() !== "committed") throw new Error("storage-relocation: destination activation did not match intent");
}

function physicalStagePath(operation: RuntimeRelocationOperation, path: string): string {
  const pending = operation.inventory();
  const suffix = relative(pending.source.stateRoot, path);
  if (suffix === "" || suffix === ".." || suffix.startsWith(`..${sep}`) || suffix.startsWith(sep)) {
    throw new Error("storage-relocation: stage path is outside source authority");
  }
  return join(operation.verifiedSourceControlEntries().source.stateRoot, suffix);
}

async function verifyStageEvidence(operation: RuntimeRelocationOperation, destination: RuntimeAdmission): Promise<VerifiedRelocationEvidence> {
  const pending = operation.inventory();
  const intent = pending.activationIntent;
  const view = pending.evidence;
  if (intent === undefined || view === undefined) throw new Error("storage-relocation: stage evidence missing");
  const evidence: VerifiedRelocationEvidence = { ...view, managedStateEntries: [...view.managedStateEntries] };
  if (evidence.configSnapshotId !== intent.snapshot.configSnapshotId
    || evidence.configFingerprint !== intent.snapshot.fingerprint
    || evidence.finalDatabasePath !== intent.nativeDestinationPath
    || evidence.databaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(intent.nativeDestinationPath)) {
    throw new Error("storage-relocation: saved stage identity differs from activation intent");
  }
  const stageManifestPath = physicalStagePath(operation, intent.stageAuthority.manifestPath);
  const stageBackupPath = physicalStagePath(operation, intent.stageAuthority.backupPath);
  if (digest(stageManifestPath) !== intent.stageAuthority.manifestSha256
    || digest(stageBackupPath) !== intent.stageAuthority.backupSha256) {
    throw new Error("storage-relocation: retained stage authority changed");
  }
  const stage = await verifyBackupManifestAtPath(destination, stageManifestPath,
    AuthorityDatabase.sourceDatabaseIdentity(join(intent.source.stateRoot, "state.db")));
  if (stage.backupPath !== stageBackupPath || stage.manifest.authorityGeneration !== intent.preAuthorityGeneration
    || stage.manifest.authorityContentFingerprint !== intent.preAuthorityContentFingerprint) {
    throw new Error("storage-relocation: retained stage backup differs from intent");
  }
  if (basename(evidence.backupReceiptId) !== evidence.backupReceiptId
    || !/^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite$/u.test(evidence.backupReceiptId)) {
    throw new Error("storage-relocation: stage backup receipt name invalid");
  }
  const finalManifestPath = join(intent.destination.stateRoot, "backups", "authority",
    `${evidence.backupReceiptId}.manifest.json`);
  const final = await verifyBackupManifestAtPath(destination, finalManifestPath, evidence.databaseIdentity);
  if (final.manifest.sha256 !== evidence.backupDigest
    || final.manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error("storage-relocation: final backup evidence differs");
  }
  const database = AuthorityDatabase.open(destination, { path: intent.nativeDestinationPath,
    busyTimeoutMs: 5000, migrationOwner: "storage-relocation-verification",
    openMode: "storage-doctor-read-only-no-migrate" });
  try {
    if (database.classifyRelocationActivation(intent, stageBackupPath) !== "committed") {
      throw new Error("storage-relocation: destination activation not committed");
    }
    const live = inspectAuthorityBackupReadOnly(destination, intent.nativeDestinationPath, CURRENT_AUTHORITY_SCHEMA_VERSION);
    if (final.manifest.authorityGeneration !== live.authorityGeneration
      || final.manifest.authorityContentFingerprint !== live.authorityContentFingerprint) {
      throw new Error("storage-relocation: final backup differs from committed authority");
    }
  } finally { database.close(); }
  return evidence;
}

export async function runOfflineStorageRelocation(input: Readonly<{ workspace: string; lifetime: RuntimeLifetimeLock; command: RelocationCommand;
  admission?: RuntimeAdmission; clock?: Clock; hostFacts?: HostConfigFacts;
  faults?: Readonly<{ afterNativePublish?(): void; afterActivationIntent?(): void; beforeActivationTransaction?(): void;
    afterActivationWrite?(): void; afterFinalBackup?(): void;
    afterVerifiedStage?(): void; afterFence?(): void; afterRetention?(): void; afterSwitch?(): void }> }>): Promise<Readonly<{ operationId: string; generation: number }>> {
  if (!(input.lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
  input.lifetime.assertHeld();
  const workspace = resolve(input.workspace);
  input.lifetime.assertExclusiveWorkspaceTarget(workspace);
  if (input.admission !== undefined) {
    if (input.admission.lifetime !== input.lifetime) throw new Error("storage-relocation: runtime lifetime mismatch");
    input.admission.assertExclusive();
  }
  const clock = input.clock ?? systemClock;
  input.admission?.assertStorageRelocationSupported();
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  let admission = input.admission;
  let ownedAdmission = false;
  let operationId: string | undefined;
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, clock);
  try {
    let operation: RuntimeRelocationOperation;
    if (input.command.kind === "resume") {
      const binding = inspectPendingRelocationRecovery(workspace, input.command.id, restore);
      const recovered = acquireRecoveryRuntimeRelocation(workspace, input.lifetime, binding, restore);
      admission = recovered.admission;
      ownedAdmission = true;
      operation = recovered.operation;
    } else {
      if (admission === undefined) throw new Error("storage-relocation: exclusive admission required");
      const activeAdmission = admission;
      activeAdmission.assertExclusive();
      activeAdmission.assertFixedProcessLockRoot(workspace, processLockRoot);
      const source = AuthorityDatabase.open(activeAdmission, { path: join(activeAdmission.stateRoot, "state.db"),
        busyTimeoutMs: 5000, migrationOwner: "storage-relocation-plan", openMode: "storage-doctor-read-only-no-migrate" }, clock);
      let view;
      try {
        const locator = activeAdmission.locator;
        view = source.withAuthorityReadSnapshot(() => projectStorageRelocationPlanHistory(source.authority,
          { installationId: locator.installationId, generation: locator.generation,
            stateRoot: locator.stateRoot, artifactRoot: locator.artifactRoot },
          activeAdmission.readRelocationReceipts(), workspace));
      }
      finally { source.close(); }
      if (view.pending?.commandId !== input.command.id) throw new Error("storage-relocation: requested plan is not current pending intent");
      await probeStoppedProfileBrowsersClosed(activeAdmission,clock);
      operation = activeAdmission.beginRelocation(view.pending.desiredPair, bindingFromPlan(view), restore);
    }
    operationId = operation.operationId;
    const inventory = operation.inventory();
    if (inventory.phase === "preparing" || inventory.phase === "prepared") {
      if (admission === undefined) throw new Error("storage-relocation: source admission missing");
      inspectRelocationFiles({ admission, source: inventory.source, destination: inventory.destination,
        fixedLockRoot: processLockRoot, operation });
      const sourcePath = join(inventory.source.stateRoot, "state.db");
      const source = AuthorityDatabase.open(admission, { path: sourcePath, busyTimeoutMs: 5000,
        migrationOwner: "storage-relocation-plan", openMode: "storage-doctor-read-only-no-migrate" }, clock);
      try { requireExactPlan(operation, source, workspace); } finally { source.close(); }
      if (inventory.phase === "preparing") {
        const inspected = inspectAuthorityBackupReadOnly(admission, sourcePath);
        if (inspected.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("storage-relocation: unsupported source schema");
        const report = await backupStoppedAuthority(admission, inventory.source.stateRoot, clock,processLockRoot,restore);
        const manifest = report.manifests.at(-1);
        if (manifest === undefined) throw new Error("storage-relocation: preparation backup missing manifest");
        inspectRelocationFiles({ admission, source: inventory.source, destination: inventory.destination,
          fixedLockRoot: processLockRoot, operation });
        const manifestPath = join(inventory.source.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`);
        const backup = await verifyBackupManifestAtPath(admission, manifestPath,
          AuthorityDatabase.sourceDatabaseIdentity(sourcePath));
        if (backup.manifest.authorityGeneration !== inspected.authorityGeneration
          || backup.manifest.authorityContentFingerprint !== inspected.authorityContentFingerprint) {
          throw new Error("storage-relocation: preparation backup is stale");
        }
        const evidence: VerifiedRelocationPreparation = {
          operationId: inventory.operationId, installationId: inventory.installationId,
          sourceGeneration: inventory.fromGeneration, source: inventory.source, destination: inventory.destination,
          plan: inventory.plan, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(sourcePath),
          sourceSchemaVersion: inspected.schemaVersion, sourceAuthorityGeneration: inspected.authorityGeneration,
          sourceAuthorityContentFingerprint: inspected.authorityContentFingerprint,
          backupReceiptId: manifest.backupFileName, backupManifestPath: backup.manifestPath,
          backupManifestSha256: digest(backup.manifestPath), backupFilePath: backup.backupPath,
          backupFileSha256: digest(backup.backupPath),
        };
        operation.recordVerifiedPreparation(() => { if (digest(backup.manifestPath) !== evidence.backupManifestSha256
          || digest(backup.backupPath) !== evidence.backupFileSha256) throw new Error("storage-relocation: preparation changed");
          return evidence; });
      }
      const prepared = operation.inventory().preparation;
      if (prepared === undefined) throw new Error("storage-relocation: preparation receipt missing");
      await verifyPreparation(admission, prepared);
      operation.prepareDestinationRoots();
      const nativeSource = inspectAuthorityBackupReadOnly(admission, sourcePath, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const stageBackup = await backupStoppedAuthority(admission, inventory.source.stateRoot, clock,processLockRoot,restore);
      const stageManifest = stageBackup.manifests.at(-1);
      if (stageManifest === undefined || stageManifest.authorityGeneration !== nativeSource.authorityGeneration
        || stageManifest.authorityContentFingerprint !== nativeSource.authorityContentFingerprint) {
        throw new Error("storage-relocation: native stage backup is stale");
      }
      const sourceFiles = inspectRelocationFiles({ admission, source: inventory.source,
        destination: inventory.destination, fixedLockRoot: processLockRoot, operation });
      const stageManifestPath = join(inventory.source.stateRoot, "backups", "authority", `${stageManifest.backupFileName}.manifest.json`);
      const verifiedStageBackup = await verifyBackupManifestAtPath(admission, stageManifestPath);
      await verifyRelocationBackupTree({ admission, operation, stateRoot: inventory.source.stateRoot });
      verifyRelocationLiveReferences({ admission, source: inventory.source });
      const destination = operation.destinationAdmission();
      try {
        prepareRelocationDirectories({ destinationAdmission: destination, inventory: sourceFiles });
        if (inventory.source.stateRoot !== inventory.destination.stateRoot) {
          copyNativeSnapshot(verifiedStageBackup.backupPath, join(inventory.destination.stateRoot, "state.db"),
            verifiedStageBackup.manifest.sha256, inventory.operationId, destination,
            input.faults?.afterNativePublish);

        }
        for (const file of sourceFiles.files) {
          if (file.role === "state" && (["state.db", "state.db-wal", "state.db-shm", "archive.sqlite"].includes(file.relativePath))) continue;
          copyRelocationFile({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles,
            file, operationId: inventory.operationId });
        }
        verifyRelocationFileCopies({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles });
        const stageAuthority = { manifestPath: verifiedStageBackup.manifestPath,
          manifestSha256: digest(verifiedStageBackup.manifestPath), backupPath: verifiedStageBackup.backupPath,
          backupSha256: digest(verifiedStageBackup.backupPath) };
        const intent = selectActivationIntent(operation, destination, stageAuthority, sourceFiles,
          { generation: verifiedStageBackup.manifest.authorityGeneration,
            fingerprint: verifiedStageBackup.manifest.authorityContentFingerprint }, clock, input.hostFacts);
        operation.recordActivationIntent(() => {
          if (digest(intent.stageAuthority.manifestPath) !== intent.stageAuthority.manifestSha256
            || digest(intent.stageAuthority.backupPath) !== intent.stageAuthority.backupSha256
            || (intent.nativeDestinationSha256 !== null
              && digest(intent.nativeDestinationPath) !== intent.nativeDestinationSha256)) {
            throw new Error("storage-relocation: activation stage changed");
          }
          return intent;
        });
        input.faults?.afterActivationIntent?.();
      } finally { destination.release(); }
    }
    if (operation.inventory().phase === "activating") {
      const pending = operation.inventory();
      const intent = pending.activationIntent;
      if (intent === undefined || admission === undefined) throw new Error("storage-relocation: activation intent missing");
      const sourceFiles = inspectRelocationFiles({ admission, source: pending.source, destination: pending.destination,
        fixedLockRoot: processLockRoot, operation });
      if (inventoryDigest(sourceFiles) !== intent.managedInventoryDigest) {
        throw new Error("storage-relocation: managed source inventory changed after activation intent");
      }
      if (digest(intent.stageAuthority.manifestPath) !== intent.stageAuthority.manifestSha256
        || digest(intent.stageAuthority.backupPath) !== intent.stageAuthority.backupSha256) {
        throw new Error("storage-relocation: activation stage bytes changed");
      }
      const destination = operation.destinationAdmission();
      try {
        verifyRelocationFileCopies({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles });
        applyActivationIntent(destination, intent, intent.stageAuthority.backupPath,
          input.faults?.beforeActivationTransaction);
        input.faults?.afterActivationWrite?.();
        const finalBackup = await backupStoppedAuthority(destination, pending.destination.stateRoot, clock,processLockRoot,restore);
        const finalManifest = finalBackup.manifests.at(-1);
        if (finalManifest === undefined) throw new Error("storage-relocation: final backup missing");
        const finalManifestPath = join(pending.destination.stateRoot, "backups", "authority",
          `${finalManifest.backupFileName}.manifest.json`);
        const finalVerified = await verifyBackupManifestAtPath(destination, finalManifestPath);
        if (finalVerified.manifest.sha256 !== finalManifest.sha256) {
          throw new Error("storage-relocation: final backup identity changed");
        }
        input.faults?.afterFinalBackup?.();
        const finalManifestSha256 = digest(finalManifestPath);
        const evidence: VerifiedRelocationEvidence = {
          operationId: pending.operationId, installationId: pending.installationId,
          sourceGeneration: pending.fromGeneration, source: pending.source, destination: pending.destination,
          plan: pending.plan, stagingReceiptId: randomUUID(),
          stagingDigest: createHash("sha256").update(canonicalJsonStringify({ operationId: pending.operationId,
            destination: pending.destination, manifest: finalManifest.sha256,
            configFingerprint: intent.snapshot.fingerprint })).digest("hex"),
          backupReceiptId: finalManifest.backupFileName, backupDigest: finalManifest.sha256,
          finalDatabasePath: join(pending.destination.stateRoot, "state.db"),
          configSnapshotId: intent.snapshot.configSnapshotId, configFingerprint: intent.snapshot.fingerprint,
          authorityVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
          databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(pending.destination.stateRoot, "state.db")),
          managedStateEntries: pending.source.stateRoot === pending.destination.stateRoot ? [] : [...sourceFiles.stateEntries],
        };
        operation.recordVerifiedStage(() => {
          if (digest(intent.stageAuthority.manifestPath) !== intent.stageAuthority.manifestSha256
            || digest(intent.stageAuthority.backupPath) !== intent.stageAuthority.backupSha256
            || digest(finalManifestPath) !== finalManifestSha256
            || digest(finalVerified.backupPath) !== finalManifest.sha256) {
            throw new Error("storage-relocation: stage backup changed");
          }
          return evidence;
        });
        input.faults?.afterVerifiedStage?.();
      } finally { destination.release(); }
    }
    if (operation.inventory().phase === "staged") {
      const pending = operation.inventory();
      if (admission === undefined) throw new Error("storage-relocation: source admission missing before fence");
      const sourceFiles = inspectRelocationFiles({ admission, source: pending.source, destination: pending.destination,
        fixedLockRoot: processLockRoot, operation });
      const destination = operation.destinationAdmission();
      try {
        verifyRelocationFileCopies({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles });
        verifyRelocationLiveReferences({ admission: destination, source: pending.destination });
        await verifyStageEvidence(operation, destination);
        operation.fenceRelocationSource();
        input.faults?.afterFence?.();
      } finally { destination.release(); }
    }
    if (operation.inventory().phase === "fenced" || operation.inventory().phase === "retaining") {
      operation.retainRelocationSources();
      input.faults?.afterRetention?.();
    }
    if (operation.inventory().phase === "retained") {
      const destination = operation.destinationAdmission();
      const source = operation.sourceVerificationAdmission();
      try {
        verifyRetainedRelocationCopies({ operation, sourceAdmission: source, destinationAdmission: destination });
        verifyRelocationLiveReferences({ admission: destination, source: operation.inventory().destination });
        const evidence = await verifyStageEvidence(operation, destination);
        operation.switchRelocationLocator(() => evidence);
        input.faults?.afterSwitch?.();
      } finally { source.release(); destination.release(); }
    }
    if (operation.inventory().phase === "switched") {
      const destination = operation.destinationAdmission();
      const source = operation.sourceVerificationAdmission();
      try {
        verifyRetainedRelocationCopies({ operation, sourceAdmission: source, destinationAdmission: destination });
        verifyRelocationLiveReferences({ admission: destination, source: operation.inventory().destination });
        const evidence = await verifyStageEvidence(operation, destination);
        operation.settleRelocation(() => evidence);
      } finally { source.release(); destination.release(); }
    }
    return { operationId: operation.operationId, generation: inventory.fromGeneration + 1 };
  } catch (error) {
    if (operationId !== undefined) throw new StorageRelocationIncompleteError(operationId, error);
    throw error;
  } finally { if (ownedAdmission) admission?.release(); restore.release(); }
}
