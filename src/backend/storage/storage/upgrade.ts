import { readExplorerOverrideSource } from "../sqlite/explorer-override-conversion.js";
import { backupHasArchiveTransferCustody } from "../compat/backup-inspection.js";
import { requireSupportedRecoverySchema, requireDatabaseSourcePath } from "../sqlite/recovery-admission.js";
import { inspectAuthorityBackupReadOnly } from "../compat/backup-inspection.js";
import { inspectRecoveryFloor, readLatestDatabaseUpgrade, convertStoppedDatabase, settleDatabaseUpgrade, inspectHistoricalSettingsExposure } from "../sqlite/stopped-database-conversion.js";
import { AuthorityCapabilityUpgradeRecordSchema, TombstoneBackfillCountsSchema } from "../../../domain/authority.js";
import { NORMAL_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, UPGRADE_FLOOR_SCHEMA_VERSION, isNormalAuthoritySchemaVersion } from "../sqlite/migrations.js";
import { readArchiveUpgradeJournal, beginArchiveUpgrade, finishArchiveUpgrade, hasHistoricalArchiveSources } from "../compat/archive-upgrade-journal.js";
import { backupLifecyclePair, verifyLifecyclePair } from "../sqlite/lifecycle-storage.js";
import { timelineSourcesForUpgrade, preserveTimelineSources, readPreservedTimelineSources } from "../events/timeline-import.js";
/** D336 stopped conversion: SQLite settles first; credentials settle independently. */
import { existsSync, readdirSync, mkdirSync, readFileSync, lstatSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { AuthorityDatabase, inspectConvertedAuthority, inspectNormalAuthority } from "../sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import { ArchiveDatabase } from "../sqlite/archive-database.js";
import { acquireRuntimeRestoreAdmission, observeProcessIdentity, observeRuntimeLockSnapshot, RestoreAdmissionFileSchema, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";
import { RecoveryStopProofStore } from "../sqlite/recovery-stop-proof.js";
import type { StoppedSystemProof } from "../sqlite/recovery-contracts.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";

export const StorageUpgradeReportSchema = z.strictObject({
  state: z.enum(["planned", "converted", "already-upgraded"]),
  fromSchemaVersion: z.number().int().nonnegative(),
  toSchemaVersion: z.union([z.literal(NORMAL_AUTHORITY_SCHEMA_VERSION), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]),
  importedKeys: z.array(z.string()), sourceFiles: z.array(z.string()),
  envKeysToRemove: z.array(z.string()),
  backupManifest: z.string().optional(),
  credentials: z.literal("unchanged"),
  historicalExposure: z.array(z.literal("operator.timekeeperName")),
  tombstoneBackfill: TombstoneBackfillCountsSchema,
  orphanGateRecordsRemoved: z.number().int().nonnegative(),
});
export type StorageUpgradeReport = z.infer<typeof StorageUpgradeReportSchema>;
export interface StorageUpgradeInput {
  readonly stateRoot: string;
  readonly processLockRoot: string;
  readonly environmentFile: string;
  readonly plan: boolean;
  readonly backupManifest?: string;
  readonly timelineSourceDirectory?: string;
  readonly generatedSourceDirectory?: string;
  readonly hooks?: Readonly<{ beforeCommit?(): void; afterCommit?(): void; afterCredentialRename?(): void; archiveStep?(step: "captured" | "verified" | "cleaned" | "published" | "retired"): void }>;
}

export interface RelocationCapabilityUpgradeInput {
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly processLockRoot: string;
  readonly backupManifest: string;
  readonly expectedSource: Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>;
  readonly stoppedSystemProof: StoppedSystemProof;
  readonly heldRestoreAdmission?: RestoreAdmissionHandle;
  readonly hooks?: Readonly<{ beforeCommit?(): void; afterCommit?(): void }>;
}

function assertHeldRestoreAdmission(runtimeAdmission: RuntimeAdmission, input: RelocationCapabilityUpgradeInput, admissionId: string): void {
  runtimeAdmission.assertFixedProcessLockRoot(input.workspaceRoot, input.processLockRoot);
  const directory = lstatSync(input.processLockRoot);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (process.getuid && directory.uid !== process.getuid())
    || (directory.mode & 0o777) !== 0o700) throw new Error("restore-admission-invalid-root");
  const path = join(input.processLockRoot, "restore-admission.lock.json");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())
    || (stat.mode & 0o777) !== 0o600) throw new Error("restore-admission-invalid");
  const record = RestoreAdmissionFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const observed = observeProcessIdentity(process.pid);
  if (record.schemaVersion !== 2 || observed.state !== "alive" || record.admissionId !== admissionId
    || record.pid !== process.pid || record.processIdentity.platform !== observed.identity.platform
    || record.processIdentity.startToken !== observed.identity.startToken) throw new Error("restore-admission-identity-mismatch");
}

