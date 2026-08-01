import { deepFreeze } from "../../domain/immutability.js";
import type { TableName, TableSpec } from "../../domain/authority.js";
import { AUTHORITY_TABLE_REGISTRY, TableNameSchema } from "../../domain/authority.js";

export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 3;

const jsonRecordTable = (name: string): string => `
  CREATE TABLE ${name} (
    record_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    created_at TEXT NOT NULL
  ) STRICT
`;

export const SQLITE_TABLE_DDL = deepFreeze({
  authority_meta: `
    CREATE TABLE authority_meta (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      authority_generation INTEGER NOT NULL CHECK (authority_generation >= 0),
      updated_at TEXT NOT NULL,
      migration_owner TEXT,
      migration_started_at TEXT,
      CHECK ((migration_owner IS NULL) = (migration_started_at IS NULL))
    ) STRICT
  `,
  tasks: jsonRecordTable("tasks"),
  leases: jsonRecordTable("leases"),
  dependencies: `
    CREATE TABLE dependencies (
      record_key TEXT PRIMARY KEY,
      manifest_id TEXT NOT NULL REFERENCES delegation_manifests(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  delegation_manifests: jsonRecordTable("delegation_manifests"),
  commands: `
    CREATE TABLE commands (
      record_key TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  command_audits: `
    CREATE TABLE command_audits (
      record_key TEXT PRIMARY KEY,
      command_id TEXT NOT NULL REFERENCES commands(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  notifications: jsonRecordTable("notifications"),
  config_snapshots: jsonRecordTable("config_snapshots"),
  version_plans: jsonRecordTable("version_plans"),
  checkpoint_payloads: jsonRecordTable("checkpoint_payloads"),
  // Doc 02 §5.7. The logical item is (workflow, item_id) — retries share it,
  // rerun-with-new-input gets a fresh one — and the resume grain is a graph
  // NODE, so the doc's `step_id` column is `node_id` here. Payloads are
  // system-of-record under D14: pruned only on logical-item deletion, never on
  // the 7-day JSONL clock.
  run_checkpoints: `
    CREATE TABLE run_checkpoints (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      item_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      run_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (workflow, item_id, node_id, attempt)
    ) STRICT
  `,
  ocr_approvals: jsonRecordTable("ocr_approvals"),
  capture_sessions: jsonRecordTable("capture_sessions"),
  capture_photo_order: jsonRecordTable("capture_photo_order"),
  capture_finalization_outboxes: jsonRecordTable("capture_finalization_outboxes"),
  write_intents: `
    CREATE TABLE write_intents (
      record_key TEXT PRIMARY KEY,
      idempotency_key_digest TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  write_attempts: `
    CREATE TABLE write_attempts (
      record_key TEXT PRIMARY KEY,
      write_intent_id TEXT NOT NULL REFERENCES write_intents(record_key) ON DELETE RESTRICT,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (write_intent_id, generation)
    ) STRICT
  `,
  durable_outbox: `
    CREATE TABLE durable_outbox (
      record_key TEXT PRIMARY KEY,
      write_intent_id TEXT NOT NULL REFERENCES write_intents(record_key) ON DELETE RESTRICT,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      kind TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  artifact_outbox: jsonRecordTable("artifact_outbox"),
  artifact_sink_heads: jsonRecordTable("artifact_sink_heads"),
  spans: jsonRecordTable("spans"),
  gates: jsonRecordTable("gates"),
  notes: jsonRecordTable("notes"),
  runs_view: jsonRecordTable("runs_view"),
} as const satisfies Record<TableName, string>);

/** The tables migration 1 created, in dependency order. A released migration is never edited. */
const V1_TABLE_ORDER = [
  "authority_meta",
  "commands",
  "delegation_manifests",
  "write_intents",
  "tasks",
  "leases",
  "dependencies",
  "command_audits",
  "notifications",
  "config_snapshots",
  "version_plans",
  "checkpoint_payloads",
  "ocr_approvals",
  "capture_sessions",
  "capture_photo_order",
  "capture_finalization_outboxes",
  "write_attempts",
  "durable_outbox",
  "artifact_outbox",
  "artifact_sink_heads",
  "spans",
  "gates",
  "notes",
  "runs_view",
] as const satisfies readonly TableName[];

/** Tables created after v1, in the migration that created them. */
const POST_V1_TABLE_ORDER = ["run_checkpoints"] as const satisfies readonly TableName[];

const TABLE_ORDER = [...V1_TABLE_ORDER, ...POST_V1_TABLE_ORDER] as const satisfies readonly TableName[];

export const SQLITE_MIGRATIONS = deepFreeze([
  {
    // This is the committed Stage-B schema. Never edit a released migration in place.
    version: 1,
    statements: [
      ...V1_TABLE_ORDER.map((name) => SQLITE_TABLE_DDL[name]),
      "CREATE INDEX dependencies_manifest_id_idx ON dependencies(manifest_id)",
      "CREATE INDEX command_audits_command_id_idx ON command_audits(command_id)",
      "CREATE INDEX write_attempts_intent_id_idx ON write_attempts(write_intent_id)",
      "CREATE INDEX durable_outbox_intent_id_idx ON durable_outbox(write_intent_id)",
    ],
  },
  {
    version: 2,
    statements: [
      "ALTER TABLE write_intents ADD COLUMN system TEXT",
      "ALTER TABLE write_intents ADD COLUMN idempotency_key TEXT",
      "UPDATE write_intents SET system = json_extract(record_json, '$.system'), idempotency_key = json_extract(record_json, '$.idempotencyKey')",
      "CREATE UNIQUE INDEX write_intents_system_idempotency_key_idx ON write_intents(system, idempotency_key)",
      `CREATE TRIGGER write_intents_require_permanent_key_insert
        BEFORE INSERT ON write_intents
        WHEN NEW.system IS NULL OR NEW.idempotency_key IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'write_intents requires system and idempotency_key');
        END`,
      `CREATE TRIGGER write_intents_require_permanent_key_update
        BEFORE UPDATE OF system, idempotency_key ON write_intents
        WHEN NEW.system IS NULL OR NEW.idempotency_key IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'write_intents requires system and idempotency_key');
        END`,
    ],
  },
  {
    // Doc 02 §5.7's checkpoint store. The descending-attempt index is what makes
    // "latest compatible attempt wins" a lookup rather than a scan-and-sort.
    version: 3,
    statements: [
      SQLITE_TABLE_DDL.run_checkpoints,
      "CREATE INDEX run_checkpoints_item_node_idx ON run_checkpoints(workflow, item_id, node_id, attempt DESC)",
    ],
  },
] as const);

export function auditMigrationTableCoverage(): readonly string[] {
  const violations: string[] = [];
  const ddlNames = Object.keys(SQLITE_TABLE_DDL);
  const registeredNames = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name);
  for (const name of registeredNames) if (!ddlNames.includes(name)) violations.push(`registered table ${name} has no DDL`);
  for (const name of ddlNames) if (!registeredNames.includes(TableNameSchema.parse(name))) violations.push(`DDL table ${name} is not registered`);
  if (new Set(TABLE_ORDER).size !== TABLE_ORDER.length) violations.push("migration table order contains duplicates");
  for (const name of registeredNames) if (!TABLE_ORDER.includes(name)) violations.push(`registered table ${name} is absent from migration order`);
  return violations;
}

export function tableClassification(name: TableName): TableSpec["classification"] {
  const spec = AUTHORITY_TABLE_REGISTRY.find((entry) => entry.name === name);
  if (spec === undefined) throw new Error(`table ${name} has no authority classification`);
  return spec.classification;
}
