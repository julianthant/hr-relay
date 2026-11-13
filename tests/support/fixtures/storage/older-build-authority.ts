import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AuthorityUpgradeRecordSchema } from "../../../../src/models/config/authority.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, migrationTableNames, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { execMigrationStatement } from "../../../../src/backend/storage/sqlite/worker-custody-migration.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import frozenStatements from "./older-build-authority-statements.json" with { type: "json" };

/** Table order a schema 18-23 build hashed into authorityContentFingerprint, with the dropped worker tables after worker_slots. */
const SCHEMA_23_FINGERPRINT_TABLES = [
  "assistant_model_preference", "database_states", "database_upgrades", "settings_snapshots", "commands", "command_audits", "settings",
  "assistant_grants", "assistant_chats", "assistant_actions", "run_batches", "deleted_runs", "runs", "run_requests", "run_delegations", "delegation_dependencies", "run_checkpoints",
  "gate_results", "run_results", "run_failures", "run_receipts", "write_intents", "write_attempts", "worker_pools", "worker_slots", "worker_leases", "worker_controls",
  "browser_sessions", "auth_leases", "exclusive_session_leases", "ocr_review_revisions", "ocr_source_uploads", "ocr_approved_snapshots", "notifications", "notification_states",
  "artifacts", "timeline_events", "diagnostic_snapshots", "diagnostic_files", "dryrun_results", "run_search", "workbook_creations", "workbook_types", "workbook_operations",
  "workbook_library", "workbook_library_history", "workbook_library_state", "workbook_library_actions", "workbook_library_snapshots",
] as const;
const SCHEMA_24_FINGERPRINT_TABLES = SCHEMA_23_FINGERPRINT_TABLES.filter(table => table !== "worker_leases" && table !== "worker_controls" && table !== "browser_sessions");
const FINGERPRINT_TABLES = { 23: SCHEMA_23_FINGERPRINT_TABLES, 24: SCHEMA_24_FINGERPRINT_TABLES } as const;
const ROW_ORDER: Record<string, string> = {
  run_results: "id", deleted_runs: "run_id", run_search: "run_id", worker_pools: "workflow",
  workbook_library_history: "workbook_id,version,name", workbook_operations: "sequence", worker_controls: "command_id", auth_leases: "credential_key", timeline_events: "cursor",
};
const FrozenStatementsSchema = z.strictObject({
  versions: z.array(z.strictObject({ version: z.number().int().min(1).max(24), statements: z.array(z.string().min(1)) })).length(24),
});
const frozenVersions = FrozenStatementsSchema.parse(frozenStatements).versions;
if (frozenVersions.some((item, index) => item.version !== index + 1)) throw new Error("older-build statement versions are not 1 through 24");

const CellSchema = z.union([z.string(), z.number(), z.bigint(), z.null(), z.instanceof(Uint8Array)]);
type OlderBuildVersion = 23 | 24;

function sqlIdent(value: string): string {
  if (!/^[a-z_]+$/u.test(value)) throw new Error(`older-build identifier refused: ${value}`);
  return value;
}

function orderBy(table: string): string {
  const order = ROW_ORDER[table] ?? "id";
  if (!/^[a-z_]+(?:,[a-z_]+)*$/u.test(order)) throw new Error(`older-build row order refused: ${table}`);
  return order;
}

/** Statements a schema 23 or 24 build applied, captured from the exports that match those builds. */
export function olderBuildStatements(version: OlderBuildVersion): readonly string[] {
  const frozen = frozenVersions.filter(item => item.version <= version).flatMap(item => item.statements);
  const shipped = SQLITE_MIGRATIONS.filter(item => item.version <= version).flatMap(item => item.statements);
  if (frozen.length !== shipped.length || frozen.some((statement, index) => statement !== shipped[index])) {
    throw new Error(`older-build schema ${String(version)} statements drifted from the shipped migrations`);
  }
  return frozen;
}

export function applyOlderBuildStatements(database: DatabaseSync, version: OlderBuildVersion): void {
  for (const statement of olderBuildStatements(version)) execMigrationStatement(database, statement);
}

