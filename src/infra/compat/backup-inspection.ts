import { VersionChangeSchema } from "../../domain/archive/change-record.js";
import { RuntimeVersionChangeSchema } from "../../domain/archive/runtime-version-change.js";
import { ArchiveReportSchema } from "../../domain/archive/report.js";
import { parsePendingCapture } from "../../domain/archive/pending-capture.js";
import { ArchiveRelaunchStorageRecordSchema } from "../sqlite/storage-records.js";
import { FailureResolutionSchema } from "../../domain/trust/failure-resolution.js";
import { KnowledgeRecordSchema, FixRecordSchema } from "../../domain/trust/knowledge.js";
import { OpaqueAuthorityRecordSchema } from "../sqlite/storage-records.js";
import { ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema } from "../../domain/generated-artifact.js";
import { OperatorXlsxExportEvidenceSchema } from "../../domain/dashboard/xlsx-export.js";
import { SettingsCurrentRecordSchema } from "../../domain/config/settings-current.js";
import { ActiveRuntimeConfigRecordSchema } from "../../domain/config/runtime-generation.js";
import { ProviderAdmissionRecordSchema, ProviderBudgetCounterSchema } from "../../domain/provider-admission.js";
import { IntakeSessionSchema } from "../../domain/intake/session.js";
import { IntakePlanManifestSchema } from "../../domain/intake/manifest.js";
import { AdmittedExtractionSchema } from "../../domain/ocr/extraction.js";
import { HistoricalRunRecordV40Schema } from "../../domain/run/record.js";
import { HistoricalTerminalAuthorizationSchema, HistoricalTerminalOutboxRecordSchema } from "../../domain/run/completion-history.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { LedgerPartitionRecordSchema, LedgerProjectionRecordSchema } from "../../domain/ledger-projection.js";
import { BulkRunCommandAcceptanceRecordSchema, AuthorityCommandRecordSchema } from "../../domain/commands.js";
import { PreFloorCommandSchema, HistoricalProtectedSettingsCommandSchema } from "../../domain/commands-history.js";
import { HistoricalRunSessionRecordSchema } from "../../domain/run/session.js";
import { createHash } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { inspectConvertedAuthority, inspectHistoricalAuthorityInvariants } from "../sqlite/authority-database.js";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "../sqlite/storage-records.js";
import { SettingsCurrentRecordSchema as HistoricalSettingsCurrentRecordSchema } from "./d331-settings-current.js";
import { ProtectedSettingsCurrentRecordSchema } from "../../domain/authority.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import {
  AUTHORITY_APPLICATION_ID,
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  databaseStateTable,
  SQLITE_MIGRATIONS,
} from "../sqlite/migrations.js";

const ADMITTED_HISTORICAL_SCHEMA_VERSIONS = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
] as const);
const PROJECTION_TABLES = new Set(["spans", "gates", "notes", "runs_view"]);

/**
 * Released authority-table order used by the backup fingerprint algorithm.
 * Filtering this list by a replayed schema reconstructs the list used at that
 * schema version, including the v1-v27 capture tables and the v30-v31 protected
 * singleton that are absent from the v32 runtime registry.
 */
