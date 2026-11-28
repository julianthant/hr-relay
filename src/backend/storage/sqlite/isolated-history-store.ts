import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { join } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SpanEventWireSchema, type SpanEventWire } from "../../../models/events/types.js";
import { TimelineAppendSchema, TimelineEventRecordSchema, type TimelineEventRecord, type TimelineRepository } from "../../../models/events/timeline.js";
import { NotificationRecordSchema, type NotificationRecord } from "../../../models/notifications/notifications.js";
import { RunRecordSchema, type RunRecord } from "../../../models/run/record.js";
import { RunSessionRecordSchema, type RunSessionRecord } from "../../../models/run/session.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { FailureRecordSchema, type FailureRecord } from "../../../models/trust/failure.js";
import type { IsoInstant, NodeId } from "../../../rules/identity/ids.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, type WriteAttemptRecord, type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { capturedInstantClock, localDatePart } from "../../../rules/time/clock.js";
import { createTimelineEmitter } from "../events/timeline-emitter.js";
import type { ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { deriveStableUuid } from "../../../rules/identity/stable-uuid.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, OCR_SEARCH_TERMS_COLUMN_SQL } from "./migrations.js";
import { initialFailureColumns, initialNotificationColumns } from "./native-record-row.js";
import { backupReadOnlyDatabase, openReadOnlyDatabase } from "./readonly-authority-snapshot.js";
import { runRecordColumns, runRecordFromRow } from "./run-record-row.js";
import { backfillRunSearchOcrSubjects, copySeedSearchColumns } from "./run-search-index.js";
import { RUN_SEARCH_FTS_MIGRATION } from "./run-search-fts.js";
import { convertSettingsRecordRow } from "./settings-record-conversion.js";
import { timelineEventColumns } from "./timeline-repository.js";
import { privatePathRejects } from "../private-path.js";

export function historyArchivePath(stateRoot: string): string {
  const directory = join(stateRoot, "files");
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat !== undefined && (!stat.isDirectory() || realpathSync(directory) !== directory || privatePathRejects(directory, stat, "group-write"))) {
    throw new Error("isolated-history-directory-unsafe");
  }
  return join(directory, "imported-history.sqlite");
}

const commandFamilies = "family IN ('run-lifecycle','run','start','bulk-parent','bulk-child','failure-resolution','ocr-review','gate','workflow-batch') OR (family='worker-browser' AND json_extract(request_json,'$.type')='check-parked-write')";
const archiveFormat = 2;
const dashboardEvidenceTables = {
  run_requests: " WHERE id IN (SELECT json_extract(payload_json,'$.origin.startPlanId') FROM run_batches WHERE id IN (SELECT session_id FROM runs))",
  settings_snapshots: " WHERE id IN (SELECT settings_snapshot_id FROM runs)",
  artifacts: " WHERE kind='extracted' AND id IN (SELECT json_extract(payload_json,'$.result.value.extractionId') FROM run_results WHERE workflow='ocr-page')",
} as const;
const historyTables = {
  runs: "", run_batches: "", deleted_runs: "", run_delegations: "", delegation_dependencies: "",
  run_checkpoints: "", gate_results: "", run_results: "", run_failures: "", run_receipts: "",
  write_intents: "", write_attempts: "", timeline_events: "", notifications: "", run_search: "",
  diagnostic_snapshots: "", diagnostic_files: "", dryrun_results: "", ocr_approved_snapshots: "", ocr_review_revisions: "",
  commands: ` WHERE ${commandFamilies}`,
  command_audits: ` WHERE command_id IN (SELECT id FROM commands WHERE ${commandFamilies})`,
  run_references: " WHERE table_name IN ('commands','command_audits','run_delegations','delegation_dependencies','run_results','run_receipts')",
  workbook_operations: " WHERE json_extract(request_json,'$.source.kind') IN ('run','run-reference') AND receipt_json IS NOT NULL",
  ...dashboardEvidenceTables,
} as const;
const tables = Object.entries(historyTables);
const headers = z.strictObject({ format: z.literal(archiveFormat), schema_version: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  installation_id: z.uuid(), profile_id: z.uuid() });
const Column = z.string().regex(/^[a-z_][a-z0-9_]*$/u);
const validatedVersion = new WeakMap<DatabaseSync, number>();

