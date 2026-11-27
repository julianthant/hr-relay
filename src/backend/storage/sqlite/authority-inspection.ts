import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CHANGE_LOG_SCHEMA_VERSION } from "./authority-change-log.js";
import { AuthorityTableNameSchema } from "../../../models/config/authority.js";
import { validateNotificationMetadata } from "./notification-publications.js";
import { readonlyAuthorityImage } from "./readonly-authority-snapshot.js";
import { execMigrationStatement } from "./worker-custody-migration.js";
import { withoutNativeRecordReadMemo } from "./run-record-row.js";
import { createRunSearchIndex } from "./run-search-index.js";
import { RUN_SEARCH_FTS_MISMATCH_SQL, RUN_SEARCH_FTS_SCHEMA_VERSION } from "./run-search-fts.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ASSISTANT_HISTORY_MIGRATION } from "./assistant-history.js";
import { ASSISTANT_GRANT_RETIREMENT_VERSION, RETIRED_ASSISTANT_GRANT_TABLE } from "./assistant-grant-retirement.js";
import { byteAwareRow } from "./assistant-attachments.js";
import { RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS } from "../../../models/config/authority-schema-versions.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, WORKER_CUSTODY_DROPPED_TABLES, WORKER_CUSTODY_SCHEMA_VERSION, isWorkerCustodyDroppedTable, SQLITE_MIGRATIONS, isCurrentAuthoritySchemaVersion, isSupportedStoppedAuthoritySchemaVersion, migrationTableNames, tableClassification } from "./migrations.js";
import { AuthorityCopyInspectionSchema, type AuthorityCopyInspection } from "./recovery-contracts.js";
import { readIntPragma, CountRowSchema, readTextPragma, inspectionTableNames, readMetaRow, PageCountRowSchema } from "./authority-connection.js";
import { AuthorityFormatUnsupportedError, authorityIntegrityError, inspectStoredData, AuthoritySchemaVersionError } from "./authority-errors.js";
import { inspectionRunReader } from "./authority-run-evidence.js";
import { nativeTableKey, validateAuthorityRecordSchemas, assertRunReferences, invariantViolations } from "./authority-stored-rows.js";
import { readStartupFile, type StartupFile } from "./startup-file-proof.js";

export const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });

const FingerprintRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.instanceof(Uint8Array)]));

function createAuthorityFingerprint() {
  const hash = createHash("sha256");
  return {
    table: (name: string) => { hash.update(canonicalJsonStringify(name)); },
    row: (row: Record<string, unknown>) => { hash.update(canonicalJsonStringify(byteAwareRow(FingerprintRowSchema.parse(row)))); },
    finish: () => hash.digest("hex"),
  };
}

export function authorityContentFingerprint(database: DatabaseSync, excludedUpgradeRecord?: string): string {
  const fingerprint = createAuthorityFingerprint();
  for (const table of migrationTableNames(readIntPragma(database, "user_version"))) {
    fingerprint.table(table);
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      if (table === "database_upgrades" && row.id === excludedUpgradeRecord) continue;
      fingerprint.row(row);
    }
  }
  return fingerprint.finish();
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE command.family <> 'bulk-parent' AND NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.id)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM write_intents WHERE status NOT IN ('committed', 'observed-present')"),
    providerReservations: 0,
    artifactOutbox: count("SELECT count(*) AS count FROM artifacts f,json_each(f.payload_json,'$.updates') u WHERE f.kind='generated' AND json_extract(u.value,'$.record.state')='pending'"),
  };
}

const expectedNativeSchemas = new Map<string, string>();
export function normalizedNativeSchema(database: DatabaseSync): string {
  const schema = z.strictObject({type:z.string(),name:z.string(),table:z.string(),sql:z.string()});
  return canonicalJsonStringify(database.prepare("SELECT type,name,tbl_name AS 'table',sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(raw => { const row = schema.parse(raw); return {...row,sql:row.sql.trim().replace(/\s+/gu," ")}; }));
}
export function expectedNativeSchema(version: number, withoutRunSearch: boolean): string {
  const key = `${String(version)}:${String(withoutRunSearch)}`;
  const cached = expectedNativeSchemas.get(key);
  if (cached !== undefined) return cached;
  const expected = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS) if (migration.version <= version) for (const statement of migration.statements) execMigrationStatement(expected, statement);
    if (withoutRunSearch) expected.exec("DROP TABLE run_search");
    const schema = normalizedNativeSchema(expected);
    expectedNativeSchemas.set(key, schema);
    return schema;
  } finally { expected.close(); }
}

