import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { CHANGE_LOG_SCHEMA_VERSION, ChangeEntrySchema, RUN_REFERENCE_SOURCES, RunReferenceSourceSchema, SingletonImageSchema, currentRowKey, expectedRunReferences, singletonChangeKeys, sourceRowWhere, type ChangeEntry, type DependencyKey, type RunReferenceSource, type SingletonImage } from "./authority-change-log.js";
import { AuthorityTableNameSchema, CHANGE_LOG_TABLE, RUN_REFERENCES_TABLE, type AuthorityTableName } from "../../../models/config/authority.js";
import { withoutNativeRecordReadMemo } from "./run-record-row.js";
import { createRunSearchIndex } from "./run-search-index.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";
import { readIntPragma } from "./authority-connection.js";
import { assertNativeSchema } from "./authority-inspection.js";
import { type StoredRow, validatedRowByRow, storedRowContext, validateStoredRow, validateAuthorityFamilies, invariantViolations, validateAuthorityRecordSchemas, assertRunReferences } from "./authority-stored-rows.js";

type Dependents = (database: DatabaseSync, key: DependencyKey) => readonly StoredRow[];

const RowsSchema = z.array(z.record(z.string(), z.unknown()));
function selectRows(database: DatabaseSync, sql: string, ...values: SQLInputValue[]): readonly StoredRow[] {
  return RowsSchema.parse(database.prepare(sql).all(...values));
}

const COLUMN_KEY_KINDS = ["run", "worker", "snapshot", "intent", "command", "chat"] as const;
type ColumnKeys = Readonly<Partial<Record<typeof COLUMN_KEY_KINDS[number], string>>>;

/** Rows of `table` whose column equals the key's value, for each key kind listed. */
function byColumn(table: AuthorityTableName, columns: ColumnKeys): Dependents {
  return (database, key) => {
    const kind = COLUMN_KEY_KINDS.find(candidate => key.startsWith(`${candidate}:`));
    const column = kind === undefined ? undefined : columns[kind];
    return kind === undefined || column === undefined ? [] : selectRows(database, `SELECT * FROM ${table} WHERE ${column}=?`, key.slice(kind.length + 1));
  };
}

/** Rows of a run reference source whose JSON names the key's run, found through `run_references`. */
function byRunReference(table: RunReferenceSource): Dependents {
  const join = currentRowKey(table).map((column, index) => `source.${column}=json_extract(reference.row_key,'$[${String(index)}]')`).join(" AND ");
  return (database, key) => key.startsWith("run:")
    ? selectRows(database, `SELECT source.* FROM ${RUN_REFERENCES_TABLE} AS reference JOIN ${table} AS source ON ${join} WHERE reference.run_id=? AND reference.table_name='${table}'`, key.slice(4))
    : [];
}

/**
 * The rows of `table` whose validator reads a row emitting `key`. Most validators read only their own row; the rest read rows
 * owned by the same run, a command's audit or a chat. The keys each row emits are generated SQL in the capture triggers.
 */
function tableDependents(database: DatabaseSync, table: AuthorityTableName, key: DependencyKey): readonly StoredRow[] {
  switch (table) {
    case "command_audits": return [...byColumn(table, { command: "command_id" })(database, key), ...byRunReference(table)(database, key)];
    case "write_intents": return [...byColumn(table, { run: "run_id", intent: "id" })(database, key), ...byRunReference(table)(database, key)];
    case "assistant_actions": return byColumn(table, { chat: "chat_id" })(database, key);
    case "run_results": case "run_receipts": case "timeline_events": case "run_search": return byColumn(table, { run: "run_id" })(database, key);
    default: return [];
  }
}

/** Parent runs read their delegated children's settlements, so a run key also reaches every ancestor. */
function withAncestorRuns(database: DatabaseSync, runs: Set<string>): void {
  const pending = [...runs];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const parent = z.object({ parent_id: z.string().nullable() }).optional().parse(database.prepare("SELECT parent_id FROM runs WHERE id=?").get(id))?.parent_id;
    if (parent != null && !runs.has(parent)) { runs.add(parent); pending.push(parent); }
  }
}

const SourceKeySchema = z.tuple([RunReferenceSourceSchema, z.string()]);
const RunIdRowsSchema = z.array(z.object({ run_id: z.string() }));

