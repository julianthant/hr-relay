import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  AUTHORITY_TABLE_REGISTRY,
  AuthorityTableNameSchema,
  ProjectionTableNameSchema,
  type AuthorityTableName,
  type ProjectionTableName,
  type TableName,
} from "../../domain/authority.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../domain/commands.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import { BrowserSystemIdSchema } from "../../domain/ids.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { NotificationRecordSchema } from "../../domain/notifications.js";
import {
  IdempotencyKeySchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
  type WriteAttemptRecord,
  type WriteIntentRecord,
} from "../../domain/write-safety.js";
import {
  AUTHORITY_APPLICATION_ID,
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  auditMigrationTableCoverage,
  tableClassification,
} from "./migrations.js";
import {
  AuthorityCopyInspectionSchema,
  type AuthorityCopyInspection,
} from "./recovery-contracts.js";
import {
  ArtifactOutboxStorageRecordSchema,
  AUTHORITY_RECORD_SCHEMA_REGISTRY,
  OpaqueAuthorityRecordSchema,
  ProjectionStorageRecordSchema,
  VersionPlanStorageRecordSchema,
  type ArtifactOutboxStorageRecord,
  type OpaqueAuthorityRecord,
  type ProjectionStorageRecord,
  type VersionPlanStorageRecord,
} from "./storage-records.js";
import {
  AtomicWriteCommitInputSchema,
  AtomicWriteCommitReportSchema,
  PermanentWriteResolutionSchema,
  WriteFenceInputSchema,
  type AtomicWriteCommitReport,
  type AtomicWriteCommitStorageStep,
  type PermanentWriteResolution,
} from "./write-commit-contracts.js";

export const AuthorityDatabaseOptionsSchema = z.strictObject({
  path: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  migrationOwner: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const AuthorityMetaSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
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

export const ImmutableInsertDispositionSchema = z.enum(["inserted", "existing"]);

type ImmutableInsertResult<RecordValue> = Readonly<{
  state: z.infer<typeof ImmutableInsertDispositionSchema>;
  record: RecordValue;
}>;

type ImmutableRepository<RecordValue> = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RecordValue>;
  get(recordKey: string): RecordValue | undefined;
}>;

type ReadRepository<RecordValue> = Readonly<{
  get(recordKey: string): RecordValue | undefined;
}>;

type CommandRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandRequestSchema>>;
  get(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
}>;

type WriteIntentRepository = Readonly<{
  recordObservedPresent(input: unknown): PermanentWriteResolution;
  fenceAttempt(input: unknown): PermanentWriteResolution;
  get(writeIntentId: string): z.infer<typeof WriteIntentRecordSchema> | undefined;
  findByPermanentKey(system: unknown, idempotencyKey: unknown): z.infer<typeof WriteIntentRecordSchema> | undefined;
}>;

export interface AuthorityWriteCommitHooks {
  afterStorageStep(step: AtomicWriteCommitStorageStep): void;
}

type OpaqueAuthorityRepositories = Readonly<{
  tasks: ImmutableRepository<OpaqueAuthorityRecord>;
  leases: ImmutableRepository<OpaqueAuthorityRecord>;
  ocrApprovals: ImmutableRepository<OpaqueAuthorityRecord>;
  captureSessions: ImmutableRepository<OpaqueAuthorityRecord>;
  capturePhotoOrder: ImmutableRepository<OpaqueAuthorityRecord>;
  captureFinalizationOutboxes: ImmutableRepository<OpaqueAuthorityRecord>;
  artifactSinkHeads: ImmutableRepository<OpaqueAuthorityRecord>;
}>;

export type AuthorityRepositories = Readonly<{
  commands: CommandRepository;
  commandAudits: ImmutableRepository<z.infer<typeof CommandAuditRecordSchema>>;
  dependencies: ImmutableRepository<z.infer<typeof DependencyRecordSchema>>;
  delegationManifests: ImmutableRepository<z.infer<typeof DelegationManifestSchema>>;
  gateResults: ImmutableRepository<z.infer<typeof GateResultRecordSchema>>;
  notifications: ImmutableRepository<z.infer<typeof NotificationRecordSchema>>;
  configSnapshots: ImmutableRepository<z.infer<typeof ConfigSnapshotRecordSchema>>;
  versionPlans: ImmutableRepository<VersionPlanStorageRecord>;
  writeIntents: WriteIntentRepository;
  writeAttempts: ReadRepository<z.infer<typeof WriteAttemptRecordSchema>>;
  durableOutbox: ReadRepository<z.infer<typeof AtomicOutboxRecordSchema>>;
  artifactOutbox: ImmutableRepository<ArtifactOutboxStorageRecord>;
  opaque: OpaqueAuthorityRepositories;
}>;

type ProjectionRepository = Readonly<{
  upsert(input: unknown): ProjectionStorageRecord;
  get(projectionKey: string): ProjectionStorageRecord | undefined;
  clear(): number;
}>;

export type ProjectionRepositories = Readonly<{
  spans: ProjectionRepository;
  gates: ProjectionRepository;
  notes: ProjectionRepository;
  runsView: ProjectionRepository;
}>;

const OpaqueAuthorityTableSchema = z.enum([
  "tasks",
  "leases",
  "ocr_approvals",
  "capture_sessions",
  "capture_photo_order",
  "capture_finalization_outboxes",
  "artifact_sink_heads",
]);

const JsonRowSchema = z.strictObject({ record_json: z.string() });
const IntPragmaRowSchema = z.record(z.string(), z.number().int());
const TextPragmaRowSchema = z.record(z.string(), z.string());
const MetaRowSchema = z.strictObject({
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});
const TableNameRowSchema = z.strictObject({ name: z.string() });
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });
const AuthorityRecordFingerprintRowSchema = z.strictObject({ record_key: z.string(), record_json: z.string() });
const AuthorityMetaFingerprintRowSchema = z.strictObject({
  singleton_id: z.literal(1),
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});

