import { z } from "zod";
import { AuthorityTableNameSchema, CHANGE_LOG_TABLE, RUN_REFERENCES_TABLE, type AuthorityTableName } from "../../../models/config/authority.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";

/**
 * The change log: every authority table carries persistent capture triggers that append one `authority_changes` entry
 * per changed row, inside the writing transaction and for every connection. An entry names the row and the dependency
 * keys of its old and new images, so a reader re-validates only the closure of what changed since its cursor.
 */
export const CHANGE_LOG_SCHEMA_VERSION = 31;

/**
 * A key a stored row image emits. `run`, `worker`, `snapshot` and `intent` scope the invariants and search coverage;
 * `item` reaches every run of one work item, whose replays read each other's checkpoints; `source` names the row a run
 * reference was derived from; the others find the rows whose validator reads the changed row.
 */
export const DependencyKeySchema = z.union([
  z.templateLiteral([z.enum(["run", "item", "worker", "snapshot", "intent", "command", "chat", "family", "source"]), ":", z.string().min(1)]),
  z.enum(["profile", "search-publication"]),
]);
export type DependencyKey = z.infer<typeof DependencyKeySchema>;

function jsonText<T extends z.ZodType>(schema: T) {
  return z.string().transform((text, context) => {
    try { const value: unknown = JSON.parse(text); return value; }
    catch { context.addIssue({ code: "custom", message: "change-entry-json-invalid" }); return z.NEVER; }
  }).pipe(schema);
}

/** One stored change entry, strictly parsed: a NULL key is a column that held no text, which emits nothing. */
export const ChangeEntrySchema = z.strictObject({
  seq: z.number().int().positive(),
  table_name: z.union([AuthorityTableNameSchema.exclude(["database_states"]), z.literal(RUN_REFERENCES_TABLE)]),
  row_key: jsonText(z.array(z.union([z.string(), z.number()])).min(1)),
  op: z.enum(["insert", "update", "delete"]),
  keys_json: jsonText(z.array(DependencyKeySchema.nullable())),
}).transform(entry => deepFreeze({ seq: entry.seq, table: entry.table_name, rowKey: entry.row_key, op: entry.op,
  keys: entry.keys_json.filter(key => key !== null) }));
export type ChangeEntry = z.infer<typeof ChangeEntrySchema>;

/** The singleton fields whose change reaches other rows: the search publication and the profile. */
export const SingletonImageSchema = z.object({ search_state: z.string(), search_generation: z.number().nullable(), profile_id: z.string() });
export type SingletonImage = z.infer<typeof SingletonImageSchema>;

/** The keys a singleton change emits: only a changed search publication or profile reaches other rows. */
export function singletonChangeKeys(before: SingletonImage, after: SingletonImage): DependencyKey[] {
  return [
    ...(before.search_state !== after.search_state || (after.search_state !== "ready" && before.search_generation !== after.search_generation) ? ["search-publication" as const] : []),
    ...(before.profile_id !== after.profile_id ? ["profile" as const, "family:assistant-preference" as const] : []),
  ];
}

/** The columns of each table's primary key at the current schema, in the order a change entry's `row_key` lists them. */
export function currentRowKey(table: AuthorityTableName): readonly string[] {
  switch (table) {
    case "deleted_runs": case "run_search": return ["run_id"];
    case "worker_pools": return ["workflow"];
    case "workflow_workbook_selections": return ["workflow_id"];
    case "workbook_library_history": return ["workbook_id", "version", "name"];
    case "workbook_operations": return ["sequence"];
    case "auth_leases": return ["credential_key"];
    case "timeline_events": return ["cursor"];
    default: return ["id"];
  }
}

type Image = "OLD" | "NEW";
const KEY_COLUMN_KINDS = ["run", "worker", "snapshot", "intent", "command", "chat"] as const;
type KeyColumns = Readonly<Partial<Record<typeof KEY_COLUMN_KINDS[number], string>>>;