export function runSearchDefinitions(version: number): readonly string[] {
  const expected = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS) if (migration.version <= version) for (const statement of migration.statements) execMigrationStatement(expected, statement);
    const definitions = z.array(z.strictObject({ sql: z.string() })).parse(expected.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='run_search' AND sql IS NOT NULL ORDER BY type='table' DESC,type,name").all()).map(row => row.sql);
    return version >= RUN_SEARCH_FTS_SCHEMA_VERSION ? ["DELETE FROM run_search_fts", ...definitions] : definitions;
  } finally { expected.close(); }
}

export function nonProjectionFingerprint(database: DatabaseSync): string {
  const hash = createHash("sha256");
  for (const table of migrationTableNames(readIntPragma(database, "user_version"))) {
    if (table === "run_search") continue;
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      const record = z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.instanceof(Uint8Array)])).parse(row);
      if (table === "database_states") { delete record.search_generation; delete record.search_state; }
      hash.update(canonicalJsonStringify(byteAwareRow(record)));
    }
  }
  return hash.digest("hex");
}

/** Unpublished assistant builds numbered history 23 to 25, or ran 26-29 without staging's 24 and 25; such a store is never opened. */
export function assertPublishedAssistantNumbering(database: DatabaseSync): void {
  const version = readIntPragma(database, "user_version");
  if (version < 23 || version > ASSISTANT_GRANT_RETIREMENT_VERSION) return;
  const hasTable = (name: string) => database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name) !== undefined;
  if (!hasTable("assistant_conversations")) return;
  if (version < ASSISTANT_HISTORY_MIGRATION.version || !hasTable("workflow_workbook_selections")) throw new AuthorityFormatUnsupportedError("STORAGE_PROFILE_FORMAT_UNSUPPORTED",
    { cause: new Error("assistant-unpublished-schema-numbering") });
}

export function assertNativeSchema(database: DatabaseSync, version = CURRENT_AUTHORITY_SCHEMA_VERSION, withoutRunSearch = false): void {
  assertPublishedAssistantNumbering(database);
  if (normalizedNativeSchema(database) !== expectedNativeSchema(version, withoutRunSearch)) throw authorityIntegrityError("authority-native-schema-shape-mismatch");
}

export type NativeInspection = ReturnType<typeof verifyNativeAuthority>;
export type VerifiedUpgradeImage =
  | { kind: "snapshot"; marker: string; digest: string | undefined; source?: StartupFile; inspection: NativeInspection }
  | { kind: "committed"; digest: string; inspection: NativeInspection };
export const upgradeInspections = new AsyncLocalStorage<{
  active: boolean;
  images: Map<string, VerifiedUpgradeImage>;
  backupCopies: Map<string, NativeInspection>;
}>();

export function inspectNativeAuthority(database: DatabaseSync, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas = false,
  missingRunSearch = false, workbookPayloads = true) {
  return withoutNativeRecordReadMemo(() => inspectNativeAuthorityImage(database, expectedSchemaVersion, requireOperationalPragmas, missingRunSearch, workbookPayloads));
}

export function inspectNativeBackupCopy(database: DatabaseSync, expectedSchemaVersion: number): NativeInspection {
  return withoutNativeRecordReadMemo(() => inspectNativeAuthorityImage(database, expectedSchemaVersion, false, false, true, true));
}

export function checkSqliteIntegrity(database: DatabaseSync): void {
  const quickCheck = database.prepare("PRAGMA quick_check(1)").get();
  inspectStoredData(() => QuickCheckRowSchema.parse(quickCheck));
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw authorityIntegrityError(`authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`);
}

function assertRunSearchFts(database: DatabaseSync): void {
  if (database.prepare("SELECT v FROM run_search_fts_config WHERE k='secure-delete'").get()?.v !== 1)
    throw new Error("run-search-fts-secure-delete-disabled");
  if (database.prepare(RUN_SEARCH_FTS_MISMATCH_SQL).get() !== undefined) throw new Error("run-search-fts-projection-mismatch");
}

export function checkInspectionPragmas(database: DatabaseSync, requireOperationalPragmas: boolean): void {
  if (readIntPragma(database, "foreign_keys") !== 1) throw new Error("authority database foreign keys are disabled");
  if (requireOperationalPragmas) {
    if (readTextPragma(database, "journal_mode") !== "wal") throw new Error("authority database is not using WAL mode");
    if (readIntPragma(database, "synchronous") !== 2) throw new Error("authority database synchronous mode is not FULL");
  }
}