/** Fingerprint the older build wrote: its table order, not a rewind of the current schema. */
export function olderBuildFingerprint(database: DatabaseSync, version: OlderBuildVersion): string {
  const tables = FINGERPRINT_TABLES[version];
  const shipped = migrationTableNames(version);
  if (tables.length !== shipped.length || tables.some((table, index) => table !== shipped[index])) {
    throw new Error(`older-build schema ${String(version)} fingerprint order drifted`);
  }
  const hash = createHash("sha256");
  const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
  for (const table of tables) {
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${sqlIdent(table)} ORDER BY ${orderBy(table)}`).iterate()) {
      hash.update(canonicalJsonStringify(rowSchema.parse(row)));
    }
  }
  return hash.digest("hex");
}

function columnNames(database: DatabaseSync, table: string): string[] {
  return z.array(z.object({ name: z.string() })).parse(database.prepare(`PRAGMA table_info(${sqlIdent(table)})`).all()).map(column => sqlIdent(column.name));
}

function captureRows(database: DatabaseSync): Map<string, Record<string, unknown>[]> {
  const names = z.array(z.strictObject({ name: z.string() })).parse(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all());
  return new Map(names.map(table => [sqlIdent(table.name), z.array(z.record(z.string(), z.unknown())).parse(database.prepare(`SELECT * FROM ${sqlIdent(table.name)} ORDER BY rowid`).all())]));
}

function olderBuildUpgradeRow(table: string, row: Record<string, unknown>, version: OlderBuildVersion): Record<string, unknown> {
  if (table !== "database_upgrades") return row;
  const record = AuthorityUpgradeRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json));
  if (record.phase === "baseline") {
    return { ...row, payload_json: canonicalJsonStringify(AuthorityUpgradeRecordSchema.parse({ ...record, toSchemaVersion: version })) };
  }
  if (record.fromSchemaVersion > version || record.toSchemaVersion > version) {
    throw new Error(`older-build schema ${String(version)} cannot keep a ${record.phase} upgrade through schema ${String(record.toSchemaVersion)}`);
  }
  return row;
}

function insertCaptured(database: DatabaseSync, captured: Map<string, Record<string, unknown>[]>, version: OlderBuildVersion): void {
  const tables = z.array(z.strictObject({ name: z.string() })).parse(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())
    .map(table => sqlIdent(table.name));
  for (const table of tables) database.exec(`DELETE FROM ${table}`);
  const target = new Set(tables);
  for (const [table, rows] of captured) {
    if (!target.has(table)) {
      if (rows.length > 0) throw new Error(`older-build schema ${String(version)} has no table for ${String(rows.length)} ${table} row(s)`);
      continue;
    }
    if (rows.length === 0) continue;
    const columns = columnNames(database, table);
    const actual = Object.keys(rows[0] ?? {}).map(sqlIdent).sort();
    const expected = [...columns].sort();
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error(`older-build ${table} columns ${actual.join(",")} differ from ${expected.join(",")}`);
    }
    const insert = database.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`);
    for (const raw of rows) {
      const stored = olderBuildUpgradeRow(table, raw, version);
      insert.run(...columns.map(column => CellSchema.parse(stored[column])));
    }
  }
}

/**
 * Replaces a rewound profile database with one built by applying the frozen schema 23 or 24 statements,
 * keeping its rows. The baseline names that older schema. Returns the fingerprint that build would have written.
 */
export function replantOlderBuildAuthority(path: string, version: OlderBuildVersion): string {
  const source = new DatabaseSync(path, { readOnly: true });
  let captured: Map<string, Record<string, unknown>[]>;
  try {
    const userVersion = z.strictObject({ user_version: z.number() }).parse(source.prepare("PRAGMA user_version").get()).user_version;
    if (userVersion !== version) throw new Error(`older-build source version ${String(userVersion)} is not schema ${String(version)}`);
    captured = captureRows(source);
  } finally { source.close(); }
  rmSync(path);
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA journal_mode=WAL");
    database.exec("PRAGMA synchronous=FULL");
    applyOlderBuildStatements(database, version);
    const triggers = z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z0-9_]+$/u), sql: z.string().min(1) })).parse(
      database.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND sql IS NOT NULL ORDER BY name").all());
    for (const trigger of triggers) database.exec(`DROP TRIGGER ${trigger.name}`);
    database.exec("PRAGMA foreign_keys=OFF");
    insertCaptured(database, captured, version);
    for (const trigger of triggers) database.exec(trigger.sql);
    database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(version);
    database.exec(`PRAGMA user_version=${String(version)}`);
    database.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    database.exec("PRAGMA foreign_keys=ON");
    const failures = database.prepare("PRAGMA foreign_key_check").all();
    if (failures.length > 0) throw new Error(`older-build foreign-key validation failed for ${String(failures.length)} row(s)`);
    const fingerprint = olderBuildFingerprint(database, version);
    const inspected = inspectNativeAuthority(database, version).authorityContentFingerprint;
    if (inspected !== fingerprint) throw new Error(`older-build schema ${String(version)} fingerprint ${fingerprint} disagrees with inspection ${inspected}`);
    return fingerprint;
  } finally { database.close(); }
}