/** Explicit stopped capability fence. Ordinary v55 admission never calls this. */
export async function upgradeRelocationCapabilityV56(
  runtimeAdmission: RuntimeAdmission,
  input: RelocationCapabilityUpgradeInput,
  clock: Clock,
): Promise<"converted" | "already-upgraded"> {
  requireRuntimeAdmission(runtimeAdmission).assertExclusive();
  runtimeAdmission.assertStateRoot(input.stateRoot);
  runtimeAdmission.assertFixedProcessLockRoot(input.workspaceRoot, input.processLockRoot);
  const path = join(input.stateRoot, "state.db");
  runtimeAdmission.assertAuthorityDatabase(path);
  requireDatabaseSourcePath(path);
  const sourceIdentity = AuthorityDatabase.sourceDatabaseIdentity(path);
  const current = inspectAuthorityBackupReadOnly(runtimeAdmission, path);
  const verified = await verifyBackupManifestAtPath(runtimeAdmission, input.backupManifest, sourceIdentity);
  if (verified.manifest.schemaVersion !== NORMAL_AUTHORITY_SCHEMA_VERSION
    || verified.manifest.authorityGeneration !== input.expectedSource.authorityGeneration
    || verified.manifest.authorityContentFingerprint !== input.expectedSource.authorityContentFingerprint) {
    throw new Error("capability-upgrade-backup-source-mismatch");
  }
  if (current.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) {
    const prior = readLatestDatabaseUpgrade(runtimeAdmission, path);
    if (prior?.phase === "settled" && "format" in prior && prior.format === 4
      && prior.sourceGeneration === input.expectedSource.authorityGeneration
      && prior.sourceFingerprint === input.expectedSource.authorityContentFingerprint
      && prior.backupManifest === verified.manifestPath && prior.backupSha256 === verified.manifest.sha256) return "already-upgraded";
    throw new Error("capability-upgrade-replay-divergent");
  }
  if (current.schemaVersion !== NORMAL_AUTHORITY_SCHEMA_VERSION
    || current.authorityGeneration !== input.expectedSource.authorityGeneration
    || current.authorityContentFingerprint !== input.expectedSource.authorityContentFingerprint) {
    throw new Error("capability-upgrade-source-changed");
  }
  await requiredBackup(runtimeAdmission, input.stateRoot, current.authorityGeneration,
    current.authorityContentFingerprint, verified.manifestPath);
  runtimeAdmission.assertAuthorityDatabase(path);
  const ownedRestore = input.heldRestoreAdmission === undefined
    ? acquireRuntimeRestoreAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock)
    : undefined;
  try {
    assertHeldRestoreAdmission(runtimeAdmission, input, input.heldRestoreAdmission?.admissionId ?? ownedRestore?.admissionId ?? "");
    requireStopped({ stateRoot: input.stateRoot, processLockRoot: input.processLockRoot,
      environmentFile: "", plan: false }, clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot: input.processLockRoot, maxProofAgeMs: 5 * 60_000 }, clock);
    proofs.consumeAgainstLiveSnapshot(input.stoppedSystemProof,
      observeRuntimeLockSnapshot({ processLockRoot: input.processLockRoot, sourceDatabaseIdentity: sourceIdentity }, clock));
    const again = inspectAuthorityBackupReadOnly(runtimeAdmission, path);
    if (again.schemaVersion !== NORMAL_AUTHORITY_SCHEMA_VERSION
      || again.authorityGeneration !== current.authorityGeneration
      || again.authorityContentFingerprint !== current.authorityContentFingerprint) throw new Error("capability-upgrade-source-changed");
    runtimeAdmission.assertAuthorityDatabase(path);
    assertHeldRestoreAdmission(runtimeAdmission, input, input.heldRestoreAdmission?.admissionId ?? ownedRestore?.admissionId ?? "");
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false, allowExtension: false, readBigInts: false,
      returnArrays: false, allowBareNamedParameters: false, allowUnknownNamedParameters: false, defensive: true });
    let committed = false;
    try {
      database.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; BEGIN EXCLUSIVE");
      const inside = inspectNormalAuthority(database);
      if (inside.schemaVersion !== NORMAL_AUTHORITY_SCHEMA_VERSION
        || inside.authorityGeneration !== current.authorityGeneration
        || inside.authorityContentFingerprint !== current.authorityContentFingerprint) throw new Error("capability-upgrade-source-changed");
      const migration = SQLITE_MIGRATIONS.find((entry) => entry.version === CURRENT_AUTHORITY_SCHEMA_VERSION);
      if (migration === undefined || migration.statements.length !== 0) throw new Error("capability-upgrade-not-version-only");
      const now = clock.now().toISOString();
      const record = AuthorityCapabilityUpgradeRecordSchema.parse({
        format: 4, recordKey: randomUUID(), upgradeId: sha256Hex(canonicalJsonStringify({
          sourceIdentity, generation: current.authorityGeneration, fingerprint: current.authorityContentFingerprint,
          backupSha256: verified.manifest.sha256, target: CURRENT_AUTHORITY_SCHEMA_VERSION,
        })), phase: "settled", fromSchemaVersion: NORMAL_AUTHORITY_SCHEMA_VERSION,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: now,
        sourceGeneration: current.authorityGeneration, sourceFingerprint: current.authorityContentFingerprint,
        backupManifest: verified.manifestPath, backupSha256: verified.manifest.sha256,
      });
      database.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)")
        .run(record.recordKey, record.upgradeId, record.phase, canonicalJsonStringify(record), now);
      database.prepare("UPDATE database_state SET schema_version = 56, authority_generation = authority_generation + 1, updated_at = ? WHERE singleton_id = 1")
        .run(now);
      database.exec("PRAGMA user_version = 56");
      inspectConvertedAuthority(database);
      input.hooks?.beforeCommit?.();
      runtimeAdmission.assertAuthorityDatabase(path);
      assertHeldRestoreAdmission(runtimeAdmission, input, input.heldRestoreAdmission?.admissionId ?? ownedRestore?.admissionId ?? "");
      database.exec("COMMIT");
      committed = true;
      input.hooks?.afterCommit?.();
    } catch (error) {
      if (!committed && database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally { database.close(); }
    const after = inspectAuthorityBackupReadOnly(runtimeAdmission, path);
    if (after.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION
      || after.authorityGeneration !== current.authorityGeneration + 1) throw new Error("capability-upgrade-postcheck-failed");
    return "converted";
  } finally { ownedRestore?.release(); }
}

