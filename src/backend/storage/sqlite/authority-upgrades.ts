import type { EvidenceSchemaConversion } from "../../../models/storage/evidence-schema-admission.js";
import { runSettlementColumns } from "./run-settlement-row.js";
import { isSettingsRecordConversionMarker } from "./settings-record-conversion.js";
import { createHash,randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AppSettingsSchema } from "../../../models/config/app-settings.js";
import { AuthorityTableNameSchema, AuthorityEvidenceSchemaUpgradeRecordSchema, AuthorityUpgradeRecordSchema, type AuthorityEvidenceSchemaUpgradeRecord } from "../../../models/config/authority.js";
import { authorityUpgradeJournalOf, authorityUpgradeTransition, type AuthorityUpgradeJournalEvent } from "../../../rules/storage/upgrade-journal.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { LogoutOperationSchema, type LogoutOperation } from "../../../models/profiles/profile.js";
import { PredecessorRunRecordSchema, type PredecessorRunRecord } from "../../../models/run/record.js";
import type { RunResultRecord } from "../../../models/run/result.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { inspectArtifactDeletionFile } from "../artifacts/content-addressed-artifact-writer.js";
import type { FixedLayoutActivation } from "../maintenance/fixed-layout.js";
import { retainAuthoritySourceClosure } from "../source-closure.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { deletePreBuildRuns } from "./pre-build-run-deletion.js";
import { assertWorkerCustodyConverted, convertWorkerCustody, execMigrationStatement } from "./worker-custody-migration.js";
import { SearchStateColumnSchema, backfillRunSearchOcrSubjects } from "./run-search-index.js";
import { readAppSettings, migrateSettingsRecords } from "./settings-storage.js";
import { assertPreMasterWorkbookHistory, migrateWorkbookPayloads, migrateWorkbookVersionNames, WORKBOOK_MASTER_MIGRATION, WORKBOOK_PAYLOAD_CONVERSION_ID, WORKBOOK_VERSION_NAMES_CONVERSION_ID } from "./workbook-library-repository.js";
import { FingerprintSchema, IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { VerifiedBackup } from "./backup-service.js";
import { ASSISTANT_EFFORT_SCALE_VERSION, migrateAssistantEffortScale } from "./assistant-effort-migration.js";
import { FAILURE_NOTE_REMOVAL_CONVERSION_ID, migrateFailureNotes } from "./failure-note-removal-migration.js";
import { ASSISTANT_GRANT_RETIREMENT_VERSION, assertAssistantHistoryRetirable } from "./assistant-grant-retirement.js";
import { byteAwareRow } from "./assistant-attachments.js";
import { AUTHORITY_APPLICATION_ID, BUILD_ID_ENVELOPE_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION, OCR_SEARCH_TERMS_BACKFILL_ID, SQLITE_MIGRATIONS, WORKER_CUSTODY_CONVERSION_ID, WORKER_CUSTODY_SCAN_ID, deriveAuthorityUpgradePlanDigest, isSupportedStoppedAuthoritySchemaVersion } from "./migrations.js";
import { inspectionTableNames, readIntPragma, readMetaRow, optimizeAuthorityPlanner } from "./authority-connection.js";
import { AuthoritySchemaVersionError } from "./authority-errors.js";
import { inspectNormalAuthority, inspectStoppedTransaction, authorityContentFingerprint, commitVerifiedUpgrade } from "./authority-inspection.js";
import { assertTerminalEvidenceOwner, PREDECESSOR_CUSTODY_READERS } from "./authority-run-evidence.js";
import { nativeTableKey } from "./authority-stored-rows.js";

const AuthorityRecordFingerprintRowSchema = z.strictObject({ id: z.string(), payload_json: z.string() });

export function fixedLayoutUnchangedAuthorityFingerprint(database: DatabaseSync, intent: FixedLayoutActivation): string {
  const initialization = intent.settingsUpdate ?? intent.settingsInitialization;
  const excluded = new Set(["database_states", "settings", "settings_snapshots", "run_search"]);
  const present = new Set(inspectionTableNames(database));
  const hash = createHash("sha256");
  for (const table of AuthorityTableNameSchema.options.filter((name) => present.has(name) && !excluded.has(name))) {
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      const record = z.record(z.string(), z.unknown()).parse(row);
      if (initialization !== undefined && (table === "commands" && record.id === initialization.commandId
        || table === "command_audits" && record.id === initialization.auditId)) continue;
      hash.update(canonicalJsonStringify(byteAwareRow(record)));
    }
  }
  return hash.digest("hex");
}