/** SQL for the keys a column emits: a text value becomes `<kind>:<value>`; anything else emits NULL, which readers drop. */
const columns = (keys: KeyColumns) => (image: Image): string[] => KEY_COLUMN_KINDS.flatMap(kind => {
  const column = keys[kind];
  return column === undefined ? [] : [`CASE WHEN typeof(${image}.${column})='text' THEN '${kind}:'||${image}.${column} END`];
});
const constant = (...keys: readonly DependencyKey[]) => (): string[] => keys.map(key => `'${key}'`);
/** A command request's family keys: settings commands and initializations, and assistant model preferences. */
const requestFamilies = (json: (image: Image) => string, path: string) => (image: Image): string[] => [
  `CASE WHEN json_extract(${json(image)},'${path}.family')='settings' OR json_extract(${json(image)},'${path}.kind')='settings-initialization' THEN 'family:settings' END`,
  `CASE WHEN json_extract(${json(image)},'${path}.family')='assistant-model-preference' THEN 'family:assistant-preference' END`,
];
const all = (...parts: readonly ((image: Image) => string[])[]) => (image: Image): string[] => parts.flatMap(part => part(image));
const none = (): string[] => [];

/**
 * The keys each table's images emit, as SQL over `OLD` or `NEW`. Runs named inside JSON are not listed here: they reach
 * the log through `run_references`, whose own entries carry them. `database_states` has no entry: readers compare the
 * singleton with the image they last validated.
 */
const TABLE_KEYS = deepFreeze<Record<Exclude<AuthorityTableName, "database_states">, (image: Image) => string[]>>({
  assistant_model_preference: constant("family:assistant-preference"),
  database_upgrades: none,
  settings_snapshots: constant("family:settings"),
  commands: all(columns({ command: "id", run: "target_id" }), requestFamilies(image => `${image}.request_json`, "$")),
  command_audits: all(columns({ command: "command_id" }), requestFamilies(image => `${image}.payload_json`, "$.request")),
  settings: constant("family:settings"),
  assistant_chats: columns({ chat: "id" }),
  assistant_actions: columns({ chat: "chat_id" }),
  assistant_conversations: none,
  assistant_messages: none,
  assistant_attachments: none,
  run_batches: none,
  deleted_runs: columns({ run: "run_id", command: "command_id" }),
  runs: columns({ run: "id", worker: "owner_worker_id" }),
  run_requests: none,
  run_delegations: columns({ run: "parent_run_id" }),
  delegation_dependencies: none,
  run_checkpoints: all(columns({ run: "run_id" }), image => [`'item:'||json_array(${image}.workflow,${image}.item_id)`]),
  gate_results: columns({ run: "run_id" }),
  run_results: columns({ run: "run_id" }),
  run_failures: columns({ run: "run_id" }),
  run_receipts: columns({ run: "run_id" }),
  write_intents: columns({ run: "run_id", intent: "id" }),
  write_attempts: columns({ run: "run_id", intent: "intent_id" }),
  worker_pools: none,
  worker_slots: none,
  auth_leases: none,
  exclusive_session_leases: none,
  ocr_review_revisions: columns({ run: "run_id" }),
  ocr_source_uploads: none,
  ocr_approved_snapshots: columns({ run: "run_id" }),
  notifications: none,
  notification_states: none,
  artifacts: none,
  timeline_events: columns({ run: "run_id", intent: "operation_id" }),
  diagnostic_snapshots: columns({ run: "run_id", snapshot: "id" }),
  diagnostic_files: columns({ snapshot: "snapshot_id" }),
  dryrun_results: columns({ run: "run_id" }),
  run_search: columns({ run: "run_id" }),
  workflow_workbook_selections: none,
  workbook_creations: constant("family:workbook"),
  workbook_types: constant("family:workbook"),
  workbook_operations: constant("family:workbook"),
  workbook_library: constant("family:workbook"),
  workbook_library_history: constant("family:workbook"),
  workbook_library_state: constant("family:workbook"),
  workbook_library_actions: constant("family:workbook"),
  workbook_library_snapshots: constant("family:workbook"),
});

/** The JSON columns whose `runId` members, at any depth, `run_references` indexes: the journal names runs only inside JSON. */
export const RUN_REFERENCE_SOURCES = deepFreeze({
  commands: ["request_json", "outcome_json"],
  command_audits: ["payload_json"],
  write_intents: ["publication_json"],
  workbook_operations: ["request_json", "receipt_json"],
} satisfies Partial<Record<AuthorityTableName, readonly string[]>>);
export type RunReferenceSource = keyof typeof RUN_REFERENCE_SOURCES;
export const RunReferenceSourceSchema = z.enum(["commands", "command_audits", "write_intents", "workbook_operations"]);

