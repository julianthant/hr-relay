import { readExplorerOverrideSource } from "../../infra/sqlite/explorer-override-conversion.js";
import { backupHasArchiveTransferCustody } from "../../infra/compat/backup-inspection.js";
import { requireSupportedRecoverySchema, requireDatabaseSourcePath } from "../../infra/sqlite/recovery-admission.js";
import { inspectAuthorityBackupReadOnly } from "../../infra/compat/backup-inspection.js";
import { inspectRecoveryFloor, readLatestDatabaseUpgrade, convertStoppedDatabase, settleDatabaseUpgrade, inspectHistoricalSettingsExposure } from "../../infra/sqlite/stopped-database-conversion.js";
import { TombstoneBackfillCountsSchema } from "../../domain/authority.js";
import { UPGRADE_FLOOR_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { readArchiveUpgradeJournal, beginArchiveUpgrade, finishArchiveUpgrade, hasHistoricalArchiveSources } from "../../infra/compat/archive-upgrade-journal.js";
import { backupLifecyclePair, verifyLifecyclePair } from "../../infra/sqlite/lifecycle-storage.js";
import { timelineSourcesForUpgrade, preserveTimelineSources, readPreservedTimelineSources } from "../../infra/events/timeline-import.js";
/** D336 stopped conversion: SQLite settles first; credentials settle independently. */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { ArchiveDatabase } from "../../infra/sqlite/archive-database.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";

export const StorageUpgradeReportSchema = z.strictObject({
  state: z.enum(["planned", "converted", "already-upgraded"]),
  fromSchemaVersion: z.number().int().nonnegative(),
  toSchemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
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

function requireStopped(input: StorageUpgradeInput, clock: Clock): void {
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot: input.processLockRoot,
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(input.stateRoot, "state.db")) }, clock);
  if (Object.values(snapshot.processLocks).some((lock) => lock.state === "active")) throw new Error("runtime-active: stop server and workers before storage upgrade");
}

function archiveNeedsIndexUpgrade(stateRoot: string): boolean {
  const path = join(stateRoot, "archive.sqlite");
  if (!existsSync(path)) return false;
  const archive = new ArchiveDatabase(path, { readOnly: true });
  try { return archive.schemaVersion === 1; } finally { archive.close(); }
}

/** Read-only legacy source for the existing explicit backup writer. No credential access. */
export async function backupStoppedAuthority(stateRoot: string, clock: Clock) {
  const path = join(stateRoot, "state.db");
  const { openAuthorityBackupSourceReadOnly } = await import("../../infra/compat/backup-inspection.js");
  const source = openAuthorityBackupSourceReadOnly(path);
  try {
    return await backupLifecyclePair(source,stateRoot,clock);
  } finally { source.close(); }
}