function requireStopped(input: StorageUpgradeInput, clock: Clock): void {
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot: input.processLockRoot,
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(input.stateRoot, "state.db")) }, clock);
  if (Object.values(snapshot.processLocks).some((lock) => lock.state === "active")) throw new Error("runtime-active: stop server and workers before storage upgrade");
}

function archiveNeedsIndexUpgrade(runtimeAdmission:RuntimeAdmission,stateRoot: string): boolean {
  const path = join(stateRoot, "archive.sqlite");
  if (!existsSync(path)) return false;
  const archive = new ArchiveDatabase(runtimeAdmission,path, { readOnly: true });
  try { return archive.schemaVersion === 1; } finally { archive.close(); }
}

/** Read-only legacy source for the existing explicit backup writer. No credential access. */
export async function backupStoppedAuthority(runtimeAdmission:RuntimeAdmission,stateRoot: string, clock: Clock) {
  requireRuntimeAdmission(runtimeAdmission).assertStateRoot(stateRoot);
  const path = join(stateRoot, "state.db");
  const { openAuthorityBackupSourceReadOnly } = await import("../compat/backup-inspection.js");
  const source = openAuthorityBackupSourceReadOnly(runtimeAdmission,path);
  try {
    return await backupLifecyclePair(runtimeAdmission,source,stateRoot,clock);
  } finally { source.close(); }
}