/** The archive answers the statements written for the native tables, so it carries their indexes: without one a lookup scans every archived row. */
function missingNativeIndexes(native: DatabaseSync, archive: DatabaseSync): string[] {
  const present = new Set(archive.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => z.object({ name: z.string() }).parse(row).name));
  return native.prepare(`SELECT name,sql FROM main.sqlite_master WHERE type='index' AND sql IS NOT NULL
    AND tbl_name IN (SELECT value FROM json_each(?)) ORDER BY name`).all(JSON.stringify(Object.keys(historyTables)))
    .map(row => z.object({ name: z.string(), sql: z.string() }).parse(row)).filter(index => !present.has(index.name)).map(index => index.sql);
}

/** An index hint applies to a native table. The planner selects each side's index independently on the history union. */
export function runIndex(database: DatabaseSync, name: "runs_day_idx" | "runs_workflow_day_idx" | "runs_parent_idx" | "runs_nonterminal_idx"): string {
  return validatedVersion.has(database) ? "" : `INDEXED BY ${name}`;
}

export function writeHistoryArchive(source: DatabaseSync, path: string, binding: ProfileDatabaseBinding, at: IsoInstant) {
  return materializeHistoryArchive(source, path, binding, at);
}

function createHistoryTable(archive: DatabaseSync, name: string, columns: readonly string[]): void {
  archive.exec(`CREATE TABLE ${name} (${columns.join(",")})`);
  const key = columns.includes("id") ? "id" : columns.includes("run_id") ? "run_id" : columns[0];
  archive.exec(`CREATE INDEX ${name}_lookup ON ${name}(${key})`);
  if (columns.includes("run_id") && key !== "run_id") archive.exec(`CREATE INDEX ${name}_owner ON ${name}(run_id)`);
}

function materializeHistoryArchive(source: DatabaseSync, path: string, binding: ProfileDatabaseBinding, at?: IsoInstant) {
  const archive = new DatabaseSync(path);
  try {
    archive.exec("BEGIN");
    archive.exec("CREATE TABLE history_header(format INTEGER, schema_version INTEGER, installation_id TEXT, profile_id TEXT)");
    archive.prepare("INSERT INTO history_header VALUES(?,?,?,?)").run(archiveFormat, CURRENT_AUTHORITY_SCHEMA_VERSION, binding.installationId, binding.profileId);
    const counts: Record<string, number> = {};
    for (const [name, where] of tables) {
      const select = source.prepare(`SELECT * FROM ${name}${at === undefined ? " WHERE 0" : where}${name === "commands" ? " ORDER BY rowid" : ""}`);
      const columns = select.columns().map(column => Column.parse(column.name));
      createHistoryTable(archive, name, columns);
      const insert = archive.prepare(`INSERT INTO ${name} VALUES(${columns.map(() => "?").join(",")})`);
      let count = 0;
      for (let row of select.iterate()) {
        if (at !== undefined && name === "runs" && row.state !== "terminal") {
          const record = { ...runRecordFromRow(row) };
          delete record.cancelRequested;
          delete record.pause;
          row = runRecordColumns({ ...record, updatedAt: at, lifecycle: { state: "terminal", outcome: "discarded",
            endedAt: at, errorSummary: "Closed when imported as isolated history" } });
        }
        insert.run(...columns.map(key => row[key]));
        count++;
      }
      counts[name] = count;
    }
    archive.exec("UPDATE run_search SET state='discarded' WHERE run_id IN (SELECT id FROM runs WHERE outcome='discarded') AND state NOT IN ('done','failed','cancelled','discarded','interrupted','superseded')");
    backfillRunSearchOcrSubjects(archive);
    for (const statement of RUN_SEARCH_FTS_MIGRATION.statements) archive.exec(statement);
    for (const index of missingNativeIndexes(source, archive)) archive.exec(index);
    archive.exec("COMMIT");
    return counts;
  } finally { archive.close(); }
}

