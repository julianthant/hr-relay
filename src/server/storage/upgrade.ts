import { readArchiveUpgradeJournal, beginArchiveUpgrade, finishArchiveUpgrade, hasHistoricalArchiveSources } from "../../infra/compat/archive-upgrade-journal.js";
import { backupLifecyclePair, verifyLifecyclePair } from "../../core/run-lifecycle-storage.js";
import { verifyGeneratedSelection, readGeneratedSourcesAtPath, generatedSourceDigest, preserveGeneratedSources, readPreservedGeneratedSources } from "../../infra/sqlite/generated-conversion.js";
import { timelineSourcesForUpgrade, preserveTimelineSources, readPreservedTimelineSources } from "../../infra/events/timeline-import.js";
/** D336 stopped conversion: SQLite settles first; credentials settle independently. */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { AuthorityUpgradeRecordSchema, TombstoneBackfillCountsSchema } from "../../domain/authority.js";
import { ProtectedSettingsCommandRequestSchema } from "../../domain/commands.js";
import { derivePersistedSettingsFingerprint } from "../../domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../domain/config/protected-settings.js";
import { createCredentialStore } from "../../infra/config/credential-store.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";
import { executeSettingsCommand } from "../../core/command-kernel.js";
import { createSettingsApplicationExecutor } from "../dashboard/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";