export function fixedLayoutChangedAuthorityTables(before: DatabaseSync, after: DatabaseSync): readonly string[] {
  const excluded = new Set(["database_states", "settings", "settings_snapshots", "run_search"]);
  const beforeNames = new Set(inspectionTableNames(before));
  const afterNames = new Set(inspectionTableNames(after));
  return AuthorityTableNameSchema.options.filter((table) => !excluded.has(table)).filter((table) => {
    if (beforeNames.has(table) !== afterNames.has(table)) return true;
    if (!beforeNames.has(table)) return false;
    const fingerprint = (database: DatabaseSync): string => {
      const hash = createHash("sha256");
      for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
        hash.update(canonicalJsonStringify(byteAwareRow(z.record(z.string(), z.unknown()).parse(row))));
      }
      return hash.digest("hex");
    };
    return fingerprint(before) !== fingerprint(after);
  });
}

export function assertFixedLayoutPublications(before: DatabaseSync, after: DatabaseSync, sourceGeneration: number, activatedAt: string): void {
  const schema = z.strictObject({ id: z.literal(1), schema_version: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
    authority_generation: z.number().int().nonnegative(), updated_at: z.string(),
    search_generation: z.number().int().nonnegative().nullable(), search_state: SearchStateColumnSchema,
    installation_id: z.uuid(), profile_id: z.uuid() });
  const prior = schema.parse(before.prepare("SELECT * FROM database_states WHERE id=1").get());
  const current = schema.parse(after.prepare("SELECT * FROM database_states WHERE id=1").get());
  const ready = prior.search_state === "ready" && prior.search_generation === sourceGeneration;
  const expected = { ...prior, authority_generation: sourceGeneration + 1, updated_at: activatedAt,
    search_generation: ready ? sourceGeneration + 1 : null, search_state: ready ? "ready" : "invalid" };
  if (prior.authority_generation !== sourceGeneration || canonicalJsonStringify(current) !== canonicalJsonStringify(expected)) {
    throw new Error("fixed-layout: search publication differs from activation transaction");
  }
}

export const FixedLayoutSettingsSnapshotRowSchema = AuthorityRecordFingerprintRowSchema.extend({
  revision: z.number().int().positive(), fingerprint: FingerprintSchema, captured_at: IsoInstantSchema,
});

export function fixedLayoutSettingsSnapshots(database: DatabaseSync): readonly string[] {
  return database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all().map((raw) => {
    const row = FixedLayoutSettingsSnapshotRowSchema.parse(raw);
    const record = ConfigSnapshotRecordSchema.parse(JSON.parse(row.payload_json));
    if (record.configSnapshotId !== row.id || record.capturedAt !== row.captured_at
      || record.revision !== row.revision || record.fingerprint !== row.fingerprint) {
      throw new Error("fixed-layout: snapshot row metadata changed");
    }
    return canonicalJsonStringify(row);
  });
}