export const COPY_HISTORY_SEED_BUILD = sha256Hex("relay-copy-seed");

export type CopyHistorySeed = Readonly<{
  fromDay: string;
  build(runs: readonly RunRecord[]): Readonly<{
    runs: readonly Readonly<{ run: RunRecord; failure?: FailureRecord; events: readonly SpanEventWire[];
      write?: Readonly<{ intent: WriteIntentRecord; attempt: WriteAttemptRecord; nodeId: NodeId }> }>[];
    notifications: readonly NotificationRecord[];
    /** Run groups the generated runs belong to; seed-owned, never a real session. */
    batches: readonly RunSessionRecord[];
    /** Sample Sessions cards, served beside the pool's members on a copy and never given to it. */
    sessions: readonly Readonly<{ workerId: string; payload: unknown }>[];
  }>;
}>;

export async function cloneHistoryArchive(path: string, stage: string): Promise<boolean> {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return false;
  assertArchiveFile(path);
  await backupReadOnlyDatabase(path, stage, 5000);
  return true;
}

const SeedMemberSchema = z.strictObject({ kind: z.enum(["run", "notification"]), id: z.uuid() });

/** A seed member run must still be the seed's own synthetic run; anything else in the membership list is refused. */
function assertSeedRun(archive: DatabaseSync, id: string): RunRecord {
  const row = archive.prepare("SELECT * FROM runs WHERE id=?").get(id);
  const run = row === undefined ? undefined : runRecordFromRow(row);
  if (run?.envelope.buildId !== COPY_HISTORY_SEED_BUILD || run.displayName?.startsWith("Synthetic ") !== true) throw new Error("copy-seed-run-membership-mismatch");
  return run;
}

function removePreviousSeed(archive: DatabaseSync): void {
  archive.exec(`CREATE TABLE IF NOT EXISTS copy_seed_members(kind TEXT NOT NULL CHECK(kind IN ('run','notification')),
    id TEXT NOT NULL, PRIMARY KEY(kind,id)) STRICT;
    CREATE TABLE IF NOT EXISTS copy_seed_batches(id TEXT PRIMARY KEY) STRICT`);
  for (const raw of archive.prepare("SELECT kind,id FROM copy_seed_members").iterate()) {
    const { kind, id } = SeedMemberSchema.parse(raw);
    if (kind === "run") {
      assertSeedRun(archive, id);
    } else {
      const row = z.object({ payload_json: z.string() }).parse(archive.prepare("SELECT payload_json FROM notifications WHERE id=?").get(id));
      if (!NotificationRecordSchema.parse(JSON.parse(row.payload_json)).title.startsWith("Synthetic ")) throw new Error("copy-seed-notification-membership-mismatch");
    }
  }
  for (const table of ["write_attempts", "write_intents", "run_search", "timeline_events", "run_failures", "runs"] as const) {
    archive.exec(`DELETE FROM ${table} WHERE ${table === "runs" ? "id" : "run_id"} IN (SELECT id FROM copy_seed_members WHERE kind='run')`);
  }
  // Seed members are gone, so any run still in a seed batch is foreign.
  const foreignMember = archive.prepare("SELECT 1 FROM runs WHERE batch_id=? LIMIT 1");
  for (const raw of archive.prepare("SELECT id FROM copy_seed_batches").iterate()) {
    if (foreignMember.get(z.object({ id: z.string() }).parse(raw).id) !== undefined) throw new Error("copy-seed-batch-membership-mismatch");
  }
  archive.exec(`DELETE FROM notifications WHERE id IN (SELECT id FROM copy_seed_members WHERE kind='notification'); DELETE FROM copy_seed_members;
    DELETE FROM run_batches WHERE id IN (SELECT id FROM copy_seed_batches); DELETE FROM copy_seed_batches`);
  archive.exec("CREATE TABLE IF NOT EXISTS copy_seed_sessions(worker_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT; DELETE FROM copy_seed_sessions");
}

