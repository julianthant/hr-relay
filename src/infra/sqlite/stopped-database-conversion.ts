import { backfillArchivedTransactionSelection, indexArchivedTransactionSnapshot } from "./transaction-selection.js";
import { rebuildRunSearchForUpgrade } from "./run-search-index.js";
import { assertExplorerOverrideSourceUnchanged, importExplorerOverrides, type ExplorerOverrideSourceSnapshot } from "./explorer-override-conversion.js";
import { AuthorityDatabase } from "./authority-database.js";
import type { RuntimeAdmission } from "../runtime-control/admission.js";
import { requireSupportedRecoverySchema } from "./recovery-admission.js";
import { createRunSummaries } from "./run-summaries.js";
import { convertHistoricalArchives } from "../../services/archive/archive-transfer.js";
import { createRunLifecycleStorage } from "./lifecycle-storage.js";
import { ArchiveDatabase } from "./archive-database.js";
import { HistoricalVersionChangeSchema } from "./storage-records.js";
import { join } from "node:path";
import { assertFoundationRetirement } from "./foundation-retirement.js";
import { readAppSettings } from "./settings-storage.js";
import { timelineSourcesForUpgrade, readPreservedTimelineSources, type TimelineSourceSnapshot } from "../events/timeline-import.js";
import { freezeConvertedArchiveTransactions } from "./timeline-conversion.js";
import { DatabaseSync } from "node:sqlite";
import { openSync, closeSync, lstatSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { AuthorityUpgradeRecordSchema } from "../../domain/authority.js";
import { derivePersistedSettingsFingerprint } from "../../domain/config/settings.js";
import { withStoppedArchiveConversion, inspectConvertedAuthority } from "./authority-database.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, databaseStateTable, databaseUpgradesTable, settingsSnapshotsTable } from "./migrations.js";
import type { verifyBackupManifestAtPath } from "./backup-service.js";
import { withAuthorityDatabaseReadOnly, inspectOpenDatabase, type BackupCopyInspection } from "../compat/backup-inspection.js";
const RowSchema = z.strictObject({ record_json: z.string() });
const VersionSchema = z.strictObject({ user_version: z.number().int().nonnegative() });
const GenerationSchema = z.strictObject({ authority_generation: z.number().int().nonnegative() });
type UpgradeRecord = z.infer<typeof AuthorityUpgradeRecordSchema>;
type ConversionInput = Readonly<{ stateRoot: string; timelineSourceDirectory?: string;
  hooks?: Readonly<{ beforeCommit?(): void; afterCommit?(): void; archiveStep?(step: "captured" | "verified" | "cleaned" | "published" | "retired"): void }>;
}>;
/** Version refusal precedes historical grammar admission and every mutation. */
export function inspectRecoveryFloor(admission:RuntimeAdmission,path: string): void {
  withAuthorityDatabaseReadOnly(admission,path, database => { requireSupportedRecoverySchema(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version); });
}
/** Supported database conversion never reads or applies displaced settings/credentials. */
export function readDatabaseSettings(admission:RuntimeAdmission,path: string | undefined) {
  if (path === undefined) return { revision: 1, settings: {} };
  return withAuthorityDatabaseReadOnly(admission,path, database => { const saved = readAppSettings(database)?.saved; return saved ?? { revision: 1, settings: {} }; });
}
export function inspectHistoricalSettingsExposure(admission:RuntimeAdmission,path: string | undefined): readonly "operator.timekeeperName"[] {
  if (path === undefined) return [];
  return withAuthorityDatabaseReadOnly(admission,path, database => {
    const table = settingsSnapshotsTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version);
    const exposed = database.prepare(table === "settings_snapshots"
      ? "SELECT 1 FROM settings_snapshots WHERE json_type(record_json, '$.config.operator.timekeeperName') IS NOT NULL LIMIT 1"
      : "SELECT 1 FROM config_snapshots WHERE json_type(record_json, '$.config.operator.timekeeperName') IS NOT NULL LIMIT 1").get();
    return exposed === undefined ? [] : ["operator.timekeeperName"];
  });
}
export function readLatestDatabaseUpgrade(admission:RuntimeAdmission,path: string): UpgradeRecord | undefined {
  return withAuthorityDatabaseReadOnly(admission,path, database => {
    const rows = database.prepare(`SELECT record_json FROM ${databaseUpgradesTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)} ORDER BY rowid DESC`).all()
      .map((row) => AuthorityUpgradeRecordSchema.parse(JSON.parse(RowSchema.parse(row).record_json)));
    return rows[0];
  });
}
function appendUpgrade(database: DatabaseSync, input: unknown): void {
  const record = AuthorityUpgradeRecordSchema.parse(input);
  database.prepare(`INSERT INTO ${databaseUpgradesTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)}(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)`)
    .run(record.recordKey, record.upgradeId, record.phase, canonicalJsonStringify(record), record.recordedAt);
}