function inspectNativeAuthorityImage(database: DatabaseSync, expectedSchemaVersion: number, requireOperationalPragmas: boolean,
  missingRunSearch: boolean, workbookPayloads: boolean, backupCopy = false) {
  const scope = upgradeInspections.getStore();
  const image = scope?.active && !requireOperationalPragmas && !missingRunSearch && workbookPayloads
    ? readonlyAuthorityImage(database) : undefined;
  if (scope === undefined || image === undefined) {
    return verifyNativeAuthority(database, expectedSchemaVersion, requireOperationalPragmas, missingRunSearch, workbookPayloads);
  }
  const previous = scope.images.get(image.path);
  if (previous?.kind === "snapshot" && previous.inspection.schemaVersion === expectedSchemaVersion) {
    if (previous.marker === image.marker) {
      checkInspectionPragmas(database, false);
      return structuredClone(previous.inspection);
    }
    if (previous.source !== undefined && previous.digest !== undefined) {
      const observed = observeReadonlyStartupFile(database, image.path);
      if (observed.state === "observed" && sameStartupFile(previous.source, observed.file)
        && upgradeImageDigest(database) === previous.digest) {
        checkInspectionPragmas(database, false);
        scope.images.set(image.path, { ...previous, marker: image.marker });
        return structuredClone(previous.inspection);
      }
    }
  }
  const digest = backupCopy || basename(image.path) === "state.db" ? upgradeImageDigest(database) : undefined;
  const backupInspection = backupCopy && digest !== undefined ? scope.backupCopies.get(digest) : undefined;
  const verified = previous?.kind === "committed" && previous.digest === digest
    ? previous.inspection : backupInspection;
  let inspection: NativeInspection;
  if (verified?.schemaVersion === expectedSchemaVersion) {
    checkInspectionPragmas(database, false);
    inspection = structuredClone(verified);
  } else {
    inspection = verifyNativeAuthority(database, expectedSchemaVersion, false, false, true);
    if (backupCopy && digest !== undefined) scope.backupCopies.set(digest, structuredClone(inspection));
  }
  scope.images.set(image.path, { kind: "snapshot", marker: image.marker, digest, inspection: structuredClone(inspection) });
  return inspection;
}

function upgradeImageDigest(database: DatabaseSync): string | undefined {
  if (!database.isTransaction) return undefined;
  const image = startupImageDigest(database);
  return image.state === "observed" ? image.digest : undefined;
}

export function inspectStoppedTransaction(database: DatabaseSync, path: string, version: number, requireOperationalPragmas = false): NativeInspection {
  const scope = upgradeInspections.getStore(), previous = scope?.active ? scope.images.get(path) : undefined;
  if (previous?.digest !== undefined && previous.inspection.schemaVersion === version && previous.digest === upgradeImageDigest(database)) {
    checkInspectionPragmas(database, requireOperationalPragmas);
    return structuredClone(previous.inspection);
  }
  return inspectNativeAuthority(database, version, requireOperationalPragmas);
}

export function commitVerifiedUpgrade(database: DatabaseSync, path: string, inspection: NativeInspection): void {
  const scope = upgradeInspections.getStore();
  const digest = scope?.active ? upgradeImageDigest(database) : undefined;
  const verified = digest === undefined ? undefined : { digest, inspection: structuredClone(inspection) };
  database.exec("COMMIT");
  if (scope?.active && verified !== undefined) scope.images.set(path, { kind: "committed", ...verified });
}