async function requiredBackup(runtimeAdmission:RuntimeAdmission,stateRoot: string, generation: number, fingerprint: string, selectedManifest?: string) {
  const directory = join(stateRoot, "backups", "authority");
  const journal=readArchiveUpgradeJournal(stateRoot);
  const requiresPair=journal===undefined && existsSync(join(stateRoot,"archive.sqlite"));
  if (!existsSync(join(stateRoot,"archive.sqlite")) && backupHasArchiveTransferCustody(runtimeAdmission,join(stateRoot,"state.db"))) throw new Error("archive-database-missing");
  if (selectedManifest === undefined && !existsSync(directory)) throw new Error("backup-required: run storage backup first");
  const names = selectedManifest === undefined ? readdirSync(directory).filter((name) => name.endsWith(".manifest.json")).sort().map(name=>join(directory,name)) : [selectedManifest];
  let matching: Awaited<ReturnType<typeof verifyBackupManifestAtPath>> | undefined;
  for (const name of names) {
    const verified = await verifyBackupManifestAtPath(runtimeAdmission,name, AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")));
    if (verified.manifest.authorityGeneration === generation && verified.manifest.authorityContentFingerprint === fingerprint) {
      // A live manifest is not publication of a completed lifecycle pair.
      if (requiresPair && !existsSync(`${verified.manifestPath}.lifecycle.json`)) {
        if (selectedManifest !== undefined) throw new Error("paired-lifecycle-backup-required");
        continue;
      }
      matching = verified;
    }
  }
  if (matching === undefined) throw new Error("backup-stale: run storage backup against the current authority first");
  if(journal!==undefined) {
    if(journal.sourceIdentity!==matching.manifest.sourceDatabaseIdentity || journal.backupSha256!==matching.manifest.sha256) throw new Error("archive-conversion-resume-mismatch");
    return matching;
  }
  if (existsSync(join(stateRoot,"archive.sqlite"))) {
    const paired=await verifyLifecyclePair(runtimeAdmission,`${matching.manifestPath}.lifecycle.json`);
    const {ArchiveDatabase}=await import("../sqlite/archive-database.js");
    const archive=new ArchiveDatabase(runtimeAdmission,join(stateRoot,"archive.sqlite"),{readOnly:true});
    try{
      if(archive.fingerprint()!==paired.pair.archiveFingerprint)throw new Error("archive-backup-stale");
      for(const file of archive.files()) archive.readFile(file);
    }finally{archive.close();}
  }
  return matching;
}

export async function upgradeStorage(runtimeAdmission:RuntimeAdmission,input: StorageUpgradeInput, clock: Clock, acquireAdmission = acquireRuntimeRestoreAdmission): Promise<StorageUpgradeReport> {
  requireRuntimeAdmission(runtimeAdmission).assertExclusive();
  runtimeAdmission.assertStateRoot(input.stateRoot);
  requireStopped(input, clock);
  const path = join(input.stateRoot, "state.db");
  requireDatabaseSourcePath(path);
  const existed = existsSync(path);
  if (existed) inspectRecoveryFloor(runtimeAdmission,path);
  const inspection = existed ? inspectAuthorityBackupReadOnly(runtimeAdmission,path) : undefined;
  const from = inspection?.schemaVersion ?? 0;
  if (existed) requireSupportedRecoverySchema(from);
  if (input.generatedSourceDirectory !== undefined) throw new Error("generated-source-import-retired: use the original compatible release");
  const archiveJournal = readArchiveUpgradeJournal(input.stateRoot);
  if (archiveJournal !== undefined && archiveJournal.sourceIdentity !== AuthorityDatabase.sourceDatabaseIdentity(path)) throw new Error("archive-conversion-resume-mismatch");
  const prior = existed ? readLatestDatabaseUpgrade(runtimeAdmission,path) : undefined;
  if (prior?.phase === "committed") {
    if (!("format" in prior) || (prior.fromSchemaVersion !== 0 && prior.fromSchemaVersion < UPGRADE_FLOOR_SCHEMA_VERSION)
      || prior.importedKeys.length > 0 || prior.sourceFiles.length > 0 || prior.envKeysToRemove.length > 0 || prior.generatedImport !== undefined) {
      throw new Error("upgrade-pending: finish the interrupted settings conversion with its original compatible release");
    }
    if (from !== prior.toSchemaVersion) throw new Error("upgrade-pending: finish the interrupted database conversion with its original compatible release");
  }
  if (isNormalAuthoritySchemaVersion(from)) {
    const archiveNeedsUpgrade = archiveNeedsIndexUpgrade(runtimeAdmission,input.stateRoot);
    if (archiveJournal !== undefined) {
      if (prior === undefined || !("format" in prior)) throw new Error("archive-conversion-resume-mismatch");
      const backup = await verifyBackupManifestAtPath(runtimeAdmission,prior.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      if (backup.manifest.sha256 !== archiveJournal.backupSha256) throw new Error("archive-conversion-resume-mismatch");
    }
    if (prior !== undefined && "format" in prior && prior.phase === "committed" && prior.timelineImport?.state === "imported") {
      const backup = await verifyBackupManifestAtPath(runtimeAdmission,prior.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      readPreservedTimelineSources(prior.timelineImport.copyDirectory, prior.timelineImport.manifestDigest, backup);
    }
    const archiveBackup = archiveNeedsUpgrade && prior?.phase !== "committed" && inspection !== undefined
      ? await requiredBackup(runtimeAdmission,input.stateRoot, inspection.authorityGeneration, inspection.authorityContentFingerprint, input.backupManifest)
      : undefined;
    if (archiveNeedsUpgrade && prior?.phase === "committed") {
      if (!("format" in prior) || prior.backupManifest === "fresh") throw new Error("paired-lifecycle-backup-required");
      await verifyLifecyclePair(runtimeAdmission,`${prior.backupManifest}.lifecycle.json`);
    }
    if (!input.plan && (prior?.phase === "committed" || archiveJournal !== undefined || archiveNeedsUpgrade)) {
      const admission = acquireAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock);
      try {
        requireStopped(input, clock);
        const again = inspectAuthorityBackupReadOnly(runtimeAdmission,path);
        if (again.authorityContentFingerprint !== inspection?.authorityContentFingerprint) throw new Error("source-changed: re-plan upgrade");
        if (archiveNeedsUpgrade) {
          if (archiveBackup === undefined && prior?.phase !== "committed") throw new Error("paired-lifecycle-backup-required");
          ArchiveDatabase.upgradeStopped(runtimeAdmission,join(input.stateRoot, "archive.sqlite"));
        }
        if (prior?.phase === "committed") settleDatabaseUpgrade(runtimeAdmission,path, prior, clock.now().toISOString());
        finishArchiveUpgrade(input.stateRoot);
      } finally { admission.release(); }
    }
    return reportFor(!input.plan && (prior?.phase === "committed" || archiveNeedsUpgrade) ? "converted"
      : input.plan && archiveNeedsUpgrade ? "planned" : "already-upgraded", from);
  }
  const backupEvidence = inspection === undefined ? undefined : await requiredBackup(runtimeAdmission,input.stateRoot, inspection.authorityGeneration, inspection.authorityContentFingerprint, input.backupManifest);
  const timelineSources = backupEvidence === undefined ? undefined : timelineSourcesForUpgrade(input.stateRoot, backupEvidence, input.timelineSourceDirectory);
  const timelineCopyDirectory = timelineSources === undefined || backupEvidence === undefined ? undefined : join(dirname(backupEvidence.manifestPath), "timeline-sources", timelineSources.digest);
  const explorerSource = readExplorerOverrideSource(input.stateRoot);
  const historicalExposure = inspectHistoricalSettingsExposure(runtimeAdmission,existed ? path : undefined);
  const args = { runtimeAdmission,input, path, existed, from, inspection, backupEvidence, timelineSources, timelineCopyDirectory, explorerSource, historicalExposure,
    archiveRecordedAt: archiveJournal?.recordedAt ?? clock.now().toISOString() };
  convertStoppedDatabase({ ...args, verifyOnly: true }, clock);
  const report = reportFor("planned", from, historicalExposure, backupEvidence?.manifestPath);
  if (input.plan) return report;
  mkdirSync(input.stateRoot, { recursive: true, mode: 0o700 });
  const admission = acquireAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock);
  try {
    requireStopped(input, clock);
    if (timelineSources !== undefined && backupEvidence !== undefined) preserveTimelineSources(timelineSources, backupEvidence);
    if (backupEvidence !== undefined && hasHistoricalArchiveSources(runtimeAdmission,path)) beginArchiveUpgrade(input.stateRoot, { schemaVersion: 1,
      sourceIdentity: AuthorityDatabase.sourceDatabaseIdentity(path), backupSha256: backupEvidence.manifest.sha256, recordedAt: args.archiveRecordedAt });
    const pending = convertStoppedDatabase(args, clock);
    if (archiveNeedsIndexUpgrade(runtimeAdmission,input.stateRoot)) ArchiveDatabase.upgradeStopped(runtimeAdmission,join(input.stateRoot, "archive.sqlite"));
    settleDatabaseUpgrade(runtimeAdmission,path, pending, clock.now().toISOString());
    finishArchiveUpgrade(input.stateRoot);
    return { ...report, state: "converted" };
  } finally { admission.release(); }
}

function reportFor(state: StorageUpgradeReport["state"], from: number, historicalExposure: readonly "operator.timekeeperName"[] = [], backupManifest?: string): StorageUpgradeReport {
  return StorageUpgradeReportSchema.parse({ state, fromSchemaVersion: from,
    toSchemaVersion: from === CURRENT_AUTHORITY_SCHEMA_VERSION ? CURRENT_AUTHORITY_SCHEMA_VERSION : NORMAL_AUTHORITY_SCHEMA_VERSION,
    historicalExposure, importedKeys: [], sourceFiles: [], envKeysToRemove: [], orphanGateRecordsRemoved: 0,
    tombstoneBackfill: { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 },
    credentials: "unchanged", ...(backupManifest === undefined ? {} : { backupManifest: basename(backupManifest) }) });
}

// Both stopped conversion commands share the composer's dynamic admission boundary.