export function writeCopyHistorySeed(local: DatabaseSync, path: string, binding: ProfileDatabaseBinding, cloned: boolean, seed: CopyHistorySeed) {
  if (!cloned) materializeHistoryArchive(local, path, binding);
  const archive = new DatabaseSync(path);
  try {
    archive.exec("PRAGMA secure_delete=ON; BEGIN IMMEDIATE");
    removePreviousSeed(archive);
    const from = z.iso.date().parse(seed.fromDay);
    const existing = [archive, local].flatMap(database => database.prepare("SELECT * FROM runs WHERE local_day>=?").all(from).map(runRecordFromRow));
    const population = seed.build(existing);
    let { cursor } = z.strictObject({ cursor: z.number().int().nonnegative() }).parse(
      archive.prepare("SELECT coalesce(max(cursor),0) AS cursor FROM timeline_events").get());
    const membership = archive.prepare("INSERT INTO copy_seed_members(kind,id) VALUES(?,?)");
    const insert = (table: "runs" | "run_search" | "run_failures" | "write_intents" | "write_attempts" | "timeline_events" | "notifications", columns: Record<string, SQLInputValue>) => {
      const key = table === "run_search" ? "run_id" : "id";
      if (archive.prepare(`SELECT 1 FROM ${table} WHERE ${key}=? LIMIT 1`).get(columns[key]) !== undefined) throw new Error(`copy-seed-id-collision: ${table}`);
      const keys = Object.keys(columns);
      archive.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(columns));
    };
    const batches = new Map(population.batches.map(input => RunSessionRecordSchema.parse(input)).map(batch => [batch.sessionId, batch]));
    for (const batch of batches.values()) {
      if (archive.prepare("SELECT 1 FROM run_batches WHERE id=?").get(batch.sessionId) !== undefined) throw new Error("copy-seed-id-collision: run_batches");
      archive.prepare("INSERT INTO run_batches(id,workflow,started_at,payload_json,created_at,group_in_queue,version) VALUES(?,?,?,?,?,?,?)")
        .run(batch.sessionId, batch.workflow, batch.startedAt, canonicalJsonStringify(batch), batch.createdAt, batch.groupInQueue ? 1 : 0, batch.version);
      archive.prepare("INSERT INTO copy_seed_batches(id) VALUES(?)").run(batch.sessionId);
    }
    const byWorkflow: Record<string, number> = {};
    for (const row of population.runs) {
      const run = RunRecordSchema.parse(row.run), { runId, workflow } = run.envelope;
      if (run.envelope.buildId !== COPY_HISTORY_SEED_BUILD || run.envelope.dryRun === (row.write !== undefined) || run.displayName?.startsWith("Synthetic ") !== true || run.envelope.parent !== undefined
        || run.sessionId !== undefined && batches.get(run.sessionId)?.workflow !== workflow) throw new Error("copy-seed-run-invalid");
      const failure = row.failure === undefined ? undefined : FailureRecordSchema.parse(row.failure);
      if (failure !== undefined && (failure.runId !== runId || run.lifecycle.state !== "terminal" || run.lifecycle.failureId !== failure.failureId)) throw new Error("copy-seed-failure-owner-mismatch");
      insert("runs", runRecordColumns(run));
      if (failure !== undefined) insert("run_failures", initialFailureColumns(failure));
      let queued: TimelineEventRecord | undefined, index = 0;
      // The archive's side of the span writer: every ID is derived from the run and event position, so a reseed is identical.
      const repository: Pick<TimelineRepository, "append"> = { append: input => {
        const append = TimelineAppendSchema.parse(input);
        const found = archive.prepare("SELECT 1 FROM timeline_events WHERE id=?").get(append.eventId) !== undefined;
        const record = TimelineEventRecordSchema.parse({ ...append, cursor: found ? cursor : ++cursor });
        if (found) return { state: "existing", record };
        insert("timeline_events", timelineEventColumns(record));
        if (record.payload.kind === "span" && record.payload.event.t === "run.queued") queued = record;
        return { state: "inserted", record };
      } };
      for (const event of SpanEventWireSchema.array().parse(row.events)) {
        createTimelineEmitter({ repository, clock: capturedInstantClock(event.ts), pid: event.pid,
          uuid: () => deriveStableUuid("relay-copy-seed-event", `${runId}/${String(index)}`) }).emit(event);
        index += 1;
      }
      if (row.write !== undefined) {
        const intent = WriteIntentRecordSchema.parse(row.write.intent), attempt = WriteAttemptRecordSchema.parse(row.write.attempt);
        if (run.lifecycle.state !== "parked-write" || intent.status !== "parked" || run.lifecycle.writeIntentId !== intent.writeIntentId
          || intent.runId !== runId || attempt.runId !== runId || attempt.writeAttemptId !== intent.currentAttemptId) throw new Error("copy-seed-write-owner-mismatch");
        insert("write_intents", { id: intent.writeIntentId, system: intent.system, idempotency_key: intent.idempotencyKey,
          idempotency_key_digest: intent.idempotencyKeyDigest, status: intent.status, generation: intent.generation, run_id: runId,
          payload_json: canonicalJsonStringify(intent), publication_json: null, created_at: intent.createdAt, updated_at: intent.updatedAt });
        insert("write_attempts", { id: attempt.writeAttemptId, intent_id: intent.writeIntentId, generation: attempt.generation,
          run_id: runId, payload_json: canonicalJsonStringify(attempt), created_at: attempt.recordedAt });
        repository.append({ schemaVersion: 1, eventId: runId, workflow, scope: { kind: "run", runId }, occurredAt: intent.updatedAt,
          recordedAt: intent.updatedAt, retentionDate: localDatePart(capturedInstantClock(intent.updatedAt).now()), source: { kind: "native" },
          payload: { kind: "write-parked", runId, workflow, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
            nodeId: row.write.nodeId, writeIntentId: intent.writeIntentId, generation: intent.generation } });
      }
      if (queued === undefined) throw new Error("copy-seed-queue-event-missing");
      insert("run_search", copySeedSearchColumns(run, queued, failure?.code ?? null));
      membership.run("run", runId);
      byWorkflow[workflow] = (byWorkflow[workflow] ?? 0) + 1;
    }
    for (const input of population.notifications) {
      const notice = NotificationRecordSchema.parse(input);
      if (!notice.title.startsWith("Synthetic ")) throw new Error("copy-seed-notification-invalid");
      insert("notifications", initialNotificationColumns(notice));
      membership.run("notification", notice.notificationId);
    }
    const session = archive.prepare("INSERT INTO copy_seed_sessions(worker_id,payload_json) VALUES(?,?)");
    for (const { workerId, payload } of population.sessions) session.run(workerId, JSON.stringify(payload));
    archive.exec("COMMIT");
    return { runs: population.runs.length, byWorkflow, notifications: population.notifications.length, batches: batches.size, sessions: population.sessions.length };
  } finally { archive.close(); }
}