function verifyNativeAuthority(database: DatabaseSync, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas = false,
  missingRunSearch = false, workbookPayloads = true) {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  assertPublishedAssistantNumbering(database);
  if ((!isSupportedStoppedAuthoritySchemaVersion(expectedSchemaVersion) && expectedSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) || schemaVersion !== expectedSchemaVersion) throw new AuthoritySchemaVersionError(schemaVersion);
  assertNativeSchema(database, schemaVersion, missingRunSearch);
  checkSqliteIntegrity(database);
  const names = inspectionTableNames(database);
  const expected = [...migrationTableNames(expectedSchemaVersion)].filter(name => !missingRunSearch || name !== "run_search").sort();
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    throw authorityIntegrityError(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
  }
  const meta = inspectStoredData(() => readMetaRow(database));
  if (meta.schema_version !== schemaVersion) {
    throw authorityIntegrityError(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`);
  }
  const fingerprint = database.isTransaction && expectedSchemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION && !missingRunSearch
    ? createAuthorityFingerprint() : undefined;
  inspectStoredData(() => validateAuthorityRecordSchemas(database, !missingRunSearch, expectedSchemaVersion, workbookPayloads, fingerprint));
  if (schemaVersion >= CHANGE_LOG_SCHEMA_VERSION) assertRunReferences(database);
  inspectStoredData(() => validateNotificationMetadata(database));
  const violations = invariantViolations(database);
  if (violations.length > 0) throw authorityIntegrityError(`authority database invariant validation failed: ${violations.join("; ")}`);
  if (!missingRunSearch) inspectStoredData(() => {
    createRunSearchIndex(database).validateCoverage(inspectionRunReader(expectedSchemaVersion));
    if (schemaVersion >= RUN_SEARCH_FTS_SCHEMA_VERSION) assertRunSearchFts(database);
  });
  checkInspectionPragmas(database, requireOperationalPragmas);
  const currentTables = AuthorityCopyInspectionSchema.shape.tables;
  const predecessorTables = [...(expectedSchemaVersion < 10 ? ["explorer_overrides" as const] : []),
    ...(expectedSchemaVersion >= 8 && expectedSchemaVersion < ASSISTANT_GRANT_RETIREMENT_VERSION ? [RETIRED_ASSISTANT_GRANT_TABLE] : []),
    ...(expectedSchemaVersion < WORKER_CUSTODY_SCHEMA_VERSION ? WORKER_CUSTODY_DROPPED_TABLES : [])];
  const tables = predecessorTables.length === 0 ? currentTables : z.array(z.union([currentTables.element,
    z.strictObject({ name: z.enum(predecessorTables), classification: z.literal("authority") }),
  ]));
  return AuthorityCopyInspectionSchema.extend({ tables, schemaVersion: z.literal(RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS), installationId: z.uuid().optional(), profileId: z.uuid().optional() }).parse({
    applicationId,
    schemaVersion,
    installationId: meta.installation_id,
    profileId: meta.profile_id,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    // Without run_search the full fingerprint cannot be read; only startup classification asks for this shape.
    authorityContentFingerprint: missingRunSearch ? nonProjectionFingerprint(database) : fingerprint?.finish() ?? authorityContentFingerprint(database),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariants: { state: "valid", violations: [] },
    tables: names.map((name) => ({ name, classification: (expectedSchemaVersion < 10 && name === "explorer_overrides")
      || (expectedSchemaVersion < ASSISTANT_GRANT_RETIREMENT_VERSION && name === RETIRED_ASSISTANT_GRANT_TABLE) || isWorkerCustodyDroppedTable(name)
      ? "authority" : tableClassification(AuthorityTableNameSchema.parse(name)) })),
    counts: pendingCounts(database),
  });
}

export function inspectOpenDatabase(database: DatabaseSync, requireOperationalPragmas: boolean, workbookPayloads = true): AuthorityCopyInspection {
  return AuthorityCopyInspectionSchema.parse(inspectNativeAuthority(database, CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas, false, workbookPayloads));
}

const startupCopyDigests = new WeakMap<object, string>();
const startupCopySources = new WeakMap<object, StartupFile>();

export function sameStartupFile(left: StartupFile, right: StartupFile): boolean {
  return left.identity === right.identity && left.main === right.main && left.wal === right.wal;
}

/** The guarded reader rechecks the source files at both ends of every borrow. */
export function observeReadonlyStartupFile(database: DatabaseSync, path: string): ReturnType<typeof readStartupFile> {
  const image = readonlyAuthorityImage(database);
  const copy = database.isTransaction && image?.path === path ? image.copy : undefined;
  const prior = copy === undefined ? undefined : startupCopySources.get(copy);
  if (prior !== undefined) return { state: "observed", file: prior };
  const result = readStartupFile(path);
  if (copy !== undefined && result.state === "observed") startupCopySources.set(copy, result.file);
  return result;
}

export function startupImageDigest(database: DatabaseSync): { state: "observed"; digest: string } | { state: "unavailable" } {
  // Readers of the same guarded private copy see the same main file and WAL.
  const copy = database.isTransaction ? readonlyAuthorityImage(database)?.copy : undefined;
  const prior = copy === undefined ? undefined : startupCopyDigests.get(copy);
  if (prior !== undefined) return { state: "observed", digest: prior };
  try {
    // serialize reads this transaction's pages, including committed WAL frames. Bound its temporary allocation.
    const pages = PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count;
    const size = z.strictObject({ page_size: z.number().int().positive() }).parse(database.prepare("PRAGMA page_size").get()).page_size;
    if (pages * size > 256 * 1024 * 1024) return { state: "unavailable" };
    const digest = createHash("sha256").update(database.serialize()).digest("hex");
    if (copy !== undefined) startupCopyDigests.set(copy, digest);
    return { state: "observed", digest };
  } catch { return { state: "unavailable" }; }
}

export function inspectNormalAuthority(database: DatabaseSync): AuthorityCopyInspection {
  if (!isCurrentAuthoritySchemaVersion(readIntPragma(database, "user_version"))) throw new Error("normal-authority-schema-mismatch");
  return inspectOpenDatabase(database, false);
}