const RELEASED_AUTHORITY_TABLE_ORDER = Object.freeze([
  "transaction_selection", "run_search_index", "run_search_grams", "run_search_publication", "run_search_declarations", "run_search_actors",
  "run_summaries", "summary_publication", "archive_transfers", "version_changes",
  "authority_meta",
  "database_state",
  "explorer_overrides",
  "tasks",
  "workflow_runs",
  "run_terminal_authorizations",
  "failures",
  "run_failures",
  "run_results",
  "run_terminal_outbox",
  "diagnostic_bundles",
  "diagnostic_snapshots",
  "diagnostic_attachments",
  "diagnostic_files",
  "evidence_receipts",
  "run_receipts",
  "dry_run_scenario_results",
  "dryrun_results",
  "operator_xlsx_exports",
  "generated_artifacts",
  "activity_person_pseudonyms",
  "activity_person_pseudonym_generations",
  "knowledge_records",
  "fix_records",
  "ledger_partitions",
  "ledger_projections",
  "provider_budget_counters",
  "provider_admissions",
  "provider_usage",
  "provider_requests",
  "leases",
  "workflow_workers",
  "dependencies",
  "delegation_dependencies",
  "delegation_manifests",
  "run_delegations",
  "commands",
  "command_audits",
  "bulk_command_acceptances",
  "notifications", "notification_publications", "notification_health",
  "config_snapshots",
  "settings_snapshots",
  "settings_current",
  "runtime_config",
  "app_settings",
  "version_plans",
  "checkpoint_payloads",
  "run_checkpoints",
  "start_plans",
  "workflow_run_requests",
  "ocr_approvals",
  "capture_sessions",
  "capture_photo_order",
  "capture_finalization_outboxes",
  "write_intents",
  "run_operations",
  "write_attempts",
  "run_operation_attempts",
  "durable_outbox",
  "operation_outbox",
  "artifact_outbox",
  "artifact_sink_heads",
  "imported_artifacts",
  "extracted_artifacts",
  "intake_sessions",
  "intake_manifests",
  "ocr_extractions",
  "version_bump_applications",
  "archived_runs",
  "archive_relaunches",
  "duo_ceremony_leases",
  "worker_auth",
  "worker_pools",
  "worker_controls", "worker_browsers",
  "run_sessions",
  "workflow_run_batches",
  "deleted_runs",
  "protected_settings_current",
  "authority_upgrades",
  "database_upgrades",
  "timeline_events",
  "timeline_operation_sources",
  "runtime_versions",
  "runtime_version_adoptions",
  "runtime_version_changes",
] as const);

const IntPragmaRowSchema = z.record(z.string(), z.number().int());
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
const MetaRowSchema = z.strictObject({
  singleton_id: z.literal(1),
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string().min(1),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});
const SchemaObjectRowSchema = z.strictObject({
  type: z.enum(["table", "index", "trigger"]),
  name: z.string().min(1),
  tbl_name: z.string().min(1),
  sql: z.string().nullable(),
});
const TableColumnRowSchema = z.strictObject({
  cid: z.number().int(),
  name: z.string(),
  type: z.string(),
  notnull: z.number().int(),
  dflt_value: z.union([z.string(), z.number(), z.null()]),
  pk: z.number().int(),
  hidden: z.number().int(),
});
const ForeignKeyRowSchema = z.strictObject({
  id: z.number().int(),
  seq: z.number().int(),
  table: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  on_update: z.string(),
  on_delete: z.string(),
  match: z.string(),
});
const IndexColumnRowSchema = z.strictObject({
  seqno: z.number().int(),
  cid: z.number().int(),
  name: z.string().nullable(),
  desc: z.number().int(),
  coll: z.string(),
  key: z.number().int(),
});
const FingerprintRowSchema = z.strictObject({
  record_key: z.string(),
  record_json: z.string(),
});

type SchemaObjectRow = z.infer<typeof SchemaObjectRowSchema>;
type MetaRow = z.infer<typeof MetaRowSchema>;

export type BackupCopyInspection = Readonly<{
  applicationId: typeof AUTHORITY_APPLICATION_ID;
  schemaVersion: number;
  pageCount: number;
  authorityGeneration: number;
  authorityContentFingerprint: string;
  quickCheck: "ok";
  foreignKeyViolations: 0;
  invariantViolations: readonly [];
  exactTableRegistry: true;
  tables: readonly Readonly<{ name: string; classification: "authority" | "projection" }>[];
  counts: Readonly<{
    pendingCommands: number;
    unresolvedWriteIntents: number;
    leases: number;
    durableOutbox?: number;
    runTerminalOutbox?: number;
    providerReservations: number;
    artifactOutbox: number;
  }>;
}>;

export type AuthorityBackupSourceReadOnly = Readonly<{
  getMeta(): Readonly<{ schemaVersion: number; authorityGeneration: number; updatedAt: string }>;
  getSourceDatabaseIdentity(): string;
  onlineBackupTo(destinationPath: string): Promise<number>;
  close(): void;
}>;

function isAdmittedSchemaVersion(schemaVersion: number): boolean {
  return ADMITTED_HISTORICAL_SCHEMA_VERSIONS.includes(
    schemaVersion as typeof ADMITTED_HISTORICAL_SCHEMA_VERSIONS[number],
  ) || schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION;
}