/** The copy seed's sample run IDs and Sessions cards, read once when a copy dashboard starts; an archive without a seed has none. */
export function readCopySeedSamples(path: string, binding: ProfileDatabaseBinding) {
  assertArchiveFile(path);
  const archive = new DatabaseSync(path, { readOnly: true });
  try {
    readArchiveVersion(archive, binding);
    const has = (table: string) => archive.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !== undefined;
    const runIds = has("copy_seed_members") ? archive.prepare("SELECT id FROM copy_seed_members WHERE kind='run'").all()
      .map(row => assertSeedRun(archive, z.strictObject({ id: z.uuid() }).parse(row).id).envelope.runId) : [];
    const sessions = has("copy_seed_sessions") ? archive.prepare("SELECT worker_id,payload_json FROM copy_seed_sessions ORDER BY worker_id").all()
      .map(row => z.strictObject({ worker_id: z.string(), payload_json: z.string() }).parse(row))
      .map(row => ({ workerId: row.worker_id, payload: z.unknown().parse(JSON.parse(row.payload_json)) })) : [];
    return { runIds, sessions };
  } finally { archive.close(); }
}

/** Refuse ambiguous identities before replacing the last usable archive, and after local commits while serving it. */
function checkIdentities(database: DatabaseSync): void {
  for (const [table] of tables) {
    const hasId = database.prepare(`SELECT * FROM history.${table} LIMIT 0`).columns().some(column => column.name === "id");
    if (hasId && database.prepare(`SELECT 1 FROM history.${table} JOIN main.${table} USING(id) LIMIT 1`).get()) {
      throw new Error(`isolated-history-local-id-collision: ${table}`);
    }
  }
  if (database.prepare(`SELECT run_id FROM history.deleted_runs INTERSECT SELECT run_id FROM main.deleted_runs`).get()
    || database.prepare("SELECT 1 FROM history.deleted_runs h JOIN main.runs l ON l.id=h.run_id LIMIT 1").get()
    || database.prepare("SELECT 1 FROM history.runs h JOIN main.deleted_runs l ON l.run_id=h.id LIMIT 1").get()) {
    throw new Error("isolated-history-local-id-collision: deleted_runs");
  }
  if (database.prepare(`SELECT 1 FROM history.run_checkpoints JOIN main.run_checkpoints
    USING(workflow,item_id,node_id,attempt,claim_generation) LIMIT 1`).get()) {
    throw new Error("isolated-history-local-checkpoint-collision");
  }
}