async function requiredBackup(stateRoot: string, generation: number, fingerprint: string, selectedManifest?: string) {
  const directory = join(stateRoot, "backups", "authority");
  const journal=readArchiveUpgradeJournal(stateRoot);
  const requiresPair=journal===undefined && existsSync(join(stateRoot,"archive.sqlite"));
  if (!existsSync(join(stateRoot,"archive.sqlite")) && backupHasArchiveTransferCustody(join(stateRoot,"state.db"))) throw new Error("archive-database-missing");
  if (selectedManifest === undefined && !existsSync(directory)) throw new Error("backup-required: run storage backup first");
  const names = selectedManifest === undefined ? readdirSync(directory).filter((name) => name.endsWith(".manifest.json")).sort().map(name=>join(directory,name)) : [selectedManifest];
  let matching: Awaited<ReturnType<typeof verifyBackupManifestAtPath>> | undefined;
  for (const name of names) {
    const verified = await verifyBackupManifestAtPath(name, AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")));
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
    const paired=await verifyLifecyclePair(`${matching.manifestPath}.lifecycle.json`);
    const {ArchiveDatabase}=await import("../../infra/sqlite/archive-database.js");
    const archive=new ArchiveDatabase(join(stateRoot,"archive.sqlite"),{readOnly:true});
    try{
      if(archive.fingerprint()!==paired.pair.archiveFingerprint)throw new Error("archive-backup-stale");
      for(const file of archive.files()) archive.readFile(file);
    }finally{archive.close();}
  }
  return matching;
}

export async function upgradeStorage(input: StorageUpgradeInput, clock: Clock, acquireAdmission = acquireRuntimeRestoreAdmission): Promise<StorageUpgradeReport> {
  requireStopped(input, clock);
  const path = join(input.stateRoot, "state.db");
  requireDatabaseSourcePath(path);
  const existed = existsSync(path);
  if (existed) inspectRecoveryFloor(path);
  const inspection = existed ? inspectAuthorityBackupReadOnly(path) : undefined;
  const from = inspection?.schemaVersion ?? 0;
  if (existed) requireSupportedRecoverySchema(from);
  if (input.generatedSourceDirectory !== undefined) throw new Error("generated-source-import-retired: use the original compatible release");
  const archiveJournal = readArchiveUpgradeJournal(input.stateRoot);
  if (archiveJournal !== undefined && archiveJournal.sourceIdentity !== AuthorityDatabase.sourceDatabaseIdentity(path)) throw new Error("archive-conversion-resume-mismatch");
  const prior = existed ? readLatestDatabaseUpgrade(path) : undefined;
  if (prior?.phase === "committed") {
    if (!("format" in prior) || (prior.fromSchemaVersion !== 0 && prior.fromSchemaVersion < UPGRADE_FLOOR_SCHEMA_VERSION)
      || prior.importedKeys.length > 0 || prior.sourceFiles.length > 0 || prior.envKeysToRemove.length > 0 || prior.generatedImport !== undefined) {
      throw new Error("upgrade-pending: finish the interrupted settings conversion with its original compatible release");
    }
    if (from !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("upgrade-pending: finish the interrupted database conversion with its original compatible release");
  }
  if (from === CURRENT_AUTHORITY_SCHEMA_VERSION) {
    const archiveNeedsUpgrade = archiveNeedsIndexUpgrade(input.stateRoot);
    if (archiveJournal !== undefined) {
      if (prior === undefined || !("format" in prior)) throw new Error("archive-conversion-resume-mismatch");
      const backup = await verifyBackupManifestAtPath(prior.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      if (backup.manifest.sha256 !== archiveJournal.backupSha256) throw new Error("archive-conversion-resume-mismatch");
    }
    if (prior !== undefined && "format" in prior && prior.phase === "committed" && prior.timelineImport?.state === "imported") {
      const backup = await verifyBackupManifestAtPath(prior.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      readPreservedTimelineSources(prior.timelineImport.copyDirectory, prior.timelineImport.manifestDigest, backup);
    }
    const archiveBackup = archiveNeedsUpgrade && prior?.phase !== "committed" && inspection !== undefined
      ? await requiredBackup(input.stateRoot, inspection.authorityGeneration, inspection.authorityContentFingerprint, input.backupManifest)
      : undefined;
    if (archiveNeedsUpgrade && prior?.phase === "committed") {
      if (!("format" in prior) || prior.backupManifest === "fresh") throw new Error("paired-lifecycle-backup-required");
      await verifyLifecyclePair(`${prior.backupManifest}.lifecycle.json`);
    }
    if (!input.plan && (prior?.phase === "committed" || archiveJournal !== undefined || archiveNeedsUpgrade)) {
      const admission = acquireAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock);
      try {
        requireStopped(input, clock);
        const again = inspectAuthorityBackupReadOnly(path);
        if (again.authorityContentFingerprint !== inspection?.authorityContentFingerprint) throw new Error("source-changed: re-plan upgrade");
        if (archiveNeedsUpgrade) {
          if (archiveBackup === undefined && prior?.phase !== "committed") throw new Error("paired-lifecycle-backup-required");
          ArchiveDatabase.upgradeStopped(join(input.stateRoot, "archive.sqlite"));
        }
        if (prior?.phase === "committed") settleDatabaseUpgrade(path, prior, clock.now().toISOString());
        finishArchiveUpgrade(input.stateRoot);
      } finally { admission.release(); }
    }
    return reportFor(!input.plan && (prior?.phase === "committed" || archiveNeedsUpgrade) ? "converted"
      : input.plan && archiveNeedsUpgrade ? "planned" : "already-upgraded", from);
  }
  const backupEvidence = inspection === undefined ? undefined : await requiredBackup(input.stateRoot, inspection.authorityGeneration, inspection.authorityContentFingerprint, input.backupManifest);
  const timelineSources = backupEvidence === undefined ? undefined : timelineSourcesForUpgrade(input.stateRoot, backupEvidence, input.timelineSourceDirectory);
  const timelineCopyDirectory = timelineSources === undefined || backupEvidence === undefined ? undefined : join(dirname(backupEvidence.manifestPath), "timeline-sources", timelineSources.digest);
  const explorerSource = readExplorerOverrideSource(input.stateRoot);
  const historicalExposure = inspectHistoricalSettingsExposure(existed ? path : undefined);
  const args = { input, path, existed, from, inspection, backupEvidence, timelineSources, timelineCopyDirectory, explorerSource, historicalExposure,
    archiveRecordedAt: archiveJournal?.recordedAt ?? clock.now().toISOString() };
  convertStoppedDatabase({ ...args, verifyOnly: true }, clock);
  const report = reportFor("planned", from, historicalExposure, backupEvidence?.manifestPath);
  if (input.plan) return report;
  mkdirSync(input.stateRoot, { recursive: true, mode: 0o700 });
  const admission = acquireAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock);
  try {
    requireStopped(input, clock);
    if (timelineSources !== undefined && backupEvidence !== undefined) preserveTimelineSources(timelineSources, backupEvidence);
    if (backupEvidence !== undefined && hasHistoricalArchiveSources(path)) beginArchiveUpgrade(input.stateRoot, { schemaVersion: 1,
      sourceIdentity: AuthorityDatabase.sourceDatabaseIdentity(path), backupSha256: backupEvidence.manifest.sha256, recordedAt: args.archiveRecordedAt });
    const pending = convertStoppedDatabase(args, clock);
    if (archiveNeedsIndexUpgrade(input.stateRoot)) ArchiveDatabase.upgradeStopped(join(input.stateRoot, "archive.sqlite"));
    settleDatabaseUpgrade(path, pending, clock.now().toISOString());
    finishArchiveUpgrade(input.stateRoot);
    return { ...report, state: "converted" };
  } finally { admission.release(); }
}

function reportFor(state: StorageUpgradeReport["state"], from: number, historicalExposure: readonly "operator.timekeeperName"[] = [], backupManifest?: string): StorageUpgradeReport {
  return StorageUpgradeReportSchema.parse({ state, fromSchemaVersion: from, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
    historicalExposure, importedKeys: [], sourceFiles: [], envKeysToRemove: [], orphanGateRecordsRemoved: 0,
    tombstoneBackfill: { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 },
    credentials: "unchanged", ...(backupManifest === undefined ? {} : { backupManifest: basename(backupManifest) }) });
}

// Both stopped conversion commands share the composer's dynamic admission boundary.