function readIntPragma(database: DatabaseSync, name: "application_id" | "user_version"): number {
  const row = IntPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql
    .trim()
    .replace(/;$/u, "")
    .replace(/["`]([A-Za-z_][A-Za-z0-9_]*)["`]/gu, "$1")
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/gu, "$1")
    .replace(/\s+/gu, " ");
}

function schemaRows(database: DatabaseSync): readonly SchemaObjectRow[] {
  return z.array(SchemaObjectRowSchema).parse(database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger')
      AND (type = 'index' OR name NOT LIKE 'sqlite_%')
    ORDER BY type, name
  `).all());
}

function schemaSnapshot(database: DatabaseSync): string {
  const rows = schemaRows(database);
  const tables = rows.filter(({ type }) => type === "table").map((row) => ({
    ...row,
    sql: normalizeSql(row.sql),
    columns: z.array(TableColumnRowSchema).parse(
      database.prepare(`PRAGMA table_xinfo(${quoteIdentifier(row.name)})`).all(),
    ).map((column) => ({
      ...column,
      dflt_value: typeof column.dflt_value === "string"
        ? normalizeSql(column.dflt_value)
        : column.dflt_value,
    })),
    foreignKeys: z.array(ForeignKeyRowSchema).parse(
      database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(row.name)})`).all(),
    ),
  }));
  const indexes = rows.filter(({ type }) => type === "index").map((row) => ({
    ...row,
    sql: normalizeSql(row.sql),
    columns: z.array(IndexColumnRowSchema).parse(
      database.prepare(`PRAGMA index_xinfo(${quoteIdentifier(row.name)})`).all(),
    ),
  }));
  const triggers = rows.filter(({ type }) => type === "trigger").map((row) => ({
    ...row,
    sql: normalizeSql(row.sql),
  }));
  return canonicalJsonStringify({ tables, indexes, triggers });
}

function expectedSchemaSnapshot(schemaVersion: number): string {
  const database = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    for (const migration of SQLITE_MIGRATIONS) {
      if (migration.version > schemaVersion) break;
      for (const statement of migration.statements) database.exec(statement);
    }
    database.exec("COMMIT");
    return schemaSnapshot(database);
  } finally {
    database.close();
  }
}

function readMeta(database: DatabaseSync): MetaRow {
  const rows = z.array(MetaRowSchema).parse(database.prepare(`
    SELECT singleton_id, schema_version, authority_generation, updated_at,
           migration_owner, migration_started_at
    FROM ${databaseStateTable(readIntPragma(database, "user_version"))}
    ORDER BY singleton_id
  `).all());
  if (rows.length !== 1) {
    throw new Error(`authority database must hold exactly one metadata row; found ${String(rows.length)}`);
  }
  const row = rows[0];
  if (row === undefined) throw new Error("authority database metadata row is missing");
  return row;
}

function authorityTableOrder(tableNames: ReadonlySet<string>): readonly string[] {
  const ordered = RELEASED_AUTHORITY_TABLE_ORDER.filter((name) => tableNames.has(name));
  const unknown = [...tableNames]
    .filter((name) => !PROJECTION_TABLES.has(name) && !ordered.includes(
      name as typeof RELEASED_AUTHORITY_TABLE_ORDER[number],
    ))
    .toSorted();
  if (unknown.length > 0) {
    throw new Error(`authority backup fingerprint has no released table order for ${unknown.join(",")}`);
  }
  return ordered;
}

function authorityContentFingerprint(database: DatabaseSync, tableNames: ReadonlySet<string>): string {
  const schemaVersion = readIntPragma(database, "user_version");
  const groupedCommands = schemaVersion >= 37;
  const hash = createHash("sha256");
  hash.update("[");
  for (const [tableIndex, name] of authorityTableOrder(tableNames).entries()) {
    if (tableIndex > 0) hash.update(",");
    hash.update(`[${canonicalJsonStringify(name)},`);
    if (name === databaseStateTable(readIntPragma(database, "user_version"))) {
      const meta = readMeta(database);
      hash.update(canonicalJsonStringify({
        singleton_id: meta.singleton_id,
        schema_version: meta.schema_version,
        authority_generation: meta.authority_generation,
        updated_at: meta.updated_at,
        migration_owner: meta.migration_owner,
        migration_started_at: meta.migration_started_at,
      }));
    } else {
      hash.update("[");
      let rowIndex = 0;
      const schema = name === "run_failures" && schemaVersion >= 45 ? FingerprintRowSchema.extend({ resolution_json: z.string(), resolution_version: z.number().int().positive() }) : name === "commands" && groupedCommands ? FingerprintRowSchema.extend({ parent_command_id: z.string().nullable() }) : name === "archived_runs" && schemaVersion >= 40 ? FingerprintRowSchema.extend({ transactions_json: z.string().nullable(), transactions_digest: z.string().nullable() }) : FingerprintRowSchema;
      for (const rawRow of database.prepare(`
        SELECT record_key, record_json${name === "run_failures" && schemaVersion >= 45 ? ", resolution_json, resolution_version" : name === "commands" && groupedCommands ? ", parent_command_id" : name === "archived_runs" && schemaVersion >= 40 ? ", transactions_json, transactions_digest" : ""} FROM ${quoteIdentifier(name)} ORDER BY record_key
      `).iterate()) {
        const row = schema.parse(rawRow);
        if (name === "run_failures" && schemaVersion >= 45) {
          const resolution = z.object({ resolution_json: z.string(), resolution_version: z.number().int().positive() }).parse(row);
          if (FailureResolutionSchema.parse(JSON.parse(resolution.resolution_json)).version !== resolution.resolution_version) throw new Error("failure-resolution-version-mismatch");
        }
        if (rowIndex > 0) hash.update(",");
        hash.update(canonicalJsonStringify(row));
        rowIndex += 1;
      }
      hash.update("]");
    }
    hash.update("]");
  }
  hash.update("]");
  return hash.digest("hex");
}

function count(database: DatabaseSync, sql: string): number {
  return CountRowSchema.parse(database.prepare(sql).get()).count;
}

function pendingCounts(database: DatabaseSync, tableNames: ReadonlySet<string>, schemaVersion: number) {
  // Schema admission already proved the exact layout. Missing required tables must throw.
  const operations = schemaVersion < 36 ? "write_intents" : "run_operations";
  const outbox = schemaVersion < 36 ? "durable_outbox" : "operation_outbox";
  const countIfPresent = (tableName: string, sql: string): number => (
    tableNames.has(tableName) ? count(database, sql) : 0
  );
  return Object.freeze({
    pendingCommands: count(database, `SELECT count(*) AS count FROM commands AS command WHERE ${schemaVersion >= 37 ? "command.family <> 'bulk-parent' AND " : ""}NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.record_key)`),
    unresolvedWriteIntents: count(database, `SELECT count(*) AS count FROM ${operations} WHERE status NOT IN ('committed', 'observed-present')`),
    leases: count(database, schemaVersion < 35 ? "SELECT count(*) AS count FROM leases" : "SELECT count(*) AS count FROM workflow_workers"),
    ...(schemaVersion >= 40 ? {} : { durableOutbox: count(database, `SELECT count(*) AS count FROM ${outbox} WHERE json_extract(record_json, '$.projection.state') = 'pending'`) }),
    ...(schemaVersion <= 40 ? { runTerminalOutbox: countIfPresent("run_terminal_outbox", "SELECT count(*) AS count FROM run_terminal_outbox WHERE state = 'pending'") } : {}),
    providerReservations: schemaVersion >= 43 ? count(database, "SELECT count(*) AS count FROM provider_requests WHERE state='reserved'") : countIfPresent("provider_admissions", "SELECT count(*) AS count FROM provider_admissions WHERE state = 'reserved'"),
    artifactOutbox: count(database, schemaVersion >= 46 ? "SELECT count(*) AS count FROM generated_artifacts f,json_each(f.record_json,'$.updates') u WHERE json_extract(u.value,'$.record.state')='pending'" : "SELECT count(*) AS count FROM artifact_outbox WHERE json_extract(record_json, '$.state') = 'pending'"),
  });
}

/** Historical rows are never opaque admission: use the retained grammar for each family. */
function validateHistoricalRecords(database: DatabaseSync, schemaVersion: number, tables: ReadonlySet<string>): void {
  const registry: Readonly<Record<string, z.ZodType>> = {
    ...AUTHORITY_RECORD_SCHEMA_REGISTRY,
    archive_relaunches: ArchiveRelaunchStorageRecordSchema,
    knowledge_records: KnowledgeRecordSchema, fix_records: FixRecordSchema, ocr_approvals: OpaqueAuthorityRecordSchema,
    operator_xlsx_exports: OperatorXlsxExportEvidenceSchema, artifact_outbox: ArtifactOutboxStorageRecordSchema, artifact_sink_heads: ArtifactSinkHeadRecordSchema,
    provider_admissions: ProviderAdmissionRecordSchema, provider_budget_counters: ProviderBudgetCounterSchema,
    settings_current: SettingsCurrentRecordSchema, runtime_config: ActiveRuntimeConfigRecordSchema,
    intake_sessions: IntakeSessionSchema, intake_manifests: IntakePlanManifestSchema, ocr_extractions: AdmittedExtractionSchema,
    authority_upgrades: AUTHORITY_RECORD_SCHEMA_REGISTRY.database_upgrades,
    diagnostic_bundles: AUTHORITY_RECORD_SCHEMA_REGISTRY.diagnostic_snapshots,
    diagnostic_attachments: AUTHORITY_RECORD_SCHEMA_REGISTRY.diagnostic_files,
    evidence_receipts: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_receipts,
    config_snapshots: AUTHORITY_RECORD_SCHEMA_REGISTRY.settings_snapshots,
    dry_run_scenario_results: AUTHORITY_RECORD_SCHEMA_REGISTRY.dryrun_results,
    tasks: HistoricalRunRecordV40Schema,
    ...(schemaVersion <= 40 ? { workflow_runs: HistoricalRunRecordV40Schema,
      failures: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_failures,
      run_terminal_authorizations: HistoricalTerminalAuthorizationSchema,
      run_terminal_outbox: HistoricalTerminalOutboxRecordSchema } : {}),
    leases: AUTHORITY_RECORD_SCHEMA_REGISTRY.workflow_workers,
    duo_ceremony_leases: AUTHORITY_RECORD_SCHEMA_REGISTRY.worker_auth,
    start_plans: AUTHORITY_RECORD_SCHEMA_REGISTRY.workflow_run_requests,
    write_intents: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_operations,
    write_attempts: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_operation_attempts,
    durable_outbox: AtomicOutboxRecordSchema,
    operation_outbox: AtomicOutboxRecordSchema,
    ledger_partitions: LedgerPartitionRecordSchema,
    ledger_projections: LedgerProjectionRecordSchema,
    dependencies: AUTHORITY_RECORD_SCHEMA_REGISTRY.delegation_dependencies,
    delegation_manifests: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_delegations,
    bulk_command_acceptances: BulkRunCommandAcceptanceRecordSchema,
    ...(schemaVersion < 37 ? { commands: z.union([AuthorityCommandRecordSchema, PreFloorCommandSchema, HistoricalProtectedSettingsCommandSchema]) } : {}),
    run_sessions: HistoricalRunSessionRecordSchema,
    ...(schemaVersion < 32 ? { settings_current: HistoricalSettingsCurrentRecordSchema, protected_settings_current: ProtectedSettingsCurrentRecordSchema } : {}),
  };
  for (const table of tables) {
    if (PROJECTION_TABLES.has(table) || table === databaseStateTable(schemaVersion)) continue;
    const schema = registry[table];
    if (schema === undefined) {
      // Retired capture authorities have no admitted producer. Refuse any retained
      // row before the historical DROP migration can discard evidence.
      if (count(database, `SELECT count(*) AS count FROM ${quoteIdentifier(table)}`) !== 0) throw new Error(`unsupported-retained-authority { table: ${table} }`);
      continue;
    }
    for (const raw of database.prepare(`SELECT record_key, record_json FROM ${quoteIdentifier(table)}`).iterate()) {
      const row = FingerprintRowSchema.parse(raw);
      const result = schema.safeParse(JSON.parse(row.record_json));
      if (!result.success) throw new Error(`authority-record-invalid { table: ${table}, record: ${row.record_key} }`);
    }
  }
}

export function inspectOpenDatabase(
  database: DatabaseSync,
  expectedSchemaVersion: number | undefined,
): BackupCopyInspection {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  if (!isAdmittedSchemaVersion(schemaVersion)) {
    throw new Error(`authority schema ${String(schemaVersion)} is not an admitted backup schema`);
  }
  if (expectedSchemaVersion !== undefined && schemaVersion !== expectedSchemaVersion) {
    throw new Error(
      `authority schema ${String(schemaVersion)} does not match backup manifest ${String(expectedSchemaVersion)}`,
    );
  }
  QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) {
    throw new Error(
      `authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`,
    );
  }
  const actualSchema = schemaSnapshot(database);
  const expectedSchema = expectedSchemaSnapshot(schemaVersion);
  if (actualSchema !== expectedSchema) {
    throw new Error(`authority schema ${String(schemaVersion)} does not match its immutable migration replay`);
  }
  const meta = readMeta(database);
  if (meta.schema_version !== schemaVersion) {
    throw new Error(
      `authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`,
    );
  }
  if (meta.migration_owner !== null || meta.migration_started_at !== null) {
    throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
  }
  const tableNames = new Set(schemaRows(database)
    .filter(({ type }) => type === "table")
    .map(({ name }) => name));
  validateHistoricalRecords(database, schemaVersion, tableNames);
  if (schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) inspectConvertedAuthority(database);
  else inspectHistoricalAuthorityInvariants(database, schemaVersion);
  return Object.freeze({
    applicationId: AUTHORITY_APPLICATION_ID,
    schemaVersion,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    authorityContentFingerprint: authorityContentFingerprint(database, tableNames),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariantViolations: Object.freeze([] as const),
    exactTableRegistry: true,
    tables: Object.freeze([...tableNames].toSorted().map((name) => Object.freeze({
      name,
      classification: PROJECTION_TABLES.has(name) ? "projection" as const : "authority" as const,
    }))),
    counts: pendingCounts(database, tableNames, schemaVersion),
  });
}

function openReadOnlyDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  return new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
}

type ExistingSqliteCompanions = Readonly<{ wal: boolean; shm: boolean }>;

function existingSqliteCompanions(path: string): ExistingSqliteCompanions {
  return Object.freeze({
    wal: existsSync(`${path}-wal`),
    shm: existsSync(`${path}-shm`),
  });
}

function removeGeneratedReadOnlyCompanions(
  path: string,
  existing: ExistingSqliteCompanions,
): void {
  const walPath = `${path}-wal`;
  if (!existing.wal && existsSync(walPath)) {
    const size = statSync(walPath).size;
    if (size !== 0) {
      throw new Error(
        `read-only authority inspection unexpectedly created a ${String(size)}-byte WAL`,
      );
    }
    rmSync(walPath);
  }
  const shmPath = `${path}-shm`;
  if (!existing.shm && existsSync(shmPath)) rmSync(shmPath);
}

/** Internal stopped readers preserve pre-existing SQLite companions and remove only their own empty read artifacts. */
export function withAuthorityDatabaseReadOnly<Result>(admission: RuntimeAdmission, path: string, read: (database: DatabaseSync) => Result): Result {
  requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
  const existing = existingSqliteCompanions(path);
  const database = openReadOnlyDatabase(path, 250);
  try { return read(database); }
  finally { database.close(); removeGeneratedReadOnlyCompanions(path, existing); }
}

export function inspectAuthorityBackupReadOnly(
  admission: RuntimeAdmission,
  pathInput: string,
  expectedSchemaVersion?: number,
  busyTimeoutMs = 250,
): BackupCopyInspection {
  const path = resolve(z.string().min(1).parse(pathInput));
  requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`authority database ${path} is missing or empty`);
  }
  const existingCompanions = existingSqliteCompanions(path);
  const database = openReadOnlyDatabase(path, busyTimeoutMs);
  let transactionOpen = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    database.exec("BEGIN");
    transactionOpen = true;
    const inspection = inspectOpenDatabase(database, expectedSchemaVersion);
    database.exec("COMMIT");
    transactionOpen = false;
    return inspection;
  } finally {
    if (transactionOpen) database.exec("ROLLBACK");
    database.close();
    removeGeneratedReadOnlyCompanions(path, existingCompanions);
  }
}

export function authorityBackupSourceDatabaseIdentity(pathInput: string): string {
  return createHash("sha256")
    .update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(pathInput))}`)
    .digest("hex");
}

/**
 * Opens a stopped authority without migrating it. The caller owns `close()`;
 * the backup service re-inspects the copied bytes before publishing a manifest.
 */
export function openAuthorityBackupSourceReadOnly(
  admission: RuntimeAdmission,
  pathInput: string,
  busyTimeoutMs = 250,
): AuthorityBackupSourceReadOnly {
  const path = resolve(z.string().min(1).parse(pathInput));
  inspectAuthorityBackupReadOnly(admission,path, undefined, busyTimeoutMs);
  const existingCompanions = existingSqliteCompanions(path);
  const database = openReadOnlyDatabase(path, busyTimeoutMs);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA query_only = ON");
  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error("authority backup source is closed");
  };
  return Object.freeze({
    getMeta() {
      admission.assertLive();
      assertOpen();
      const schemaVersion = readIntPragma(database, "user_version");
      const meta = readMeta(database);
      if (meta.schema_version !== schemaVersion) {
        throw new Error(
          `authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`,
        );
      }
      return Object.freeze({
        schemaVersion,
        authorityGeneration: meta.authority_generation,
        updatedAt: meta.updated_at,
      });
    },
    getSourceDatabaseIdentity() {
      admission.assertLive();
      assertOpen();
      return authorityBackupSourceDatabaseIdentity(path);
    },
    async onlineBackupTo(destinationPath: string) {
      admission.assertWritable();
      admission.assertStateRoot(destinationPath);
      assertOpen();
      return sqliteBackup(database, resolve(z.string().min(1).parse(destinationPath)), { rate: 100 });
    },
    close() {
      if (closed) return;
      database.close();
      closed = true;
      removeGeneratedReadOnlyCompanions(path, existingCompanions);
    },
  });
}