function parseJsonRecord<Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> {
  return schema.parse(JSON.parse(text));
}

function sqliteChanges(value: number | bigint): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return z.number().int().nonnegative().parse(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readIntPragma(
  database: DatabaseSync,
  name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout",
): number {
  const row = IntPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name === "busy_timeout" ? "timeout" : name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function readTextPragma(database: DatabaseSync, name: "journal_mode"): string {
  const row = TextPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function tableNames(database: DatabaseSync): TableName[] {
  const rows = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return z.array(z.union([AuthorityTableNameSchema, ProjectionTableNameSchema])).parse(
    rows.map((row) => TableNameRowSchema.parse(row).name),
  );
}

function readMetaRow(database: DatabaseSync): z.infer<typeof MetaRowSchema> {
  return MetaRowSchema.parse(database.prepare(`
    SELECT schema_version, authority_generation, updated_at, migration_owner, migration_started_at
    FROM authority_meta WHERE singleton_id = 1
  `).get());
}

const INVARIANT_QUERIES = Object.freeze([
  {
    name: "commands-family-column-matches-record",
    sql: "SELECT count(*) AS count FROM commands WHERE family <> json_extract(record_json, '$.family')",
  },
  {
    name: "command-audit-parent-column-matches-record",
    sql: "SELECT count(*) AS count FROM command_audits WHERE command_id <> json_extract(record_json, '$.request.commandId')",
  },
  {
    name: "dependency-manifest-column-matches-record",
    sql: "SELECT count(*) AS count FROM dependencies WHERE manifest_id <> json_extract(record_json, '$.manifestId')",
  },
  {
    name: "write-intent-columns-match-record",
    sql: "SELECT count(*) AS count FROM write_intents WHERE system <> json_extract(record_json, '$.system') OR idempotency_key <> json_extract(record_json, '$.idempotencyKey') OR idempotency_key_digest <> json_extract(record_json, '$.idempotencyKeyDigest') OR status <> json_extract(record_json, '$.status')",
  },
  {
    name: "write-attempt-columns-match-record",
    sql: "SELECT count(*) AS count FROM write_attempts WHERE write_intent_id <> json_extract(record_json, '$.writeIntentId') OR generation <> json_extract(record_json, '$.generation')",
  },
  {
    name: "durable-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM durable_outbox WHERE write_intent_id <> json_extract(record_json, '$.aggregate.writeIntentId') OR generation <> json_extract(record_json, '$.aggregate.generation') OR kind <> json_extract(record_json, '$.payload.kind')",
  },
  {
    name: "attempting-write-has-current-attempt",
    sql: `
      SELECT count(*) AS count FROM write_intents AS intent
      WHERE intent.status = 'attempting' AND NOT EXISTS (
        SELECT 1 FROM write_attempts AS attempt
        WHERE attempt.record_key = json_extract(intent.record_json, '$.currentAttemptId')
          AND attempt.write_intent_id = intent.record_key
          AND attempt.generation = json_extract(intent.record_json, '$.generation')
      )
    `,
  },
] as const);

function invariantViolations(database: DatabaseSync): readonly string[] {
  return INVARIANT_QUERIES.flatMap(({ name, sql }) => {
    const { count } = CountRowSchema.parse(database.prepare(sql).get());
    return count === 0 ? [] : [`${name} failed for ${String(count)} row(s)`];
  });
}

function validateAuthorityRecordSchemas(database: DatabaseSync): number {
  let validated = 0;
  for (const [table, schema] of Object.entries(AUTHORITY_RECORD_SCHEMA_REGISTRY)) {
    const rows = z.array(AuthorityRecordFingerprintRowSchema).parse(database.prepare(`
      SELECT record_key, record_json FROM ${table} ORDER BY record_key
    `).all());
    for (const row of rows) {
      try {
        parseJsonRecord(schema, row.record_json);
      } catch (error) {
        throw new Error(
          `authority table ${table} record ${row.record_key} failed strict record schema validation: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      validated += 1;
    }
  }
  return validated;
}

function authorityContentFingerprint(database: DatabaseSync): string {
  const authorityRows = AuthorityTableNameSchema.options.map((name) => {
    if (name === "authority_meta") {
      const row = AuthorityMetaFingerprintRowSchema.parse(database.prepare(`
        SELECT singleton_id, schema_version, authority_generation, updated_at,
               migration_owner, migration_started_at
        FROM authority_meta WHERE singleton_id = 1
      `).get());
      return [name, row] as const;
    }
    const rows = z.array(AuthorityRecordFingerprintRowSchema).parse(database.prepare(`
      SELECT record_key, record_json FROM ${name} ORDER BY record_key
    `).all());
    return [name, rows] as const;
  });
  return createHash("sha256").update(canonicalJsonStringify(authorityRows)).digest("hex");
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.record_key)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM write_intents WHERE status NOT IN ('committed', 'observed-present')"),
    leases: count("SELECT count(*) AS count FROM leases"),
    durableOutbox: count("SELECT count(*) AS count FROM durable_outbox WHERE json_extract(record_json, '$.projection.state') = 'pending'"),
    artifactOutbox: count("SELECT count(*) AS count FROM artifact_outbox WHERE json_extract(record_json, '$.state') = 'pending'"),
    captureFinalizationOutboxes: count("SELECT count(*) AS count FROM capture_finalization_outboxes"),
  };
}

function inspectOpenDatabase(database: DatabaseSync, requireOperationalPragmas: boolean): AuthorityCopyInspection {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  if (schemaVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`authority schema ${String(schemaVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  }
  if (schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  }
  QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw new Error(`authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`);
  const names = tableNames(database);
  const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
  }
  const meta = readMetaRow(database);
  if (meta.schema_version !== schemaVersion) {
    throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`);
  }
  if (meta.migration_owner !== null || meta.migration_started_at !== null) {
    throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
  }
  validateAuthorityRecordSchemas(database);
  const violations = invariantViolations(database);
  if (violations.length > 0) throw new Error(`authority database invariant validation failed: ${violations.join("; ")}`);
  if (readIntPragma(database, "foreign_keys") !== 1) throw new Error("authority database foreign keys are disabled");
  if (requireOperationalPragmas) {
    if (readTextPragma(database, "journal_mode") !== "wal") throw new Error("authority database is not using WAL mode");
    if (readIntPragma(database, "synchronous") !== 2) throw new Error("authority database synchronous mode is not FULL");
  }
  return AuthorityCopyInspectionSchema.parse({
    applicationId,
    schemaVersion,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    authorityContentFingerprint: authorityContentFingerprint(database),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariants: { state: "valid", violations: [] },
    tables: names.map((name) => ({ name, classification: tableClassification(name) })),
    counts: pendingCounts(database),
  });
}

function inspectExistingDatabaseReadOnly(path: string, busyTimeoutMs: number): AuthorityCopyInspection {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const database = new DatabaseSync(parsedPath, {
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
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    return inspectOpenDatabase(database, false);
  } finally {
    database.close();
  }
}

export class AuthorityDatabase implements Disposable {
  #database: DatabaseSync;
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #closed = false;
  #transactionDepth = 0;
  #savepointSequence = 0;
  #transactionMode: "authority" | "projection" | undefined;
  #authorityDirty = false;
  #writeCommitHooks: AuthorityWriteCommitHooks | undefined;

  readonly authority: AuthorityRepositories;
  readonly projections: ProjectionRepositories;

  private constructor(input: unknown, clock: Clock, writeCommitHooks?: AuthorityWriteCommitHooks) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const existed = options.path !== ":memory:" && existsSync(options.path);
    if (existed && statSync(options.path).size === 0) {
      throw new Error(`authority database ${options.path} exists but is empty; refusing to replace it`);
    }
    this.#clock = clock;
    this.#writeCommitHooks = writeCommitHooks;
    this.#path = options.path;
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#database = new DatabaseSync(options.path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: options.busyTimeoutMs,
      readBigInts: false,
      returnArrays: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      defensive: true,
    });

    try {
      this.#configureConnection();
      this.#initializeSchema(existed, options.migrationOwner);
      this.#validateDatabase();
    } catch (error) {
      this.#database.close();
      throw new Error(`failed to open authority database ${options.path}: ${errorMessage(error)}`, { cause: error });
    }

    this.authority = this.#buildAuthorityRepositories();
    this.projections = this.#buildProjectionRepositories();
  }

  static open(
    input: unknown,
    clock: Clock = systemClock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
  ): AuthorityDatabase {
    return new AuthorityDatabase(input, clock, writeCommitHooks);
  }

  static sourceDatabaseIdentity(path: string): string {
    return createHash("sha256")
      .update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(path))}`)
      .digest("hex");
  }

  static inspectExistingReadOnly(path: string, busyTimeoutMs = 250): AuthorityCopyInspection {
    return inspectExistingDatabaseReadOnly(path, busyTimeoutMs);
  }

  getSourceDatabaseIdentity(): string {
    return AuthorityDatabase.sourceDatabaseIdentity(this.#path);
  }

  async onlineBackupTo(destinationPath: string): Promise<number> {
    this.#assertOpen();
    const destination = z.string().min(1).parse(destinationPath);
    return sqliteBackup(this.#database, destination, { rate: 100 });
  }

  close(): void {
    if (this.#closed) return;
    if (this.#transactionDepth !== 0) throw new Error("cannot close authority database during a transaction");
    this.#database.close();
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  getMeta(): z.infer<typeof AuthorityMetaSchema> {
    this.#assertOpen();
    const row = this.#readMetaRow();
    return AuthorityMetaSchema.parse({
      schemaVersion: row.schema_version,
      authorityGeneration: row.authority_generation,
      updatedAt: row.updated_at,
    });
  }

  inspectSchema(): z.infer<typeof AuthoritySchemaInspectionSchema> {
    this.#assertOpen();
    const meta = this.getMeta();
    const names = this.#tableNames();
    return AuthoritySchemaInspectionSchema.parse({
      applicationId: this.#readIntPragma("application_id"),
      schemaVersion: meta.schemaVersion,
      authorityGeneration: meta.authorityGeneration,
      pragmas: {
        journalMode: this.#readTextPragma("journal_mode"),
        foreignKeys: this.#readIntPragma("foreign_keys"),
        synchronous: this.#readIntPragma("synchronous"),
        busyTimeoutMs: this.#readIntPragma("busy_timeout"),
      },
      tables: names.map((name) => ({ name, classification: tableClassification(name) })),
    });
  }

  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result {
    return this.#withTransaction("authority", () => work(this.authority));
  }

  withProjectionTransaction<Result>(work: (repositories: ProjectionRepositories) => Result): Result {
    return this.#withTransaction("projection", () => work(this.projections));
  }

  commitWriteAttempt(input: unknown): AtomicWriteCommitReport {
    const parsed = AtomicWriteCommitInputSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const currentIntent = this.#readRecord("write_intents", parsed.writeIntentId, WriteIntentRecordSchema);
      if (currentIntent === undefined) throw new Error(`write intent ${parsed.writeIntentId} does not exist`);
      if (currentIntent.status !== "attempting") {
        throw new Error(`write intent ${parsed.writeIntentId} is ${currentIntent.status}; only attempting may commit`);
      }
      if (currentIntent.generation !== parsed.generation) {
        throw new Error(`write intent ${parsed.writeIntentId} generation ${String(currentIntent.generation)} does not match commit generation ${String(parsed.generation)}`);
      }
      const currentAttempt = this.#readRecord("write_attempts", currentIntent.currentAttemptId, WriteAttemptRecordSchema);
      if (currentAttempt === undefined) throw new Error(`current write attempt ${currentIntent.currentAttemptId} does not exist`);
      if (currentAttempt.outcome.state !== "attempting") {
        throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; only attempting may commit`);
      }
      WriteFenceInputSchema.parse({ intent: currentIntent, attempt: currentAttempt });
      this.#assertAtomicCommitMatchesIntent(parsed, currentIntent);

      const committedIntent = WriteIntentRecordSchema.parse({
        ...currentIntent,
        status: "committed",
        completionProof: parsed.completionProof,
        confirmedAt: parsed.confirmedAt,
        version: currentIntent.version + 1,
        updatedAt: parsed.confirmedAt,
      });
      const committedAttempt = WriteAttemptRecordSchema.parse({
        ...currentAttempt,
        outcome: {
          state: "committed",
          completionProof: parsed.completionProof,
          confirmedAt: parsed.confirmedAt,
        },
        recordedAt: parsed.confirmedAt,
      });

      this.#replaceWriteIntent(committedIntent);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      this.#replaceWriteAttempt(committedAttempt);
      this.#writeCommitHooks?.afterStorageStep("attempt-state");
      this.#insertDurableOutbox(parsed.ledgerOutbox);
      this.#writeCommitHooks?.afterStorageStep("ledger-outbox");
      this.#insertDurableOutbox(parsed.terminalSpanOutbox);
      this.#writeCommitHooks?.afterStorageStep("terminal-span-outbox");

      return AtomicWriteCommitReportSchema.parse({
        state: "committed",
        intent: committedIntent,
        attempt: committedAttempt,
        ledgerOutbox: parsed.ledgerOutbox,
        terminalSpanOutbox: parsed.terminalSpanOutbox,
      });
    });
  }

  #assertOpen(): void {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
  }

  #configureConnection(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    this.#database.exec(`PRAGMA busy_timeout = ${String(this.#busyTimeoutMs)}`);
  }

  #initializeSchema(existed: boolean, migrationOwner: string): void {
    if (!existed) {
      this.#runMigrations(0, migrationOwner);
      return;
    }
    const applicationId = this.#readIntPragma("application_id");
    if (applicationId !== AUTHORITY_APPLICATION_ID) {
      throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
    }
    const userVersion = this.#readIntPragma("user_version");
    if (userVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(`authority schema ${String(userVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    }
    if (userVersion < 1) throw new Error("existing authority database has no recognized schema version");
    const meta = this.#readMetaRow();
    if (meta.schema_version !== userVersion) {
      throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(userVersion)}`);
    }
    if (meta.migration_owner !== null || meta.migration_started_at !== null) {
      throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
    }
    if (userVersion < CURRENT_AUTHORITY_SCHEMA_VERSION) this.#runMigrations(userVersion, migrationOwner);
  }

  #runMigrations(fromVersion: number, migrationOwner: string): void {
    this.#database.exec("BEGIN EXCLUSIVE");
    try {
      const migrations = SQLITE_MIGRATIONS.filter(({ version }) => version > fromVersion);
      for (const migration of migrations) {
        for (const statement of migration.statements) this.#database.exec(statement);
        if (migration.version === 1) {
          this.#database.prepare(`
            INSERT INTO authority_meta (
              singleton_id, schema_version, authority_generation, updated_at,
              migration_owner, migration_started_at
            ) VALUES (1, ?, 0, ?, ?, ?)
          `).run(migration.version, this.#now(), migrationOwner, this.#now());
        } else {
          this.#database.prepare(`
            UPDATE authority_meta
            SET schema_version = ?, migration_owner = ?, migration_started_at = ?, updated_at = ?
            WHERE singleton_id = 1
          `).run(migration.version, migrationOwner, this.#now(), this.#now());
        }
        this.#database.exec(`PRAGMA user_version = ${String(migration.version)}`);
      }
      this.#database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
      this.#database.prepare(`
        UPDATE authority_meta
        SET migration_owner = NULL, migration_started_at = NULL, updated_at = ?
        WHERE singleton_id = 1
      `).run(this.#now());
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #validateDatabase(): void {
    const migrationViolations = auditMigrationTableCoverage();
    if (migrationViolations.length > 0) throw new Error(migrationViolations.join("; "));
    inspectOpenDatabase(this.#database, true);
  }

  #tableNames(): TableName[] {
    return tableNames(this.#database);
  }

  #readMetaRow(): z.infer<typeof MetaRowSchema> {
    return readMetaRow(this.#database);
  }

  #readIntPragma(name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout"): number {
    return readIntPragma(this.#database, name);
  }

  #readTextPragma(name: "journal_mode"): string {
    return readTextPragma(this.#database, name);
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  #withTransaction<Result>(mode: "authority" | "projection", work: () => Result): Result {
    this.#assertOpen();
    if (this.#transactionDepth > 0) {
      if (this.#transactionMode === "projection" && mode === "authority") {
        throw new Error("authority mutation cannot run inside a projection transaction");
      }
      const savepoint = `authority_nested_${String(this.#savepointSequence += 1)}`;
      const dirtyBefore = this.#authorityDirty;
      this.#database.exec(`SAVEPOINT ${savepoint}`);
      this.#transactionDepth += 1;
      try {
        const result = work();
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.#database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        this.#authorityDirty = dirtyBefore;
        throw error;
      } finally {
        this.#transactionDepth -= 1;
      }
    }

    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth = 1;
    this.#transactionMode = mode;
    this.#authorityDirty = false;
    try {
      const result = work();
      if (this.#authorityDirty) {
        const update = this.#database.prepare(`
          UPDATE authority_meta
          SET authority_generation = authority_generation + 1, updated_at = ?
          WHERE singleton_id = 1
        `).run(this.#now());
        if (sqliteChanges(update.changes) !== 1) throw new Error("authority generation update did not affect the singleton metadata row");
      }
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth = 0;
      this.#transactionMode = undefined;
      this.#authorityDirty = false;
    }
  }

  #authorityWrite<Outcome extends Readonly<{ result: unknown; changes: number }>>(
    table: AuthorityTableName,
    operation: () => Outcome,
  ): Outcome["result"] {
    if (table === "authority_meta") throw new Error("authority_meta is mutated only by the generation and migration protocols");
    return this.#withTransaction("authority", () => {
      const outcome = operation();
      if (outcome.changes > 0) this.#authorityDirty = true;
      return outcome.result;
    });
  }

  #projectionWrite<Result>(table: ProjectionTableName, operation: () => Result): Result {
    ProjectionTableNameSchema.parse(table);
    return this.#withTransaction("projection", operation);
  }

  #readRecord<Schema extends z.ZodType>(table: TableName, recordKey: string, schema: Schema): z.output<Schema> | undefined {
    const row = this.#database.prepare(`SELECT record_json FROM ${table} WHERE record_key = ?`).get(recordKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(schema, JsonRowSchema.parse(row).record_json);
  }

  #insertSimpleRecord<Schema extends z.ZodType>(
    table: Exclude<AuthorityTableName, "authority_meta">,
    recordKey: string,
    input: unknown,
    schema: Schema,
    createdAt: string,
  ): ImmutableInsertResult<z.output<Schema>> {
    const record = schema.parse(input);
    const json = canonicalJsonStringify(record);
    return this.#authorityWrite(table, () => {
      const existing = this.#readRecord(table, recordKey, schema);
      if (existing !== undefined) {
        if (canonicalJsonStringify(existing) !== json) throw new Error(`${table} key ${recordKey} already exists with different content`);
        return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
      }
      const result = this.#database.prepare(`
        INSERT INTO ${table} (record_key, record_json, created_at) VALUES (?, ?, ?)
      `).run(recordKey, json, createdAt);
      return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
    });
  }

  #buildAuthorityRepositories(): AuthorityRepositories {
    const opaque = (tableInput: z.input<typeof OpaqueAuthorityTableSchema>): ImmutableRepository<OpaqueAuthorityRecord> => {
      const table = OpaqueAuthorityTableSchema.parse(tableInput);
      return Object.freeze({
        insert: (input: unknown) => {
          const record = OpaqueAuthorityRecordSchema.parse(input);
          return this.#insertSimpleRecord(table, record.recordId, record, OpaqueAuthorityRecordSchema, record.createdAt);
        },
        get: (recordKey: string) => this.#readRecord(table, recordKey, OpaqueAuthorityRecordSchema),
      });
    };

    return Object.freeze({
      commands: Object.freeze({
        insert: (input: unknown) => {
          const record = CommandRequestSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("commands", () => {
            const existing = this.#readRecord("commands", record.commandId, CommandRequestSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command id ${record.commandId} was reused with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO commands (record_key, family, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.commandId, record.family, json, record.requestedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (commandId: string) => this.#readRecord("commands", commandId, CommandRequestSchema),
      }),
      commandAudits: Object.freeze({
        insert: (input: unknown) => {
          const record = CommandAuditRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("command_audits", () => {
            const existing = this.#readRecord("command_audits", record.auditId, CommandAuditRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command audit ${record.auditId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO command_audits (record_key, command_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.auditId, record.request.commandId, json, record.completedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (auditId: string) => this.#readRecord("command_audits", auditId, CommandAuditRecordSchema),
      }),
      dependencies: Object.freeze({
        insert: (input: unknown) => {
          const record = DependencyRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("dependencies", () => {
            const existing = this.#readRecord("dependencies", record.dependencyId, DependencyRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`dependency ${record.dependencyId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO dependencies (record_key, manifest_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.dependencyId, record.manifestId, json, record.createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (dependencyId: string) => this.#readRecord("dependencies", dependencyId, DependencyRecordSchema),
      }),
      delegationManifests: Object.freeze({
        insert: (input: unknown) => {
          const record = DelegationManifestSchema.parse(input);
          return this.#insertSimpleRecord("delegation_manifests", record.manifestId, record, DelegationManifestSchema, record.createdAt);
        },
        get: (manifestId: string) => this.#readRecord("delegation_manifests", manifestId, DelegationManifestSchema),
      }),
      gateResults: Object.freeze({
        insert: (input: unknown) => {
          const record = GateResultRecordSchema.parse(input);
          return this.#insertSimpleRecord("checkpoint_payloads", `${record.runId}:${record.gateId}`, record, GateResultRecordSchema, record.resolvedAt);
        },
        get: (recordKey: string) => this.#readRecord("checkpoint_payloads", recordKey, GateResultRecordSchema),
      }),
      notifications: Object.freeze({
        insert: (input: unknown) => {
          const record = NotificationRecordSchema.parse(input);
          return this.#insertSimpleRecord("notifications", record.notificationId, record, NotificationRecordSchema, record.createdAt);
        },
        get: (notificationId: string) => this.#readRecord("notifications", notificationId, NotificationRecordSchema),
      }),
      configSnapshots: Object.freeze({
        insert: (input: unknown) => {
          const record = ConfigSnapshotRecordSchema.parse(input);
          return this.#insertSimpleRecord("config_snapshots", record.configSnapshotId, record, ConfigSnapshotRecordSchema, record.capturedAt);
        },
        get: (snapshotId: string) => this.#readRecord("config_snapshots", snapshotId, ConfigSnapshotRecordSchema),
      }),
      versionPlans: Object.freeze({
        insert: (input: unknown) => {
          const record = VersionPlanStorageRecordSchema.parse(input);
          return this.#insertSimpleRecord("version_plans", record.versionPlanId, record, VersionPlanStorageRecordSchema, record.createdAt);
        },
        get: (versionPlanId: string) => this.#readRecord("version_plans", versionPlanId, VersionPlanStorageRecordSchema),
      }),
      writeIntents: Object.freeze({
        recordObservedPresent: (input: unknown) => {
          const record = WriteIntentRecordSchema.parse(input);
          if (record.status !== "observed-present") {
            throw new Error(`recordObservedPresent requires observed-present status, received ${record.status}`);
          }
          return this.withAuthorityTransaction(() => {
            const existing = this.#findPermanentWriteIntent(record.system, record.idempotencyKey);
            if (existing !== undefined) {
              return PermanentWriteResolutionSchema.parse({ state: "existing", intent: existing });
            }
            this.#insertWriteIntent(record);
            return PermanentWriteResolutionSchema.parse({ state: "recorded-observed-present", intent: record });
          });
        },
        fenceAttempt: (input: unknown) => {
          const { intent, attempt } = WriteFenceInputSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const existing = this.#findPermanentWriteIntent(intent.system, intent.idempotencyKey);
            if (existing !== undefined) {
              return PermanentWriteResolutionSchema.parse({ state: "existing", intent: existing });
            }
            this.#insertWriteIntent(intent);
            this.#insertWriteAttempt(attempt);
            return PermanentWriteResolutionSchema.parse({ state: "fenced", intent, attempt });
          });
        },
        get: (writeIntentId: string) => this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema),
        findByPermanentKey: (system: unknown, idempotencyKey: unknown) => this.#findPermanentWriteIntent(
          BrowserSystemIdSchema.parse(system),
          IdempotencyKeySchema.parse(idempotencyKey),
        ),
      }),
      writeAttempts: Object.freeze({
        get: (writeAttemptId: string) => this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema),
      }),
      durableOutbox: Object.freeze({
        get: (outboxId: string) => this.#readRecord("durable_outbox", outboxId, AtomicOutboxRecordSchema),
      }),
      artifactOutbox: Object.freeze({
        insert: (input: unknown) => {
          const record = ArtifactOutboxStorageRecordSchema.parse(input);
          return this.#insertSimpleRecord("artifact_outbox", record.outboxId, record, ArtifactOutboxStorageRecordSchema, record.createdAt);
        },
        get: (outboxId: string) => this.#readRecord("artifact_outbox", outboxId, ArtifactOutboxStorageRecordSchema),
      }),
      opaque: Object.freeze({
        tasks: opaque("tasks"),
        leases: opaque("leases"),
        ocrApprovals: opaque("ocr_approvals"),
        captureSessions: opaque("capture_sessions"),
        capturePhotoOrder: opaque("capture_photo_order"),
        captureFinalizationOutboxes: opaque("capture_finalization_outboxes"),
        artifactSinkHeads: opaque("artifact_sink_heads"),
      }),
    });
  }

  #findPermanentWriteIntent(system: string, idempotencyKey: string): WriteIntentRecord | undefined {
    const row = this.#database.prepare(`
      SELECT record_json FROM write_intents WHERE system = ? AND idempotency_key = ?
    `).get(system, idempotencyKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(row).record_json);
  }

  #insertWriteIntent(record: WriteIntentRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_intents", () => {
      const existingById = this.#readRecord("write_intents", record.writeIntentId, WriteIntentRecordSchema);
      if (existingById !== undefined) throw new Error(`write intent id ${record.writeIntentId} already exists with a different permanent key`);
      const digestCollision = this.#database.prepare(`
        SELECT system, idempotency_key FROM write_intents WHERE idempotency_key_digest = ?
      `).get(record.idempotencyKeyDigest);
      if (digestCollision !== undefined) {
        throw new Error(`write intent digest ${record.idempotencyKeyDigest} is already bound to a different permanent key`);
      }
      const result = this.#database.prepare(`
        INSERT INTO write_intents (
          record_key, system, idempotency_key, idempotency_key_digest, status, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.writeIntentId,
        record.system,
        record.idempotencyKey,
        record.idempotencyKeyDigest,
        record.status,
        json,
        record.createdAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertWriteAttempt(record: WriteAttemptRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_attempts", () => {
      const result = this.#database.prepare(`
        INSERT INTO write_attempts (
          record_key, write_intent_id, generation, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(record.writeAttemptId, record.writeIntentId, record.generation, json, record.recordedAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #replaceWriteIntent(record: WriteIntentRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_intents
      SET status = ?, record_json = ?
      WHERE record_key = ? AND idempotency_key_digest = ?
    `).run(record.status, canonicalJsonStringify(record), record.writeIntentId, record.idempotencyKeyDigest);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write intent ${record.writeIntentId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #replaceWriteAttempt(record: WriteAttemptRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_attempts SET record_json = ?
      WHERE record_key = ? AND write_intent_id = ? AND generation = ?
    `).run(canonicalJsonStringify(record), record.writeAttemptId, record.writeIntentId, record.generation);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write attempt ${record.writeAttemptId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #insertDurableOutbox(record: z.infer<typeof AtomicOutboxRecordSchema>): void {
    const json = canonicalJsonStringify(record);
    const result = this.#database.prepare(`
      INSERT INTO durable_outbox (
        record_key, write_intent_id, generation, kind, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.outboxId, record.aggregate.writeIntentId, record.aggregate.generation, record.payload.kind, json, record.createdAt);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`durable outbox ${record.outboxId} insertion affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #assertAtomicCommitMatchesIntent(
    input: z.infer<typeof AtomicWriteCommitInputSchema>,
    intent: Extract<WriteIntentRecord, { status: "attempting" }>,
  ): void {
    const ledger = input.ledgerOutbox.payload;
    const span = input.terminalSpanOutbox.payload;
    if (ledger.kind !== "ledger-entry" || span.kind !== "write-committed-span" || input.outcome.disposition !== "committed") {
      throw new Error("atomic write commit payload arms were not narrowed after strict parsing");
    }
    const expected = {
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
      workflowId: intent.workflowId,
      itemId: intent.itemId,
      system: intent.system,
      idempotencyKey: intent.idempotencyKey,
      idempotencyKeyDigest: intent.idempotencyKeyDigest,
      bindingProofDigest: intent.bindingProofDigest,
      runId: intent.runId,
      attempt: intent.runAttempt,
    };
    for (const [field, value] of Object.entries(expected)) {
      const ledgerValue = ledger.entry[field as keyof typeof ledger.entry];
      const spanValue = span[field as keyof typeof span];
      if (ledgerValue !== value || spanValue !== value) {
        throw new Error(`atomic write outboxes ${field} do not match intent ${intent.writeIntentId}`);
      }
    }
    if (ledger.entry.fencedAt !== intent.fencedAt
      || ledger.entry.confirmedAt !== input.confirmedAt
      || ledger.entry.proofSource !== input.outcome.proofSource
      || span.occurredAt !== input.confirmedAt
      || canonicalJsonStringify(ledger.entry.proof) !== canonicalJsonStringify(input.completionProof)) {
      throw new Error(`atomic write outboxes do not match proof/timing for intent ${intent.writeIntentId}`);
    }
    if (input.ledgerOutbox.projection.state !== "pending"
      || input.terminalSpanOutbox.projection.state !== "pending"
      || input.ledgerOutbox.createdAt !== input.confirmedAt
      || input.terminalSpanOutbox.createdAt !== input.confirmedAt) {
      throw new Error(`atomic write outboxes must begin pending at confirmation time for intent ${intent.writeIntentId}`);
    }
  }

  #buildProjectionRepositories(): ProjectionRepositories {
    const repository = (table: ProjectionTableName): ProjectionRepository => Object.freeze({
      upsert: (input: unknown) => {
        const record = ProjectionStorageRecordSchema.parse(input);
        return this.#projectionWrite(table, () => {
          this.#database.prepare(`
            INSERT INTO ${table} (record_key, record_json, created_at) VALUES (?, ?, ?)
            ON CONFLICT(record_key) DO UPDATE SET
              record_json = excluded.record_json,
              created_at = excluded.created_at
          `).run(record.projectionKey, canonicalJsonStringify(record), record.updatedAt);
          return record;
        });
      },
      get: (projectionKey: string) => this.#readRecord(table, projectionKey, ProjectionStorageRecordSchema),
      clear: () => this.#projectionWrite(table, () => {
        const result = this.#database.prepare(`DELETE FROM ${table}`).run();
        return sqliteChanges(result.changes);
      }),
    });
    return Object.freeze({
      spans: repository("spans"),
      gates: repository("gates"),
      notes: repository("notes"),
      runsView: repository("runs_view"),
    });
  }
}