export function validateHistoryRead(database: DatabaseSync, version: number): void {
  if (validatedVersion.get(database) === version) return;
  checkIdentities(database);
  validatedVersion.set(database, version);
}

export function checkStagedHistory(localPath: string, archivePath: string, binding: ProfileDatabaseBinding): void {
  const local = openReadOnlyDatabase(localPath, 5000);
  try {
    attach(local, archivePath, binding);
    checkIdentities(local);
  } finally { local.close(); }
}

function assertArchiveFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || privatePathRejects(path, stat, "private")) throw new Error("isolated-history-unsafe");
}

/** `upgrade` lifts a stale archive in place; `validate` refuses it and opens the archive read-only only. */
type ArchiveAttach = "upgrade" | "validate";

function attach(database: DatabaseSync, path: string, binding: ProfileDatabaseBinding, mode: ArchiveAttach = "upgrade") {
  assertArchiveFile(path);
  if (mode === "upgrade") upgradeHistoryArchive(database, path, binding);
  else if (!archiveIsCurrent(database, path, binding)) throw new Error("isolated-history-upgrade-required");
  const url = pathToFileURL(path);
  url.search = "mode=ro&immutable=1";
  database.prepare("ATTACH DATABASE ? AS history").run(url.href);
  const header = headers.parse(database.prepare("SELECT * FROM history.history_header").get());
  if (header.installation_id !== binding.installationId || header.profile_id !== binding.profileId) throw new Error("isolated-history-binding-mismatch");
}

function upgradeArchivedSettings(archive: DatabaseSync, format: number): void {
  if (format === 1) return; // Format 1 predates archived settings snapshots.
  const update = archive.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?");
  const snapshotRow = z.object({ id: z.string(), payload_json: z.string() });
  for (const row of archive.prepare("SELECT id,payload_json FROM settings_snapshots").all()) {
    const before = snapshotRow.parse(row);
    const after = snapshotRow.parse(convertSettingsRecordRow("settings_snapshots", before));
    if (after.payload_json !== before.payload_json) update.run(after.payload_json, before.id);
  }
}

/** Each step lifts an archive written at its key's schema to the next one; the archive keeps every row it imported. */
const ARCHIVE_UPGRADES: Readonly<Record<number, (archive: DatabaseSync, format: number) => void>> = {
  39: archive => archive.exec(`ALTER TABLE delegation_dependencies ADD COLUMN parent_run_id;
    UPDATE delegation_dependencies SET parent_run_id=json_extract(payload_json,'$.parentRunId')`),
  40: archive => {
    archive.exec(OCR_SEARCH_TERMS_COLUMN_SQL);
    backfillRunSearchOcrSubjects(archive);
  },
  41: upgradeArchivedSettings,
  42: () => undefined, // The new assistant tables live in the person database.
  43: () => undefined, // Assistant message payloads live in the person database.
  44: upgradeArchivedSettings,
  45: archive => {
    for (const statement of RUN_SEARCH_FTS_MIGRATION.statements) archive.exec(statement);
  },
  46: () => undefined, // Applied assistant edits live in the person database.
  47: () => undefined, // Version names live in the workbook catalogue in the person database.
  48: () => undefined, // Activity's confirmation index is copied from the native store below.
};
const ArchiveVersion = z.strictObject({ format: z.literal([1, archiveFormat]), schema_version: z.number().int(), installation_id: z.uuid(), profile_id: z.uuid() });