export const StorageUpgradeReportSchema = z.strictObject({
  state: z.enum(["planned", "converted", "already-upgraded"]),
  fromSchemaVersion: z.number().int().nonnegative(),
  toSchemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  importedKeys: z.array(z.string()), sourceFiles: z.array(z.string()),
  envKeysToRemove: z.array(z.string()),
  backupManifest: z.string().optional(),
  credentials: z.enum(["pending", "empty", "verified"]),
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
  if (selectedManifest === undefined && !existsSync(directory)) throw new Error("backup-required: run storage backup first");
  const names = selectedManifest === undefined ? readdirSync(directory).filter((name) => name.endsWith(".manifest.json")).sort().map(name=>join(directory,name)) : [selectedManifest];
  let matching: Awaited<ReturnType<typeof verifyBackupManifestAtPath>> | undefined;
  for (const name of names) {
    const verified = await verifyBackupManifestAtPath(name, AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")));
    if (verified.manifest.authorityGeneration === generation && verified.manifest.authorityContentFingerprint === fingerprint) matching = verified;
  }
  if (matching === undefined) throw new Error("backup-stale: run storage backup against the current authority first");
  const journal=readArchiveUpgradeJournal(stateRoot);
  if(journal!==undefined) {
    if(journal.sourceIdentity!==matching.manifest.sourceDatabaseIdentity || journal.backupSha256!==matching.manifest.sha256) throw new Error("archive-conversion-resume-mismatch");
    return matching;
  }
  if (existsSync(join(stateRoot,"archive.sqlite"))) {
    const paired=await verifyLifecyclePair(`${matching.manifestPath}.lifecycle.json`);
    const {ArchiveDatabase}=await import("../../infra/sqlite/archive-database.js");
    const archive=new ArchiveDatabase(join(stateRoot,"archive.sqlite"),{readOnly:true});
    try{if(archive.fingerprint()!==paired.pair.archiveFingerprint)throw new Error("archive-backup-stale");}finally{archive.close();}
  }
  return matching;
}

export async function upgradeStorage(input: StorageUpgradeInput, clock: Clock, acquireAdmission = acquireRuntimeRestoreAdmission): Promise<StorageUpgradeReport> {
  requireStopped(input, clock);
  const path = join(input.stateRoot, "state.db");
  const existed = existsSync(path);
  const { inspectAuthorityBackupReadOnly } = await import("../../infra/compat/backup-inspection.js");
  const { requireMigrationSourcePath } = await import("../../infra/compat/upgrade-sources.js");
  const { readLatestSettingsUpgrade, readSettingsUpgradeSources, convertSettingsDatabase, settleSettingsUpgrade, countOrphanGateRecords, inspectTombstoneBackfill, inspectHistoricalSettingsExposure } = await import("../../infra/compat/settings-database-upgrade.js");
  requireMigrationSourcePath(path);
  const inspection = existed ? inspectAuthorityBackupReadOnly(path) : undefined;
  const from = inspection?.schemaVersion ?? 0;
  const archiveJournal=readArchiveUpgradeJournal(input.stateRoot);
  if(archiveJournal!==undefined && archiveJournal.sourceIdentity!==AuthorityDatabase.sourceDatabaseIdentity(path))throw new Error("archive-conversion-resume-mismatch");
  const archiveRecordedAt = archiveJournal?.recordedAt ?? clock.now().toISOString();
  if (from === 0 && input.generatedSourceDirectory !== undefined) throw new Error("generated-source-copy-requires-retained-backup-authority");
  if (from === 0 && input.timelineSourceDirectory !== undefined) throw new Error("timeline-source-copy-requires-retained-backup-authority");
  let pending: z.infer<typeof AuthorityUpgradeRecordSchema> | undefined;
  let historicalPath: string | undefined;
  if (from >= 32 && from < CURRENT_AUTHORITY_SCHEMA_VERSION && readLatestSettingsUpgrade(path)?.phase === "committed") {
    throw new Error(`upgrade-pending: finish the interrupted schema-${String(from)} settings conversion with its original build before upgrading this database`);
  }
  if (from === CURRENT_AUTHORITY_SCHEMA_VERSION) {
    pending = readLatestSettingsUpgrade(path);
    if(archiveJournal!==undefined) {
      if(pending===undefined || !("format" in pending))throw new Error("archive-conversion-resume-mismatch");
      const original=await verifyBackupManifestAtPath(pending.backupManifest,AuthorityDatabase.sourceDatabaseIdentity(path));
      if(original.manifest.sha256!==archiveJournal.backupSha256)throw new Error("archive-conversion-resume-mismatch");
    }
    if (pending !== undefined && "format" in pending && pending.generatedImport !== undefined) {
      const backup = await verifyBackupManifestAtPath(pending.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      const manifest=readPreservedGeneratedSources(pending.generatedImport.copyDirectory, pending.generatedImport.manifestDigest, backup);
      if(input.generatedSourceDirectory!==undefined){
        verifyGeneratedSelection(input.generatedSourceDirectory,manifest,backup);
      }
    }
    if (pending === undefined || pending.phase === "settled") {
      if (!input.plan) finishArchiveUpgrade(input.stateRoot);
      const credentials = createCredentialStore({ stateRoot: input.stateRoot }).read();
      return StorageUpgradeReportSchema.parse({ state: "already-upgraded", fromSchemaVersion: from, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
        historicalExposure: pending !== undefined && "format" in pending ? pending.historicalExposure : [],
        tombstoneBackfill: pending !== undefined && "format" in pending ? pending.tombstoneBackfill : { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 },
        orphanGateRecordsRemoved: pending !== undefined && "format" in pending ? pending.orphanGateRecordsRemoved : 0,
        importedKeys: pending !== undefined && "format" in pending ? pending.importedKeys : [],
        sourceFiles: pending !== undefined && "format" in pending ? pending.sourceFiles : [],
        envKeysToRemove: pending?.phase === "settled" ? pending.envKeysToRemove : [], credentials: credentials.revision === 1 ? "empty" : "verified" });
    }
    if ("format" in pending && pending.backupManifest !== "fresh") {
      const original = await verifyBackupManifestAtPath(pending.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      historicalPath = original.backupPath;
    }
  }
  const sources = readSettingsUpgradeSources(input.stateRoot, input.environmentFile, from === CURRENT_AUTHORITY_SCHEMA_VERSION ? historicalPath : existed ? path : undefined, clock);
  if (pending !== undefined && "format" in pending
    && (pending.ordinaryFingerprint !== derivePersistedSettingsFingerprint(sources.settings)
      || canonicalJsonStringify(pending.importedKeys) !== canonicalJsonStringify(sources.importedKeys))) throw new Error("source-changed: committed SQLite conversion requires its original import sources");
  const backupEvidence = inspection !== undefined && from !== CURRENT_AUTHORITY_SCHEMA_VERSION
    ? await requiredBackup(input.stateRoot, inspection.authorityGeneration, inspection.authorityContentFingerprint, input.backupManifest) : undefined;
  const generatedSources = backupEvidence === undefined || from >= 46 ? undefined : readGeneratedSourcesAtPath(path,input.stateRoot,backupEvidence,input.generatedSourceDirectory);
  const generatedCopyDirectory = generatedSources === undefined || backupEvidence === undefined ? undefined
    : join(dirname(backupEvidence.manifestPath), "generated-sources", generatedSourceDigest(generatedSources));
  const timelineSources = backupEvidence === undefined ? undefined : timelineSourcesForUpgrade(input.stateRoot, backupEvidence, input.timelineSourceDirectory);
  const timelineCopyDirectory = timelineSources === undefined || backupEvidence === undefined ? undefined
    : join(dirname(backupEvidence.manifestPath), "timeline-sources", timelineSources.digest);
  if (from === 0 && existsSync(join(input.stateRoot, "spans")) && readdirSync(join(input.stateRoot, "spans")).length > 0) {
    throw new Error("timeline-import-owner-missing: file history requires its retained authority");
  }
  if (pending !== undefined && "format" in pending && pending.timelineImport?.state === "imported") {
    const original = await verifyBackupManifestAtPath(pending.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
    readPreservedTimelineSources(pending.timelineImport.copyDirectory, pending.timelineImport.manifestDigest, original);
  }
  const orphanGateRecords = from === CURRENT_AUTHORITY_SCHEMA_VERSION && pending !== undefined && "format" in pending ? pending.orphanGateRecordsRemoved : countOrphanGateRecords(existed ? path : undefined);
  const tombstones = inspectTombstoneBackfill(from === CURRENT_AUTHORITY_SCHEMA_VERSION ? undefined : existed ? path : undefined, input.stateRoot);
  const historicalExposure = pending !== undefined && "format" in pending ? pending.historicalExposure : inspectHistoricalSettingsExposure(existed ? path : undefined);
  const report = StorageUpgradeReportSchema.parse({ historicalExposure, tombstoneBackfill: pending !== undefined && "format" in pending ? pending.tombstoneBackfill : tombstones.counts, orphanGateRecordsRemoved: orphanGateRecords, state: "planned", fromSchemaVersion: from, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
    importedKeys: sources.importedKeys, sourceFiles: sources.sourceFiles, envKeysToRemove: sources.envKeysToRemove,
    ...(backupEvidence === undefined ? {} : { backupManifest: basename(backupEvidence.manifestPath) }), credentials: Object.keys(sources.protectedPatch).length === 0 ? "empty" : "pending" });
  const store = createCredentialStore({ stateRoot: input.stateRoot, hooks: { afterRename: input.hooks?.afterCredentialRename } });
  const priorCredentials = store.read();
  if (from !== CURRENT_AUTHORITY_SCHEMA_VERSION && Object.keys(sources.protectedPatch).length > 0 && priorCredentials.revision !== 1) {
    throw new Error("credential-source-conflict: existing independent credentials must not be overwritten by legacy import");
  }
  if (from !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
    const planned = convertSettingsDatabase({ ownsCredentialCommandId: store.ownsCommandId, archiveRecordedAt, input, path, existed, from, inspection, backupEvidence, sources, orphanGateRecords, tombstones, historicalExposure, timelineSources, timelineCopyDirectory, generatedSources, generatedCopyDirectory, verifyOnly: true }, clock);
    if (from < 32) store.verifyUpgradePreflight(planned.upgradeId, sources.protectedPatch);
  }
  if (from === CURRENT_AUTHORITY_SCHEMA_VERSION && pending !== undefined && "format" in pending && Object.keys(sources.protectedPatch).length > 0) {
    store.verifyUpgradeBinding(pending.upgradeId, sources.protectedPatch);
  }
  const credentialState = Object.keys(sources.protectedPatch).length === 0 && priorCredentials.revision > 1 ? "verified" : report.credentials;
  if (input.plan) return { ...report, credentials: credentialState };
  mkdirSync(input.stateRoot, { recursive: true, mode: 0o700 });
  const admission = acquireAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock);
  try {
    requireStopped(input, clock);
    if (timelineSources !== undefined && backupEvidence !== undefined) preserveTimelineSources(timelineSources, backupEvidence);
    if (generatedSources !== undefined && backupEvidence !== undefined) preserveGeneratedSources(generatedSources, backupEvidence);
    if (from !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
      if(backupEvidence!==undefined && hasHistoricalArchiveSources(path)) beginArchiveUpgrade(input.stateRoot,{schemaVersion:1,
        sourceIdentity:AuthorityDatabase.sourceDatabaseIdentity(path),backupSha256:backupEvidence.manifest.sha256,recordedAt:archiveRecordedAt});
      pending = convertSettingsDatabase({ ownsCredentialCommandId: store.ownsCommandId, archiveRecordedAt, input, path, existed, from, inspection, backupEvidence, sources, orphanGateRecords, tombstones, historicalExposure, timelineSources, timelineCopyDirectory, generatedSources, generatedCopyDirectory,
        bindCredentials: (upgradeId) => { if (Object.keys(sources.protectedPatch).length > 0) store.bindUpgrade(upgradeId, sources.protectedPatch); } }, clock);
    }
    if (pending === undefined || !("format" in pending)) throw new Error("upgrade-evidence-missing");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 5000, migrationOwner: "storage-upgrade-audit" }, clock);
    try {
      if (Object.keys(sources.protectedPatch).length > 0) {
        store.verifyUpgradeBinding(pending.upgradeId, sources.protectedPatch);
        const request = ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: pending.credentialCommandId,
          requestedAt: pending.recordedAt, requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "storage-upgrade", reason: pending.upgradeId,
          target: { expectedRevision: 1 }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: pending.credentialWriteId, entries: sources.protectedPatch } });
        const result = executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
          settings: createSettingsApplicationExecutor((settings) => resolveConfigWithProvenance(settings, { primaryDisplay: null }, clock), store) }, request);
        if (result.state !== "applied" && result.state !== "already-applied") throw new Error("credential-import-refused: SQLite conversion remains committed");
      }
      database.close();
      settleSettingsUpgrade(path, pending, clock.now().toISOString());
      finishArchiveUpgrade(input.stateRoot);
    } finally { database.close(); }
    return { ...report, state: "converted", credentials: Object.keys(sources.protectedPatch).length === 0 ? credentialState : "verified" };
  } finally { admission.release(); }
}

// Both stopped conversion commands share the composer's dynamic admission boundary.
export { restoreHistoricalStorage } from "./historical-restore.js";