/** The runs one source row references: its stored links must equal what its current image implies, or the store is refused. */
function sourceRowRuns(database: DatabaseSync, table: RunReferenceSource, rowKey: string): readonly string[] {
  const stored = RunIdRowsSchema.parse(database.prepare(`SELECT run_id FROM ${RUN_REFERENCES_TABLE} WHERE table_name=? AND row_key=? ORDER BY run_id`).all(table, rowKey));
  const members = z.array(z.union([z.string(), z.number()])).parse(JSON.parse(rowKey));
  const expected = RunIdRowsSchema.parse(database.prepare(`SELECT DISTINCT run_id FROM (${expectedRunReferences(table, sourceRowWhere(table))}) ORDER BY run_id`)
    .all(...RUN_REFERENCE_SOURCES[table].flatMap(() => members)));
  if (canonicalJsonStringify(stored) !== canonicalJsonStringify(expected)) throw new Error(`run-references-mismatch: ${table} ${rowKey}`);
  return stored.map(({ run_id }) => run_id);
}

/** The logged changes after `after`, strictly parsed, in commit order. */
export function readAuthorityChanges(database: DatabaseSync, after: number, limit = -1): readonly ChangeEntry[] {
  return z.array(ChangeEntrySchema).parse(database.prepare(`SELECT seq,table_name,row_key,op,keys_json FROM ${CHANGE_LOG_TABLE} WHERE seq>? ORDER BY seq LIMIT ?`).all(after, limit));
}

/** The singleton fields a reader compares with the image it last validated; a missing singleton is refused. */
export function readSingletonImage(database: DatabaseSync): SingletonImage {
  return SingletonImageSchema.parse(database.prepare("SELECT search_state,search_generation,profile_id FROM database_states WHERE id=1").get());
}

/** The newest sequence number the change log ever issued; entries above a reader's cursor must run contiguously up to it. */
export function changeLogHighWater(database: DatabaseSync): number {
  return z.object({ seq: z.number().int().nonnegative() }).optional().parse(database.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(CHANGE_LOG_TABLE))?.seq ?? 0;
}

function authorityChangeClosure() {
  return { keys: new Set<DependencyKey>(), rows: new Map<string, { table: AuthorityTableName; rowKey: ChangeEntry["rowKey"] }>(), searchRuns: new Set<string>(),
    payloads: new Set<string>() };
}

function includeAuthorityChange(closure: ReturnType<typeof authorityChangeClosure>, entry: ChangeEntry): void {
  const { table, rowKey } = entry;
  for (const key of entry.keys) closure.keys.add(key);
  if (table === "run_search") closure.searchRuns.add(String(rowKey[0]));
  if (table === "workbook_payloads" && entry.op !== "delete") closure.payloads.add(String(rowKey[0]));
  if (entry.op !== "delete" && table !== RUN_REFERENCES_TABLE && validatedRowByRow(table)) {
    closure.rows.set(`${table}:${JSON.stringify(rowKey)}`, { table, rowKey });
  }
}

/** Change-log entries read per page; each page's closure is validated on its own, so one scoped check covers at most this many. */
export const CHANGE_LOG_PAGE_ENTRIES = 1_000;

/** One closure per unread change-log page, or `undefined` on a gap; with nothing unread, one empty closure re-checks the singleton. */
function readAuthorityChangePages(database: DatabaseSync, after: number, high: number, observe?: (entry: ChangeEntry) => void) {
  const tail = z.strictObject({ first: z.number().nullable(), last: z.number().nullable() }).parse(database.prepare(`SELECT
    (SELECT seq FROM ${CHANGE_LOG_TABLE} WHERE seq>? ORDER BY seq LIMIT 1) AS first,
    (SELECT seq FROM ${CHANGE_LOG_TABLE} WHERE seq>? ORDER BY seq DESC LIMIT 1) AS last`).get(after, after));
  if (high < after || (high === after ? tail.first !== null : tail.first !== after + 1 || tail.last !== high)) return undefined;

  const closures = [authorityChangeClosure()];
  let cursor = after;
  while (cursor < high) {
    const page = readAuthorityChanges(database, cursor, CHANGE_LOG_PAGE_ENTRIES);
    if (page.length !== Math.min(high - cursor, CHANGE_LOG_PAGE_ENTRIES)) return undefined;
    const closure = cursor === after ? closures[0] : authorityChangeClosure();
    if (closure !== closures[0]) closures.push(closure);
    for (const entry of page) {
      if (entry.seq !== cursor + 1) return undefined;
      includeAuthorityChange(closure, entry);
      observe?.(entry);
      cursor = entry.seq;
    }
  }
  return closures;
}

/** Entries kept for readers that fall behind; older ones are pruned, and a reader below the floor runs the whole-store check. */
export const CHANGE_LOG_RETAINED_ENTRIES = 10_000;
export const CHANGE_LOG_PRUNE_INTERVAL_MS = 60_000;