function readArchiveVersion(archive: DatabaseSync, binding: ProfileDatabaseBinding) {
  const header = ArchiveVersion.parse(archive.prepare("SELECT format,schema_version,installation_id,profile_id FROM history_header").get());
  if (header.installation_id !== binding.installationId || header.profile_id !== binding.profileId) throw new Error("isolated-history-binding-mismatch");
  if (header.schema_version > CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("isolated-history-schema-unsupported");
  return header;
}

/** Whether an archive is at the current schema and format with every native index, read through a read-only probe. */
function archiveIsCurrent(native: DatabaseSync, path: string, binding: ProfileDatabaseBinding): boolean {
  const probe = new DatabaseSync(path, { readOnly: true });
  try {
    const header = readArchiveVersion(probe, binding);
    return header.schema_version === CURRENT_AUTHORITY_SCHEMA_VERSION && header.format === archiveFormat
      && missingNativeIndexes(native, probe).length === 0;
  } finally { probe.close(); }
}

/** Upgrades an archive's schema, format and native indexes in one transaction. */
function upgradeHistoryArchive(native: DatabaseSync, path: string, binding: ProfileDatabaseBinding): void {
  if (archiveIsCurrent(native, path, binding)) return;
  const archive = new DatabaseSync(path);
  try {
    archive.exec("BEGIN IMMEDIATE");
    try {
      const start = readArchiveVersion(archive, binding);
      let version = start.schema_version;
      for (; version < CURRENT_AUTHORITY_SCHEMA_VERSION; version += 1) {
        const step = ARCHIVE_UPGRADES[version];
        if (step === undefined) throw new Error(`isolated-history-schema-unsupported: ${String(version)}`);
        step(archive, start.format);
      }
      if (start.format === 1) {
        for (const name of Object.keys(dashboardEvidenceTables)) {
          const columns = native.prepare(`SELECT * FROM main.${name} LIMIT 0`).columns().map(column => Column.parse(column.name));
          createHistoryTable(archive, name, columns);
        }
      }
      for (const index of missingNativeIndexes(native, archive)) archive.exec(index);
      archive.prepare("UPDATE history_header SET schema_version=?,format=?").run(version, archiveFormat);
      archive.exec("COMMIT");
    } catch (error) { archive.exec("ROLLBACK"); throw error; }
  } finally { archive.close(); }
}

export function attachHistoryArchive(database: DatabaseSync, path: string, binding: ProfileDatabaseBinding, mode: ArchiveAttach = "upgrade") {
  attach(database, path, binding, mode);
  const { offset } = z.strictObject({ offset: z.number().int().nonnegative() }).parse(
    database.prepare("SELECT coalesce(max(cursor),0) AS offset FROM history.timeline_events").get());
  for (const [name] of tables) {
    const columns = database.prepare(`SELECT * FROM main.${name} LIMIT 0`).columns().map(column => Column.parse(column.name));
    const selection = columns.map(key => {
      if (name === "timeline_events" && key === "cursor") return `cursor+${String(offset)} AS cursor`;
      if (name === "timeline_events" && key === "payload_json") return `json_set(payload_json,'$.cursor',cursor+${String(offset)}) AS payload_json`;
      return key;
    });
    database.exec(`CREATE TEMP VIEW ${name} AS SELECT ${selection.join(",")} FROM main.${name} UNION ALL SELECT ${columns.join(",")} FROM history.${name}`);
  }
  database.exec(`CREATE TEMP VIEW history_command_order AS
    SELECT id AS command_id, 0 AS source, rowid AS ordinal FROM history.commands
    UNION ALL SELECT id AS command_id, 1 AS source, rowid AS ordinal FROM main.commands`);
  checkIdentities(database);
  validatedVersion.set(database, -1);
  return offset;
}
