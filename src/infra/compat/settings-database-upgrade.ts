import { createRunSummaries } from "../sqlite/run-summaries.js";
import { convertHistoricalArchives } from "../../services/archive/archive-transfer.js";
import { createRunLifecycleStorage } from "../../core/run-lifecycle-storage.js";
import { ArchiveDatabase } from "../sqlite/archive-database.js";
import { HistoricalVersionChangeSchema } from "../sqlite/storage-records.js";
import { join } from "node:path";
import { assertFoundationRetirement } from "../sqlite/foundation-retirement.js";
import { readGeneratedSources, generatedSourceDigest, readPreservedGeneratedSources, installGeneratedSources, convertGeneratedArtifacts, type GeneratedSourceManifest } from "../sqlite/generated-conversion.js";
import { convertAppSettings, writeAppSettings, readAppSettings } from "../sqlite/settings-storage.js";
import { convertProviderStorage } from "../sqlite/provider-storage.js";
import { convertImportedArtifacts } from "../sqlite/imported-artifacts.js";
import { convertRunCompletions } from "../sqlite/completion-conversion.js";
import { deriveBulkChildCommand } from "../../domain/command-groups.js";
import { timelineSourcesForUpgrade, readPreservedTimelineSources, type TimelineSourceSnapshot } from "../events/timeline-import.js";
import { convertOperationHistory, freezeConvertedArchiveTransactions, importTimelineSources } from "../sqlite/timeline-conversion.js";
/** D336 temporary stopped SQLite conversion adapter; Phase 2.6 owns deletion. */
import { DatabaseSync } from "node:sqlite";
import { openSync, closeSync, lstatSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { DeletedRunRecordSchema } from "../../domain/run/deleted-run.js";
import { inspectSpanAuthorityCorpusReadOnly } from "../sqlite/storage-doctor.js";
import { AuthorityUpgradeRecordSchema } from "../../domain/authority.js";
import { BulkRunCommandAcceptanceRecordSchema, CommandAuditRecordSchema, SettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../domain/commands.js";
import { SettingsCurrentRecordSchema } from "../../domain/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, derivePersistedSettingsFingerprint } from "../../domain/config/settings.js";
import { withStoppedArchiveConversion, inspectConvertedAuthority } from "../sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, databaseStateTable, databaseUpgradesTable, settingsSnapshotsTable } from "../sqlite/migrations.js";
import type { verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { inspectOpenDatabase, type BackupCopyInspection } from "./backup-inspection.js";
import { ordinaryLeaves, readUpgradeSources, type UpgradeSources } from "./upgrade-sources.js";
const RowSchema = z.strictObject({ record_json: z.string() });
const VersionSchema = z.strictObject({ user_version: z.number().int().nonnegative() });
const GenerationSchema = z.strictObject({ authority_generation: z.number().int().nonnegative() });
type UpgradeRecord = z.infer<typeof AuthorityUpgradeRecordSchema>;
type ConversionInput = Readonly<{
  stateRoot: string; environmentFile: string; timelineSourceDirectory?: string; generatedSourceDirectory?: string;
  hooks?: Readonly<{ beforeCommit?(): void; afterCommit?(): void; archiveStep?(step: "captured" | "verified" | "cleaned" | "published" | "retired"): void }>;
}>;
const ORPHAN_GATE_WHERE = "EXISTS (SELECT 1 FROM deleted_runs WHERE deleted_runs.record_key=substr(checkpoint_payloads.record_key,1,36) AND substr(checkpoint_payloads.record_key,37,1)=':')";
export function countOrphanGateRecords(path: string | undefined): number {
  if (path === undefined) return 0;
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_runs'").get() === undefined) return 0;
    return z.object({ count: z.number().int().nonnegative() }).parse(database.prepare(`SELECT count(*) AS count FROM checkpoint_payloads WHERE ${ORPHAN_GATE_WHERE}`).get()).count;
  } finally { database.close(); }
}
/** Scan once in preflight and again under the exclusive transaction; never infer ordinals. */
function tombstoneBackfill(database: DatabaseSync | undefined, stateRoot: string) {
  const counts = { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 };
  if (database === undefined || database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_runs'").get() === undefined) return { counts, updates: [] };
  const rows = database.prepare("SELECT record_key, record_json FROM deleted_runs ORDER BY record_key").all();
  const candidates = rows.map((row) => {
    const record = DeletedRunRecordSchema.parse(JSON.parse(z.strictObject({ record_key: z.string(), record_json: z.string() }).parse(row).record_json));
    if (record.runId !== row.record_key) throw new Error("malformed-evidence: tombstone runId");
    return record;
  }).filter((record) => record.ordinalSource === "unknown" && record.itemId === null && record.attempt === null && record.runNumber === null);
  if (candidates.length === 0) return { counts, updates: [] };
  let corpus: ReturnType<typeof inspectSpanAuthorityCorpusReadOnly>;
  try { corpus = inspectSpanAuthorityCorpusReadOnly(stateRoot, stateRoot); }
  catch (cause) { throw new Error("malformed-evidence: tombstone span corpus", { cause }); }
  const updates = candidates.map((record) => {
    const matches = corpus.roots.filter((root) => root.runId === record.runId);
    const root = matches[0];
    if (matches.length > 1 || (root !== undefined && root.streamIssues.length > 0)) throw new Error(`malformed-evidence: ${record.runId} root`);
    if (root !== undefined && (root.workflow !== record.workflow || root.traceId !== record.traceId)) throw new Error(`malformed-evidence: ${record.runId} workflow/traceId`);
    counts.missingRunNumber++;
    if (root === undefined) { counts.unknown++; return { runId: record.runId, itemId: null, attempt: null, ordinalSource: "unknown" as const }; }
    if (root.reconstructed) counts.fromReconstructedRoots++; else counts.fromRoots++;
    // The released run.queued grammar never carried runNumber. Operator-approved
    // D332 amendment retains NULL and reports incomplete history in doctor.
    return { runId: record.runId, itemId: root.itemId, attempt: root.finalAttempt, ordinalSource: "span-root-backfill" as const };
  });
  return { counts, updates };
}
export function inspectTombstoneBackfill(path: string | undefined, stateRoot: string) {
  const database = path === undefined ? undefined : new DatabaseSync(path, { readOnly: true });
  try { return tombstoneBackfill(database, stateRoot); } finally { database?.close(); }
}
function applyTombstoneBackfill(database: DatabaseSync, plan: ReturnType<typeof tombstoneBackfill>): void {
  if (plan.updates.length === 0) return;
  const trigger = z.strictObject({ sql: z.string().min(1) }).parse(database.prepare("SELECT sql FROM sqlite_master WHERE name='deleted_runs_immutable_update'").get()).sql;
  database.exec("DROP TRIGGER deleted_runs_immutable_update");
  const update = database.prepare("UPDATE deleted_runs SET item_id=?, attempt=?, run_number=NULL, ordinal_source=?, record_json=json_set(record_json,'$.itemId',?,'$.attempt',?,'$.runNumber',NULL,'$.ordinalSource',?) WHERE record_key=? AND item_id IS NULL AND attempt IS NULL AND run_number IS NULL");
  for (const row of plan.updates) {
    if (update.run(row.itemId, row.attempt, row.ordinalSource, row.itemId, row.attempt, row.ordinalSource, row.runId).changes !== 1) throw new Error("source-changed: tombstone backfill");
  }
  database.exec(trigger);
}

export function inspectHistoricalSettingsExposure(path: string | undefined): readonly "operator.timekeeperName"[] {
  if (path === undefined) return [];
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const table = settingsSnapshotsTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version);
    const exposed = database.prepare(table === "settings_snapshots"
      ? "SELECT 1 FROM settings_snapshots WHERE json_type(record_json, '$.config.operator.timekeeperName') IS NOT NULL LIMIT 1"
      : "SELECT 1 FROM config_snapshots WHERE json_type(record_json, '$.config.operator.timekeeperName') IS NOT NULL LIMIT 1").get();
    return exposed === undefined ? [] : ["operator.timekeeperName"];
  } finally { database.close(); }
}
export function readLatestSettingsUpgrade(path: string): UpgradeRecord | undefined {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = database.prepare(`SELECT record_json FROM ${databaseUpgradesTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)} ORDER BY rowid DESC`).all()
      .map((row) => AuthorityUpgradeRecordSchema.parse(JSON.parse(RowSchema.parse(row).record_json)));
    return rows.find((record) => "format" in record && record.format === 3);
  } finally { database.close(); }
}
export function readSettingsUpgradeSources(stateRoot: string, environmentFile: string, path: string | undefined, clock: Clock): UpgradeSources {
  const database = path === undefined ? undefined : new DatabaseSync(path, { readOnly: true });
  try { return readUpgradeSources(stateRoot, environmentFile, database, clock); }
  finally { database?.close(); }
}
function appendUpgrade(database: DatabaseSync, input: unknown): void {
  const record = AuthorityUpgradeRecordSchema.parse(input);
  database.prepare(`INSERT INTO ${databaseUpgradesTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)}(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)`)
    .run(record.recordKey, record.upgradeId, record.phase, canonicalJsonStringify(record), record.recordedAt);
}