export function fixedLayoutAppSettings(database: DatabaseSync) {
  const rows = database.prepare("SELECT * FROM settings ORDER BY id").all()
    .map((raw) => AuthorityRecordFingerprintRowSchema.extend({ revision: z.number().int().positive(),
      snapshot_id: z.string(), command_id: z.string(), audit_id: z.string(), updated_at: z.string() }).parse(raw));
  if (rows.length > 1 || rows.some((row) => row.id !== "current")) {
    throw new Error("fixed-layout: app settings membership changed");
  }
  const row = rows[0];
  if (row === undefined) return null;
  const value = AppSettingsSchema.parse(JSON.parse(row.payload_json));
  const authenticated = readAppSettings(database);
  if (canonicalJsonStringify(authenticated) !== canonicalJsonStringify(value)
    || row.revision !== (value.saved?.revision ?? 1)
    || row.snapshot_id !== (value.active?.configSnapshotId ?? value.initialization.configSnapshotId)
    || row.command_id !== (value.saved?.commandId ?? value.initialization.commandId)
    || row.audit_id !== (value.saved?.auditId ?? value.initialization.auditId)
    || row.updated_at !== (value.saved?.committedAt ?? value.active?.activatedAt ?? value.initialization.initializedAt)) {
    throw new Error("fixed-layout: app settings row metadata changed");
  }
  return value;
}

/** Internal stopped-upgrade barrier; never exported through the repository entrypoint. */
/** Applies every migration after `version` with the data steps that run between its statements; the caller owns the transaction and the version stamp. */
export function applyAuthorityMigrationsAfter(database: DatabaseSync, version: number, input: Readonly<{ now: string;
  binding?: Readonly<{ installationId: string; profileId: string }>; captureFile: Parameters<typeof convertWorkerCustody>[2] }>): void {
  const settleEvidence = (record: Parameters<typeof settlePredecessorRunEvidence>[1], run: Parameters<typeof settlePredecessorRunEvidence>[2]) => settlePredecessorRunEvidence(database, record, run);
  for (const migration of SQLITE_MIGRATIONS.filter(item => item.version > version)) {
    for (const [index, statement] of migration.statements.entries()) {
      if (migration.version === 7 && index === 1) {
        if (input.binding === undefined) throw new Error("authority-migration-binding-required");
        database.prepare("INSERT INTO database_states_bound SELECT id,schema_version,authority_generation,updated_at,search_generation,search_state,?,? FROM database_states")
          .run(input.binding.installationId, input.binding.profileId);
      }
      if (migration.version === BUILD_ID_ENVELOPE_SCHEMA_VERSION && index === 0) deletePreBuildRuns(database, input.now, input.captureFile, settleEvidence);
      if (statement === `SELECT '${WORKER_CUSTODY_CONVERSION_ID}'`) convertWorkerCustody(database, input.now, input.captureFile, settleEvidence);
      if (migration.version === ASSISTANT_GRANT_RETIREMENT_VERSION && index === 0) {
        assertAssistantHistoryRetirable(database, nativeOrdinaryRecordFromRow);
        database.exec("DELETE FROM assistant_actions");
      }
      if (migration.version === WORKBOOK_MASTER_MIGRATION.version && index === 0) assertPreMasterWorkbookHistory(database);
      execMigrationStatement(database, statement);
      if (isSettingsRecordConversionMarker(statement)) migrateSettingsRecords(database);
      if (migration.version === ASSISTANT_EFFORT_SCALE_VERSION && index === 2) migrateAssistantEffortScale(database);
      if (statement === `SELECT '${FAILURE_NOTE_REMOVAL_CONVERSION_ID}'`) migrateFailureNotes(database);
      if (statement === `SELECT '${WORKBOOK_PAYLOAD_CONVERSION_ID}'`) migrateWorkbookPayloads(database);
      if (statement === `SELECT '${WORKBOOK_VERSION_NAMES_CONVERSION_ID}'`) migrateWorkbookVersionNames(database);
      if (statement === `SELECT '${OCR_SEARCH_TERMS_BACKFILL_ID}'`) backfillRunSearchOcrSubjects(database);
      if (statement === `SELECT '${WORKER_CUSTODY_SCAN_ID}'`) assertWorkerCustodyConverted(database);
    }
  }
}

export function readAuthorityUpgradeRecords(database: DatabaseSync) {
  return database.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all()
    .map(row => AuthorityUpgradeRecordSchema.parse(nativeOrdinaryRecordFromRow("database_upgrades", row)));
}

