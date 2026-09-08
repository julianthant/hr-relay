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
  SQLITE_MIGRATIONS,
} from "../sqlite/migrations.js";

const ADMITTED_HISTORICAL_SCHEMA_VERSIONS = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  27, 28, 29, 30, 31, 32, 33, 34,
] as const);
const PROJECTION_TABLES = new Set(["spans", "gates", "notes", "runs_view"]);

/**
 * Released authority-table order used by the backup fingerprint algorithm.
 * Filtering this list by a replayed schema reconstructs the list used at that
 * schema version, including the v1-v27 capture tables and the v30-v31 protected
 * singleton that are absent from the v32 runtime registry.
 */
const RELEASED_AUTHORITY_TABLE_ORDER = Object.freeze([
  "authority_meta",
  "tasks",
  "workflow_runs",
  "run_terminal_authorizations",
  "failures",
  "run_results",
  "run_terminal_outbox",
  "diagnostic_bundles",
  "diagnostic_attachments",
  "evidence_receipts",
  "dry_run_scenario_results",
  "operator_xlsx_exports",
  "activity_person_pseudonyms",
  "activity_person_pseudonym_generations",
  "knowledge_records",
  "fix_records",
  "ledger_partitions",
  "ledger_projections",
  "provider_budget_counters",
  "provider_admissions",
  "leases",
  "dependencies",
  "delegation_manifests",
  "commands",
  "command_audits",
  "bulk_command_acceptances",
  "notifications",
  "config_snapshots",
  "settings_current",
  "runtime_config",
  "version_plans",
  "checkpoint_payloads",
  "run_checkpoints",
  "start_plans",
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
  "intake_sessions",
  "intake_manifests",
  "ocr_extractions",
  "version_bump_applications",
  "archived_runs",
  "archive_relaunches",
  "duo_ceremony_leases",
  "worker_pools",
  "run_sessions",
  "workflow_run_batches",
  "deleted_runs",
  "protected_settings_current",
  "authority_upgrades",
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
    durableOutbox: number;
    runTerminalOutbox: number;
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
    FROM authority_meta
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
  const hash = createHash("sha256");
  hash.update("[");
  for (const [tableIndex, name] of authorityTableOrder(tableNames).entries()) {
    if (tableIndex > 0) hash.update(",");
    hash.update(`[${canonicalJsonStringify(name)},`);
    if (name === "authority_meta") {
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
      for (const rawRow of database.prepare(`
        SELECT record_key, record_json FROM ${quoteIdentifier(name)} ORDER BY record_key
      `).iterate()) {
        const row = FingerprintRowSchema.parse(rawRow);
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
  const operations = schemaVersion < 35 ? "write_intents" : "run_operations";
  const outbox = schemaVersion < 35 ? "durable_outbox" : "operation_outbox";
  const countIfPresent = (tableName: string, sql: string): number => (
    tableNames.has(tableName) ? count(database, sql) : 0
  );
  return Object.freeze({
    pendingCommands: count(database, "SELECT count(*) AS count FROM commands AS command WHERE NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.record_key)"),
    unresolvedWriteIntents: count(database, `SELECT count(*) AS count FROM ${operations} WHERE status NOT IN ('committed', 'observed-present')`),
    leases: count(database, "SELECT count(*) AS count FROM leases"),
    durableOutbox: count(database, `SELECT count(*) AS count FROM ${outbox} WHERE json_extract(record_json, '$.projection.state') = 'pending'`),
    runTerminalOutbox: countIfPresent("run_terminal_outbox", "SELECT count(*) AS count FROM run_terminal_outbox WHERE state = 'pending'"),
    providerReservations: countIfPresent("provider_admissions", "SELECT count(*) AS count FROM provider_admissions WHERE state = 'reserved'"),
    artifactOutbox: count(database, "SELECT count(*) AS count FROM artifact_outbox WHERE json_extract(record_json, '$.state') = 'pending'"),
  });
}

/** Historical rows are never opaque admission: use the retained grammar for each family. */
function validateHistoricalRecords(database: DatabaseSync, schemaVersion: number, tables: ReadonlySet<string>): void {
  const registry: Readonly<Record<string, z.ZodType>> = {
    ...AUTHORITY_RECORD_SCHEMA_REGISTRY,
    tasks: AUTHORITY_RECORD_SCHEMA_REGISTRY.workflow_runs,
    write_intents: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_operations,
    write_attempts: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_operation_attempts,
    durable_outbox: AUTHORITY_RECORD_SCHEMA_REGISTRY.operation_outbox,
    run_sessions: HistoricalRunSessionRecordSchema,
    ...(schemaVersion < 32 ? { settings_current: HistoricalSettingsCurrentRecordSchema, protected_settings_current: ProtectedSettingsCurrentRecordSchema } : {}),
  };
  for (const table of tables) {
    if (PROJECTION_TABLES.has(table) || table === "authority_meta") continue;
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

export function inspectAuthorityBackupReadOnly(
  pathInput: string,
  expectedSchemaVersion?: number,
  busyTimeoutMs = 250,
): BackupCopyInspection {
  const path = resolve(z.string().min(1).parse(pathInput));
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
  pathInput: string,
  busyTimeoutMs = 250,
): AuthorityBackupSourceReadOnly {
  const path = resolve(z.string().min(1).parse(pathInput));
  inspectAuthorityBackupReadOnly(path, undefined, busyTimeoutMs);
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
      assertOpen();
      return authorityBackupSourceDatabaseIdentity(path);
    },
    async onlineBackupTo(destinationPath: string) {
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