/**
 * One connection's position in the change log. Every entry at or below `cursor` is validated or the connection's own;
 * `wholeStore` is set after a schema move or a gap, until a whole-store check passes; `failed` records the last refusal;
 * `settled` is the position a passing search-`none` admit reached, which a restart rebuild's commit settles to.
 */
export type ChangeLogReader = { cursor: number; schemaCookie: number; singleton: SingletonImage; wholeStore: boolean;
  failed: "authority" | "projection-only" | undefined; settled: Readonly<{ cursor: number; dataVersion: number }> | undefined };

export function changeLogBaseline(database: DatabaseSync): ChangeLogReader {
  return { cursor: changeLogHighWater(database), schemaCookie: readIntPragma(database, "schema_version"), singleton: readSingletonImage(database),
    wholeStore: false, failed: undefined, settled: undefined };
}

export function admitChanges(database: DatabaseSync, reader: ChangeLogReader, search: "all" | "progress" | "none", observed: number,
  observe?: (entry: ChangeEntry) => void) {
  const cookie = readIntPragma(database, "schema_version"), schemaMoved = cookie !== reader.schemaCookie;
  // Entries may be missing while the schema differed, so a schema move is checked whole.
  if (schemaMoved) reader.wholeStore = true;
  const high = changeLogHighWater(database);
  const closures = reader.wholeStore ? undefined : readAuthorityChangePages(database, reader.cursor, high, observe);
  if (closures === undefined) reader.wholeStore = true;
  const singleton = readSingletonImage(database);
  const check = closures === undefined
    ? (value: typeof search) => { validateAuthorityStore(database, value); }
    : (value: typeof search) => { validateAuthorityChangePages(database, closures, singletonChangeKeys(reader.singleton, singleton), value); };
  try { check(search); }
  catch (error) {
    // The refusal is rethrown either way; this only names which half failed.
    reader.failed = "authority";
    if (search !== "none") { try { check("none"); reader.failed = "projection-only"; } catch { /* the authority rows fail on their own */ } }
    throw error;
  }
  if (schemaMoved) {
    // After the rows: a bad row reports its own refusal. Any schema difference refuses even when every row is valid, now and on
    // every later read, since the cookie is recorded only once the whole schema matches.
    try { assertNativeSchema(database, CURRENT_AUTHORITY_SCHEMA_VERSION); }
    catch (error) { reader.failed = "authority"; throw error; }
    reader.schemaCookie = cookie;
  }
  if (search === "none") {
    if (reader.failed === "authority") reader.failed = "projection-only";
    reader.settled = { cursor: high, dataVersion: observed };
    return;
  }
  if (search === "progress") return;
  Object.assign(reader, { cursor: high, singleton, wholeStore: false, failed: undefined, settled: undefined });
  return closures !== undefined;
}

/**
 * How a reader re-validated a set of changes: `scoped` checked only their closure; `whole` ran the whole-store check because a
 * change reaches every row of a kind (a completed search publication or a profile change).
 */
export type AuthorityChangeRoute = "scoped" | "whole";

/**
 * Re-validates exactly the units a set of logged changes can affect: each changed row's current image, every row whose
 * validator reads a changed row, the families they belong to, the invariants and search coverage of their keys. Throws
 * whenever the whole-store check (`validateAuthorityStore`) would throw for the same store. `singletonKeys` are the keys of
 * the singleton's change since the reader last validated it (`singletonChangeKeys`).
 */
export function validateAuthorityChanges(database: DatabaseSync, entries: readonly ChangeEntry[], singletonKeys: readonly DependencyKey[],
  search: "all" | "progress" | "none" = "all"): AuthorityChangeRoute {
  const pages = Array.from({ length: Math.max(1, Math.ceil(entries.length / CHANGE_LOG_PAGE_ENTRIES)) }, (_, page) => {
    const closure = authorityChangeClosure();
    for (const entry of entries.slice(page * CHANGE_LOG_PAGE_ENTRIES, (page + 1) * CHANGE_LOG_PAGE_ENTRIES)) includeAuthorityChange(closure, entry);
    return closure;
  });
  return validateAuthorityChangePages(database, pages, singletonKeys, search);
}

/**
 * Validates each page's closure on its own, so one scoped check never covers more than one page; this equals validating their
 * union, since every check reads current rows, except the build-prefix check, which is given every page's changed search rows.
 * A whole-store route covers the remaining pages.
 */
function validateAuthorityChangePages(database: DatabaseSync, pages: readonly ReturnType<typeof authorityChangeClosure>[],
  singletonKeys: readonly DependencyKey[], search: "all" | "progress" | "none"): AuthorityChangeRoute {
  // The build-prefix check must see every changed search row: a row another page changed is not an unchanged prefix end.
  const searchRuns = new Set(pages.flatMap(page => [...page.searchRuns]));
  return pages.some(page => validateAuthorityChangeClosure(database, { ...page, searchRuns }, singletonKeys, search) === "whole") ? "whole" : "scoped";
}

