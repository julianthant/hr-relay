import { deepFreeze } from "../../domain/immutability.js";
import type { TableName, TableSpec } from "../../domain/authority.js";
import { AUTHORITY_TABLE_REGISTRY, TableNameSchema } from "../../domain/authority.js";

export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 9;

/** The run lifecycle states in which exactly one worker owns the row (doc 02 §4). */
const CLAIMED_STATE_SQL_LIST = "('claimed','validating','running')";
const CLAIM_COLUMNS_PRESENT = "NEW.owner_worker_id IS NOT NULL AND NEW.heartbeat_at IS NOT NULL";
const CLAIM_COLUMNS_ABSENT = "NEW.owner_worker_id IS NULL AND NEW.heartbeat_at IS NULL";
const RUN_CLAIM_CONSISTENCY = `
  (NEW.state IN ${CLAIMED_STATE_SQL_LIST} AND NOT (${CLAIM_COLUMNS_PRESENT}))
  OR (NEW.state NOT IN ${CLAIMED_STATE_SQL_LIST} AND NOT (${CLAIM_COLUMNS_ABSENT}))
  OR (NEW.state IN ${CLAIMED_STATE_SQL_LIST} AND NEW.claim_generation < 1)
`;
const RUN_REQUIRED_COLUMNS = `
  NEW.workflow IS NULL OR NEW.item_id IS NULL OR NEW.state IS NULL
  OR NEW.priority IS NULL OR NEW.attempt IS NULL OR NEW.version IS NULL
  OR NEW.claim_generation IS NULL
`;
const WORKER_REQUIRED_COLUMNS = `
  NEW.worker_id IS NULL OR NEW.workflow IS NULL OR NEW.lease_generation IS NULL
  OR NEW.state IS NULL OR NEW.directive IS NULL OR NEW.version IS NULL
`;

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
  run_terminal_authorizations: `
    CREATE TABLE run_terminal_authorizations (
      record_key TEXT PRIMARY KEY REFERENCES tasks(record_key) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('failed', 'done')),
      expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
      worker_id TEXT NOT NULL,
      claim_generation INTEGER NOT NULL CHECK (claim_generation >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  failures: `
    CREATE TABLE failures (
      record_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES tasks(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  run_results: `
    CREATE TABLE run_results (
      record_key TEXT PRIMARY KEY REFERENCES tasks(record_key) ON DELETE RESTRICT,
      workflow TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      result_digest TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  run_terminal_outbox: `
    CREATE TABLE run_terminal_outbox (
      record_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES run_results(record_key) ON DELETE RESTRICT,
      state TEXT NOT NULL CHECK (state IN ('pending', 'projected')),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  provider_budget_counters: `
    CREATE TABLE provider_budget_counters (
      record_key TEXT PRIMARY KEY,
      capability TEXT NOT NULL UNIQUE,
      minute_window_started_at TEXT NOT NULL,
      minute_requests INTEGER NOT NULL CHECK (minute_requests >= 0),
      day_window_started_at TEXT NOT NULL,
      day_requests INTEGER NOT NULL CHECK (day_requests >= 0),
      day_reserved_cost_usd_micros INTEGER NOT NULL CHECK (day_reserved_cost_usd_micros >= 0),
      active_reservations INTEGER NOT NULL CHECK (active_reservations >= 0),
      blocked_by_admission_id TEXT,
      version INTEGER NOT NULL CHECK (version >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  provider_admissions: `
    CREATE TABLE provider_admissions (
      record_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES tasks(record_key) ON DELETE RESTRICT,
      capability TEXT NOT NULL,
      config_snapshot_id TEXT NOT NULL REFERENCES config_snapshots(record_key) ON DELETE RESTRICT,
      config_fingerprint TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved','denied','settled','interrupted','lease-expired')),
      reserved_cost_usd_micros INTEGER NOT NULL CHECK (reserved_cost_usd_micros >= 0),
      actual_cost_usd_micros INTEGER CHECK (actual_cost_usd_micros >= 0),
      lease_expires_at TEXT,
      deadline_at TEXT,
      version INTEGER NOT NULL CHECK (version >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      CHECK ((state = 'reserved') = (lease_expires_at IS NOT NULL AND deadline_at IS NOT NULL)),
      CHECK ((state = 'settled') = (actual_cost_usd_micros IS NOT NULL))
    ) STRICT
  `,
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
  // Doc 13 §5.1. A plan is proposed, shown, and then consumed exactly once; the
  // consuming command carries only its id and fingerprints, so the plan itself
  // has to be durable or the confirmation would be trusting the client's copy.
  start_plans: `
    CREATE TABLE start_plans (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      consumed_by TEXT,
      expires_at TEXT NOT NULL,
      version INTEGER NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
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
const POST_V1_TABLE_ORDER = [
  "run_checkpoints",
  "start_plans",
  "failures",
  "run_results",
  "run_terminal_outbox",
  "run_terminal_authorizations",
  "provider_budget_counters",
  "provider_admissions",
] as const satisfies readonly TableName[];

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
  {
    // Doc 03 §2.3's task/claim store, typed. `tasks` holds runs and `leases`
    // holds worker leases; both were created as opaque JSON tables in v1 because
    // nothing wrote them before the executor existed.
    //
    // There is deliberately NO unique index over (workflow, item_id): a logical
    // item legitimately carries many runs — in-run attempts share a run id, and
    // a cross-run retry is a new run against the same item. "At most one ACTIVE
    // run per item" is descriptor policy (`enqueue`), and a workflow that
    // declares `allow-parallel` would break a schema-level uniqueness rule.
    version: 4,
    statements: [
      "ALTER TABLE tasks ADD COLUMN workflow TEXT",
      "ALTER TABLE tasks ADD COLUMN item_id TEXT",
      "ALTER TABLE tasks ADD COLUMN state TEXT",
      "ALTER TABLE tasks ADD COLUMN priority TEXT",
      "ALTER TABLE tasks ADD COLUMN attempt INTEGER",
      "ALTER TABLE tasks ADD COLUMN not_before TEXT",
      "ALTER TABLE tasks ADD COLUMN owner_worker_id TEXT",
      "ALTER TABLE tasks ADD COLUMN claim_generation INTEGER",
      "ALTER TABLE tasks ADD COLUMN heartbeat_at TEXT",
      "ALTER TABLE tasks ADD COLUMN version INTEGER",
      // The claim query: eligible rows for one workflow, priority then FIFO.
      "CREATE INDEX tasks_claim_idx ON tasks(workflow, state, priority, not_before, created_at)",
      // The dead-worker sweep: claimed rows whose heartbeat has gone stale.
      "CREATE INDEX tasks_heartbeat_idx ON tasks(state, heartbeat_at)",
      "CREATE INDEX tasks_item_idx ON tasks(workflow, item_id)",
      "CREATE INDEX tasks_owner_idx ON tasks(owner_worker_id)",
      `CREATE TRIGGER tasks_require_run_columns_insert
        BEFORE INSERT ON tasks
        WHEN ${RUN_REQUIRED_COLUMNS}
        BEGIN
          SELECT RAISE(ABORT, 'tasks requires workflow, item_id, state, priority, attempt, and version');
        END`,
      `CREATE TRIGGER tasks_require_run_columns_update
        BEFORE UPDATE OF workflow, item_id, state, priority, attempt, version, claim_generation ON tasks
        WHEN ${RUN_REQUIRED_COLUMNS}
        BEGIN
          SELECT RAISE(ABORT, 'tasks requires workflow, item_id, state, priority, attempt, and version');
        END`,
      // A claim exists exactly in the claimed states. This is the one-worker
      // ownership invariant expressed where no code path can route around it.
      `CREATE TRIGGER tasks_require_claim_consistency_insert
        BEFORE INSERT ON tasks
        WHEN ${RUN_CLAIM_CONSISTENCY}
        BEGIN
          SELECT RAISE(ABORT, 'tasks claim columns must be set exactly in claimed, validating, and running states');
        END`,
      `CREATE TRIGGER tasks_require_claim_consistency_update
        BEFORE UPDATE OF state, owner_worker_id, claim_generation, heartbeat_at ON tasks
        WHEN ${RUN_CLAIM_CONSISTENCY}
        BEGIN
          SELECT RAISE(ABORT, 'tasks claim columns must be set exactly in claimed, validating, and running states');
        END`,
      // Claim generation, attempt, and version only ever move forward. A fence
      // that could be rewound is not a fence.
      `CREATE TRIGGER tasks_monotonic_counters_update
        BEFORE UPDATE OF claim_generation, attempt, version ON tasks
        WHEN NEW.claim_generation < OLD.claim_generation
          OR NEW.attempt < OLD.attempt
          OR NEW.version <= OLD.version
        BEGIN
          SELECT RAISE(ABORT, 'tasks claim_generation, attempt, and version may only advance');
        END`,
      "ALTER TABLE leases ADD COLUMN worker_id TEXT",
      "ALTER TABLE leases ADD COLUMN workflow TEXT",
      "ALTER TABLE leases ADD COLUMN lease_generation INTEGER",
      "ALTER TABLE leases ADD COLUMN state TEXT",
      "ALTER TABLE leases ADD COLUMN directive TEXT",
      "ALTER TABLE leases ADD COLUMN heartbeat_at TEXT",
      "ALTER TABLE leases ADD COLUMN version INTEGER",
      "CREATE INDEX leases_workflow_state_idx ON leases(workflow, state)",
      `CREATE TRIGGER leases_require_worker_columns_insert
        BEFORE INSERT ON leases
        WHEN ${WORKER_REQUIRED_COLUMNS}
        BEGIN
          SELECT RAISE(ABORT, 'leases requires worker_id, workflow, lease_generation, state, directive, and version');
        END`,
      `CREATE TRIGGER leases_require_worker_columns_update
        BEFORE UPDATE OF worker_id, workflow, lease_generation, state, directive, version ON leases
        WHEN ${WORKER_REQUIRED_COLUMNS}
        BEGIN
          SELECT RAISE(ABORT, 'leases requires worker_id, workflow, lease_generation, state, directive, and version');
        END`,
      `CREATE TRIGGER leases_monotonic_counters_update
        BEFORE UPDATE OF lease_generation, version ON leases
        WHEN NEW.lease_generation < OLD.lease_generation OR NEW.version <= OLD.version
        BEGIN
          SELECT RAISE(ABORT, 'leases lease_generation and version may only advance');
        END`,
    ],
  },
  {
    // Start plans (doc 13 §5.1), plus the delegation edge every projection and
    // the tree-scoped cancel need. `parent_run_id` is a column rather than a
    // JSON extract because cancelling a group walks it.
    version: 5,
    statements: [
      SQLITE_TABLE_DDL.start_plans,
      "CREATE INDEX start_plans_workflow_idx ON start_plans(workflow, expires_at)",
      "ALTER TABLE tasks ADD COLUMN parent_run_id TEXT",
      "CREATE INDEX tasks_parent_idx ON tasks(parent_run_id)",
      `CREATE TRIGGER start_plans_monotonic_version_update
        BEFORE UPDATE OF version ON start_plans
        WHEN NEW.version <= OLD.version
        BEGIN
          SELECT RAISE(ABORT, 'start_plans version may only advance');
        END`,
      // A consumed plan is spent. Re-pointing it at a second command would let
      // one confirmation start two sets of runs.
      `CREATE TRIGGER start_plans_consume_once_update
        BEFORE UPDATE OF consumed_by ON start_plans
        WHEN OLD.consumed_by IS NOT NULL AND NEW.consumed_by IS NOT OLD.consumed_by
        BEGIN
          SELECT RAISE(ABORT, 'a start plan is consumed exactly once');
        END`,
    ],
  },
  {
    /*
     * D109 makes raw ingress a mandatory durable part of every start-plan
     * outcome. Pre-D109 records cannot be honestly upgraded: their canonical
     * input may be transformed and is not a substitute for raw operator input.
     * Plans are short-lived proposals, so invalidate them and require operators
     * to re-plan rather than fabricate historical ingress.
     */
    version: 6,
    statements: [
      "DELETE FROM start_plans",
    ],
  },
  {
    // D110/D114 terminal authority. Failed and successful settlements are
    // immutable facts; the composite repository writes one of these rows and
    // the matching terminal run transition in one outer transaction.
    version: 7,
    statements: [
      SQLITE_TABLE_DDL.failures,
      SQLITE_TABLE_DDL.run_results,
      SQLITE_TABLE_DDL.run_terminal_outbox,
      "CREATE INDEX failures_run_id_idx ON failures(run_id)",
      "CREATE INDEX run_results_workflow_attempt_idx ON run_results(workflow, attempt)",
    ],
  },
  {
    // The D110/D114 review repair preserves the exact pre-terminal CAS/claim
    // authorization separately from v7's released terminal facts. Existing v7
    // databases must execute this migration rather than look current by mistake.
    version: 8,
    statements: [
      SQLITE_TABLE_DDL.run_terminal_authorizations,
      "CREATE INDEX run_terminal_authorizations_kind_idx ON run_terminal_authorizations(kind)",
    ],
  },
  {
    // D112 generic durable provider admission. Production adapters and
    // consumers remain Phase 2h; these tables are capability-global authority.
    version: 9,
    statements: [
      SQLITE_TABLE_DDL.provider_budget_counters,
      SQLITE_TABLE_DDL.provider_admissions,
      "CREATE INDEX provider_admissions_capability_state_lease_idx ON provider_admissions(capability, state, lease_expires_at)",
      "CREATE INDEX provider_admissions_run_idx ON provider_admissions(run_id, capability, created_at)",
      `CREATE TRIGGER provider_budget_counters_monotonic_version_update
        BEFORE UPDATE OF version ON provider_budget_counters
        WHEN NEW.version <> OLD.version + 1
        BEGIN
          SELECT RAISE(ABORT, 'provider budget counter version must advance exactly once');
        END`,
      `CREATE TRIGGER provider_admissions_immutable_identity_update
        BEFORE UPDATE ON provider_admissions
        WHEN NEW.record_key IS NOT OLD.record_key
          OR NEW.run_id IS NOT OLD.run_id
          OR NEW.capability IS NOT OLD.capability
          OR NEW.config_snapshot_id IS NOT OLD.config_snapshot_id
          OR NEW.config_fingerprint IS NOT OLD.config_fingerprint
          OR NEW.request_fingerprint IS NOT OLD.request_fingerprint
          OR NEW.reserved_cost_usd_micros IS NOT OLD.reserved_cost_usd_micros
          OR NEW.created_at IS NOT OLD.created_at
        BEGIN
          SELECT RAISE(ABORT, 'provider admission immutable identity cannot change');
        END`,
      `CREATE TRIGGER provider_admissions_lifecycle_update
        BEFORE UPDATE OF state, version ON provider_admissions
        WHEN OLD.state <> 'reserved'
          OR NEW.state NOT IN ('settled','interrupted','lease-expired')
          OR NEW.version <> OLD.version + 1
        BEGIN
          SELECT RAISE(ABORT, 'provider admission may transition once from reserved to a terminal lifecycle');
        END`,
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
