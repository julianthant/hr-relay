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
import { CommandAuditRecordSchema, SettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../domain/commands.js";
import { SettingsCurrentRecordSchema } from "../../domain/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, derivePersistedSettingsFingerprint } from "../../domain/config/settings.js";
import { inspectConvertedAuthority } from "../sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../sqlite/migrations.js";
import type { verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { inspectOpenDatabase, type BackupCopyInspection } from "./backup-inspection.js";
import { ordinaryLeaves, readUpgradeSources, type UpgradeSources } from "./upgrade-sources.js";
const RowSchema = z.strictObject({ record_json: z.string() });
const VersionSchema = z.strictObject({ user_version: z.number().int().nonnegative() });
const GenerationSchema = z.strictObject({ authority_generation: z.number().int().nonnegative() });
type UpgradeRecord = z.infer<typeof AuthorityUpgradeRecordSchema>;
type ConversionInput = Readonly<{
  stateRoot: string; environmentFile: string;
  hooks?: Readonly<{ beforeCommit?(): void; afterCommit?(): void }>;
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
    const exposed = database.prepare("SELECT 1 FROM config_snapshots WHERE json_type(record_json, '$.config.operator.timekeeperName') IS NOT NULL LIMIT 1").get();
    return exposed === undefined ? [] : ["operator.timekeeperName"];
  } finally { database.close(); }
}
export function readLatestSettingsUpgrade(path: string): UpgradeRecord | undefined {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = database.prepare("SELECT record_json FROM authority_upgrades ORDER BY rowid DESC").all()
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
  database.prepare("INSERT INTO authority_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)")
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
  const args = [record.revision,record.settingsFingerprint,record.commandId,record.commandFingerprint,record.auditId,canonicalJsonStringify(record),now];
  if (sources.ordinary.revision === 1) database.prepare("INSERT INTO settings_current(record_key,revision,settings_fingerprint,command_id,command_fingerprint,audit_id,record_json,created_at) VALUES ('current',?,?,?,?,?,?,?)").run(...args);
  else database.prepare("UPDATE settings_current SET revision=?,settings_fingerprint=?,command_id=?,command_fingerprint=?,audit_id=?,record_json=?,created_at=? WHERE record_key='current'").run(...args);
  return revision;
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
  verifyOnly?: boolean;
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
      const now = clock.now().toISOString();
      const upgradeId = sha256Hex(canonicalJsonStringify({ from, to: 32, backup: backupEvidence?.manifest.sha256 ?? "fresh", settings: derivePersistedSettingsFingerprint(sources.settings), names: Object.keys(sources.protectedPatch).sort() }));
      if (!existed && args.verifyOnly !== true) { const fd = openSync(path, "wx", 0o600); closeSync(fd); }
      const createdIdentity = !existed && args.verifyOnly !== true ? lstatSync(path) : undefined;
      let database: DatabaseSync | undefined;
      try {
        database = args.verifyOnly === true ? cloneAuthorityReadOnly(existed ? path : undefined) : new DatabaseSync(path);
        database.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
        if (existed && (VersionSchema.parse(database.prepare("PRAGMA user_version").get()).user_version !== from
          || GenerationSchema.parse(database.prepare("SELECT authority_generation FROM authority_meta").get()).authority_generation !== inspection?.authorityGeneration)) throw new Error("source-changed: re-plan upgrade");
        if (existed && inspectOpenDatabase(database, from).authorityContentFingerprint !== inspection?.authorityContentFingerprint) throw new Error("source-changed: authority differs from verified backup");
        const again = readUpgradeSources(input.stateRoot, input.environmentFile, existed ? database : undefined, clock);
        if (canonicalJsonStringify(again) !== canonicalJsonStringify(sources)) throw new Error("source-changed: re-plan upgrade");
        const currentTombstones = tombstoneBackfill(existed ? database : undefined, input.stateRoot);
        if (canonicalJsonStringify(currentTombstones) !== canonicalJsonStringify(tombstones)) throw new Error("source-changed: tombstone span evidence");
        for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version > from)) {
          for (const [index, statement] of migration.statements.entries()) {
            if (migration.version === 32 && index === 2 && sources.ordinary.revision > 1) {
              database.prepare("UPDATE settings_current SET record_json=json_set(record_json,'$.settings',json(?)) WHERE record_key='current'").run(canonicalJsonStringify(sources.ordinary.settings));
            }
            database.exec(statement);
          }
          if (migration.version === 1) database.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,1,0,?)").run(now);
          database.prepare("UPDATE authority_meta SET schema_version=? WHERE singleton_id=1").run(migration.version);
          database.exec(`PRAGMA user_version=${String(migration.version)}`);
        }
        database.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
        applyTombstoneBackfill(database, tombstones);
        const removed = database.prepare(`DELETE FROM checkpoint_payloads WHERE ${ORPHAN_GATE_WHERE}`).run().changes;
        if (removed !== orphanGateRecords) throw new Error("source-changed: orphan gate inventory differs from preflight");
        const revision = writeOrdinaryConversion(database, sources, now, upgradeId);
        pending = AuthorityUpgradeRecordSchema.parse({ format: 3, recordKey: randomUUID(), upgradeId, phase: "committed", fromSchemaVersion: from, toSchemaVersion: 32,
          by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: now, backupManifest: backupEvidence?.manifestPath ?? "fresh", ordinaryRevision: revision,
          ordinaryFingerprint: derivePersistedSettingsFingerprint(sources.settings), sourceFiles: report.sourceFiles, historicalExposure: args.historicalExposure, orphanGateRecordsRemoved: orphanGateRecords, tombstoneBackfill: tombstones.counts,
          credentialCommandId: randomUUID(), credentialWriteId: randomUUID(), importedKeys: report.importedKeys, envKeysToRemove: report.envKeysToRemove });
        appendUpgrade(database, pending);
        database.prepare("UPDATE authority_meta SET authority_generation=authority_generation+1,updated_at=? WHERE singleton_id=1").run(now);
        inspectConvertedAuthority(database);
        if (args.verifyOnly !== true) {
          args.bindCredentials?.(upgradeId);
          input.hooks?.beforeCommit?.();
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
    database.prepare("UPDATE authority_meta SET authority_generation=authority_generation+1,updated_at=? WHERE singleton_id=1").run(now);
    database.exec("COMMIT");
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
  finally { database.close(); }
}