const rowKey = (table: AuthorityTableName, image: string) => `json_array(${currentRowKey(table).map(column => `${image}.${column}`).join(",")})`;

/** The run ids one image of a source row references, as a SELECT of `value`; invalid JSON references nothing and is refused by row validation. */
export function runReferenceSelect(table: RunReferenceSource, image: string): string {
  return RUN_REFERENCE_SOURCES[table].map(column =>
    `SELECT value FROM json_tree(CASE WHEN json_valid(${image}.${column}) THEN ${image}.${column} END) WHERE key='runId' AND type='text'`).join(" UNION ");
}

/** A source row's own `source:` key, in the text form `run_references` entries carry: its table and its row key as JSON text. */
const sourceKey = (table: RunReferenceSource, image: string) => `'source:'||json_array('${table}',${rowKey(table, image)}||'')`;
const isRunReferenceSource = (table: AuthorityTableName): table is RunReferenceSource => RunReferenceSourceSchema.safeParse(table).success;

/**
 * The references the source rows of `table` imply, as `SELECT run_id,table_name,row_key`; `where` narrows the source rows
 * (alias `source`). The stored link must equal this set exactly.
 */
export function expectedRunReferences(table: RunReferenceSource, where = ""): string {
  return RUN_REFERENCE_SOURCES[table].map(column => `SELECT reference.value AS run_id,'${table}' AS table_name,${rowKey(table, "source")}||'' AS row_key FROM ${table} AS source,
      json_tree(CASE WHEN json_valid(source.${column}) THEN source.${column} END) AS reference
    WHERE reference.key='runId' AND reference.type='text'${where === "" ? "" : ` AND (${where})`}`).join(" UNION ");
}

/** The key columns of a source row, as a WHERE clause over alias `source` taking the row key's members as parameters. */
export function sourceRowWhere(table: RunReferenceSource): string {
  return currentRowKey(table).map(column => `source.${column}=?`).join(" AND ");
}

function captureTriggers(table: Exclude<AuthorityTableName, "database_states">): string[] {
  const keys = (image: Image) => [...TABLE_KEYS[table](image), ...(isRunReferenceSource(table) ? [sourceKey(table, image)] : [])];
  const entry = (op: "insert" | "update" | "delete", image: Image, keySql: readonly string[]) =>
    `INSERT INTO ${CHANGE_LOG_TABLE}(table_name,row_key,op,keys_json) VALUES('${table}',${rowKey(table, image)},'${op}',json_array(${keySql.join(",")}))`;
  return [
    `CREATE TRIGGER ${table}_change_insert AFTER INSERT ON ${table} BEGIN ${entry("insert", "NEW", keys("NEW"))}; END`,
    `CREATE TRIGGER ${table}_change_update AFTER UPDATE ON ${table} BEGIN ${entry("update", "NEW", [...keys("OLD"), ...keys("NEW")])}; END`,
    `CREATE TRIGGER ${table}_change_delete AFTER DELETE ON ${table} BEGIN ${entry("delete", "OLD", keys("OLD"))}; END`,
  ];
}

function runReferenceTriggers(table: RunReferenceSource): string[] {
  const links = (image: Image) => `INSERT OR IGNORE INTO ${RUN_REFERENCES_TABLE}(run_id,table_name,row_key) SELECT value,'${table}',${rowKey(table, image)} FROM (${runReferenceSelect(table, image)})`;
  const unlink = `DELETE FROM ${RUN_REFERENCES_TABLE} WHERE table_name='${table}' AND row_key=${rowKey(table, "OLD")}`;
  const changed = [...currentRowKey(table), ...RUN_REFERENCE_SOURCES[table]].map(column => `OLD.${column} IS NOT NEW.${column}`).join(" OR ");
  return [
    `CREATE TRIGGER ${table}_run_references_insert AFTER INSERT ON ${table} BEGIN ${links("NEW")}; END`,
    `CREATE TRIGGER ${table}_run_references_update AFTER UPDATE ON ${table} WHEN ${changed} BEGIN ${unlink}; ${links("NEW")}; END`,
    `CREATE TRIGGER ${table}_run_references_delete AFTER DELETE ON ${table} BEGIN ${unlink}; END`,
  ];
}

