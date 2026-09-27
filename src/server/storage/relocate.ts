import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { ConfigSnapshotWriteSchema } from "../../domain/config/snapshot.js";
import type { StorageRelocationPlanView } from "../../domain/commands.js";
import { manualClock, systemClock, type Clock } from "../../domain/clock.js";
import { hostConfigFacts, type HostConfigFacts } from "../../domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import { hostAwareResolutionEnvironment } from "../../domain/secrets.js";
import { inspectAuthorityBackupReadOnly } from "../../infra/compat/backup-inspection.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { verifyLifecyclePair } from "../../infra/sqlite/lifecycle-storage.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, NORMAL_AUTHORITY_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { RecoveryStopProofStore } from "../../infra/sqlite/recovery-stop-proof.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";
import { acquireRecoveryRuntimeRelocation, type RuntimeAdmission, type RuntimeRelocationOperation } from "../../infra/runtime-control/admission.js";
import { inspectPendingRelocationRecovery, type RelocationPlanBinding, type VerifiedRelocationActivationIntent,
  type VerifiedRelocationEvidence, type VerifiedRelocationPreparation } from "../../infra/runtime-control/installation.js";
import { probePrimaryDisplay } from "../../infra/host/primary-display.js";
import { projectStorageRelocationPlanHistory, createStorageRelocationPlanReader } from "../../core/storage-relocation-plans.js";
import { readSettings } from "../settings-runtime.js";
import { backupStoppedAuthority, upgradeRelocationCapabilityV56 } from "./upgrade.js";
import { copyRelocationFile, inspectRelocationFiles, prepareRelocationDirectories, verifyRelocationBackupTree,
  verifyRelocationFileCopies, verifyRelocationLiveReferences, verifyRetainedRelocationCopies,
  type RelocationFileInventory } from "./relocation-inventory.js";

const UUID = z.uuid();
const RESTORE_PROOF_MAX_AGE_MS = 5 * 60_000;

export class StorageRelocationIncompleteError extends Error {
  constructor(readonly operationId: string, cause: unknown) {
    super(`storage-relocation-incomplete: operation ${operationId} needs explicit recovery`, { cause });
  }
}

export type RelocationCommand = Readonly<{ kind: "plan" | "resume"; id: string; json: boolean }>;
export function parseRelocationCommand(args: readonly string[]): RelocationCommand {
  const [selector, value, ...tail] = args;
  if ((selector !== "--plan" && selector !== "--resume") || value === undefined || !UUID.safeParse(value).success
    || tail.some((item) => item !== "--json") || tail.filter((item) => item === "--json").length > 1) {
    throw new Error("storage-relocation-usage: use storage relocate --plan <command-id> or --resume <operation-id> [--json]");
  }
  return Object.freeze({ kind: selector === "--plan" ? "plan" : "resume", id: value, json: tail.length === 1 });
}

function digest(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())
    || (stat.mode & 0o022) !== 0) throw new Error("storage-relocation: unsafe verification file");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function sync(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }

function copyNativeSnapshot(source: string, destination: string, expectedSha256: string, operationId: string,
  admission: RuntimeAdmission, kind: "authority" | "archive"): void {
  if (kind === "authority") admission.assertAuthorityDatabase(destination);
  else admission.assertArchiveDatabase(destination);
  if (digest(source) !== expectedSha256) throw new Error("storage-relocation: native snapshot digest changed");
  const parent = dirname(destination);
  const candidate = join(parent, `.relocation-${operationId}-${basename(destination)}.tmp`);
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (digest(destination) !== expectedSha256) throw new Error("storage-relocation: existing native snapshot differs");
    const temporary = lstatSync(candidate, { throwIfNoEntry: false });
    if (temporary !== undefined) {
      if (existing.nlink !== 2 || temporary.nlink !== 2 || existing.dev !== temporary.dev
        || existing.ino !== temporary.ino) throw new Error("storage-relocation: ambiguous native snapshot publication");
      unlinkSync(candidate);
      sync(parent);
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
  const view = authority.withAuthorityTransaction((repositories) =>
    projectStorageRelocationPlanHistory(repositories, epoch, operation.readPriorReceipts(), workspace));
  const pending = view.pending;
  if (pending === null || canonicalJsonStringify(bindingFromPlan(view)) !== canonicalJsonStringify(inventory.plan)
    || pending.desiredPair.stateRoot !== inventory.destination.stateRoot
    || pending.desiredPair.artifactRoot !== inventory.destination.artifactRoot) {
    throw new Error("storage-relocation: pending plan changed");
  }
}

function stopProof(admission: RuntimeAdmission, workspace: string, clock: Clock) {
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  admission.assertFixedProcessLockRoot(workspace, processLockRoot);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"));
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
  const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: RESTORE_PROOF_MAX_AGE_MS }, clock);
  proofs.recordRuntimeState(snapshot);
  return proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity });
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
  if (existsSync(join(evidence.source.stateRoot, "archive.sqlite"))) {
    await verifyLifecyclePair(admission, `${evidence.backupManifestPath}.lifecycle.json`);
  }
}

