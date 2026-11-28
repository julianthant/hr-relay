import { TimelinePageRequestSchema, type TimelineEventRecord } from "../../../models/events/timeline.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { LogMutation } from "../events/log-mutations.js";
import { debugEventFromRow, timelineEventColumns, timelineEventFromRow } from "./timeline-repository.js";
import { fileModified, fileChanged, fileStatus, sameDirectory } from "../file-identity.js";
import { windowsObserverPolicyPrelude } from "../windows-observer-policy.js";
import { posixPrivatePathRejects, privatePathRejects } from "../private-path.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { createReadonlyAuthoritySnapshot, openReadOnlyDatabase } from "./readonly-authority-snapshot.js";
import { closeSync, lstatSync, openSync, type BigIntStats } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ProfileDatabaseBindingSchema, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { outermostOperationProof } from "../configuration/credential-safe-file.js";
import { attachHistoryArchive, historyArchivePath } from "./isolated-history-store.js";
import { AUTHORITY_APPLICATION_ID, BOUND_AUTHORITY_SCHEMA_VERSIONS, CURRENT_AUTHORITY_SCHEMA_VERSION, UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS, isSupportedStoppedAuthoritySchemaVersion, type BoundAuthoritySchemaVersion, type UnboundPredecessorAuthoritySchemaVersion } from "../../../models/config/authority-schema-versions.js";
export function countUcsdLoginRows(path: string): number | "unreadable" | "absent" {
  const info = fileStatus(path, true);
  if (info === undefined) return "absent";
  if (!info.isFile()) return "unreadable";
  let database: DatabaseSync | undefined;
  let result: number | "unreadable";
  let primary: { error: unknown } | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const rows = z.array(z.object({
      origin_url: z.string().optional(),
      username_value: z.string().optional(),
    })).parse(database.prepare("SELECT origin_url, username_value FROM logins").all());
    result = rows.filter((row) => isUcsdIdentity(row.origin_url) || isUcsdIdentity(row.username_value)).length;
  } catch (error) { primary = { error }; result = "unreadable"; }
  try { database?.close(); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { ...(database === undefined ? {} : { database }) }); }
  return result;

}

export function countProfileCredentialLoginRows(paths: readonly string[]): number | "unreadable" | "absent" {
  if (paths.length === 0) return "absent";
  let rows = 0;
  let sawFile = false;
  for (const path of paths) {
    const count = countUcsdLoginRows(path);
    if (count === "unreadable") return "unreadable";
    if (count === "absent") continue;
    sawFile = true;
    rows += count;
  }
  return sawFile ? rows : "absent";
}

function isUcsdIdentity(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "ucsd.edu" || host.endsWith(".ucsd.edu");
  } catch {
    const text = value.toLowerCase();
    return text.endsWith("@ucsd.edu") || text.endsWith(".ucsd.edu");
  }
}