/** The migration command is the sole temporary writer outside the ordinary kernel. */
function writeOrdinaryConversion(database: DatabaseSync, sources: UpgradeSources, now: string, upgradeId: string): number {
  const patch = Object.fromEntries(Object.entries(ordinaryLeaves(sources.settings)).map(([key, value]) => [key, { set: value }]));
  // No ordinary input means the absent revision-one baseline remains absent.
  // An applied empty document keeps its existing revision and immutable journal.
  // v32 has already copied its empty values into the singleton in this transaction.
  if (Object.keys(patch).length === 0) return sources.ordinary.revision;
  const revision = sources.ordinary.revision + 1;
  const request = SettingsCommandRequestSchema.parse({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: now,
    requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "storage-upgrade", reason: upgradeId,
    target: { expectedRevision: sources.ordinary.revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const settingsFingerprint = derivePersistedSettingsFingerprint(sources.settings);
  const target = { family: "settings", revision };
  const audit = CommandAuditRecordSchema.parse({ auditId: randomUUID(), request,
    result: { state: "applied", commandId: request.commandId, affectedTargets: [target], restartRequired: true, settingsRevision: revision, settingsFingerprint },
    completedAt: now, versionChanges: [{ target, before: revision - 1, after: revision }], affectedDependencyIds: [] });
  database.prepare("INSERT INTO commands(record_key,family,record_json,created_at) VALUES (?,?,?,?)").run(request.commandId,"settings",canonicalJsonStringify(request),now);
  database.prepare("INSERT INTO command_audits(record_key,command_id,record_json,created_at) VALUES (?,?,?,?)").run(audit.auditId,request.commandId,canonicalJsonStringify(audit),now);
  const record = SettingsCurrentRecordSchema.parse({ revision, settings: sources.settings, settingsFingerprint,
    commandId: request.commandId, commandFingerprint: deriveSettingsCommandFingerprint(request), auditId: audit.auditId, committedAt: now });
  writeAppSettings(database, { format: 1, saved: record, active: readAppSettings(database)?.active ?? null });
  return revision;
}

/** Validate every historical ownership relation before changing any schema or record. */
function commandGroupLinks(database: DatabaseSync, ownsCredentialCommandId: (commandId: string) => boolean): readonly Readonly<{ commandId: string; parentId: string }>[] {
  const rowSchema = z.strictObject({ record_key: z.string(), record_json: z.string() });
  const rows = database.prepare("SELECT record_key, record_json FROM commands").all()
    .map((row) => rowSchema.parse(row));
  const commands = new Map(rows.map((row) => [row.record_key, row.record_json]));
  const parents = database.prepare("SELECT record_json FROM bulk_command_acceptances").all()
    .map((row) => BulkRunCommandAcceptanceRecordSchema.parse(JSON.parse(RowSchema.parse(row).record_json)));
  const parentIds = new Set(parents.map((record) => record.bulkCommandId));
  const links = new Map<string, string>();
  for (const parent of parents) {
    if (commands.has(parent.bulkCommandId) || ownsCredentialCommandId(parent.bulkCommandId)) throw new Error("command-group migration parent identity collision");
    for (const target of parent.request.targets) {
      const child = deriveBulkChildCommand(parent.request, target);
      if (parentIds.has(child.commandId) || ownsCredentialCommandId(child.commandId)) throw new Error("command-group migration parent/child identity collision");
      const previous = links.get(child.commandId);
      if (previous !== undefined && previous !== parent.bulkCommandId) throw new Error("command-group migration ambiguous child ownership");
      const saved = commands.get(child.commandId);
      if (saved === undefined) continue;
      if (canonicalJsonStringify(JSON.parse(saved) as unknown) !== canonicalJsonStringify(child)) throw new Error("command-group migration child request mismatch");
      links.set(child.commandId, parent.bulkCommandId);
    }
  }
  return [...links].map(([commandId, parentId]) => ({ commandId, parentId }));
}

function applyCommandGroupLinks(database: DatabaseSync, links: ReturnType<typeof commandGroupLinks>): void {
  if (links.length === 0) return;
  const trigger = z.strictObject({ sql: z.string() }).parse(database.prepare("SELECT sql FROM sqlite_master WHERE name='commands_parent_immutable_update'").get()).sql;
  database.exec("DROP TRIGGER commands_parent_immutable_update");
  for (const link of links) {
    if (database.prepare("UPDATE commands SET parent_command_id=? WHERE record_key=? AND parent_command_id IS NULL")
      .run(link.parentId, link.commandId).changes !== 1) throw new Error("source-changed: command-group child linkage");
  }
  database.exec(trigger);
}

/** A disposable in-memory replay proves the entire post-conversion invariant set
 * before the stopped command creates a lock, directory, credential or SQLite write.
 * Source schema is already authenticated against immutable released DDL. */
function cloneAuthorityReadOnly(path: string | undefined): DatabaseSync {
  const copy = new DatabaseSync(":memory:");
  if (path === undefined) return copy;
  const source = new DatabaseSync(path, { readOnly: true });
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
  finally { if (source.isTransaction) source.exec("ROLLBACK"); source.close(); }
}

export function convertSettingsDatabase(args: Readonly<{
  ownsCredentialCommandId: (commandId: string) => boolean;
  verifyOnly?: boolean;
  archiveRecordedAt?: string;
  timelineSources?: TimelineSourceSnapshot;
  timelineCopyDirectory?: string;
  generatedSources?: GeneratedSourceManifest;
  generatedCopyDirectory?: string;
  bindCredentials?: (upgradeId: string) => void;
  input: ConversionInput; path: string; existed: boolean; from: number;
  inspection: BackupCopyInspection | undefined;
  backupEvidence: Awaited<ReturnType<typeof verifyBackupManifestAtPath>> | undefined;
  historicalExposure: readonly "operator.timekeeperName"[];
  sources: UpgradeSources; orphanGateRecords: number; tombstones: ReturnType<typeof inspectTombstoneBackfill>;
}>, clock: Clock): UpgradeRecord {
  const { input, path, existed, from, inspection, backupEvidence, sources, orphanGateRecords, tombstones } = args;
  const report = sources;
  let pending: UpgradeRecord | undefined;
      const now = args.archiveRecordedAt ?? clock.now().toISOString();
      const timelineIdentity = existed ? args.timelineSources?.digest : "fresh";
      if (timelineIdentity === undefined) throw new Error("timeline-import-source-evidence-required");
      const upgradeId = sha256Hex(canonicalJsonStringify({ from, to: CURRENT_AUTHORITY_SCHEMA_VERSION, backup: backupEvidence?.manifest.sha256 ?? "fresh", timeline: timelineIdentity, generated: args.generatedSources === undefined ? "fresh" : generatedSourceDigest(args.generatedSources), settings: derivePersistedSettingsFingerprint(sources.settings), names: Object.keys(sources.protectedPatch).sort() }));
      if (!existed && args.verifyOnly !== true) { const fd = openSync(path, "wx", 0o600); closeSync(fd); }
      const createdIdentity = !existed && args.verifyOnly !== true ? lstatSync(path) : undefined;
      let database: DatabaseSync | undefined;
      try {
        database = args.verifyOnly === true ? cloneAuthorityReadOnly(existed ? path : undefined) : new DatabaseSync(path);
        database.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
        if (existed && (VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version !== from
          || GenerationSchema.parse(database.prepare(`SELECT authority_generation FROM ${databaseStateTable(from)}`).get()).authority_generation !== inspection?.authorityGeneration)) throw new Error("source-changed: re-plan upgrade");
        if (existed && inspectOpenDatabase(database, from).authorityContentFingerprint !== inspection?.authorityContentFingerprint) throw new Error("source-changed: authority differs from verified backup");
        const again = readUpgradeSources(input.stateRoot, input.environmentFile, existed ? database : undefined, clock);
        if (canonicalJsonStringify(again) !== canonicalJsonStringify(sources)) throw new Error("source-changed: re-plan upgrade");
        const currentTombstones = tombstoneBackfill(existed ? database : undefined, input.stateRoot);
        if (canonicalJsonStringify(currentTombstones) !== canonicalJsonStringify(tombstones)) throw new Error("source-changed: tombstone span evidence");
        if (args.generatedSources !== undefined && backupEvidence !== undefined) {
          const again = readGeneratedSources(database, input.stateRoot, backupEvidence, input.generatedSourceDirectory);
          if (generatedSourceDigest(again) !== generatedSourceDigest(args.generatedSources)) throw new Error("generated-import-source-changed");
          if (args.verifyOnly !== true) {
            if (args.generatedCopyDirectory === undefined) throw new Error("generated-source-copy-required");
            readPreservedGeneratedSources(args.generatedCopyDirectory, generatedSourceDigest(again), backupEvidence);
          }
        }
        for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version > from && version < 49)) {
          if (migration.version === 41) convertRunCompletions(database);
          const links = migration.version === 37 ? commandGroupLinks(database, args.ownsCredentialCommandId) : undefined;
          for (const [index, statement] of migration.statements.entries()) {
            if (migration.version === 32 && index === 2 && sources.ordinary.revision > 1) {
              database.prepare("UPDATE settings_current SET record_json=json_set(record_json,'$.settings',json(?)) WHERE record_key='current'").run(canonicalJsonStringify(sources.ordinary.settings));
            }
            if (migration.version === 40 && statement === "DROP TABLE ledger_projections" && existed) {
              if (args.timelineSources === undefined) throw new Error("operation-history-sources-required");
              convertOperationHistory(database, args.timelineSources, now);
            }
            if (migration.version === 42 && statement === "DROP TABLE intake_sessions") convertImportedArtifacts(database);
            if (migration.version === 43 && statement === "DROP TABLE provider_admissions") convertProviderStorage(database, now);
            if (migration.version === 44 && statement === "DROP TABLE runtime_config") convertAppSettings(database);
            if (migration.version === 46 && statement === "DROP TABLE artifact_outbox") convertGeneratedArtifacts(database, args.generatedSources);
            if (migration.version === 47 && statement === "DROP TABLE spans") assertFoundationRetirement(database, backupEvidence);
            database.exec(statement);
          }
          if (links !== undefined) applyCommandGroupLinks(database, links);
          if (migration.version === 1) database.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,1,0,?)").run(now);
          database.prepare(`UPDATE ${databaseStateTable(migration.version)} SET schema_version=? WHERE singleton_id=1`).run(migration.version);
          database.exec(`PRAGMA user_version=${String(migration.version)}`);

        }
        database.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
        applyTombstoneBackfill(database, tombstones);
        const removed = database.prepare(`DELETE FROM checkpoint_payloads WHERE ${ORPHAN_GATE_WHERE}`).run().changes;
        if (removed !== orphanGateRecords) throw new Error("source-changed: orphan gate inventory differs from preflight");
        let timelineImport: unknown = { state: "fresh", imported: 0, excludedDeleted: 0 };
        if (existed) {
          if (args.timelineSources === undefined || backupEvidence === undefined || args.timelineCopyDirectory === undefined) {
            throw new Error("timeline-import-source-evidence-required");
          }
          const currentSources = timelineSourcesForUpgrade(input.stateRoot, backupEvidence, input.timelineSourceDirectory);
          if (currentSources.digest !== args.timelineSources.digest) throw new Error("timeline-import-source-changed");
          const verifiedSources = args.verifyOnly === true ? currentSources
            : readPreservedTimelineSources(args.timelineCopyDirectory, currentSources.digest, backupEvidence);
          // Authenticate semantic history from the same selected source location.
          // The final digest recheck below still binds these reads to exact bytes.
          const historyDirectory = args.verifyOnly === true
            ? input.timelineSourceDirectory ?? input.stateRoot : args.timelineCopyDirectory;
          try {
            const corpus = inspectSpanAuthorityCorpusReadOnly(historyDirectory, historyDirectory);
            if (corpus.roots.some((root) => root.streamIssues.length > 0)) throw new Error("invalid span ordering or identity");
          } catch { throw new Error("timeline-import-span-history-invalid"); }
          const counts = from >= 38 ? { imported: 0, replayed: 0, excludedDeleted: 0 } : importTimelineSources(database, verifiedSources, now);
          if (counts.replayed !== 0) throw new Error("timeline-import-unexpected-existing-events");
          timelineImport = { state: "imported", manifestDigest: currentSources.digest,
            copyDirectory: args.timelineCopyDirectory, backupSha256: backupEvidence.manifest.sha256,
            imported: counts.imported, excludedDeleted: counts.excludedDeleted };
        }
          if (from < 49) {
            // Finish historical transaction presentation while its sources still exist.
            freezeConvertedArchiveTransactions(database, now);
            const archive = args.verifyOnly === true ? ArchiveDatabase.preflightCopy(join(input.stateRoot, "archive.sqlite")) : undefined;
            const converted = withStoppedArchiveConversion(database, path, clock, archive, authority => {
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
        const revision = from >= 32 ? sources.ordinary.revision : writeOrdinaryConversion(database, sources, now, upgradeId);
        pending = AuthorityUpgradeRecordSchema.parse({ format: 3, recordKey: randomUUID(), upgradeId, phase: "committed", fromSchemaVersion: from, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
          by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: now, timelineImport,
          ...(args.generatedSources === undefined ? {} : { generatedImport: { manifestDigest: generatedSourceDigest(args.generatedSources), copyDirectory: args.generatedCopyDirectory, backupSha256: backupEvidence?.manifest.sha256 } }), backupManifest: backupEvidence?.manifestPath ?? "fresh", ordinaryRevision: revision,
          ordinaryFingerprint: derivePersistedSettingsFingerprint(sources.settings), sourceFiles: report.sourceFiles, historicalExposure: args.historicalExposure, orphanGateRecordsRemoved: orphanGateRecords, tombstoneBackfill: tombstones.counts,
          credentialCommandId: randomUUID(), credentialWriteId: randomUUID(), importedKeys: report.importedKeys, envKeysToRemove: report.envKeysToRemove });
        appendUpgrade(database, pending);
        database.prepare(`UPDATE ${databaseStateTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)} SET authority_generation=authority_generation+1,updated_at=? WHERE singleton_id=1`).run(now);
        createRunSummaries(database).refresh(GenerationSchema.parse(database.prepare("SELECT authority_generation FROM database_state").get()).authority_generation,now);
        inspectConvertedAuthority(database);
        if (args.verifyOnly !== true) {
          args.bindCredentials?.(upgradeId);
          input.hooks?.beforeCommit?.();
          if (args.generatedSources !== undefined && backupEvidence !== undefined && args.generatedCopyDirectory !== undefined) {
            readPreservedGeneratedSources(args.generatedCopyDirectory, generatedSourceDigest(args.generatedSources), backupEvidence);
            const source = new DatabaseSync(backupEvidence.backupPath, { readOnly: true });
            try { if (generatedSourceDigest(readGeneratedSources(source, input.stateRoot, backupEvidence, input.generatedSourceDirectory)) !== generatedSourceDigest(args.generatedSources)) throw new Error("generated-import-source-changed"); }
            finally { source.close(); }
            installGeneratedSources(args.generatedSources, input.stateRoot);
          }
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
export function settleSettingsUpgrade(path: string, pending: UpgradeRecord, now: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("BEGIN IMMEDIATE");
    appendUpgrade(database, { ...pending, recordKey: randomUUID(), phase: "settled", recordedAt: now });
    database.prepare(`UPDATE ${databaseStateTable(VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version)} SET authority_generation=authority_generation+1,updated_at=? WHERE singleton_id=1`).run(now);
    createRunSummaries(database).refresh(GenerationSchema.parse(database.prepare("SELECT authority_generation FROM database_state").get()).authority_generation,now);
    database.exec("COMMIT");
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
  finally { database.close(); }
}