function inventoryDigest(files: RelocationFileInventory): string {
  return createHash("sha256").update(canonicalJsonStringify({
    directories: files.directories.map((row) => [row.role, row.relativePath]),
    files: files.files.map((row) => [row.role, row.relativePath]),
  })).digest("hex");
}

function selectActivationIntent(operation: RuntimeRelocationOperation, admission: RuntimeAdmission,
  stageAuthority: VerifiedRelocationActivationIntent["stageAuthority"],
  stageArchive: VerifiedRelocationActivationIntent["stageArchive"], sourceFiles: RelocationFileInventory,
  preAuthority: Readonly<{ generation: number; fingerprint: string }>,
  clock: Clock, hostFactsInput?: HostConfigFacts): VerifiedRelocationActivationIntent {
  const inventory = operation.inventory();
  const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
    busyTimeoutMs: 5000, migrationOwner: "storage-relocation" }, clock);
  try {
    const previous = database.withAuthorityTransaction((repositories) => ({
      settings: readSettings(repositories), active: repositories.runtimeConfig.get() ?? null,
    }));
    const facts = hostFactsInput ?? hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay));
    const resolved = resolveConfigWithProvenance(previous.settings.settings, facts, clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
    const nativePath = join(admission.stateRoot, "state.db");
    return {
      operationId: inventory.operationId, installationId: inventory.installationId,
      sourceGeneration: inventory.fromGeneration, source: inventory.source, destination: inventory.destination,
      plan: inventory.plan, stageAuthority, stageArchive,
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
  verifiedStageBackupPath = intent.stageAuthority.backupPath): void {
  const clock = manualClock(new Date(intent.snapshot.capturedAt));
  const database = AuthorityDatabase.open(admission, { path: intent.nativeDestinationPath,
    busyTimeoutMs: 5000, migrationOwner: "storage-relocation" }, clock);
  try {
    const state = database.classifyRelocationActivation(intent, verifiedStageBackupPath);
    if (state === "prestate") {
      if (intent.nativeDestinationSha256 !== null
        && digest(intent.nativeDestinationPath) !== intent.nativeDestinationSha256) {
        throw new Error("storage-relocation: native destination changed before activation");
      }
      database.withAuthorityTransaction((repositories) => {
        repositories.configSnapshots.insert(intent.snapshot);
        repositories.runtimeConfig.activate({ settingsRevision: intent.settingsRevision,
          settingsFingerprint: intent.settingsFingerprint, configSnapshotId: intent.snapshot.configSnapshotId,
          configFingerprint: intent.snapshot.fingerprint, activatedAt: intent.snapshot.capturedAt });
      });
    }
    if (database.classifyRelocationActivation(intent, verifiedStageBackupPath) !== "committed") {
      throw new Error("storage-relocation: destination activation did not match intent");
    }
  } finally { database.close(); }
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
  if (intent.stageArchive !== null) {
    const pairedPath = physicalStagePath(operation, intent.stageArchive.pairedManifestPath);
    const archivePath = physicalStagePath(operation, intent.stageArchive.archivePath);
    if (digest(pairedPath) !== intent.stageArchive.pairedManifestSha256
      || digest(archivePath) !== intent.stageArchive.archiveSha256) {
      throw new Error("storage-relocation: retained archive stage changed");
    }
    const pair = await verifyLifecyclePair(destination, pairedPath);
    if (join(pair.root, pair.pair.archiveFile) !== archivePath) {
      throw new Error("storage-relocation: retained archive identity differs");
    }
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
  } finally { database.close(); }
  return evidence;
}

export async function runOfflineStorageRelocation(input: Readonly<{ workspace: string; command: RelocationCommand;
  admission?: RuntimeAdmission; clock?: Clock; hostFacts?: HostConfigFacts }>): Promise<Readonly<{ operationId: string; generation: number }>> {
  const workspace = resolve(input.workspace);
  const clock = input.clock ?? systemClock;
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  let admission = input.admission;
  let ownedAdmission = false;
  let operationId: string | undefined;
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, clock);
  try {
    let operation: RuntimeRelocationOperation;
    if (input.command.kind === "resume") {
      const binding = inspectPendingRelocationRecovery(workspace, input.command.id, restore);
      const recovered = acquireRecoveryRuntimeRelocation(workspace, binding, restore);
      admission = recovered.admission;
      ownedAdmission = true;
      operation = recovered.operation;
    } else {
      if (admission === undefined) throw new Error("storage-relocation: exclusive admission required");
      admission.assertExclusive();
      admission.assertFixedProcessLockRoot(workspace, processLockRoot);
      const source = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
        busyTimeoutMs: 5000, migrationOwner: "storage-relocation-plan", openMode: "storage-doctor-read-only-no-migrate" }, clock);
      let view;
      try { view = createStorageRelocationPlanReader({ authority: source, admission, workspace }).read(); }
      finally { source.close(); }
      if (view.pending?.commandId !== input.command.id) throw new Error("storage-relocation: requested plan is not current pending intent");
      operation = admission.beginRelocation(view.pending.desiredPair, bindingFromPlan(view), restore);
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
        if (inspected.schemaVersion !== NORMAL_AUTHORITY_SCHEMA_VERSION
          && inspected.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("storage-relocation: unsupported source schema");
        const report = await backupStoppedAuthority(admission, inventory.source.stateRoot, clock);
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
        if (existsSync(join(inventory.source.stateRoot, "archive.sqlite"))) await verifyLifecyclePair(admission, `${manifestPath}.lifecycle.json`);
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
      if (prepared.sourceSchemaVersion === NORMAL_AUTHORITY_SCHEMA_VERSION) {
        const stoppedSystemProof = stopProof(admission, workspace, clock);
        await upgradeRelocationCapabilityV56(admission, { workspaceRoot: workspace,
          stateRoot: inventory.source.stateRoot, processLockRoot,
          backupManifest: prepared.backupManifestPath,
          expectedSource: { authorityGeneration: prepared.sourceAuthorityGeneration,
            authorityContentFingerprint: prepared.sourceAuthorityContentFingerprint },
          stoppedSystemProof, heldRestoreAdmission: restore }, clock);
      }
      operation.prepareDestinationRoots();
      const source56 = inspectAuthorityBackupReadOnly(admission, sourcePath, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const stageBackup = await backupStoppedAuthority(admission, inventory.source.stateRoot, clock);
      const stageManifest = stageBackup.manifests.at(-1);
      if (stageManifest === undefined || stageManifest.authorityGeneration !== source56.authorityGeneration
        || stageManifest.authorityContentFingerprint !== source56.authorityContentFingerprint) {
        throw new Error("storage-relocation: native stage backup is stale");
      }
      const sourceFiles = inspectRelocationFiles({ admission, source: inventory.source,
        destination: inventory.destination, fixedLockRoot: processLockRoot, operation });
      const stageManifestPath = join(inventory.source.stateRoot, "backups", "authority", `${stageManifest.backupFileName}.manifest.json`);
      const verifiedStageBackup = await verifyBackupManifestAtPath(admission, stageManifestPath);
      const verifiedStagePair = "pairedManifestPath" in stageBackup
        ? await verifyLifecyclePair(admission, stageBackup.pairedManifestPath) : undefined;
      await verifyRelocationBackupTree({ admission, operation, stateRoot: inventory.source.stateRoot });
      verifyRelocationLiveReferences({ admission, source: inventory.source });
      const destination = operation.destinationAdmission();
      try {
        prepareRelocationDirectories({ destinationAdmission: destination, inventory: sourceFiles });
        if (inventory.source.stateRoot !== inventory.destination.stateRoot) {
          copyNativeSnapshot(verifiedStageBackup.backupPath, join(inventory.destination.stateRoot, "state.db"),
            verifiedStageBackup.manifest.sha256, inventory.operationId, destination, "authority");
          if (verifiedStagePair !== undefined) {
            copyNativeSnapshot(join(verifiedStagePair.root, verifiedStagePair.pair.archiveFile),
              join(inventory.destination.stateRoot, "archive.sqlite"),
              verifiedStagePair.pair.archiveDigest, inventory.operationId, destination, "archive");
          }
        }
        for (const file of sourceFiles.files) {
          if (file.role === "state" && (["state.db", "state.db-wal", "state.db-shm", "archive.sqlite", "archive.sqlite-wal", "archive.sqlite-shm"].includes(file.relativePath))) continue;
          copyRelocationFile({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles,
            file, operationId: inventory.operationId });
        }
        verifyRelocationFileCopies({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles });
        const stageAuthority = { manifestPath: verifiedStageBackup.manifestPath,
          manifestSha256: digest(verifiedStageBackup.manifestPath), backupPath: verifiedStageBackup.backupPath,
          backupSha256: digest(verifiedStageBackup.backupPath) };
        const stageArchive = verifiedStagePair === undefined ? null : {
          pairedManifestPath: `${stageManifestPath}.lifecycle.json`,
          pairedManifestSha256: digest(`${stageManifestPath}.lifecycle.json`),
          archivePath: join(verifiedStagePair.root, verifiedStagePair.pair.archiveFile),
          archiveSha256: digest(join(verifiedStagePair.root, verifiedStagePair.pair.archiveFile)),
        };
        const intent = selectActivationIntent(operation, destination, stageAuthority, stageArchive, sourceFiles,
          { generation: verifiedStageBackup.manifest.authorityGeneration,
            fingerprint: verifiedStageBackup.manifest.authorityContentFingerprint }, clock, input.hostFacts);
        operation.recordActivationIntent(() => {
          if (digest(intent.stageAuthority.manifestPath) !== intent.stageAuthority.manifestSha256
            || digest(intent.stageAuthority.backupPath) !== intent.stageAuthority.backupSha256
            || (intent.stageArchive !== null && (digest(intent.stageArchive.pairedManifestPath) !== intent.stageArchive.pairedManifestSha256
              || digest(intent.stageArchive.archivePath) !== intent.stageArchive.archiveSha256))) {
            throw new Error("storage-relocation: activation stage changed");
          }
          return intent;
        });
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
        || digest(intent.stageAuthority.backupPath) !== intent.stageAuthority.backupSha256
        || (intent.stageArchive !== null && (digest(intent.stageArchive.pairedManifestPath) !== intent.stageArchive.pairedManifestSha256
          || digest(intent.stageArchive.archivePath) !== intent.stageArchive.archiveSha256))) {
        throw new Error("storage-relocation: activation stage bytes changed");
      }
      const destination = operation.destinationAdmission();
      try {
        verifyRelocationFileCopies({ sourceAdmission: admission, destinationAdmission: destination, inventory: sourceFiles });
        applyActivationIntent(destination, intent);
        const finalBackup = await backupStoppedAuthority(destination, pending.destination.stateRoot, clock);
        const finalManifest = finalBackup.manifests.at(-1);
        if (finalManifest === undefined) throw new Error("storage-relocation: final backup missing");
        const finalManifestPath = join(pending.destination.stateRoot, "backups", "authority",
          `${finalManifest.backupFileName}.manifest.json`);
        const finalVerified = await verifyBackupManifestAtPath(destination, finalManifestPath);
        if (finalVerified.manifest.sha256 !== finalManifest.sha256) {
          throw new Error("storage-relocation: final backup identity changed");
        }
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
      } finally { destination.release(); }
    }
    if (operation.inventory().phase === "fenced" || operation.inventory().phase === "retaining") {
      operation.retainRelocationSources();
    }
    if (operation.inventory().phase === "retained") {
      const destination = operation.destinationAdmission();
      const source = operation.sourceVerificationAdmission();
      try {
        verifyRetainedRelocationCopies({ operation, sourceAdmission: source, destinationAdmission: destination });
        verifyRelocationLiveReferences({ admission: destination, source: operation.inventory().destination });
        const evidence = await verifyStageEvidence(operation, destination);
        operation.switchRelocationLocator(() => evidence);
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