/** Published transfers and nonempty applying claims require archive custody.
 * An applying claim may already have captured reports before its first live transfer;
 * absent archive bytes cannot prove that capture never happened.
 */
export function backupHasArchiveTransferCustody(admission: RuntimeAdmission,path: string): boolean {
  return withAuthorityDatabaseReadOnly(admission,path, database => {
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('archive_transfers','version_changes','runtime_version_changes')").all()
      .map(row => z.object({ name: z.string() }).parse(row).name));
    if (tables.has("archive_transfers") && database.prepare("SELECT 1 FROM archive_transfers LIMIT 1").get() !== undefined) return true;
    if (tables.has("version_changes") && database.prepare("SELECT 1 FROM version_changes WHERE json_extract(record_json,'$.state')='applying' AND json_array_length(record_json,'$.members')>0 LIMIT 1").get() !== undefined) return true;
    return tables.has("runtime_version_changes") && database.prepare("SELECT 1 FROM runtime_version_changes WHERE json_extract(record_json,'$.state')='applying' AND json_array_length(record_json,'$.members')>0 LIMIT 1").get() !== undefined;
  });
}

/** Claim-owned bytes are recovery assets before archive report publication. */
export function backupPendingCaptureFiles(admission: RuntimeAdmission,path: string) {
  return withAuthorityDatabaseReadOnly(admission,path, database => {
    const legacy = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='version_changes'").get() === undefined ? []
      : database.prepare("SELECT record_json FROM version_changes WHERE json_extract(record_json,'$.pendingCaptures') IS NOT NULL").all().flatMap(raw => {
      const change = VersionChangeSchema.parse(JSON.parse(z.object({record_json:z.string()}).parse(raw).record_json));
      return (change.pendingCaptures ?? []).flatMap(capture => {
        const report = parsePendingCapture(change, capture);
        return report.content.files;
      });
    });
    const runtime = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_version_changes'").get() === undefined ? []
      : database.prepare("SELECT record_json FROM runtime_version_changes WHERE json_extract(record_json,'$.pendingCaptures') IS NOT NULL").all().flatMap(raw => {
        const change = RuntimeVersionChangeSchema.parse(JSON.parse(z.object({record_json:z.string()}).parse(raw).record_json));
        return (change.pendingCaptures ?? []).flatMap(capture => ArchiveReportSchema.parse(JSON.parse(capture.reportJson)).content.files);
      });
    return [...legacy, ...runtime];
  });
}
import { requireRuntimeAdmission, type RuntimeAdmission } from "../runtime-control/admission.js";