function validateAuthorityChangeClosure(database: DatabaseSync, closure: ReturnType<typeof authorityChangeClosure>,
  singletonKeys: readonly DependencyKey[], search: "all" | "progress" | "none"): AuthorityChangeRoute {
  return withoutNativeRecordReadMemo(() => validateStoredChanges(database, closure, singletonKeys, search));
}

function validateStoredChanges(database: DatabaseSync, closure: ReturnType<typeof authorityChangeClosure>,
  singletonKeys: readonly DependencyKey[], search: "all" | "progress" | "none"): AuthorityChangeRoute {
  const keys = new Set<DependencyKey>([...closure.keys, ...singletonKeys]);
  const searchReady = z.object({ search_state: z.string() }).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready";
  if (keys.has("profile") || (keys.has("search-publication") && searchReady)) {
    validateAuthorityStore(database, search);
    return "whole";
  }
  const context = storedRowContext(database, CURRENT_AUTHORITY_SCHEMA_VERSION);
  const ofKind = (kind: string) => new Set([...keys].flatMap(key => key.startsWith(`${kind}:`) ? [key.slice(kind.length + 1)] : []));
  const runs = ofKind("run");
  for (const source of ofKind("source")) {
    const [table, rowKey] = SourceKeySchema.parse(JSON.parse(source));
    for (const run of sourceRowRuns(database, table, rowKey)) runs.add(run);
  }
  for (const item of ofKind("item")) {
    const [workflow, itemId] = z.tuple([z.string(), z.string()]).parse(JSON.parse(item));
    for (const { id } of z.array(z.object({ id: z.string() })).parse(database.prepare("SELECT id FROM runs WHERE workflow=? AND item_id=?").all(workflow, itemId))) runs.add(id);
  }
  withAncestorRuns(database, runs);
  for (const run of runs) keys.add(`run:${run}`);
  const units = new Map<AuthorityTableName, Map<string, StoredRow>>();
  const addUnit = (table: AuthorityTableName, row: StoredRow) => {
    const rows = units.get(table) ?? new Map<string, StoredRow>();
    units.set(table, rows.set(canonicalJsonStringify(currentRowKey(table).map(column => row[column])), row));
  };
  // The singleton has no capture triggers, since every write moves it: its one row is re-validated on every admit.
  const singleton = database.prepare("SELECT * FROM database_states WHERE id=1").get();
  if (singleton === undefined) throw new Error("authority-singleton-missing");
  addUnit("database_states", singleton);
  for (const { table, rowKey } of closure.rows.values()) {
    const current = database.prepare(`SELECT * FROM ${table} WHERE ${currentRowKey(table).map(column => `${column}=?`).join(" AND ")}`).get(...rowKey);
    if (current !== undefined) addUnit(table, current);
  }
  for (const key of keys) for (const table of AuthorityTableNameSchema.options) {
    if (validatedRowByRow(table)) for (const row of tableDependents(database, table, key)) addUnit(table, row);
  }
  for (const [table, rows] of units) {
    if (table === "run_search" && (search !== "all" || !searchReady)) continue;
    for (const row of rows.values()) validateStoredRow(context, table, row);
  }
  // Payloads are immutable and kept while named, so only the logged ones can have changed since the last check.
  validateAuthorityFamilies(context, true, new Set([...ofKind("family")].map(family => z.enum(["workbook", "assistant-preference", "settings"]).parse(family))), closure.payloads);
  const violations = invariantViolations(database, { run: runs, worker: ofKind("worker"), snapshot: ofKind("snapshot"), intent: ofKind("intent"), command: ofKind("command") });
  if (violations.length > 0) throw new Error("current composite authority is invalid");
  if (search === "none") return "scoped";
  const index = createRunSearchIndex(database);
  if (keys.has("search-publication")) index.validateCoverage();
  else index.validateCoverageOf(runs, closure.searchRuns);
  return "scoped";
}

/** The whole-store check a reader runs after another connection commits. */
export function validateAuthorityStore(database: DatabaseSync, search: "all" | "progress" | "none" = "all"): void {
  withoutNativeRecordReadMemo(() => {
    validateAuthorityRecordSchemas(database, search === "all");
    if (readIntPragma(database, "user_version") >= CHANGE_LOG_SCHEMA_VERSION) assertRunReferences(database);
    const violations = invariantViolations(database);
    if (violations.length > 0) throw new Error("current composite authority is invalid");
    if (search !== "none") createRunSearchIndex(database).validateCoverage();
  });
}
