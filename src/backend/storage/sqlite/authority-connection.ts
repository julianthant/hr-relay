import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { CHANGE_TRACKING_TABLES, RUN_SEARCH_FTS_TABLES, AuthorityTableNameSchema, ProjectionTableNameSchema, type TableName } from "../../../models/config/authority.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../models/config/authority-schema-versions.js";
import { CHANGE_LOG_SCHEMA_VERSION } from "./authority-change-log.js";
import { RUN_SEARCH_FTS_SCHEMA_VERSION } from "./run-search-fts.js";

export const AuthorityDatabaseOpenModeSchema = z.enum([
  "read-write",
  "storage-backup-read-only-no-migrate",
  "storage-doctor-read-only-no-migrate",
  "storage-upgrade-preflight-read-only-no-migrate",
  "dashboard-read-worker-read-only-no-migrate",
]);

export const AuthorityDatabaseOptionsSchema = z.strictObject({
  path: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  migrationOwner: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  openMode: AuthorityDatabaseOpenModeSchema.default("read-write"),
  checkpointOwner: z.literal("dashboard-navigation").optional(),
});

export const AuthorityMetaSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  installationId: z.uuid(),
  profileId: z.uuid(),
  authorityGeneration: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const AuthoritySchemaInspectionSchema = z.strictObject({
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  authorityGeneration: z.number().int().nonnegative(),
  pragmas: z.strictObject({
    journalMode: z.literal("wal"),
    foreignKeys: z.literal(1),
    synchronous: z.literal(2),
    busyTimeoutMs: z.number().int().positive(),
  }),
  tables: z.array(z.strictObject({
    name: z.union([AuthorityTableNameSchema, ProjectionTableNameSchema]),
    classification: z.enum(["authority", "projection"]),
  })),
});

const IntPragmaRowSchema = z.record(z.string(), z.number().int());
const TextPragmaRowSchema = z.record(z.string(), z.string());
export const MetaRowSchema = z.strictObject({
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  installation_id: z.uuid().optional(),
  profile_id: z.uuid().optional(),
});
const TableNameRowSchema = z.strictObject({ name: z.string() });
export const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });

export const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });

export function sqliteChanges(value: number | bigint): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return z.number().int().nonnegative().parse(parsed);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readIntPragma(
  database: DatabaseSync,
  name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout" | "data_version" | "schema_version" | "freelist_count" | "query_only",
): number {
  const row = IntPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name === "busy_timeout" ? "timeout" : name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

export function existingDatabaseLocation(path: string): URL | string {
  if (path === ":memory:") return path;
  const location = pathToFileURL(path);
  location.searchParams.set("mode", "rw");
  return location;
}

export function readTextPragma(database: DatabaseSync, name: "journal_mode"): string {
  const row = TextPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

/** The registry tables present; derived tables are checked as schema objects. */
export function inspectionTableNames(database: DatabaseSync): string[] {
  const version = readIntPragma(database, "user_version");
  const derived = [
    ...(version >= CHANGE_LOG_SCHEMA_VERSION ? CHANGE_TRACKING_TABLES : []),
    ...(version >= RUN_SEARCH_FTS_SCHEMA_VERSION ? RUN_SEARCH_FTS_TABLES : []),
  ];
  return database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => TableNameRowSchema.parse(row).name).filter(name => !derived.some(table => table === name));
}

export function tableNames(database: DatabaseSync): TableName[] {
  return z.array(z.union([AuthorityTableNameSchema, ProjectionTableNameSchema])).parse(inspectionTableNames(database));
}

export function readMetaRow(database: DatabaseSync): z.infer<typeof MetaRowSchema> {
  return MetaRowSchema.parse(database.prepare(readIntPragma(database, "user_version") >= 7
    ? "SELECT schema_version,authority_generation,updated_at,installation_id,profile_id FROM database_states WHERE id=1"
    : "SELECT schema_version,authority_generation,updated_at FROM database_states WHERE id=1").get());
}

/** The WAL file is cut back to this size whenever a checkpoint lets it restart: two automatic checkpoints' worth of 4 KiB pages. */
export const AUTHORITY_WAL_SIZE_LIMIT_BYTES = 8 * 1024 * 1024;

export function optimizeAuthorityPlanner(database: DatabaseSync): void {
  database.exec("PRAGMA analysis_limit=1000; PRAGMA main.optimize=0x10002");
}

export function configureWritableConnection(database: DatabaseSync, busyTimeoutMs: number): void {
  database.exec("PRAGMA foreign_keys = ON");
  // Enable secure deletion so freed SQLite pages do not retain deleted run bytes.
  database.exec("PRAGMA secure_delete = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`PRAGMA journal_size_limit = ${String(AUTHORITY_WAL_SIZE_LIMIT_BYTES)}`);
  database.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`);
}

export function parseDiagnosticPageCount(value: unknown, limit: number): number {
  return z.number().int().min(1).max(Math.min(32, Math.floor(1000 / limit))).parse(value);
}