export const readAuthorityUpgradeJournal = (database: DatabaseSync) => authorityUpgradeJournalOf(readAuthorityUpgradeRecords(database));

/** Refuses a row the journal's transition table does not allow, before the writer inserts it. */
export function assertAuthorityUpgradeAppend(database: DatabaseSync, event: AuthorityUpgradeJournalEvent, phase: "baseline" | "settled") {
  const transition = authorityUpgradeTransition(readAuthorityUpgradeJournal(database), event);
  if (!("append" in transition)) throw new Error(`authority-upgrade-journal-${transition.refused}`);
  if (transition.append !== phase) throw new Error("authority-upgrade-journal-phase-mismatch");
}

export function evidenceSchemaPlanDigest(upgradeId: string, conversion: EvidenceSchemaConversion): string {
  return sha256Hex(`relay:evidence-schema-conversion:v1\0${upgradeId}\0${canonicalJsonStringify(conversion)}`);
}

/** Each conversion id is recorded at most once and remains sealed at the schema where it settled. */
export function verifiedEvidenceSchemaRecords(database: DatabaseSync, admission: RuntimeAdmission,
  binding: Readonly<{ installationId?: string; profileId?: string }>): ReadonlyMap<EvidenceSchemaConversion["id"], AuthorityEvidenceSchemaUpgradeRecord> {
  const records = new Map<EvidenceSchemaConversion["id"], AuthorityEvidenceSchemaUpgradeRecord>();
  const journal = readAuthorityUpgradeJournal(database);
  for (const stored of journal.journal === "settled" ? journal.evidence : []) {
    admission.assertEvidenceSchemaConversion(stored);
    const record = AuthorityEvidenceSchemaUpgradeRecordSchema.parse(stored), conversion = record.evidenceSchemas;
    if (records.has(conversion.id)) throw new Error("evidence-schema-conversion-duplicate");
    if (record.toSchemaVersion > readIntPragma(database, "user_version")
      || record.planDigest !== evidenceSchemaPlanDigest(record.upgradeId, conversion)) throw new Error("evidence-schema-conversion-unproved");
    if (conversion.installationId !== binding.installationId || conversion.profileId !== binding.profileId) throw new Error("evidence-schema-conversion-foreign");
    records.set(conversion.id, record);
  }
  return records;
}

export const startupLogoutConversionBrand: unique symbol = Symbol("startup-logout-conversion");
export type StartupLogoutConversion = Readonly<{ [startupLogoutConversionBrand]: true }>;
export const startupLogoutConversions = new WeakMap<StartupLogoutConversion, {
  admission: RuntimeAdmission; operation: LogoutOperation; next: LogoutOperation;
  verifyBackup: (admission: RuntimeAdmission, path: string) => VerifiedBackup;
}>();

export function convertedLogoutOperation(operation: LogoutOperation, sourceFingerprint: string, currentFingerprint: string): LogoutOperation {
  const settlement = operation.settlement;
  if (settlement === undefined) throw new Error("profile-startup-logout-settlement-required");
  if (settlement.after === sourceFingerprint) return LogoutOperationSchema.parse({ ...operation, settlement: { ...settlement, after: currentFingerprint } });
  if (settlement.before !== sourceFingerprint) throw new Error("profile-startup-logout-source-changed");
  const { after: _after, ...prepared } = settlement;
  return LogoutOperationSchema.parse({ ...operation, settlement: { ...prepared, phase: "prepared", before: currentFingerprint } });
}