function runReferenceCaptureTriggers(): string[] {
  const keys = (image: Image) => [`'run:'||${image}.run_id`, `'source:'||json_array(${image}.table_name,${image}.row_key)`];
  const entry = (op: "insert" | "update" | "delete", image: Image, keySql: readonly string[]) =>
    `INSERT INTO ${CHANGE_LOG_TABLE}(table_name,row_key,op,keys_json) VALUES('${RUN_REFERENCES_TABLE}',json_array(${image}.run_id,${image}.table_name,${image}.row_key),'${op}',json_array(${keySql.join(",")}))`;
  return [
    `CREATE TRIGGER ${RUN_REFERENCES_TABLE}_change_insert AFTER INSERT ON ${RUN_REFERENCES_TABLE} BEGIN ${entry("insert", "NEW", keys("NEW"))}; END`,
    `CREATE TRIGGER ${RUN_REFERENCES_TABLE}_change_update AFTER UPDATE ON ${RUN_REFERENCES_TABLE} BEGIN ${entry("update", "NEW", [...keys("OLD"), ...keys("NEW")])}; END`,
    `CREATE TRIGGER ${RUN_REFERENCES_TABLE}_change_delete AFTER DELETE ON ${RUN_REFERENCES_TABLE} BEGIN ${entry("delete", "OLD", keys("OLD"))}; END`,
  ];
}

const SOURCES = RunReferenceSourceSchema.options;

/**
 * Migration 31. Adds the change log and the run references with their backfill, the capture and reference triggers, and
 * the indexes the scoped check's lookups need. No existing row is rewritten.
 */
export const CHANGE_LOG_MIGRATION = deepFreeze({ version: CHANGE_LOG_SCHEMA_VERSION, statements: [
  `CREATE TABLE ${CHANGE_LOG_TABLE} (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL CHECK(json_valid(row_key) AND json_type(row_key)='array'),
    op TEXT NOT NULL CHECK(op IN ('insert','update','delete')),
    keys_json TEXT NOT NULL CHECK(json_valid(keys_json) AND json_type(keys_json)='array')
  ) STRICT`,
  `CREATE TABLE ${RUN_REFERENCES_TABLE} (
    run_id TEXT NOT NULL,
    table_name TEXT NOT NULL CHECK(table_name IN (${SOURCES.map(source => `'${source}'`).join(",")})),
    row_key TEXT NOT NULL CHECK(json_valid(row_key) AND json_type(row_key)='array'),
    PRIMARY KEY(run_id,table_name,row_key)
  ) STRICT`,
  `CREATE INDEX ${RUN_REFERENCES_TABLE}_row_idx ON ${RUN_REFERENCES_TABLE}(table_name,row_key)`,
  ...SOURCES.map(table => `INSERT OR IGNORE INTO ${RUN_REFERENCES_TABLE}(run_id,table_name,row_key) ${expectedRunReferences(table)}`),
  "CREATE INDEX runs_owner_idx ON runs(owner_worker_id,state)",
  "CREATE INDEX dryrun_results_run_idx ON dryrun_results(run_id)",
  "CREATE INDEX assistant_actions_chat_idx ON assistant_actions(chat_id)",
  "CREATE INDEX workbook_library_snapshots_workbook_idx ON workbook_library_snapshots(workbook_id,id)",
  "CREATE INDEX commands_request_family_idx ON commands(json_extract(request_json,'$.family'))",
  "CREATE INDEX run_search_build_idx ON run_search(json_extract(metadata_json,'$.buildGeneration'),run_id)",
  ...AuthorityTableNameSchema.options.flatMap(table => table === "database_states" ? [] : captureTriggers(table)),
  ...runReferenceCaptureTriggers(),
  ...SOURCES.flatMap(runReferenceTriggers),
] });

/** Every schema object migration 31 creates, by name. */
export const CHANGE_LOG_OBJECTS: readonly string[] = deepFreeze(CHANGE_LOG_MIGRATION.statements.flatMap(statement => {
  const name = /^CREATE (?:TABLE|INDEX|TRIGGER) (\w+)/u.exec(statement)?.[1];
  return name === undefined ? [] : [name];
}));
