import { deepFreeze } from "../../domain/immutability.js";
import type { TableName, TableSpec } from "../../domain/authority.js";
import { AUTHORITY_TABLE_REGISTRY, TableNameSchema } from "../../domain/authority.js";

export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 1;

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

const TABLE_ORDER = [
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

export const SQLITE_MIGRATIONS = deepFreeze([{
  version: 1,
  statements: [
    ...TABLE_ORDER.map((name) => SQLITE_TABLE_DDL[name]),
    "CREATE INDEX dependencies_manifest_id_idx ON dependencies(manifest_id)",
    "CREATE INDEX command_audits_command_id_idx ON command_audits(command_id)",
    "CREATE INDEX write_attempts_intent_id_idx ON write_attempts(write_intent_id)",
    "CREATE INDEX durable_outbox_intent_id_idx ON durable_outbox(write_intent_id)",
  ],
}] as const);

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