/** A disposable in-memory replay proves the entire post-conversion invariant set
 * before the stopped command creates a lock, directory, credential or SQLite write.
 * Source schema is already authenticated against immutable released DDL. */
function cloneAuthorityReadOnly(admission:RuntimeAdmission,path: string | undefined): DatabaseSync {
  const copy = new DatabaseSync(":memory:");
  if (path === undefined) return copy;
  return withAuthorityDatabaseReadOnly(admission,path, source => {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  try {
    source.exec("BEGIN");
    copy.exec("PRAGMA foreign_keys=OFF");
    const objects = source.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
      .map((row) => z.strictObject({ type: z.string(), name: z.string(), sql: z.string() }).parse(row));
    for (const object of objects.filter(({ type }) => type === "table")) {
      copy.exec(object.sql);
      for (const row of source.prepare(`SELECT * FROM ${quote(object.name)}`).iterate()) {
        const columns = Object.keys(row);
        copy.prepare(`INSERT INTO ${quote(object.name)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      }
    }
    for (const object of objects.filter(({ type }) => type !== "table")) copy.exec(object.sql);
    const version = VersionSchema.parse(source.prepare("PRAGMA user_version").get()).user_version;
    copy.exec(`PRAGMA user_version=${String(version)}; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA foreign_keys=ON`);
    source.exec("COMMIT");
    return copy;
  } catch (error) { copy.close(); throw error; }
  finally { if (source.isTransaction) source.exec("ROLLBACK"); }
  });
}

export function convertStoppedDatabase(args: Readonly<{
  runtimeAdmission: RuntimeAdmission;
  verifyOnly?: boolean; archiveRecordedAt?: string; timelineSources?: TimelineSourceSnapshot; timelineCopyDirectory?: string;
  explorerSource: ExplorerOverrideSourceSnapshot;
  input: ConversionInput; path: string; existed: boolean; from: number;
  inspection: BackupCopyInspection | undefined; backupEvidence: Awaited<ReturnType<typeof verifyBackupManifestAtPath>> | undefined;
  historicalExposure: readonly "operator.timekeeperName"[];
}>, clock: Clock): UpgradeRecord {
  const { input, path, existed, from, inspection, backupEvidence } = args;
  if (existed) requireSupportedRecoverySchema(from);
  else if (from !== 0) throw new Error("fresh-conversion-source-version-conflict");
  const sources = readDatabaseSettings(args.runtimeAdmission,existed ? path : undefined);
  let pending: UpgradeRecord | undefined;
      const now = args.archiveRecordedAt ?? clock.now().toISOString();
      const timelineIdentity = existed ? args.timelineSources?.digest : "fresh";
      if (timelineIdentity === undefined) throw new Error("timeline-import-source-evidence-required");
      const upgradeId = sha256Hex(canonicalJsonStringify({ from, to: CURRENT_AUTHORITY_SCHEMA_VERSION, backup: backupEvidence?.manifest.sha256 ?? "fresh", timeline: timelineIdentity, explorer: args.explorerSource.source, settings: derivePersistedSettingsFingerprint(sources.settings) }));
      assertExplorerOverrideSourceUnchanged(input.stateRoot, args.explorerSource);
      if (!existed && args.verifyOnly !== true) { const fd = openSync(path, "wx", 0o600); closeSync(fd); }
      const createdIdentity = !existed && args.verifyOnly !== true ? lstatSync(path) : undefined;
      let database: DatabaseSync | undefined;
      let convertedTransactionSnapshots: readonly import("../../domain/archive/lifecycle-source.js").LifecycleSourceSnapshot[] = [];
      try {
        args.runtimeAdmission.assertExclusive();
        args.runtimeAdmission.assertAuthorityDatabase(path);
        database = args.verifyOnly === true ? cloneAuthorityReadOnly(args.runtimeAdmission,existed ? path : undefined) : new DatabaseSync(path);
        database.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
        if (existed && (VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version !== from
          || GenerationSchema.parse(database.prepare(`SELECT authority_generation FROM ${databaseStateTable(from)}`).get()).authority_generation !== inspection?.authorityGeneration)) throw new Error("source-changed: re-plan upgrade");
        if (existed && inspectOpenDatabase(database, from).authorityContentFingerprint !== inspection?.authorityContentFingerprint) throw new Error("source-changed: authority differs from verified backup");
        for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version > from && version < 49)) {
          for (const statement of migration.statements) {
            if (migration.version === 47 && statement === "DROP TABLE spans" && existed) assertFoundationRetirement(args.runtimeAdmission,database, backupEvidence);
            database.exec(statement);
          }
          if (migration.version === 1) database.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,1,0,?)").run(now);
          database.prepare(`UPDATE ${databaseStateTable(migration.version)} SET schema_version=? WHERE singleton_id=1`).run(migration.version);
          database.exec(`PRAGMA user_version=${String(migration.version)}`);

        }
        database.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
        let timelineImport: unknown = { state: "fresh", imported: 0, excludedDeleted: 0 };
        if (existed) {
          if (args.timelineSources === undefined || backupEvidence === undefined || args.timelineCopyDirectory === undefined) {
            throw new Error("timeline-import-source-evidence-required");
          }
          const currentSources = timelineSourcesForUpgrade(input.stateRoot, backupEvidence, input.timelineSourceDirectory);
          if (currentSources.digest !== args.timelineSources.digest) throw new Error("timeline-import-source-changed");
          if (args.verifyOnly !== true) readPreservedTimelineSources(args.timelineCopyDirectory, currentSources.digest, backupEvidence);
          timelineImport = { state: "imported", manifestDigest: currentSources.digest,
            copyDirectory: args.timelineCopyDirectory, backupSha256: backupEvidence.manifest.sha256,
            imported: 0, excludedDeleted: 0 };
        }
          if (from < 49) {
            // Finish historical transaction presentation while its sources still exist.
            freezeConvertedArchiveTransactions(database, now);
            const archive = args.verifyOnly === true ? ArchiveDatabase.preflightCopy(args.runtimeAdmission,join(input.stateRoot, "archive.sqlite")) : undefined;
            const converted = withStoppedArchiveConversion(args.runtimeAdmission,database, path, clock, archive, authority => {
              const baseStorage = createRunLifecycleStorage(authority);
              const step = (at: "captured" | "verified" | "cleaned" | "published") => { if(args.verifyOnly !== true) input.hooks?.archiveStep?.(at); };
              const storage = {...baseStorage,
                saveReport: (report: Parameters<typeof baseStorage.saveReport>[0]) => { const result=baseStorage.saveReport(report);step("captured");return result; },
                verifyReport: (runId:string,digest:string) => { const result=baseStorage.verifyReport(runId,digest);step("verified");return result; },
                transfer: (request: Parameters<typeof baseStorage.transfer>[0]) => { const result=baseStorage.transfer(request);step("cleaned");return result; },
                publishReport: (runId:string,digest:string) => { const result=baseStorage.publishReport(runId,digest);step("published");return result; },
              };
              const source = storage.historicalArchiveSource();
              const result = convertHistoricalArchives(storage, source, now);
              for (const expected of result.reports) {
                const report = storage.readReport(expected.runId);
                if (report?.digest !== expected.reportDigest || report.content.sourceDigest !== expected.sourceDigest
                  || authority.authority.runs.get(expected.runId) !== undefined
                  || authority.authority.deletedRuns.get(expected.runId) !== undefined) throw new Error("archive-retirement-verification-failed");
              }
              convertedTransactionSnapshots = authority.authority.archivedTransactionSources.list();
              return result;
            });
            for (const plan of converted.retainedVersionSources.plans) {
              const application = converted.retainedVersionSources.applications.find(row => row.versionPlanId === plan.versionPlanId) ?? null;
              const record = HistoricalVersionChangeSchema.parse({schemaVersion:"historical-archive-v1",state:"historical",changeId:plan.versionPlanId,
                sourceDigest:converted.sourceDigest,plan,application,
                reports:converted.reports.filter(row => application?.archivedRunIds.includes(row.runId)),
                absentRunIds:converted.absentHistoricalMembers.filter(row => row.applicationId === application?.applicationId).map(row => row.runId)});
              const json = canonicalJsonStringify(record);
              const existing = database.prepare("SELECT record_json FROM version_changes WHERE record_key=?").get(record.changeId);
              if (existing !== undefined && RowSchema.parse(existing).record_json !== json) throw new Error("archive-retirement-version-identity-conflict");
              if (existing === undefined) database.prepare("INSERT INTO version_changes VALUES (?,?,?)").run(record.changeId,json,plan.createdAt);
            }
            const retirement = SQLITE_MIGRATIONS.find(row => row.version === 49);
            if (retirement === undefined) throw new Error("archive-retirement-migration-missing");
            for (const statement of retirement.statements) database.exec(statement);
            database.exec("UPDATE database_state SET schema_version=49 WHERE singleton_id=1; PRAGMA user_version=49");
            if (args.verifyOnly !== true) input.hooks?.archiveStep?.("retired");
          }
        for (const migration of SQLITE_MIGRATIONS.filter(({version}) => version > Math.max(from, 49))) {
          for (const statement of migration.statements) database.exec(statement);
          database.prepare("UPDATE database_state SET schema_version=? WHERE singleton_id=1").run(migration.version);
          database.exec(`PRAGMA user_version=${String(migration.version)}`);
        }
        assertExplorerOverrideSourceUnchanged(input.stateRoot, args.explorerSource);
        importExplorerOverrides(database, args.explorerSource);
        const revision = sources.revision;
        pending = AuthorityUpgradeRecordSchema.parse({ format: 3, recordKey: randomUUID(), upgradeId, phase: "committed", fromSchemaVersion: from, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
          by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: now, timelineImport,
          explorerImport: { format: 1, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path), backupSha256: backupEvidence?.manifest.sha256 ?? "fresh", source: args.explorerSource.source },
          backupManifest: backupEvidence?.manifestPath ?? "fresh", ordinaryRevision: revision,
          ordinaryFingerprint: derivePersistedSettingsFingerprint(sources.settings), sourceFiles: [], historicalExposure: args.historicalExposure, orphanGateRecordsRemoved: 0, tombstoneBackfill: { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 },
          credentialCommandId: randomUUID(), credentialWriteId: randomUUID(), importedKeys: [], envKeysToRemove: [] });
        appendUpgrade(database, pending);
        database.prepare(`UPDATE ${databaseStateTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)} SET authority_generation=authority_generation+1,updated_at=? WHERE singleton_id=1`).run(now);
        createRunSummaries(database).refresh(GenerationSchema.parse(database.prepare("SELECT authority_generation FROM database_state").get()).authority_generation,now);
        rebuildRunSearchForUpgrade(database,GenerationSchema.parse(database.prepare("SELECT authority_generation FROM database_state").get()).authority_generation,now);
        let transactionArchive: ArchiveDatabase | undefined;
        try {
          if (from < 49) for (const snapshot of convertedTransactionSnapshots) indexArchivedTransactionSnapshot(database, snapshot);
          else backfillArchivedTransactionSelection(database, () => transactionArchive ??= new ArchiveDatabase(args.runtimeAdmission,join(input.stateRoot, "archive.sqlite"), {readOnly:true}));
        } finally { transactionArchive?.close(); }
        inspectConvertedAuthority(database);
        if (args.verifyOnly !== true) {
          input.hooks?.beforeCommit?.();
          assertExplorerOverrideSourceUnchanged(input.stateRoot, args.explorerSource);
          if (existed && backupEvidence !== undefined) {
            const finalSources = timelineSourcesForUpgrade(input.stateRoot, backupEvidence, input.timelineSourceDirectory);
            if (finalSources.digest !== args.timelineSources?.digest) throw new Error("timeline-import-source-changed");
            if (args.timelineCopyDirectory === undefined) throw new Error("timeline-import-copy-missing");
            readPreservedTimelineSources(args.timelineCopyDirectory, finalSources.digest, backupEvidence);
          }
        }
        database.exec(args.verifyOnly === true ? "ROLLBACK" : "COMMIT");
      } catch (error) {
        if (database?.isTransaction) database.exec("ROLLBACK");
        database?.close();
        if (createdIdentity !== undefined) {
          try {
            const named = lstatSync(path);
            if (named.ino !== createdIdentity.ino || named.dev !== createdIdentity.dev) throw new Error("fresh-upgrade-cleanup-uncertain: authority path changed", { cause: error });
            unlinkSync(path);
          } catch (cleanupError) { throw new AggregateError([error, cleanupError], "fresh-upgrade-cleanup-uncertain", { cause: cleanupError }); }
        }
        throw error;
      } finally { if (database?.isOpen) database.close(); }
      if (args.verifyOnly !== true) input.hooks?.afterCommit?.();
      return pending;
}
export function settleDatabaseUpgrade(admission:RuntimeAdmission,path: string, pending: UpgradeRecord, now: string): void {
  admission.assertExclusive();
  admission.assertAuthorityDatabase(path);
  const database = new DatabaseSync(path);
  try {
    database.exec("BEGIN IMMEDIATE");
    appendUpgrade(database, { ...pending, recordKey: randomUUID(), phase: "settled", recordedAt: now });
    database.prepare(`UPDATE ${databaseStateTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)} SET authority_generation=authority_generation+1,updated_at=? WHERE singleton_id=1`).run(now);
    createRunSummaries(database).refresh(GenerationSchema.parse(database.prepare("SELECT authority_generation FROM database_state").get()).authority_generation,now);
        rebuildRunSearchForUpgrade(database,GenerationSchema.parse(database.prepare("SELECT authority_generation FROM database_state").get()).authority_generation,now);
    database.exec("COMMIT");
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
  finally { database.close(); }
}
