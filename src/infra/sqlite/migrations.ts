import { deepFreeze } from "../../domain/immutability.js";
import type { TableName, TableSpec } from "../../domain/authority.js";
import { AUTHORITY_TABLE_REGISTRY, TableNameSchema } from "../../domain/authority.js";

export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 15;

/** The run lifecycle states in which exactly one worker owns the row (ref workflow-model §4). */
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
  // Ref operator-trust §2.2. A bundle is content-addressed and pinned or purged EXPLICITLY:
  // `purge_after` exists exactly when retention is ordinary, and an
  // operator-requested bundle is the one origin that carries no failure.
  diagnostic_bundles: `
    CREATE TABLE diagnostic_bundles (
      record_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES tasks(record_key) ON DELETE RESTRICT,
      origin_kind TEXT NOT NULL CHECK (origin_kind IN ('failure','unexpected-state','subject-mismatch','recovery-park','operator-request')),
      failure_id TEXT REFERENCES failures(record_key) ON DELETE RESTRICT,
      content_digest TEXT NOT NULL,
      retention_kind TEXT NOT NULL CHECK (retention_kind IN ('ordinary','pinned')),
      purge_after TEXT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      CHECK ((retention_kind = 'ordinary') = (purge_after IS NOT NULL)),
      CHECK ((origin_kind = 'operator-request') = (failure_id IS NULL))
    ) STRICT
  `,
  diagnostic_attachments: `
    CREATE TABLE diagnostic_attachments (
      record_key TEXT PRIMARY KEY,
      bundle_id TEXT NOT NULL REFERENCES diagnostic_bundles(record_key) ON DELETE RESTRICT,
      artifact_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      digest TEXT NOT NULL,
      sensitivity TEXT NOT NULL CHECK (sensitivity IN ('redacted','restricted')),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (bundle_id, artifact_id)
    ) STRICT
  `,
  // Ref operator-trust §2.3. One terminal run, one server-derived receipt. `failed` is the
  // only result that may name a failure, and the only one that must.
  evidence_receipts: `
    CREATE TABLE evidence_receipts (
      record_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES tasks(record_key) ON DELETE RESTRICT,
      workflow TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      result TEXT NOT NULL CHECK (result IN ('verified-done','done-with-warnings','failed','cancelled','partial')),
      confidence TEXT NOT NULL CHECK (confidence IN ('verified','partial','unknown')),
      failure_id TEXT REFERENCES failures(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      CHECK ((result = 'failed') = (failure_id IS NOT NULL)),
      CHECK (result <> 'verified-done' OR confidence = 'verified')
    ) STRICT
  `,
  // Ref operator-trust §4. Knowledge and fix records are authored records, not run output;
  // they carry no run foreign key on purpose.
  knowledge_records: `
    CREATE TABLE knowledge_records (
      record_key TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('active','superseded','retired','unverified')),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  fix_records: `
    CREATE TABLE fix_records (
      record_key TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('draft','verified')),
      failure_fingerprint TEXT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  // Ref write-safety §6. One row per `(system, date)`: the sequence authority and the
  // projection lease. `next_seq` advances only inside the same transaction that
  // writes the assignment row it hands out.
  ledger_partitions: `
    CREATE TABLE ledger_partitions (
      record_key TEXT PRIMARY KEY,
      system TEXT NOT NULL,
      ledger_date TEXT NOT NULL,
      next_seq INTEGER NOT NULL CHECK (next_seq >= 0),
      lease_holder TEXT,
      lease_expires_at TEXT,
      lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
      version INTEGER NOT NULL CHECK (version >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (system, ledger_date),
      CHECK ((lease_holder IS NULL) = (lease_expires_at IS NULL))
    ) STRICT
  `,
  // Ref write-safety §6. One row per projected outbox id — the projector's idempotency
  // key — written BEFORE the append so the append window is repairable. `seq`
  // is unique inside its partition; nothing may delete or rewrite a row.
  ledger_projections: `
    CREATE TABLE ledger_projections (
      record_key TEXT PRIMARY KEY REFERENCES durable_outbox(record_key) ON DELETE RESTRICT,
      partition_key TEXT NOT NULL REFERENCES ledger_partitions(record_key) ON DELETE RESTRICT,
      system TEXT NOT NULL,
      ledger_date TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK (seq >= 0),
      state TEXT NOT NULL CHECK (state IN ('assigned','appended')),
      line_digest TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      appended_at TEXT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (partition_key, seq),
      CHECK ((state = 'appended') = (appended_at IS NOT NULL))
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
  // Ref workflow-model §5.7. The logical item is (workflow, item_id) — retries share it,
  // rerun-with-new-input gets a fresh one — and the resume grain is a graph
  // NODE, so the doc's `step_id` column is `node_id` here. Payloads are
  // system-of-record under D14: pruned only on logical-item deletion, never on
  // the 7-day JSONL clock.
  //
  // **This constant is the v3 SHAPE and is frozen there.** D214 added the
  // `claim_generation` column and widened the uniqueness tuple; that rebuild is
  // migration v14's own literal SQL, because v3 hashes these exact bytes and a
  // released migration is immutable. Read v14 for the live shape.
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
  // Ref frontend-backend-integration §5.1. A plan is proposed, shown, and then consumed exactly once; the
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
  /**
   * Ref data-intake-and-edit-data §2.2's in-progress upload → map → validate session (2i-E1). The
   * operator's decisions plus the immutable source identity — rows and
   * columns are re-derived from the content-addressed artifact, never
   * stored. `source_sha256` and `state` are columns so "does this exact
   * file already have an open session" is a lookup, not a JSON scan.
   */
  intake_sessions: `
    CREATE TABLE intake_sessions (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      state TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT
  `,
  /**
   * Ref data-intake-and-edit-data §5's immutable plan manifest. `record_key` is the manifest id; the
   * source digest is a column so "has this exact file been run before" is a
   * lookup rather than a scan over parsed JSON.
   */
  intake_manifests: `
    CREATE TABLE intake_manifests (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      workflow_contract_fingerprint TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  /**
   * Ref data-intake-and-edit-data §4.3's admitted extraction, one row per PAGE.
   *
   * `(source_sha256, source_page, form_type)` is UNIQUE: one page read once for
   * one form. A second producer reading the same page is a REPLACEMENT decision
   * a human makes, not a second row that silently doubles a person.
   */
  ocr_extractions: `
    CREATE TABLE ocr_extractions (
      record_key TEXT PRIMARY KEY,
      form_type TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      source_page INTEGER NOT NULL CHECK (source_page >= 1),
      page_kind TEXT NOT NULL,
      page_fingerprint TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (source_sha256, source_page, form_type)
    ) STRICT
  `,
  /**
   * D179 / ref dashboard-surfaces §10.2 — the applied version bump. Charter §25's change
   * record: what scope moved, to which build, and how many runs left the
   * active surfaces because of it.
   */
  version_bump_applications: `
    CREATE TABLE version_bump_applications (
      record_key TEXT PRIMARY KEY,
      version_plan_id TEXT NOT NULL UNIQUE REFERENCES version_plans(record_key) ON DELETE RESTRICT,
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workflows', 'application')),
      target_version TEXT NOT NULL,
      applied_app_version TEXT NOT NULL,
      archived_count INTEGER NOT NULL CHECK (archived_count >= 0),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  /**
   * One archived run, stored as SELF-CONTAINED data (charter §25). The row
   * holds the run's final projected row, its detail, its receipt/failure and
   * its evidence POINTERS, so rendering it needs no descriptor and no
   * old-version code. `content_digest` is the integrity value a relaunch
   * cites back.
   */
  archived_runs: `
    CREATE TABLE archived_runs (
      record_key TEXT PRIMARY KEY REFERENCES tasks(record_key) ON DELETE RESTRICT,
      application_id TEXT NOT NULL REFERENCES version_bump_applications(record_key) ON DELETE RESTRICT,
      workflow TEXT NOT NULL,
      descriptor_version INTEGER NOT NULL CHECK (descriptor_version >= 1),
      contract_fingerprint TEXT NOT NULL,
      app_version TEXT,
      content_digest TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  /**
   * Relaunch provenance, keyed by the FRESH run (charter §25: relaunch starts
   * a new run on the current version and is never a resume). One archived run
   * may be relaunched more than once, and neither side is rewritten to record
   * it — the link is its own insert-only fact.
   */
  archive_relaunches: `
    CREATE TABLE archive_relaunches (
      record_key TEXT PRIMARY KEY REFERENCES tasks(record_key) ON DELETE RESTRICT,
      archived_run_id TEXT NOT NULL REFERENCES archived_runs(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
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
  "diagnostic_bundles",
  "diagnostic_attachments",
  "evidence_receipts",
  "knowledge_records",
  "fix_records",
  "ledger_partitions",
  "ledger_projections",
  "intake_manifests",
  "ocr_extractions",
  "intake_sessions",
  "version_bump_applications",
  "archived_runs",
  "archive_relaunches",
] as const satisfies readonly TableName[];

const TABLE_ORDER =[...V1_TABLE_ORDER, ...POST_V1_TABLE_ORDER] as const satisfies readonly TableName[];

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
    // Ref workflow-model §5.7's checkpoint store. The descending-attempt index is what makes
    // "latest compatible attempt wins" a lookup rather than a scan-and-sort.
    version: 3,
    statements: [
      SQLITE_TABLE_DDL.run_checkpoints,
      "CREATE INDEX run_checkpoints_item_node_idx ON run_checkpoints(workflow, item_id, node_id, attempt DESC)",
    ],
  },
  {
    // Ref dashboard-surfaces §2.3's task/claim store, typed. `tasks` holds runs and `leases`
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
    // Start plans (ref frontend-backend-integration §5.1), plus the delegation edge every projection and
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
  {
    /*
     * D134 — the 2g event/trust foundation. Three groups land together because
     * they share one schema version and no later 2g slice may edit the chain:
     *
     *  1. ref operator-trust's trust tables (diagnostic bundles + attachments, evidence
     *     receipts, knowledge and fix records);
     *  2. ref write-safety §6's ledger sequencing lease and projection state;
     *  3. the two column upgrades the projections ref operator-trust already requires —
     *     a searchable failure fingerprint, and the notification dedupe fold.
     *
     * The notification upgrade is the only one that rewrites stored JSON, and
     * it does so with the exactly-true values: a row that was inserted once has
     * been seen once, at its own creation instant. No count is invented.
     */
    version: 10,
    statements: [
      SQLITE_TABLE_DDL.diagnostic_bundles,
      SQLITE_TABLE_DDL.diagnostic_attachments,
      SQLITE_TABLE_DDL.evidence_receipts,
      SQLITE_TABLE_DDL.knowledge_records,
      SQLITE_TABLE_DDL.fix_records,
      SQLITE_TABLE_DDL.ledger_partitions,
      SQLITE_TABLE_DDL.ledger_projections,
      "CREATE INDEX diagnostic_bundles_run_idx ON diagnostic_bundles(run_id, created_at)",
      "CREATE INDEX diagnostic_bundles_failure_idx ON diagnostic_bundles(failure_id)",
      "CREATE INDEX diagnostic_bundles_retention_idx ON diagnostic_bundles(retention_kind, purge_after)",
      "CREATE INDEX diagnostic_attachments_artifact_idx ON diagnostic_attachments(artifact_id)",
      "CREATE INDEX evidence_receipts_workflow_idx ON evidence_receipts(workflow, created_at)",
      "CREATE INDEX knowledge_records_status_idx ON knowledge_records(status, created_at)",
      "CREATE INDEX fix_records_fingerprint_idx ON fix_records(failure_fingerprint, created_at)",
      "CREATE INDEX ledger_projections_partition_idx ON ledger_projections(partition_key, seq)",
      "CREATE INDEX ledger_projections_state_idx ON ledger_projections(state, assigned_at)",
      "CREATE INDEX durable_outbox_kind_idx ON durable_outbox(kind, created_at)",
      // History is appended, never rewritten or erased: an assignment may make
      // exactly one transition to `appended`, and nothing may delete it.
      `CREATE TRIGGER ledger_projections_append_once_update
        BEFORE UPDATE ON ledger_projections
        WHEN NEW.record_key IS NOT OLD.record_key
          OR NEW.partition_key IS NOT OLD.partition_key
          OR NEW.system IS NOT OLD.system
          OR NEW.ledger_date IS NOT OLD.ledger_date
          OR NEW.seq IS NOT OLD.seq
          OR NEW.line_digest IS NOT OLD.line_digest
          OR NEW.assigned_at IS NOT OLD.assigned_at
          OR NEW.created_at IS NOT OLD.created_at
          OR OLD.state <> 'assigned'
          OR NEW.state <> 'appended'
        BEGIN
          SELECT RAISE(ABORT, 'a ledger projection may only transition once from assigned to appended');
        END`,
      `CREATE TRIGGER ledger_projections_never_deleted
        BEFORE DELETE ON ledger_projections
        BEGIN
          SELECT RAISE(ABORT, 'ledger projections are never deleted');
        END`,
      `CREATE TRIGGER ledger_partitions_sequence_advances_update
        BEFORE UPDATE OF next_seq, version, system, ledger_date ON ledger_partitions
        WHEN NEW.system IS NOT OLD.system
          OR NEW.ledger_date IS NOT OLD.ledger_date
          OR NEW.next_seq < OLD.next_seq
          OR NEW.version <> OLD.version + 1
        BEGIN
          SELECT RAISE(ABORT, 'a ledger partition sequence and version may only advance');
        END`,
      `CREATE TRIGGER ledger_partitions_never_deleted
        BEFORE DELETE ON ledger_partitions
        BEGIN
          SELECT RAISE(ABORT, 'ledger partitions are never deleted');
        END`,
      // Ref operator-trust §2.1/§4.2: "same failure seen before" and `explain failure
      // <fingerprint>` are lookups, not scans over parsed JSON.
      "ALTER TABLE failures ADD COLUMN fingerprint TEXT",
      "UPDATE failures SET fingerprint = json_extract(record_json, '$.fingerprint')",
      "CREATE INDEX failures_fingerprint_idx ON failures(fingerprint, created_at)",
      `CREATE TRIGGER failures_require_fingerprint_insert
        BEFORE INSERT ON failures
        WHEN NEW.fingerprint IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'failures requires the searchable fingerprint column');
        END`,
      // Ref dashboard-surfaces §2.6 / ref operator-trust §6: one row per (actor, dedupe fingerprint), folded
      // in place. Identity and creation are frozen; count/read/snooze are not.
      "ALTER TABLE notifications ADD COLUMN actor_id TEXT",
      "ALTER TABLE notifications ADD COLUMN dedupe_fingerprint TEXT",
      "ALTER TABLE notifications ADD COLUMN status TEXT",
      "ALTER TABLE notifications ADD COLUMN seen_count INTEGER",
      "ALTER TABLE notifications ADD COLUMN version INTEGER",
      "UPDATE notifications SET record_json = json_set(record_json, '$.count', 1, '$.lastSeenAt', json_extract(record_json, '$.createdAt'))",
      "UPDATE notifications SET actor_id = json_extract(record_json, '$.actorId'), dedupe_fingerprint = json_extract(record_json, '$.dedupeFingerprint'), status = json_extract(record_json, '$.status'), seen_count = json_extract(record_json, '$.count'), version = json_extract(record_json, '$.version')",
      "CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications(actor_id, dedupe_fingerprint)",
      "CREATE INDEX notifications_actor_status_idx ON notifications(actor_id, status, created_at)",
      `CREATE TRIGGER notifications_require_columns_insert
        BEFORE INSERT ON notifications
        WHEN NEW.actor_id IS NULL OR NEW.dedupe_fingerprint IS NULL OR NEW.status IS NULL
          OR NEW.seen_count IS NULL OR NEW.seen_count < 1 OR NEW.version IS NULL OR NEW.version < 1
        BEGIN
          SELECT RAISE(ABORT, 'notifications requires actor_id, dedupe_fingerprint, status, seen_count, and version');
        END`,
      `CREATE TRIGGER notifications_immutable_identity_update
        BEFORE UPDATE ON notifications
        WHEN NEW.record_key IS NOT OLD.record_key
          OR NEW.actor_id IS NOT OLD.actor_id
          OR NEW.dedupe_fingerprint IS NOT OLD.dedupe_fingerprint
          OR NEW.created_at IS NOT OLD.created_at
        BEGIN
          SELECT RAISE(ABORT, 'notification identity and creation instant are immutable');
        END`,
      `CREATE TRIGGER notifications_monotonic_update
        BEFORE UPDATE OF seen_count, version ON notifications
        WHEN NEW.version <> OLD.version + 1 OR NEW.seen_count < OLD.seen_count
        BEGIN
          SELECT RAISE(ABORT, 'notification version advances exactly once and seen_count never rewinds');
        END`,
    ],
  },
  {
    /*
     * Phase-2h durability. Everything the intake and OCR pipelines produce was
     * in-memory until here: a manifest and an admitted extraction survived
     * exactly as long as the process did.
     *
     * Both tables carry their identifying facts as COLUMNS beside the record
     * JSON, for the same reason v10 gave `failures` a searchable fingerprint:
     * "has this file been run before" and "has this page already been read"
     * are lookups an operator makes constantly, and a scan over parsed JSON is
     * not an answer.
     *
     * `ocr_extractions` is UNIQUE on `(source_sha256, source_page, form_type)`.
     * One page, read once, for one form. A second producer reading the same
     * page is a REPLACEMENT a human decides on — not a second row that silently
     * doubles a person in the fan-out.
     */
    version: 11,
    statements: [
      SQLITE_TABLE_DDL.intake_manifests,
      SQLITE_TABLE_DDL.ocr_extractions,
      "CREATE INDEX intake_manifests_source_idx ON intake_manifests(source_sha256, created_at)",
      "CREATE INDEX intake_manifests_workflow_idx ON intake_manifests(workflow, created_at)",
      "CREATE INDEX ocr_extractions_source_idx ON ocr_extractions(source_sha256, source_page)",
      "CREATE INDEX ocr_extractions_form_idx ON ocr_extractions(form_type, created_at)",
      // An intake manifest is the rerun authority (ref data-intake-and-edit-data §5): it proves which
      // file and mapping produced which items. Rewriting one would rewrite
      // history that a run already fanned out against.
      `CREATE TRIGGER intake_manifests_immutable_update
        BEFORE UPDATE ON intake_manifests
        BEGIN
          SELECT RAISE(ABORT, 'an intake manifest is immutable; a rerun creates a new one');
        END`,
      `CREATE TRIGGER intake_manifests_never_deleted
        BEFORE DELETE ON intake_manifests
        BEGIN
          SELECT RAISE(ABORT, 'intake manifests are never deleted');
        END`,
      // An admitted extraction is what a human reviewed. Replacing one is a
      // decision with its own audit; silently updating it is not.
      `CREATE TRIGGER ocr_extractions_immutable_update
        BEFORE UPDATE ON ocr_extractions
        BEGIN
          SELECT RAISE(ABORT, 'an admitted extraction is immutable; a re-read is a new row after an explicit replacement');
        END`,
    ],
  },
  {
    /*
     * 2i-E1: the durable intake session — the in-progress upload → map →
     * validate state ref data-intake-and-edit-data §2.2 walks, which D159's TERMINAL manifest
     * deliberately does not cover (a manifest is the immutable rerun
     * authority; a session is the operator's working state before one
     * exists). Mutable under a version CAS like `capture_sessions`;
     * rows/columns are never stored — they re-derive from the
     * content-addressed artifact, so a stored copy could only drift from
     * its own source.
     */
    version: 12,
    statements: [
      SQLITE_TABLE_DDL.intake_sessions,
      "CREATE INDEX intake_sessions_source_idx ON intake_sessions(source_sha256, state)",
      "CREATE INDEX intake_sessions_state_idx ON intake_sessions(state, updated_at)",
    ],
  },
  {
    /*
     * 2i-G: the archive model (D179, charter §25 / ref dashboard-surfaces §10.2). Three facts,
     * all insert-only in SQL rather than by convention:
     *
     * - the applied bump, which is the change record;
     * - one self-contained record per archived run;
     * - relaunch provenance keyed by the fresh run.
     *
     * The triggers are the load-bearing part. An archive whose rows could be
     * updated or deleted would be a WEAKER record than the live run row it
     * replaced, and the whole argument for archiving — that the operator can
     * still read exactly what happened, forever, without the code that did it
     * — depends on the bytes not moving. Nothing here touches the ledger:
     * archiving is a display lifecycle and the ledger is an audit one.
     */
    version: 13,
    statements: [
      SQLITE_TABLE_DDL.version_bump_applications,
      SQLITE_TABLE_DDL.archived_runs,
      SQLITE_TABLE_DDL.archive_relaunches,
      "CREATE INDEX archived_runs_application_idx ON archived_runs(application_id, created_at)",
      "CREATE INDEX archived_runs_workflow_idx ON archived_runs(workflow, created_at)",
      "CREATE INDEX archive_relaunches_source_idx ON archive_relaunches(archived_run_id, created_at)",
      `CREATE TRIGGER version_bump_applications_immutable_update
        BEFORE UPDATE ON version_bump_applications
        BEGIN
          SELECT RAISE(ABORT, 'an applied version bump is immutable; a later bump is a new application');
        END`,
      `CREATE TRIGGER version_bump_applications_never_deleted
        BEFORE DELETE ON version_bump_applications
        BEGIN
          SELECT RAISE(ABORT, 'applied version bumps are never deleted');
        END`,
      `CREATE TRIGGER archived_runs_immutable_update
        BEFORE UPDATE ON archived_runs
        BEGIN
          SELECT RAISE(ABORT, 'an archived run is immutable; the archive is the record, not a cache of one');
        END`,
      `CREATE TRIGGER archived_runs_never_deleted
        BEFORE DELETE ON archived_runs
        BEGIN
          SELECT RAISE(ABORT, 'archived runs are never deleted');
        END`,
      `CREATE TRIGGER archive_relaunches_immutable_update
        BEFORE UPDATE ON archive_relaunches
        BEGIN
          SELECT RAISE(ABORT, 'relaunch provenance is immutable; a second relaunch is a second row');
        END`,
      `CREATE TRIGGER archive_relaunches_never_deleted
        BEFORE DELETE ON archive_relaunches
        BEGIN
          SELECT RAISE(ABORT, 'relaunch provenance is never deleted');
        END`,
    ],
  },
  {
    /*
     * D214 — a run ATTEMPT is not one execution of its graph, so the checkpoint
     * identity gains the claim generation that executed the node.
     *
     * A gate park and its resume are two executions inside ONE attempt, and an
     * `always-rerun` node re-executes across that boundary by design (ref workflow-model
     * §5.3). Under `UNIQUE (workflow, item_id, node_id, attempt)` the second
     * execution's genuinely different observation collided with the first
     * execution's row and the immutable insert refused it — so a graph with a
     * gate upstream of an always-rerun node could not pass its own gate.
     *
     * `claim_generation` is NULLABLE and every pre-D214 row copies across as
     * NULL, because a row written before the component existed does not name an
     * execution and writing `1` into it would be fabricating a fact nobody
     * recorded (D133 read-forward). NULLs are distinct under SQLite's UNIQUE, so
     * the constraint alone would not stop two unrecorded rows for one tuple —
     * two things make that unreachable: the copied rows were already unique
     * under the OLD constraint, and `runCheckpoints.insert` refuses a record
     * carrying no generation, so no further NULL row can ever be written.
     *
     * The rebuild is table-copy rather than `ALTER TABLE ADD COLUMN` because a
     * UNIQUE constraint cannot be widened in place. `record_key` is copied
     * VERBATIM: `checkpointLookupKey` appends nothing for an absent generation,
     * so every stored key stays byte-identical and every stored row stays
     * resolvable by the exact key it was written under.
     */
    version: 14,
    statements: [
      `CREATE TABLE run_checkpoints_d214 (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      item_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      claim_generation INTEGER CHECK (claim_generation IS NULL OR claim_generation >= 1),
      run_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (workflow, item_id, node_id, attempt, claim_generation)
    ) STRICT`,
      `INSERT INTO run_checkpoints_d214
        (record_key, workflow, item_id, node_id, attempt, claim_generation, run_id, record_json, created_at)
      SELECT record_key, workflow, item_id, node_id, attempt, NULL, run_id, record_json, created_at
      FROM run_checkpoints`,
      "DROP TABLE run_checkpoints",
      "ALTER TABLE run_checkpoints_d214 RENAME TO run_checkpoints",
      "CREATE INDEX run_checkpoints_item_node_idx ON "
        + "run_checkpoints(workflow, item_id, node_id, attempt DESC, claim_generation DESC)",
    ],
  },
  {
    /*
     * D230 — a run's ORDINAL within its workflow, the queue footer's `#N`.
     *
     * `run_number` is a MIRRORED column, not a JSON leaf read at query time,
     * because the two things this ordinal must guarantee are both SQL
     * properties: `max(run_number)` over one workflow is the counter the next
     * enqueue reads inside its own transaction, and `UNIQUE (workflow,
     * run_number)` is what makes "no two runs of one workflow hold the same
     * number" a fact the database enforces rather than a claim two call sites
     * make. The integrity audit pins the column to the record's own value, as
     * it does for every other mirrored column.
     *
     * NULLABLE, and every pre-D230 row keeps NULL: an ordinal computed for
     * those rows now — by `created_at` order, say — would mint a number that
     * was never true of them and would then have to be reconciled with the
     * live counter, which is exactly the back-fill D133 forbids. SQLite treats
     * NULLs as distinct under UNIQUE, so the historical rows do not collide
     * with each other; the constraint binds only rows that name a number, and
     * `runs.enqueue` refuses a record whose number the workflow has spent, so
     * the loud refusal lands before the index has to.
     *
     * `ALTER TABLE ADD COLUMN` rather than the v14 table copy: nothing about
     * the existing UNIQUE constraint moves, so there is nothing to widen.
     */
    version: 15,
    statements: [
      "ALTER TABLE tasks ADD COLUMN run_number INTEGER",
      "CREATE UNIQUE INDEX tasks_run_number_idx ON tasks(workflow, run_number)",
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