export function readProfileDatabaseBinding(path: string):
  { readonly schemaVersion: UnboundPredecessorAuthoritySchemaVersion; readonly state: "unbound" } | { readonly schemaVersion: BoundAuthoritySchemaVersion; readonly state: "bound"; readonly binding: ProfileDatabaseBinding } {
  const snapshot = captureProfileDatabaseBinding(path);
  const failures: unknown[] = [];
  try { snapshot.assertUnchanged(); } catch (error) { failures.push(error); }
  if (failures.some(error => error instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(failures, { snapshot });
  try { snapshot.dispose(); }
  catch (error) { throw retainAuthoritySourceClosure([...failures, error], { snapshot }); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "profile-database-binding-read-failed", { cause: failures[0] });
  return snapshot.binding;
}

function captureProfileDatabaseBinding(path: string) {
  requireDatabaseSourcePath(path);
  const before = fileStatus(path, true);
  if (before === undefined) throw new Error("profile-database-binding-required");
  if (!before.isFile() || (before.nlink !== 1 && before.nlink !== 1n) || privatePathRejects(path, before, "group-write")) throw new Error("profile-database-identity-invalid");
  const snapshot = createReadonlyAuthoritySnapshot(path);
  const failures: unknown[] = [];
  try {
    const binding = readProfileDatabaseBindingCopy(snapshot.path);
    const assertUnchanged = () => {
      snapshot.assertUnchanged();
      const after = fileStatus(path);
      // An owner image is one point in time, so only the file identity must hold.
      const contentChanged = snapshot.pointInTime !== true && (before.size !== after.size || fileModified(before) !== fileModified(after) || fileChanged(before) !== fileChanged(after));
      if (before.dev !== after.dev || before.ino !== after.ino || contentChanged || (after.nlink !== 1 && after.nlink !== 1n)) throw new Error("profile-database-identity-changed");
    };
    assertUnchanged();
    return Object.freeze({ binding, path: snapshot.path, assertUnchanged, dispose: snapshot.dispose });
  } catch (error) {
    failures.push(error);
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure(failures, { snapshot });
    try { snapshot.assertUnchanged(); } catch (validation) { failures.push(validation); }
    if (failures.some(failure => failure instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(failures, { snapshot });
    try { snapshot.dispose(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([...failures, cleanup], { snapshot }); }
  }
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "profile-database-binding-read-failed", { cause: failures[0] });
}

export function captureCanonicalProfileBinding(path: string, expected: ProfileDatabaseBinding) {
  const snapshot = captureProfileDatabaseBinding(path);
  const failures: unknown[] = [];
  try {
    assertProfileBindingMatches(snapshot.binding, expected);
    return Object.freeze({ assertUnchanged: snapshot.assertUnchanged, dispose: snapshot.dispose });
  } catch (error) {
    failures.push(error);
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure(failures, { snapshot });
    try { snapshot.assertUnchanged(); } catch (validation) { failures.push(validation); }
    if (failures.some(failure => failure instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(failures, { snapshot });
    try { snapshot.dispose(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([...failures, cleanup], { snapshot }); }
  }
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "profile-database-binding-read-failed", { cause: failures[0] });
}

function readProfileDatabaseBindingCopy(path: string):
  { readonly schemaVersion: UnboundPredecessorAuthoritySchemaVersion; readonly state: "unbound" } | { readonly schemaVersion: BoundAuthoritySchemaVersion; readonly state: "bound"; readonly binding: ProfileDatabaseBinding } {
  requireDatabaseSourcePath(path);
  const before = fileStatus(path, true);
  if (before === undefined) throw new Error("profile-database-binding-required");
  if (!before.isFile() || (before.nlink !== 1 && before.nlink !== 1n) || privatePathRejects(path, before, "group-write")) throw new Error("profile-database-identity-invalid");
  const database = new DatabaseSync(path, { readOnly: true });
  const read = (): ReturnType<typeof readProfileDatabaseBindingCopy> => {
    const version = database.prepare("PRAGMA user_version").get();
    const application = database.prepare("PRAGMA application_id").get();
    if ((version?.user_version !== CURRENT_AUTHORITY_SCHEMA_VERSION && (typeof version?.user_version !== "number" || !isSupportedStoppedAuthoritySchemaVersion(version.user_version)))
      || application?.application_id !== AUTHORITY_APPLICATION_ID) throw new Error("profile-database-schema-mismatch");
    const boundVersion = z.literal(BOUND_AUTHORITY_SCHEMA_VERSIONS).safeParse(version.user_version);
    const binding = boundVersion.success ? ProfileDatabaseBindingSchema.parse(database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get()) : undefined;
    const after = fileStatus(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || fileModified(before) !== fileModified(after)
      || fileChanged(before) !== fileChanged(after) || (after.nlink !== 1 && after.nlink !== 1n)) throw new Error("profile-database-identity-changed");
    if (binding === undefined) {
      if (typeof version.user_version !== "number" || !isSupportedStoppedAuthoritySchemaVersion(version.user_version) || version.user_version >= 7) throw new Error("profile-database-schema-mismatch");
      return { schemaVersion: z.literal(UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS).parse(version.user_version), state: "unbound" };
    }
    return { schemaVersion: z.literal(BOUND_AUTHORITY_SCHEMA_VERSIONS).parse(version.user_version), state: "bound", binding };
  };
  let result: ReturnType<typeof readProfileDatabaseBindingCopy> | undefined;
  let primary: { error: unknown } | undefined;
  try { result = read(); } catch (error) { primary = { error }; }
  try { database.close(); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { database }); }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("profile-database-binding-result-missing");
  return result;
}

export function assertCanonicalProfileBinding(path: string, expected: ProfileDatabaseBinding): void {
  assertProfileBindingMatches(readProfileDatabaseBinding(path), expected);
}

function assertProfileBindingMatches(actual: ReturnType<typeof readProfileDatabaseBinding>, expected: ProfileDatabaseBinding): void {
  if (actual.state !== "bound") throw new Error("profile-database-binding-required");
  if (actual.binding.installationId !== expected.installationId || actual.binding.profileId !== expected.profileId) throw new Error("profile-database-binding-mismatch");
}

export function assertProfileRestoreDatabaseBinding(path: string, expected: ProfileDatabaseBinding): void {
  assertCanonicalProfileBinding(path, expected);
}

// Source SQLite descriptors belong to the observer process, never a live writer process.
const liveBindingScript = `
const { DatabaseSync } = require("node:sqlite");
const { constants, openSync, closeSync, lstatSync, fstatSync, readSync } = require("node:fs");
const { dirname } = require("node:path");
const [path, expected, schema, application] = process.argv.slice(1);
${process.platform === "win32" ? "" : `const privatePathRejects = ${posixPrivatePathRejects.toString()};`}
const identity = stats => [stats.dev, stats.ino, stats.mode, stats.uid, stats.nlink].join(":");
const inspect = file => {
  const stats = lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  if (!stats.isFile() || stats.nlink !== 1n || privatePathRejects(file, stats, "group-write")) throw new Error("profile-database-identity-invalid");
  return stats;
};
const checkWalHeader = (file, stats) => {
  if (stats.size === 0n) return;
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (identity(fstatSync(descriptor, { bigint: true })) !== identity(stats)) throw new Error("profile-database-identity-changed");
    const header = Buffer.alloc(32);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) throw new Error("profile-database-companion-malformed");
    const magic = header.readUInt32BE(0), version = header.readUInt32BE(4), pageSize = header.readUInt32BE(8);
    if ((magic !== 0x377f0682 && magic !== 0x377f0683) || version !== 3007000
      || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) throw new Error("profile-database-companion-malformed");
    let first = 0, second = 0;
    const word = offset => magic === 0x377f0682 ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
    for (let offset = 0; offset < 24; offset += 8) {
      first = (first + word(offset) + second) >>> 0;
      second = (second + word(offset + 4) + first) >>> 0;
    }
    if (header.readUInt32BE(24) !== first || header.readUInt32BE(28) !== second) throw new Error("profile-database-companion-malformed");
    const current = inspect(file);
    if (current === undefined || identity(current) !== identity(stats)) throw new Error("profile-database-identity-changed");
  } finally { closeSync(descriptor); }
};
const check = descriptor => {
  let ancestor = dirname(path);
  for (;;) {
    ${process.platform === "win32" ? 'const info = lstatSync(ancestor, { bigint: true }); if (!info.isDirectory() || privatePathRejects(ancestor, info, "ancestor"))' : "if (!lstatSync(ancestor).isDirectory())"} throw new Error("profile-database-identity-invalid");
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const main = inspect(path);
  if (main === undefined) throw new Error("profile-database-binding-required");
  if (identity(main) !== expected || descriptor !== undefined && identity(fstatSync(descriptor, { bigint: true })) !== expected)
    throw new Error("profile-database-identity-changed");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const companion = inspect(path + suffix);
    if (suffix === "-wal" && companion !== undefined) checkWalHeader(path + suffix, companion);
    if (suffix === "-journal" && companion !== undefined && companion.size > 0n) throw new Error("authority-readonly-source-journal-unsettled");
  }
};
let descriptor, database, result;
try {
  try {
    check();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    check(descriptor);
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true, timeout: 250 });
    database.exec("PRAGMA query_only=ON; BEGIN");
    const version = database.prepare("PRAGMA user_version").get().user_version;
    const app = database.prepare("PRAGMA application_id").get().application_id;
    if (version !== Number(schema) || app !== Number(application)) throw new Error("profile-database-schema-mismatch");
    const binding = database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get();
    database.exec("COMMIT");
    check(descriptor);
    result = { state: "bound", binding };
  } finally {
    try { database?.close(); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ state: "refused", message: error.message }));
  process.exitCode = 1;
}
`;

export function assertLiveProfileDatabaseBinding(path: string, expected: ProfileDatabaseBinding): void {
  requireDatabaseSourcePath(path);
  const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (before === undefined) throw new Error("profile-database-binding-required");
  if (!before.isFile() || before.nlink !== 1n || privatePathRejects(path, before, "group-write")) throw new Error("profile-database-identity-invalid");
  const identity = (stats: BigIntStats) => [stats.dev, stats.ino, stats.mode, stats.uid, stats.nlink].join(":");
  const witness = identity(before);
  const proof = outermostOperationProof();
  const proofKey = `live-binding:${path}:${expected.installationId}:${expected.profileId}`;
  const proofWitness = `${witness}:${before.size}:${before.mtimeNs}`;
  if (proof?.slots.get(proofKey) === proofWitness) return;
  const observed = spawnSync(process.execPath, ["--input-type=commonjs", "-e", process.platform === "win32" ? windowsObserverPolicyPrelude("binding") + liveBindingScript : liveBindingScript, path, witness,
    String(CURRENT_AUTHORITY_SCHEMA_VERSION), String(AUTHORITY_APPLICATION_ID)],
  { encoding: "utf8", maxBuffer: 64 * 1024, env: workerBootstrapEnvironment() });
  if (observed.error !== undefined || observed.signal !== null) throw new Error("profile-database-observation-failed", {
    cause: observed.error ?? { status: observed.status, signal: observed.signal },
  });
  if (observed.status !== 0) {
    const refusal = z.strictObject({ state: z.literal("refused"), message: z.string() }).parse(JSON.parse(observed.stdout));
    throw new Error(refusal.message);
  }
  const result = z.strictObject({ state: z.literal("bound"), binding: ProfileDatabaseBindingSchema }).parse(JSON.parse(observed.stdout));
  requireDatabaseSourcePath(path);
  const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (after === undefined || identity(after) !== witness) throw new Error("profile-database-identity-changed");
  if (result.binding.installationId !== expected.installationId || result.binding.profileId !== expected.profileId) throw new Error("profile-database-binding-mismatch");
  if (`${identity(after)}:${after.size}:${after.mtimeNs}` === proofWitness) proof?.slots.set(proofKey, proofWitness);
}

const bindingSchema = z.strictObject({ installation_id: z.uuid(), profile_id: z.uuid() });
const rowKeySchema = z.strictObject({ cursor: z.number().int().positive(), id: z.uuid(), payload_json: z.string() });
const pragmaInteger = (db: DatabaseSync, name: "application_id" | "user_version" | "synchronous" | "secure_delete") =>
  z.object({ [name]: z.number().int() }).parse(db.prepare(`PRAGMA ${name}`).get())[name];
const journalMode = (db: DatabaseSync, set = false) => z.strictObject({ journal_mode: z.string() })
  .parse(db.prepare(set ? "PRAGMA journal_mode=WAL" : "PRAGMA journal_mode").get()).journal_mode;

const commonColumns = `
  cursor INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, workflow TEXT, run_id TEXT, worker_id TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, retention_date TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
`;
const logPosition = `
  CREATE TABLE log_position (
    id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL CHECK(cursor>=0), history TEXT NOT NULL
  ) STRICT;
`;
const timelineNoteIndex = `
  CREATE VIRTUAL TABLE timeline_notes_fts USING fts5(message, tokenize='trigram');
  INSERT INTO timeline_notes_fts(timeline_notes_fts,rank) VALUES('secure-delete',1);
  INSERT INTO timeline_notes_fts(rowid,message)
    SELECT cursor,json_extract(payload_json,'$.payload.note.message') FROM timeline_events
    WHERE kind='note' AND json_extract(payload_json,'$.payload.note.level')='step';
  CREATE TRIGGER timeline_notes_fts_insert AFTER INSERT ON timeline_events
  WHEN NEW.kind='note' AND json_extract(NEW.payload_json,'$.payload.note.level')='step'
  BEGIN
    INSERT INTO timeline_notes_fts(rowid,message)
    VALUES(NEW.cursor,json_extract(NEW.payload_json,'$.payload.note.message'));
  END;
  CREATE TRIGGER timeline_notes_fts_delete AFTER DELETE ON timeline_events
  WHEN OLD.kind='note' AND json_extract(OLD.payload_json,'$.payload.note.level')='step'
  BEGIN DELETE FROM timeline_notes_fts WHERE rowid=OLD.cursor; END;
`;

const timeline = {
  file: "timeline.db", table: "timeline_events", applicationId: 0x524c544c, read: timelineEventFromRow,
  migrations: [`
    CREATE TABLE timeline_events (${commonColumns},
      kind TEXT NOT NULL CHECK(kind <> 'operation-confirmed'),
      retention_class TEXT NOT NULL CHECK(retention_class IN ('ordinary','protected')),
      operation_id TEXT CHECK(operation_id IS NULL), operation_generation INTEGER CHECK(operation_generation IS NULL),
      confirmed_at TEXT CHECK(confirmed_at IS NULL), system TEXT CHECK(system IS NULL)
    ) STRICT;
    CREATE INDEX timeline_events_run_idx ON timeline_events(run_id, cursor);
    CREATE VIRTUAL TABLE timeline_notes_fts USING fts5(message);
    INSERT INTO timeline_notes_fts(timeline_notes_fts,rank) VALUES('secure-delete',1);
    CREATE TRIGGER timeline_notes_fts_insert AFTER INSERT ON timeline_events
    WHEN NEW.kind='note' AND json_extract(NEW.payload_json,'$.payload.note.level')='step'
    BEGIN
      INSERT INTO timeline_notes_fts(rowid,message)
      VALUES(NEW.cursor,json_extract(NEW.payload_json,'$.payload.note.message'));
    END;
    CREATE TRIGGER timeline_notes_fts_delete AFTER DELETE ON timeline_events
    WHEN OLD.kind='note' AND json_extract(OLD.payload_json,'$.payload.note.level')='step'
    BEGIN DELETE FROM timeline_notes_fts WHERE rowid=OLD.cursor; END;
  `, `
    DROP TRIGGER timeline_notes_fts_insert;
    DROP TRIGGER timeline_notes_fts_delete;
    DROP TABLE timeline_notes_fts;
    ${timelineNoteIndex}
    ${logPosition}
    INSERT INTO log_position SELECT 1,coalesce(max(cursor),0),'' FROM timeline_events;
  `],
  bind: (record: TimelineEventRecord) => timelineEventColumns(record),
};
const dashboard = {
  file: "dashboard.db", table: "debug_events", applicationId: 0x524c444c, read: debugEventFromRow,
  migrations: [`
    CREATE TABLE debug_events (${commonColumns}, pinned INTEGER NOT NULL CHECK(pinned IN (0,1))) STRICT;
    CREATE INDEX debug_events_retention_idx ON debug_events(retention_date) WHERE pinned=0;
    CREATE INDEX debug_events_run_idx ON debug_events(run_id, cursor);
  `, `
    ${logPosition}
    INSERT INTO log_position SELECT 1,coalesce(max(cursor),0),'' FROM debug_events;
  `],
  bind: (record: TimelineEventRecord) => {
    if (record.payload.kind !== "debug") throw new Error("log-dashboard-kind-mismatch");
    return { cursor: record.cursor, id: record.eventId, workflow: record.workflow ?? null,
      run_id: record.scope.kind === "run" ? record.scope.runId : null, worker_id: record.scope.kind === "worker" ? record.scope.workerId : null,
      occurred_at: record.occurredAt, recorded_at: record.recordedAt, retention_date: record.retentionDate,
      pinned: record.payload.event.pinned ? 1 : 0, payload_json: canonicalJsonStringify(record) };
  },
};

function validateFile(path: string, required: boolean): boolean {
  const stat = fileStatus(path, true);
  if (stat === undefined && !required) return false;
  if (!stat?.isFile() || BigInt(stat.nlink) !== 1n || privatePathRejects(path, stat, "owner")) {
    throw new Error("log-database-file-unsafe");
  }
  return true;
}

function inTransaction<T>(db: DatabaseSync, begin: "BEGIN" | "BEGIN IMMEDIATE", work: () => T): T {
  db.exec(begin);
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch (rollback) { throw new AggregateError([error, rollback], "log-database-rollback-failed", { cause: rollback }); }
    throw error;
  }
}

function assertLogOwner(db: DatabaseSync, binding: z.infer<typeof bindingSchema>): void {
  const [owner, ...duplicates] = db.prepare("SELECT installation_id, profile_id FROM log_owner").all();
  const actual = bindingSchema.parse(owner);
  if (duplicates.length || actual.installation_id !== binding.installation_id || actual.profile_id !== binding.profile_id) {
    throw new Error("log-database-owner-mismatch");
  }
}

function openLogReader(root: string, binding: ProfileDatabaseBinding, spec: typeof timeline | typeof dashboard, timeout: number) {
  const path = join(root, spec.file);
  const assertPrivateFiles = () => {
    validateFile(path, true);
    for (const suffix of ["-wal", "-shm", "-journal"]) validateFile(path + suffix, false);
    const { dev, ino } = fileStatus(path);
    return { device: dev, inode: ino };
  };
  const admitted = assertPrivateFiles();
  const assertSource = () => {
    if (!sameDirectory(admitted, assertPrivateFiles())) throw new Error("log-database-source-changed");
  };
  const db = openReadOnlyDatabase(path, timeout);
  try {
    if (pragmaInteger(db, "application_id") !== spec.applicationId || pragmaInteger(db, "user_version") !== spec.migrations.length) {
      throw new Error("log-database-version-mismatch");
    }
    if (journalMode(db) !== "wal") throw new Error("log-database-wal-unavailable");
    assertLogOwner(db, { installation_id: binding.installationId, profile_id: binding.profileId });
    assertSource();
    const position = db.prepare("SELECT cursor FROM log_position WHERE id=1");
    const withReadSnapshot = <T>(read: () => T): T => {
      if (db.isTransaction) return read();
      assertSource();
      const result = inTransaction(db, "BEGIN", read);
      assertSource();
      return result;
    };
    return {
      db, withReadSnapshot,
      highWaterMark: () => withReadSnapshot(() => LogPositionSchema.parse(position.get()).cursor),
      page: (input: z.input<typeof TimelinePageRequestSchema>) => {
        const request = TimelinePageRequestSchema.parse(input);
        if (spec === dashboard && request.spanTypes !== undefined) throw new Error("debug-page-span-types-unsupported");
        const predicates = ["cursor > ?"];
        const args: (string | number)[] = [request.after];
        if (request.through !== undefined) { predicates.push("cursor <= ?"); args.push(request.through); }
        if (request.runId !== undefined) { predicates.push("run_id = ?"); args.push(request.runId); }
        if (request.workflow !== undefined) { predicates.push("workflow = ?"); args.push(request.workflow); }
        if (request.spanTypes !== undefined) {
          predicates.push(`kind IN (${request.spanTypes.map(() => "?").join(",")})`);
          args.push(...request.spanTypes);
        }
        return withReadSnapshot(() => db.prepare(`SELECT * FROM ${spec.table} WHERE ${predicates.join(" AND ")} ORDER BY cursor LIMIT ?`)
          .all(...args, request.limit).map(spec.read));
      },
      close: () => db.close(), inTransaction: () => db.isTransaction,
    };
  } catch (error) { db.close(); throw error; }
}

const LogPositionSchema = z.strictObject({ cursor: z.number().int().nonnegative() });

export function openTimelineLogReader(root: string, binding: ProfileDatabaseBinding, timeout: number) {
  const { db, ...reader } = openLogReader(root, binding, timeline, timeout);
  return { ...reader,
    revision: () => reader.withReadSnapshot(() => z.strictObject({ data_version: z.number().int() }).parse(db.prepare("PRAGMA data_version").get()).data_version),
    runTimingRows: (runIds: readonly string[]) => reader.withReadSnapshot(() => db.prepare(`
      SELECT event.* FROM json_each(?) selection JOIN timeline_events event ON event.run_id=selection.value
      WHERE event.kind='run.queued' OR (event.kind='span.ended' AND json_extract(event.payload_json,'$.payload.event.kind')='run')
      ORDER BY event.cursor`).all(JSON.stringify(runIds)).map(timelineEventFromRow)),
    stepNoteKeys: (runId: string) => reader.withReadSnapshot(() => db.prepare(`
      SELECT cursor,id FROM timeline_events WHERE run_id=? AND kind='note'
      AND json_extract(payload_json,'$.payload.note.level')='step' ORDER BY cursor`).all(runId)
      .map(row => rowKeySchema.pick({ cursor: true, id: true }).parse(row))),
    searchStepNotes(query: string, runId?: string): readonly TimelineEventRecord[] {
      const text = z.string().trim().max(256).parse(query);
      if (text === "") return [];
      const scope = runId === undefined ? "" : " AND event.run_id=?";
      const args = runId === undefined ? [] : [runId];
      return reader.withReadSnapshot(() => {
        const rows = [...text].length >= 3
          ? db.prepare(`SELECT event.* FROM timeline_notes_fts JOIN timeline_events event ON event.cursor=timeline_notes_fts.rowid
            WHERE timeline_notes_fts MATCH ?${scope} ORDER BY event.cursor`).all(`"${text.replaceAll('"', '""')}"`, ...args)
          : db.prepare(`SELECT event.* FROM timeline_events event WHERE event.kind='note'
            AND json_extract(event.payload_json,'$.payload.note.level')='step'${scope} ORDER BY event.cursor`).all(...args);
        const needle = text.toLocaleLowerCase("en");
        return rows.map(timelineEventFromRow).filter(record => record.payload.kind === "note"
          && record.payload.note.message.toLocaleLowerCase("en").includes(needle));
      });
    },
  };
}

export function openDashboardLogReader(root: string, binding: ProfileDatabaseBinding, timeout: number) {
  const { db: _db, ...reader } = openLogReader(root, binding, dashboard, timeout);
  return reader;
}

function openSidecar(root: string, spec: typeof timeline | typeof dashboard, binding: z.infer<typeof bindingSchema>) {
  const path = join(root, spec.file);
  const present = validateFile(path, false);
  for (const suffix of ["-wal", "-shm", "-journal"]) validateFile(path + suffix, false);
  if (!present) closeSync(openSync(path, "wx", 0o600));
  const db = new DatabaseSync(path, { timeout: 5000, enableDoubleQuotedStringLiterals: false, allowExtension: false });
  try {
    const applicationId = pragmaInteger(db, "application_id");
    const version = pragmaInteger(db, "user_version");
    const empty = version === 0 && applicationId === 0
      && db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get() === undefined;
    if ((!empty && (applicationId !== spec.applicationId || version < 1)) || version > spec.migrations.length) {
      throw new Error("log-database-version-mismatch");
    }
    if (journalMode(db, true) !== "wal") throw new Error("log-database-wal-unavailable");
    db.exec("PRAGMA synchronous=NORMAL; PRAGMA secure_delete=ON");
    if (version < spec.migrations.length) {
      inTransaction(db, "BEGIN IMMEDIATE", () => {
        if (empty) {
          db.exec(`PRAGMA application_id=${spec.applicationId};
            CREATE TABLE log_owner (installation_id TEXT NOT NULL, profile_id TEXT NOT NULL) STRICT`);
          db.prepare("INSERT INTO log_owner VALUES (?,?)").run(binding.installation_id, binding.profile_id);
        }
        for (const [index, sql] of spec.migrations.entries()) {
          if (index < version) continue;
          db.exec(sql);
          db.exec(`PRAGMA user_version=${index + 1}`);
        }
      });
    }
    assertLogOwner(db, binding);
    const selectKey = db.prepare(`SELECT cursor,id,payload_json FROM ${spec.table} WHERE cursor=?`);
    const remove = db.prepare(`DELETE FROM ${spec.table} WHERE cursor=?`);
    const removeRun = db.prepare(`DELETE FROM ${spec.table} WHERE run_id=?`);
    const table = spec.table;
    let insert: ReturnType<DatabaseSync["prepare"]> | undefined;
    const append = (record: TimelineEventRecord, payload: unknown) => {
      const values = { ...spec.bind(record), payload_json: z.string().parse(payload) };
      const raw = selectKey.get(record.cursor);
      if (raw !== undefined) {
        const existing = rowKeySchema.parse(raw);
        if (existing.id !== record.eventId || existing.payload_json !== values.payload_json) {
          throw new Error("log-database-row-collision");
        }
        return;
      }
      const columns = Object.keys(values);
      insert ??= db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
      insert.run(...Object.values(values));
    };
    return { db, table, append, remove, removeRun, read: spec.read,
      keys: db.prepare(`SELECT cursor,id,payload_json FROM ${table} ORDER BY cursor`),
      clear: db.prepare(`DELETE FROM ${table}`),
      position: db.prepare("SELECT cursor,history FROM log_position WHERE id=1"),
      reset: db.prepare("UPDATE log_position SET cursor=0,history=? WHERE id=1"),
      advance: db.prepare("UPDATE log_position SET cursor=max(cursor,?) WHERE id=1"),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openLogDatabases(statePath: string, root: string) {
  const directory = fileStatus(root);
  if (!directory.isDirectory() || privatePathRejects(root, directory, "owner")) throw new Error("log-database-root-unsafe");
  validateFile(statePath, true);
  const state = openReadOnlyDatabase(statePath, 5000);
  const opened: ReturnType<typeof openSidecar>[] = [];
  const close = () => {
    const errors: unknown[] = [];
    for (const db of [state, ...opened.map(entry => entry.db)]) {
      try { db.close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "log-database-close-failed");
  };
  try {
    const binding = bindingSchema.parse(state.prepare("SELECT installation_id,profile_id FROM database_states WHERE id=1").get());
    const archivePath = historyArchivePath(root);
    const archive = fileStatus(archivePath, true);
    const archiveIdentity = archive === undefined ? "" : `${archive.dev}:${archive.ino}:${fileModified(archive)}:${archive.size}`;
    const offset = archive === undefined ? 0 : attachHistoryArchive(state, archivePath,
      { installationId: binding.installation_id, profileId: binding.profile_id }, "validate");
    opened.push(openSidecar(root, timeline, binding));
    opened.push(openSidecar(root, dashboard, binding));
    const tables = opened.map(sidecar => {
      const isTimeline = sidecar.table === "timeline_events";
      const source = isTimeline && archive !== undefined ? "temp.timeline_events" : `main.${sidecar.table}`;
      const predicate = isTimeline ? "kind<>'operation-confirmed'" : "1";
      return { ...sidecar, cursorOffset: isTimeline ? offset : 0, history: isTimeline ? archiveIdentity : "",
        sourceRow: state.prepare(`SELECT * FROM ${source} WHERE cursor=? AND ${predicate}`),
        sourceRows: state.prepare(`SELECT * FROM ${source} WHERE ${predicate} ORDER BY cursor`),
        sourcePosition: state.prepare("SELECT coalesce((SELECT seq FROM main.sqlite_sequence WHERE name=?),0) AS cursor"),
      };
    });
    return {
      pragmas: () => tables.map(({ db }) => ({ journalMode: journalMode(db), synchronous: pragmaInteger(db, "synchronous"),
        secureDelete: pragmaInteger(db, "secure_delete"), userVersion: pragmaInteger(db, "user_version") })),
      reconcile: (restoring = false) => inTransaction(state, "BEGIN", () => {
        for (const entry of tables) {
          const { db, keys, sourceRow, sourceRows, append, read, remove } = entry;
          inTransaction(db, "BEGIN IMMEDIATE", () => {
            const previous = LogPositionSchema.extend({ history: z.string() }).parse(entry.position.get());
            if (previous.history !== entry.history || restoring) {
              entry.clear.run();
              entry.reset.run(entry.history);
            }
            const stale: number[] = [];
            for (const raw of keys.iterate()) {
              const { cursor, id, payload_json: payload } = rowKeySchema.parse(raw);
              const source = sourceRow.get(cursor);
              if (source === undefined) stale.push(cursor);
              else if (source.id !== id || source.payload_json !== payload) {
                throw new Error("log-database-source-mismatch");
              }
            }
            for (const cursor of stale) remove.run(cursor);
            for (const row of sourceRows.iterate()) append(read(row), row.payload_json);
            entry.advance.run(LogPositionSchema.parse(entry.sourcePosition.get(entry.table)).cursor + entry.cursorOffset);
          });
        }
      }),
      apply: (mutations: readonly LogMutation[]) => inTransaction(state, "BEGIN", () => {
        for (const { db, table, sourceRow, append, read, remove, removeRun, advance, cursorOffset } of tables) {
          const relevant = mutations.filter(mutation => mutation.kind === "purge-runs"
            || (mutation.kind === "remove" ? mutation.table === table : (mutation.row.payload.kind === "debug") === (table === "debug_events")));
          if (!relevant.length) continue;
          inTransaction(db, "BEGIN IMMEDIATE", () => {
            for (const mutation of relevant) {
              if (mutation.kind === "remove") for (const cursor of mutation.cursors) remove.run(cursor + cursorOffset);
              else if (mutation.kind === "purge-runs") for (const runId of mutation.runIds) removeRun.run(runId);
              else {
                const cursor = mutation.row.cursor + cursorOffset;
                const source = sourceRow.get(cursor);
                if (source === undefined) continue;
                const committed = read(source);
                if (canonicalJsonStringify({ ...mutation.row, cursor }) !== canonicalJsonStringify(committed)) throw new Error("log-database-source-mismatch");
                append(committed, source.payload_json);
                advance.run(cursor);
              }
            }
          });
        }
      }),
      close,
    };
  } catch (error) {
    try { close(); }
    catch (failure) { throw new AggregateError([error, failure], "log-database-open-failed", { cause: failure }); }
    throw error;
  }
}

export function restoreLogDatabases(statePath: string, root: string): void {
  const snapshot = createReadonlyAuthoritySnapshot(statePath);
  try {
    const logs = openLogDatabases(snapshot.path, root);
    try { logs.reconcile(true); }
    finally { logs.close(); }
  } finally { snapshot.dispose(); }
}