export function migrateStoppedAuthority(database: DatabaseSync, clock: Clock, admission: RuntimeAdmission, path: string, expectedFingerprint?: string, backup?: VerifiedBackup, verifyBackup?: (admission: RuntimeAdmission, manifestPath: string) => VerifiedBackup) {
  requireRuntimeAdmission(admission);
  const version = readIntPragma(database, "user_version");
  if (version === CURRENT_AUTHORITY_SCHEMA_VERSION) return inspectNormalAuthority(database);
  const purpose = admission.assertProfileMigration(path, version);
  const binding = admission.profileBinding;
  if (!isSupportedStoppedAuthoritySchemaVersion(version)) throw new AuthoritySchemaVersionError(version);
  database.exec("BEGIN EXCLUSIVE");
  try {
    admission.assertProfileMigration(path, version);
    if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("authority-application-mismatch");
    const fingerprint = inspectStoppedTransaction(database, path, version).authorityContentFingerprint;
    const meta = readMetaRow(database);
    if (meta.schema_version !== version) throw new Error("authority-schema-metadata-mismatch");
    admission.assertProfileMigration(path, version, fingerprint);
    if (expectedFingerprint !== undefined && fingerprint !== expectedFingerprint) throw new Error("source-changed: re-plan upgrade");
    if (backup === undefined || expectedFingerprint === undefined) throw new Error("upgrade-verified-backup-required");
    if (purpose === "ready") {
      if (verifyBackup === undefined) throw new Error("stopped-backup-verifier-required");
      const verified = verifyBackup(admission, backup.manifestPath);
      if (canonicalJsonStringify(verified) !== canonicalJsonStringify(backup)
        || verified.manifest.installationId !== binding.installationId || verified.manifest.profileId !== binding.profileId) throw new Error("profile-stopped-upgrade-backup-changed");
    }
    if (backup.manifest.schemaVersion !== version || backup.manifest.authorityContentFingerprint !== fingerprint
      || backup.manifest.authorityGeneration !== meta.authority_generation) throw new Error("source-changed: upgrade backup differs from source");
    const planDigest = deriveAuthorityUpgradePlanDigest(version, fingerprint);
    const logout = admission.stoppedUpgradeLogout();
    if (logout?.settlement !== undefined && fingerprint !== logout.settlement.before && fingerprint !== logout.settlement.after) throw new Error("profile-startup-logout-source-changed");
    applyAuthorityMigrationsAfter(database, version, { now: clock.now().toISOString(), binding, captureFile: ref => inspectArtifactDeletionFile(admission, ref) });
    database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    const record = AuthorityUpgradeRecordSchema.parse({ recordKey: randomUUID(), upgradeId: fingerprint,
      phase: "settled", fromSchemaVersion: version, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
      planDigest, backup: { manifestPath: backup.manifestPath, sha256: backup.manifest.sha256, authorityGeneration: backup.manifest.authorityGeneration },
      ...(logout?.settlement === undefined ? {} : { startupLogout: { operation: logout, postimage: authorityContentFingerprint(database) } }),
      by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: clock.now().toISOString() });
    assertAuthorityUpgradeAppend(database, { type: "forward-upgrade", from: version }, record.phase);
    database.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(record.recordKey, record.upgradeId, record.phase, backup.manifest.sha256, canonicalJsonStringify(record), record.recordedAt);
    optimizeAuthorityPlanner(database);
    const inspection = inspectNormalAuthority(database);
    commitVerifiedUpgrade(database, path, inspection);
    return { ...inspection, schemaVersion: version, authorityContentFingerprint: fingerprint };
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch (rollbackError) { throw retainAuthoritySourceClosure([error, rollbackError], { database }); }
    throw error;
  }
}

export function settlePredecessorRunEvidence(database: DatabaseSync, record: RunResultRecord, run: PredecessorRunRecord): void {
  const columns = runSettlementColumns(run, record, PredecessorRunRecordSchema);
  database.prepare(`INSERT INTO run_results (${Object.keys(columns).join(",")}) VALUES (${Object.keys(columns).map(() => "?").join(",")})`)
    .run(...Object.values(columns));
  assertTerminalEvidenceOwner(database, record, PREDECESSOR_CUSTODY_READERS, run, new Set(), BUILD_ID_ENVELOPE_SCHEMA_VERSION - 1);
}
