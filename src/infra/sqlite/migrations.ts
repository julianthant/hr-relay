import { TRANSACTION_SELECTION_DDL, TRANSACTION_SELECTION_CONSTRAINTS } from "./transaction-selection.js";
import { RUN_SEARCH_INDEX_DDL, RUN_SEARCH_GRAMS_DDL, RUN_SEARCH_PUBLICATION_DDL, RUN_SEARCH_DECLARATIONS_DDL, RUN_SEARCH_ACTORS_DDL, RUN_SEARCH_INDEX_CONSTRAINTS, RUN_SEARCH_ACTOR_BACKFILL_SQL } from "./run-search-index.js";
import { WORKER_CONTROL_DDL, WORKER_BROWSER_DDL } from "./worker-control.js";
import { NOTIFICATION_PUBLICATIONS_DDL, NOTIFICATION_HEALTH_DDL } from "./notification-publications.js";
export const VERSION_CHANGES_DDL = `CREATE TABLE version_changes (record_key TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL) STRICT`;
import { ARCHIVE_TRANSFER_DDL } from "./run-evidence-ownership.js";
import { RUN_SUMMARIES_DDL, SUMMARY_PUBLICATION_DDL } from "./run-summaries.js";
import { GENERATED_ARTIFACT_DDL, GENERATED_ARTIFACT_CONSTRAINTS } from "./generated-conversion.js";
import { EXPLORER_OVERRIDES_DDL, EXPLORER_OVERRIDE_CONSTRAINTS } from "./explorer-overrides.js";
import { APP_SETTINGS_DDL } from "./settings-storage.js";
import { PROVIDER_REQUEST_DDL, PROVIDER_USAGE_DDL, PROVIDER_STORAGE_CONSTRAINTS } from "./provider-storage.js";
import { IMPORTED_ARTIFACT_DDL, IMPORTED_ARTIFACT_TRIGGERS } from "./imported-artifacts.js";
import { TIMELINE_EVENT_TABLE_DDL, TIMELINE_EVENT_INDEX_DDL } from "./timeline-repository.js";
import { deepFreeze } from "../../domain/immutability.js";
import type { TableName, TableSpec } from "../../domain/authority.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../domain/authority.js";

export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const UPGRADE_FLOOR_SCHEMA_VERSION = 46;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 54;

/** Physical names changed at v39; released DDL and stored JSON keep their bytes. */
export const DATABASE_TABLE_RENAMES = deepFreeze({
  authority_meta: "database_state",
  authority_upgrades: "database_upgrades",
  diagnostic_bundles: "diagnostic_snapshots",
  diagnostic_attachments: "diagnostic_files",
  evidence_receipts: "run_receipts",
  config_snapshots: "settings_snapshots",
  dry_run_scenario_results: "dryrun_results",
} as const);

export function databaseStateTable(schemaVersion: number): "authority_meta" | "database_state" {
  return schemaVersion < 39 ? "authority_meta" : "database_state";
}

export function databaseUpgradesTable(schemaVersion: number): "authority_upgrades" | "database_upgrades" {
  return schemaVersion < 39 ? "authority_upgrades" : "database_upgrades";
}

export function settingsSnapshotsTable(schemaVersion: number): "config_snapshots" | "settings_snapshots" {
  return schemaVersion < 39 ? "config_snapshots" : "settings_snapshots";
}

export function requiresStoppedSystemAuthorityUpgrade(schemaVersion: number): boolean {
  // Retirement of archive authorities and obsolete relaunch relationships requires stopped conversion.
  return schemaVersion > 0 && (schemaVersion <= UPGRADE_FLOOR_SCHEMA_VERSION || schemaVersion < CURRENT_AUTHORITY_SCHEMA_VERSION);
}

/**
 * Tables created by the immutable v1 migration and retired by v28. They stay
 * named here only so the released migration can retain its exact bytes; they
 * are absent from the current authority registry and from every repository.
 */
export const RETIRED_PHONE_CAPTURE_TABLES = [
  "capture_sessions",
  "capture_photo_order",
  "capture_finalization_outboxes",
] as const;
type RetiredPhoneCaptureTable = typeof RETIRED_PHONE_CAPTURE_TABLES[number];
type MigrationTableName = "archive_relaunches" | "activity_person_pseudonyms" | "activity_person_pseudonym_generations" | "spans" | "gates" | "notes" | "ocr_approvals" | "knowledge_records" | "fix_records" | "artifact_outbox" | "artifact_sink_heads" | "operator_xlsx_exports" | "settings_current" | "runtime_config" | "provider_admissions" | "provider_budget_counters" | "intake_sessions" | "intake_manifests" | "ocr_extractions" | "failures" | "run_terminal_authorizations" | "run_terminal_outbox" | "ledger_partitions" | "ledger_projections" | "authority_meta" | "authority_upgrades" | "diagnostic_bundles" | "diagnostic_attachments" | "evidence_receipts" | "config_snapshots" | "dry_run_scenario_results" | "write_intents" | "write_attempts" | "durable_outbox" | "leases" | "duo_ceremony_leases" | "start_plans" | "tasks" | "run_sessions" | TableName | RetiredPhoneCaptureTable | "protected_settings_current" | "runs_view" | "dependencies" | "delegation_manifests" | "bulk_command_acceptances";

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
  transaction_selection: TRANSACTION_SELECTION_DDL,
  run_search_index: RUN_SEARCH_INDEX_DDL, run_search_grams: RUN_SEARCH_GRAMS_DDL, run_search_publication: RUN_SEARCH_PUBLICATION_DDL, run_search_declarations: RUN_SEARCH_DECLARATIONS_DDL, run_search_actors: RUN_SEARCH_ACTORS_DDL,
  version_changes: VERSION_CHANGES_DDL,
  archive_transfers: ARCHIVE_TRANSFER_DDL,
  run_summaries: RUN_SUMMARIES_DDL,
  summary_publication: SUMMARY_PUBLICATION_DDL,
  generated_artifacts: GENERATED_ARTIFACT_DDL,
  app_settings: APP_SETTINGS_DDL,
  explorer_overrides: EXPLORER_OVERRIDES_DDL,
  notification_publications: NOTIFICATION_PUBLICATIONS_DDL,
  notification_health: NOTIFICATION_HEALTH_DDL,
  worker_controls: WORKER_CONTROL_DDL,
  worker_browsers: WORKER_BROWSER_DDL,
  provider_requests: PROVIDER_REQUEST_DDL,
  provider_usage: PROVIDER_USAGE_DDL,
  imported_artifacts: IMPORTED_ARTIFACT_DDL,
  timeline_events: TIMELINE_EVENT_TABLE_DDL,
  timeline_operation_sources: jsonRecordTable("timeline_operation_sources"),
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
  // Ref guards-and-tests §10.6. This is citable dry-run evidence, not a mutable
  // projection. A started result binds to one real run; a pre-browser block
  // carries neither run nor trace identity rather than fabricating either.
  dry_run_scenario_results: `
    CREATE TABLE dry_run_scenario_results (
      record_key TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      workflow TEXT NOT NULL,
      subject_label TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('met','blocked','failed')),
      execution_state TEXT NOT NULL CHECK (execution_state IN ('started','not-started')),
      run_id TEXT UNIQUE REFERENCES tasks(record_key) ON DELETE RESTRICT,
      trace_id TEXT,
      wall_time_ms INTEGER NOT NULL CHECK (wall_time_ms >= 0),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      CHECK (
        (execution_state = 'started' AND run_id IS NOT NULL AND trace_id IS NOT NULL)
        OR (execution_state = 'not-started' AND run_id IS NULL AND trace_id IS NULL AND verdict = 'blocked')
      )
    ) STRICT
  `,
  // DCR5 — immutable evidence for one operator-facing workbook attachment.
  operator_xlsx_exports: `
    CREATE TABLE operator_xlsx_exports (
      record_key TEXT PRIMARY KEY,
      selection_kind TEXT NOT NULL CHECK (selection_kind IN ('search','activity')),
      artifact_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      media_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  // D288 — one deterministic, keyed person pseudonym per run and public key
  // generation. The source identifier and HMAC key have no columns and never
  // enter record_json.
  activity_person_pseudonyms: `
    CREATE TABLE activity_person_pseudonyms (
      record_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES tasks(record_key) ON DELETE RESTRICT,
      workflow TEXT NOT NULL,
      key_generation TEXT NOT NULL,
      pseudonym TEXT NOT NULL,
      derivation TEXT NOT NULL CHECK (derivation = 'hmac-sha-256/activity-person/v1'),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL,
      UNIQUE (run_id, key_generation)
    ) STRICT
  `,
  // D288 — an irreversible commitment binds each public generation to one
  // secret HMAC key. Neither key material nor a person-derived value enters
  // this table.
  activity_person_pseudonym_generations: `
    CREATE TABLE activity_person_pseudonym_generations (
      record_key TEXT PRIMARY KEY,
      key_generation TEXT NOT NULL UNIQUE,
      key_commitment TEXT NOT NULL,
      derivation TEXT NOT NULL CHECK (derivation = 'hmac-sha-256/activity-person-key-commitment/v1'),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
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
  bulk_command_acceptances: `
    CREATE TABLE bulk_command_acceptances (
      record_key TEXT PRIMARY KEY,
      request_fingerprint TEXT NOT NULL,
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
  // D308 — the delete tombstone. One row per deleted run, inserted FIRST in the
  // delete transaction; every relaxed `*_never_deleted` trigger reads it.
  deleted_runs: `
    CREATE TABLE deleted_runs (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('queue', 'archive')),
      command_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  authority_upgrades: `
    CREATE TABLE authority_upgrades (
      record_key TEXT PRIMARY KEY,
      upgrade_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('baseline','planned','committed','settled')),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
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
  /**
   * D267 (ref execution-and-sessions §10) — the Duo ceremony lease: ONE row per
   * credential identity, UPDATED in place across generations. It is the second
   * authority row (after notifications) that is updated rather than appended,
   * and for a similar reason: the row IS the lock, and a lock that left a row
   * behind per ceremony would be a ledger of ceremonies, not a lease. Every
   * mirrored column is pinned to the record's own value by the integrity audit.
   */
  duo_ceremony_leases: `
    CREATE TABLE duo_ceremony_leases (
      record_key TEXT PRIMARY KEY,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      holder_worker_id TEXT NOT NULL,
      holder_system TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('held', 'released')),
      expires_at TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  /**
   * D269 (ref execution-and-sessions §11.5) — the per-workflow worker POOL
   * declaration, the CAS basis `plan-worker-count` / `spawn-worker` cite. One
   * row per workflow, updated under a version CAS (a pool is a standing
   * declaration, not a history), never deleted: a row that vanished would read
   * as "nothing was ever planned", which is a different fact from the one it
   * replaced. `desired_workers` and `version` are mirrored so a pool can be
   * listed without parsing every record; the integrity audit pins them.
   */
  worker_pools: `
    CREATE TABLE worker_pools (
      record_key TEXT PRIMARY KEY,
      desired_workers INTEGER NOT NULL CHECK (desired_workers >= 1),
      version INTEGER NOT NULL CHECK (version >= 1),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  /**
   * D269 (ref execution-and-sessions §11.1) — a dashboard-started GROUP of
   * runs. Insert-only by trigger (a group that could be rewritten would be a
   * weaker record than the runs it names) and it holds NO member list:
   * membership is `tasks.session_id`, so the group is derived from the run
   * table and can never claim a run that table does not show. `workflow` is
   * mirrored for the per-workflow listing.
   */
  run_sessions: `
    CREATE TABLE run_sessions (
      record_key TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      started_at TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  runtime_config: `
    CREATE TABLE runtime_config (
      record_key TEXT PRIMARY KEY CHECK (record_key = 'active'),
      generation INTEGER NOT NULL CHECK (generation >= 1),
      settings_revision INTEGER NOT NULL CHECK (settings_revision >= 1),
      settings_fingerprint TEXT NOT NULL,
      config_snapshot_id TEXT NOT NULL REFERENCES config_snapshots(record_key) ON DELETE RESTRICT,
      config_fingerprint TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  settings_current: `
    CREATE TABLE settings_current (
      record_key TEXT PRIMARY KEY CHECK (record_key = 'current'),
      revision INTEGER NOT NULL CHECK (revision >= 2),
      settings_fingerprint TEXT NOT NULL,
      command_id TEXT NOT NULL REFERENCES commands(record_key) ON DELETE RESTRICT,
      command_fingerprint TEXT NOT NULL,
      audit_id TEXT NOT NULL REFERENCES command_audits(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  protected_settings_current: `
    CREATE TABLE protected_settings_current (
      record_key TEXT PRIMARY KEY CHECK (record_key = 'current'),
      revision INTEGER NOT NULL CHECK (revision >= 2),
      command_id TEXT NOT NULL REFERENCES commands(record_key) ON DELETE RESTRICT,
      command_fingerprint TEXT NOT NULL,
      audit_id TEXT NOT NULL REFERENCES command_audits(record_key) ON DELETE RESTRICT,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      created_at TEXT NOT NULL
    ) STRICT
  `,
  spans: jsonRecordTable("spans"),
  gates: jsonRecordTable("gates"),
  notes: jsonRecordTable("notes"),
  runs_view: jsonRecordTable("runs_view"),
} as const satisfies Record<Exclude<MigrationTableName, typeof DATABASE_TABLE_RENAMES[keyof typeof DATABASE_TABLE_RENAMES] | "run_failures" | "extracted_artifacts" | "workflow_runs" | "workflow_run_batches" | "workflow_workers" | "worker_auth" | "workflow_run_requests" | "run_operations" | "run_operation_attempts" | "operation_outbox" | "delegation_dependencies" | "run_delegations">, string>);

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
] as const satisfies readonly MigrationTableName[];

/** Tables created after v1, in the migration that created them. */
const POST_V1_TABLE_ORDER = [
  "timeline_events",
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
  "duo_ceremony_leases",
  "worker_pools",
  "run_sessions",
  "dry_run_scenario_results",
  "operator_xlsx_exports",
  "activity_person_pseudonyms",
  "activity_person_pseudonym_generations",
  "runtime_config",
  "settings_current",
  "bulk_command_acceptances",
  "deleted_runs",
  "protected_settings_current",
  "authority_upgrades",
] as const satisfies readonly MigrationTableName[];

const TABLE_ORDER = [...V1_TABLE_ORDER, ...POST_V1_TABLE_ORDER] as const satisfies readonly MigrationTableName[];

/**
 * D290/D332 — immutable released-layout admission. These are deliberately
 * literal: growing today's DDL must never rewrite what an integrated v27,
 * v28, or v29 authority meant.
 */
export const INTEGRATED_AUTHORITY_TABLES_BY_VERSION = deepFreeze({
  27: [
    "activity_person_pseudonym_generations", "activity_person_pseudonyms", "archive_relaunches",
    "archived_runs", "artifact_outbox", "artifact_sink_heads", "authority_meta",
    "bulk_command_acceptances", "capture_finalization_outboxes", "capture_photo_order",
    "capture_sessions", "checkpoint_payloads", "command_audits", "commands", "config_snapshots",
    "delegation_manifests", "dependencies", "diagnostic_attachments", "diagnostic_bundles",
    "dry_run_scenario_results", "duo_ceremony_leases", "durable_outbox", "evidence_receipts",
    "failures", "fix_records", "gates", "intake_manifests", "intake_sessions", "knowledge_records",
    "leases", "ledger_partitions", "ledger_projections", "notes", "notifications", "ocr_approvals",
    "ocr_extractions", "operator_xlsx_exports", "provider_admissions", "provider_budget_counters",
    "run_checkpoints", "run_results", "run_sessions", "run_terminal_authorizations",
    "run_terminal_outbox", "runs_view", "runtime_config", "settings_current", "spans", "start_plans",
    "tasks", "version_bump_applications", "version_plans", "worker_pools", "write_attempts",
    "write_intents",
  ],
  28: [
    "activity_person_pseudonym_generations", "activity_person_pseudonyms", "archive_relaunches",
    "archived_runs", "artifact_outbox", "artifact_sink_heads", "authority_meta",
    "bulk_command_acceptances", "checkpoint_payloads", "command_audits", "commands",
    "config_snapshots", "delegation_manifests", "dependencies", "diagnostic_attachments",
    "diagnostic_bundles", "dry_run_scenario_results", "duo_ceremony_leases", "durable_outbox",
    "evidence_receipts", "failures", "fix_records", "gates", "intake_manifests", "intake_sessions",
    "knowledge_records", "leases", "ledger_partitions", "ledger_projections", "notes", "notifications",
    "ocr_approvals", "ocr_extractions", "operator_xlsx_exports", "provider_admissions",
    "provider_budget_counters", "run_checkpoints", "run_results", "run_sessions",
    "run_terminal_authorizations", "run_terminal_outbox", "runs_view", "runtime_config",
    "settings_current", "spans", "start_plans", "tasks", "version_bump_applications",
    "version_plans", "worker_pools", "write_attempts", "write_intents",
  ],
  29: [
    "activity_person_pseudonym_generations", "activity_person_pseudonyms", "archive_relaunches",
    "archived_runs", "artifact_outbox", "artifact_sink_heads", "authority_meta",
    "bulk_command_acceptances", "checkpoint_payloads", "command_audits", "commands",
    "config_snapshots", "delegation_manifests", "deleted_runs", "dependencies",
    "diagnostic_attachments", "diagnostic_bundles", "dry_run_scenario_results", "duo_ceremony_leases",
    "durable_outbox", "evidence_receipts", "failures", "fix_records", "gates", "intake_manifests",
    "intake_sessions", "knowledge_records", "leases", "ledger_partitions", "ledger_projections",
    "notes", "notifications", "ocr_approvals", "ocr_extractions", "operator_xlsx_exports",
    "provider_admissions", "provider_budget_counters", "run_checkpoints", "run_results",
    "run_sessions", "run_terminal_authorizations", "run_terminal_outbox", "runs_view",
    "runtime_config", "settings_current", "spans", "start_plans", "tasks",
    "version_bump_applications", "version_plans", "worker_pools", "write_attempts", "write_intents",
  ],
} as const satisfies Readonly<Record<27 | 28 | 29, readonly string[]>>);

/** Historical v30–v37 layouts stay independent of the current registry. */
const V30_TABLES = [...INTEGRATED_AUTHORITY_TABLES_BY_VERSION[29], "authority_upgrades", "protected_settings_current"].sort();
const V32_TABLES = V30_TABLES.filter((name) => name !== "protected_settings_current");
const V33_TABLES = V32_TABLES.map((name) => name === "tasks" ? "workflow_runs" : name === "run_sessions" ? "workflow_run_batches" : name).sort();
const V34_TABLES = V33_TABLES.filter((name) => name !== "runs_view");
const V35_TABLES = V34_TABLES.map((name) => name === "leases" ? "workflow_workers" : name === "duo_ceremony_leases" ? "worker_auth" : name === "start_plans" ? "workflow_run_requests" : name).sort();
const V36_TABLES = V35_TABLES.map((name) => name === "write_intents" ? "run_operations" : name === "write_attempts" ? "run_operation_attempts" : name === "durable_outbox" ? "operation_outbox" : name).sort();
const V37_TABLES = V36_TABLES.filter((name) => name !== "bulk_command_acceptances")
  .map((name) => name === "delegation_manifests" ? "run_delegations" : name === "dependencies" ? "delegation_dependencies" : name).sort();
export const POST_FLOOR_AUTHORITY_TABLES_BY_VERSION: Readonly<Record<number, readonly string[]>> = deepFreeze({
  52: ["notification_publications", "notification_health", "explorer_overrides", "app_settings", "archive_transfers", "checkpoint_payloads", "command_audits", "commands", "database_state", "database_upgrades", "delegation_dependencies", "deleted_runs", "diagnostic_files", "diagnostic_snapshots", "dryrun_results", "extracted_artifacts", "generated_artifacts", "imported_artifacts", "notifications", "provider_requests", "provider_usage", "run_checkpoints", "run_delegations", "run_failures", "run_operation_attempts", "run_operations", "run_receipts", "run_results", "run_summaries", "settings_snapshots", "summary_publication", "timeline_events", "timeline_operation_sources", "version_changes", "worker_auth", "worker_pools", "workflow_run_batches", "workflow_run_requests", "workflow_runs", "workflow_workers"],
  51: ["explorer_overrides", "app_settings", "archive_transfers", "checkpoint_payloads", "command_audits", "commands", "database_state", "database_upgrades", "delegation_dependencies", "deleted_runs", "diagnostic_files", "diagnostic_snapshots", "dryrun_results", "extracted_artifacts", "generated_artifacts", "imported_artifacts", "notifications", "provider_requests", "provider_usage", "run_checkpoints", "run_delegations", "run_failures", "run_operation_attempts", "run_operations", "run_receipts", "run_results", "run_summaries", "settings_snapshots", "summary_publication", "timeline_events", "timeline_operation_sources", "version_changes", "worker_auth", "worker_pools", "workflow_run_batches", "workflow_run_requests", "workflow_runs", "workflow_workers"],
  50: ["app_settings", "archive_transfers", "checkpoint_payloads", "command_audits", "commands", "database_state", "database_upgrades", "delegation_dependencies", "deleted_runs", "diagnostic_files", "diagnostic_snapshots", "dryrun_results", "extracted_artifacts", "generated_artifacts", "imported_artifacts", "notifications", "provider_requests", "provider_usage", "run_checkpoints", "run_delegations", "run_failures", "run_operation_attempts", "run_operations", "run_receipts", "run_results", "run_summaries", "settings_snapshots", "summary_publication", "timeline_events", "timeline_operation_sources", "version_changes", "worker_auth", "worker_pools", "workflow_run_batches", "workflow_run_requests", "workflow_runs", "workflow_workers"],
  49: ["app_settings", "archive_relaunches", "archive_transfers", "checkpoint_payloads", "command_audits", "commands", "database_state", "database_upgrades", "delegation_dependencies", "deleted_runs", "diagnostic_files", "diagnostic_snapshots", "dryrun_results", "extracted_artifacts", "generated_artifacts", "imported_artifacts", "notifications", "provider_requests", "provider_usage", "run_checkpoints", "run_delegations", "run_failures", "run_operation_attempts", "run_operations", "run_receipts", "run_results", "run_summaries", "settings_snapshots", "summary_publication", "timeline_events", "timeline_operation_sources", "version_changes", "worker_auth", "worker_pools", "workflow_run_batches", "workflow_run_requests", "workflow_runs", "workflow_workers"],
  48: ["app_settings", "archive_relaunches", "archive_transfers", "archived_runs", "checkpoint_payloads", "command_audits", "commands", "database_state", "database_upgrades", "delegation_dependencies", "deleted_runs", "diagnostic_files", "diagnostic_snapshots", "dryrun_results", "extracted_artifacts", "generated_artifacts", "imported_artifacts", "notifications", "provider_requests", "provider_usage", "run_checkpoints", "run_delegations", "run_failures", "run_operation_attempts", "run_operations", "run_receipts", "run_results", "run_summaries", "settings_snapshots", "summary_publication", "timeline_events", "timeline_operation_sources", "version_bump_applications", "version_changes", "version_plans", "worker_auth", "worker_pools", "workflow_run_batches", "workflow_run_requests", "workflow_runs", "workflow_workers"],
  30: V30_TABLES,
  31: [...V30_TABLES],
  32: V32_TABLES,
  33: V33_TABLES,
  34: V34_TABLES,
  35: V35_TABLES,
  36: V36_TABLES,
  37: V37_TABLES,
  38: [...V37_TABLES, "timeline_events"].sort(),
  39: [...V37_TABLES, "timeline_events"].map((name) => DATABASE_TABLE_RENAMES[name as keyof typeof DATABASE_TABLE_RENAMES] ?? name).sort(),
  40: [...V37_TABLES, "timeline_events", "timeline_operation_sources"]
    .filter((name) => !["ledger_partitions", "ledger_projections", "operation_outbox"].includes(name))
    .map((name) => DATABASE_TABLE_RENAMES[name as keyof typeof DATABASE_TABLE_RENAMES] ?? name).sort(),
});

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
  {
    /*
     * D267 (ref execution-and-sessions §10) — the Duo ceremony lease. One row
     * per credential identity; `generation` advances on every acquisition and
     * `state` moves held → released → held … as ceremonies serialize. Nothing
     * is ever deleted (a lease row that vanished would read as a free
     * credential), so the delete trigger aborts; updates are the design.
     */
    version: 16,
    statements: [
      SQLITE_TABLE_DDL.duo_ceremony_leases,
      "CREATE INDEX duo_ceremony_leases_state_idx ON duo_ceremony_leases(state, expires_at)",
      `CREATE TRIGGER duo_ceremony_leases_never_deleted
        BEFORE DELETE ON duo_ceremony_leases
        BEGIN SELECT RAISE(ABORT, 'duo_ceremony_leases rows are never deleted'); END`,
    ],
  },
  {
    /*
     * D269 (ref execution-and-sessions §11) — the worker POOL declaration, the
     * run SESSION, and the run row's membership column.
     *
     * `worker_pools` is updated under a version CAS and never deleted.
     * `run_sessions` is insert-only: both UPDATE and DELETE abort, exactly as
     * the archive tables do, because a group that can be rewritten is a weaker
     * record than the runs it names. `tasks.session_id` is a MIRRORED, NULLABLE
     * column (D230's `run_number` shape, `ALTER TABLE ADD COLUMN`): every
     * pre-v17 row keeps NULL, which D133 reads forward as "no session" — a
     * group back-filled onto those rows would be one nobody started. The index
     * is what makes "every member of session S" a lookup rather than a scan.
     */
    version: 17,
    statements: [
      SQLITE_TABLE_DDL.worker_pools,
      `CREATE TRIGGER worker_pools_never_deleted
        BEFORE DELETE ON worker_pools
        BEGIN SELECT RAISE(ABORT, 'worker_pools rows are never deleted'); END`,
      SQLITE_TABLE_DDL.run_sessions,
      "CREATE INDEX run_sessions_workflow_idx ON run_sessions(workflow, started_at)",
      `CREATE TRIGGER run_sessions_never_updated
        BEFORE UPDATE ON run_sessions
        BEGIN SELECT RAISE(ABORT, 'run_sessions rows are immutable'); END`,
      `CREATE TRIGGER run_sessions_never_deleted
        BEFORE DELETE ON run_sessions
        BEGIN SELECT RAISE(ABORT, 'run_sessions rows are never deleted'); END`,
      "ALTER TABLE tasks ADD COLUMN session_id TEXT",
      "CREATE INDEX tasks_session_id_idx ON tasks(session_id)",
    ],
  },
  {
    // Ref guards-and-tests §10.6 — durable, insert-only dry-run scenario evidence.
    // This branch originally allocated v16 concurrently with D267/D269. The
    // merged append-only history places its new table after those rows as v18.
    version: 18,
    statements: [
      SQLITE_TABLE_DDL.dry_run_scenario_results,
      `CREATE TRIGGER dry_run_scenario_results_immutable_update
        BEFORE UPDATE ON dry_run_scenario_results
        BEGIN
          SELECT RAISE(ABORT, 'dry-run scenario results are immutable');
        END`,
      `CREATE TRIGGER dry_run_scenario_results_never_deleted
        BEFORE DELETE ON dry_run_scenario_results
        BEGIN
          SELECT RAISE(ABORT, 'dry-run scenario results are never deleted');
        END`,
    ],
  },
  {
    // DCR5 — the attachment bytes are content-addressed; this row is the
    // insert-only proof of the exact selection, artifact and download headers.
    version: 19,
    statements: [
      SQLITE_TABLE_DDL.operator_xlsx_exports,
      "CREATE INDEX operator_xlsx_exports_artifact_idx ON operator_xlsx_exports(artifact_id)",
      `CREATE TRIGGER operator_xlsx_exports_immutable_update
        BEFORE UPDATE ON operator_xlsx_exports
        BEGIN SELECT RAISE(ABORT, 'operator XLSX export evidence is immutable'); END`,
      `CREATE TRIGGER operator_xlsx_exports_never_deleted
        BEFORE DELETE ON operator_xlsx_exports
        BEGIN SELECT RAISE(ABORT, 'operator XLSX export evidence is never deleted'); END`,
    ],
  },
  {
    // D288 — insert-only, secret-keyed pseudonym evidence. A rotation appends
    // a different public generation for the run; it never rewrites history.
    version: 20,
    statements: [
      SQLITE_TABLE_DDL.activity_person_pseudonyms,
      "CREATE INDEX activity_person_pseudonyms_generation_value_idx ON activity_person_pseudonyms(key_generation, pseudonym)",
      `CREATE TRIGGER activity_person_pseudonyms_immutable_update
        BEFORE UPDATE ON activity_person_pseudonyms
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym evidence is immutable'); END`,
      `CREATE TRIGGER activity_person_pseudonyms_never_deleted
        BEFORE DELETE ON activity_person_pseudonyms
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym evidence is never deleted'); END`,
    ],
  },
  {
    // D288 review — SQLite REPLACE may delete a conflicting row without
    // running DELETE triggers when recursive_triggers is disabled. Refuse the
    // conflict in BEFORE INSERT, before REPLACE can reach that delete path.
    version: 21,
    statements: [
      `CREATE TRIGGER activity_person_pseudonyms_immutable_insert_conflict
        BEFORE INSERT ON activity_person_pseudonyms
        WHEN EXISTS (
          SELECT 1 FROM activity_person_pseudonyms AS existing
          WHERE existing.record_key = NEW.record_key
             OR (existing.run_id = NEW.run_id AND existing.key_generation = NEW.key_generation)
        )
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym evidence insert conflicts with immutable evidence'); END`,
    ],
  },
  {
    // D288 review — a generation is durably and immutably committed to one
    // secret key before evidence for that generation may be appended.
    version: 22,
    statements: [
      SQLITE_TABLE_DDL.activity_person_pseudonym_generations,
      `CREATE TRIGGER activity_person_pseudonym_generations_immutable_update
        BEFORE UPDATE ON activity_person_pseudonym_generations
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym generation binding is immutable'); END`,
      `CREATE TRIGGER activity_person_pseudonym_generations_never_deleted
        BEFORE DELETE ON activity_person_pseudonym_generations
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym generation binding is never deleted'); END`,
      `CREATE TRIGGER activity_person_pseudonym_generations_immutable_insert_conflict
        BEFORE INSERT ON activity_person_pseudonym_generations
        WHEN EXISTS (
          SELECT 1 FROM activity_person_pseudonym_generations AS existing
          WHERE existing.record_key = NEW.record_key
             OR existing.key_generation = NEW.key_generation
        )
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym generation binding conflicts with immutable authority'); END`,
      `CREATE TRIGGER activity_person_pseudonyms_require_generation_binding
        BEFORE INSERT ON activity_person_pseudonyms
        WHEN NOT EXISTS (
          SELECT 1 FROM activity_person_pseudonym_generations AS generation
          WHERE generation.key_generation = NEW.key_generation
        )
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym evidence requires a generation binding'); END`,
    ],
  },
  {
    // D288 storage review — v21 evidence predates key commitments, and no
    // migration can reconstruct which secret produced it. This transient
    // guard runs in the same exclusive transaction as v22, so refusal rolls
    // back the table, triggers, metadata and user_version together.
    version: 23,
    statements: [
      `CREATE TABLE activity_person_pseudonym_v21_upgrade_guard (
        evidence_count INTEGER NOT NULL
      ) STRICT`,
      `CREATE TRIGGER activity_person_pseudonym_v21_upgrade_guard_refusal
        BEFORE INSERT ON activity_person_pseudonym_v21_upgrade_guard
        WHEN NEW.evidence_count <> 0
        BEGIN
          SELECT RAISE(ABORT, 'v21 activity person pseudonym evidence has no truthful key commitment');
        END`,
      `INSERT INTO activity_person_pseudonym_v21_upgrade_guard (evidence_count)
        SELECT count(*)
        FROM activity_person_pseudonyms AS evidence
        LEFT JOIN activity_person_pseudonym_generations AS generation
          ON generation.key_generation = evidence.key_generation
        WHERE generation.key_generation IS NULL`,
      "DROP TABLE activity_person_pseudonym_v21_upgrade_guard",
    ],
  },
  {
    // D75 — v1 rows remain NULL/unattributed forever; v2 rows mirror the
    // server-derived actor. The insert guard closes SQLite REPLACE's implicit
    // delete path without changing the released v19 triggers.
    version: 24,
    statements: [
      "ALTER TABLE operator_xlsx_exports ADD COLUMN requested_by TEXT",
      `CREATE TRIGGER operator_xlsx_exports_immutable_insert_conflict
        BEFORE INSERT ON operator_xlsx_exports
        WHEN EXISTS (
          SELECT 1 FROM operator_xlsx_exports AS existing
          WHERE existing.record_key = NEW.record_key
        )
        BEGIN SELECT RAISE(ABORT, 'operator XLSX export evidence insert conflicts with immutable evidence'); END`,
    ],
  },
  {
    // The singleton dashboard-activated settings/config generation. Workers
    // compare it transactionally before a queued row can become claimed.
    version: 25,
    statements: [
      SQLITE_TABLE_DDL.runtime_config,
      `CREATE TRIGGER runtime_config_never_deleted
        BEFORE DELETE ON runtime_config
        BEGIN SELECT RAISE(ABORT, 'runtime_config authority is never deleted'); END`,
      `CREATE TRIGGER runtime_config_generation_advances
        BEFORE UPDATE ON runtime_config
        WHEN NEW.generation <> OLD.generation + 1
        BEGIN SELECT RAISE(ABORT, 'runtime_config generation must advance exactly once'); END`,
    ],
  },
  {
    // The exact latest settings result, committed atomically with its command audit.
    version: 26,
    statements: [
      SQLITE_TABLE_DDL.settings_current,
      `CREATE TRIGGER settings_current_never_deleted
        BEFORE DELETE ON settings_current
        BEGIN SELECT RAISE(ABORT, 'settings current authority is never deleted'); END`,
      `CREATE TRIGGER settings_current_revision_advances
        BEFORE UPDATE ON settings_current
        WHEN NEW.revision <> OLD.revision + 1
        BEGIN SELECT RAISE(ABORT, 'settings current revision must advance exactly once'); END`,
    ],
  },
  {
    // D235 replay binds one bulk id to one exact ordered accepted parent before
    // any child command can reach the kernel.
    version: 27,
    statements: [
      SQLITE_TABLE_DDL.bulk_command_acceptances,
      `CREATE TRIGGER bulk_command_acceptances_immutable_update
        BEFORE UPDATE ON bulk_command_acceptances
        BEGIN SELECT RAISE(ABORT, 'bulk command acceptances are immutable'); END`,
      `CREATE TRIGGER bulk_command_acceptances_never_deleted
        BEFORE DELETE ON bulk_command_acceptances
        BEGIN SELECT RAISE(ABORT, 'bulk command acceptances are never deleted'); END`,
    ],
  },
  {
    // D294 — the rebuild never reached production, so the retired phone
    // capture product leaves no live compatibility surface. Refuse databases
    // that contain capture-owned or capture-derived authority rather than
    // silently deleting history; empty shells are then removed in place.
    version: 28,
    statements: [
      `CREATE TABLE phone_capture_retirement_guard (
        dependent_rows INTEGER NOT NULL
      ) STRICT`,
      `CREATE TRIGGER phone_capture_retirement_guard_refusal
        BEFORE INSERT ON phone_capture_retirement_guard
        WHEN NEW.dependent_rows <> 0
        BEGIN
          SELECT RAISE(ABORT, 'phone capture retirement refuses a database containing capture authority');
        END`,
      `INSERT INTO phone_capture_retirement_guard (dependent_rows)
        SELECT
          (SELECT count(*) FROM capture_sessions)
          + (SELECT count(*) FROM capture_photo_order)
          + (SELECT count(*) FROM capture_finalization_outboxes)
          + (SELECT count(*) FROM commands
              WHERE family = 'capture'
                 OR json_extract(record_json, '$.family') = 'capture'
                 OR json_extract(record_json, '$.type') LIKE 'capture-%')
          + (SELECT count(*) FROM command_audits
              WHERE json_extract(record_json, '$.request.family') = 'capture'
                 OR json_extract(record_json, '$.request.type') LIKE 'capture-%')
          + (SELECT count(*) FROM run_sessions
              WHERE json_extract(record_json, '$.origin.kind') = 'capture-handoff')
          + (SELECT count(*) FROM intake_manifests
              WHERE json_type(record_json, '$.capture') IS NOT NULL)`,
      "DROP TABLE phone_capture_retirement_guard",
      "DROP TABLE capture_finalization_outboxes",
      "DROP TABLE capture_photo_order",
      "DROP TABLE capture_sessions",
    ],
  },
  {
    // D308 — delete means delete. A terminal run, on the queue or in the
    // Archive, can be removed from authority with every row it owns. The
    // `deleted_runs` tombstone is insert-only and written FIRST; each
    // never-delete trigger below is relaxed to pass ONLY behind a tombstone for
    // that exact run, so no other code path gains a delete. This migration
    // removes no rows.
    version: 29,
    statements: [
      SQLITE_TABLE_DDL.deleted_runs,
      "CREATE INDEX deleted_runs_workflow_idx ON deleted_runs(workflow, deleted_at)",
      // The tombstone is written with an EMPTY tally before the cascade (the
      // relaxed triggers must see it) and settled with the final tally once.
      // Only that one-way settle is an admitted UPDATE; every other change aborts.
      `CREATE TRIGGER deleted_runs_immutable_update
        BEFORE UPDATE ON deleted_runs
        WHEN NOT (
          NEW.record_key = OLD.record_key
          AND NEW.workflow = OLD.workflow
          AND NEW.trace_id = OLD.trace_id
          AND NEW.origin = OLD.origin
          AND NEW.command_id = OLD.command_id
          AND NEW.deleted_at = OLD.deleted_at
          AND NEW.created_at = OLD.created_at
          AND json_array_length(OLD.record_json, '$.removed') = 0
          AND json_array_length(NEW.record_json, '$.removed') > 0
        )
        BEGIN SELECT RAISE(ABORT, 'deleted run tombstones are immutable once their tally is settled'); END`,
      `CREATE TRIGGER deleted_runs_never_deleted
        BEFORE DELETE ON deleted_runs
        BEGIN SELECT RAISE(ABORT, 'deleted run tombstones are never deleted'); END`,
      `CREATE TRIGGER deleted_runs_immutable_insert_conflict
        BEFORE INSERT ON deleted_runs
        WHEN EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = NEW.record_key)
        BEGIN SELECT RAISE(ABORT, 'deleted run tombstone already exists for this run'); END`,
      `CREATE TRIGGER deleted_runs_require_live_run_insert
        BEFORE INSERT ON deleted_runs
        WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE record_key = NEW.record_key)
        BEGIN SELECT RAISE(ABORT, 'a deleted run tombstone names a run that authority does not hold'); END`,
      "DROP TRIGGER archived_runs_never_deleted",
      `CREATE TRIGGER archived_runs_never_deleted
        BEFORE DELETE ON archived_runs
        WHEN NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = OLD.record_key)
        BEGIN
          SELECT RAISE(ABORT, 'archived runs are never deleted outside a D308 deleted_runs tombstone');
        END`,
      "DROP TRIGGER archive_relaunches_never_deleted",
      `CREATE TRIGGER archive_relaunches_never_deleted
        BEFORE DELETE ON archive_relaunches
        WHEN NOT EXISTS (
          SELECT 1 FROM deleted_runs WHERE record_key = OLD.archived_run_id OR record_key = OLD.record_key
        )
        BEGIN
          SELECT RAISE(ABORT, 'relaunch provenance is never deleted outside a D308 deleted_runs tombstone');
        END`,
      "DROP TRIGGER dry_run_scenario_results_never_deleted",
      `CREATE TRIGGER dry_run_scenario_results_never_deleted
        BEFORE DELETE ON dry_run_scenario_results
        WHEN OLD.run_id IS NULL OR NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = OLD.run_id)
        BEGIN
          SELECT RAISE(ABORT, 'dry-run scenario results are never deleted outside a D308 deleted_runs tombstone');
        END`,
      "DROP TRIGGER activity_person_pseudonyms_never_deleted",
      `CREATE TRIGGER activity_person_pseudonyms_never_deleted
        BEFORE DELETE ON activity_person_pseudonyms
        WHEN NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = OLD.run_id)
        BEGIN SELECT RAISE(ABORT, 'activity person pseudonym evidence is never deleted outside a D308 deleted_runs tombstone'); END`,
      "DROP TRIGGER ledger_projections_never_deleted",
      `CREATE TRIGGER ledger_projections_never_deleted
        BEFORE DELETE ON ledger_projections
        WHEN NOT EXISTS (
          SELECT 1 FROM durable_outbox AS outbox
          JOIN write_intents AS intent ON intent.record_key = outbox.write_intent_id
          JOIN deleted_runs AS tombstone ON tombstone.record_key = json_extract(intent.record_json, '$.runId')
          WHERE outbox.record_key = OLD.record_key
        )
        BEGIN
          SELECT RAISE(ABORT, 'ledger projections are never deleted outside a D308 deleted_runs tombstone');
        END`,
    ],
  },
  {
    // D332 — the one stopped-system authority upgrade journal. Every append
    // has its own opaque key; planned attempts may repeat, while the three
    // decisive phases are unique per upgrade identity.
    version: 30,
    statements: [
      "ALTER TABLE deleted_runs ADD COLUMN item_id TEXT",
      "ALTER TABLE deleted_runs ADD COLUMN attempt INTEGER CHECK (attempt IS NULL OR attempt >= 1)",
      "ALTER TABLE deleted_runs ADD COLUMN run_number INTEGER CHECK (run_number IS NULL OR run_number >= 1)",
      "ALTER TABLE deleted_runs ADD COLUMN ordinal_source TEXT CHECK (ordinal_source IS NULL OR ordinal_source IN ('tombstone','span-root-backfill','unknown'))",
      "DROP TRIGGER deleted_runs_immutable_update",
      `CREATE TRIGGER deleted_runs_immutable_update
        BEFORE UPDATE ON deleted_runs
        WHEN NOT (
          NEW.record_key = OLD.record_key
          AND NEW.workflow = OLD.workflow
          AND NEW.trace_id = OLD.trace_id
          AND NEW.item_id IS OLD.item_id
          AND NEW.attempt IS OLD.attempt
          AND NEW.run_number IS OLD.run_number
          AND NEW.ordinal_source IS OLD.ordinal_source
          AND NEW.origin = OLD.origin
          AND NEW.command_id = OLD.command_id
          AND NEW.deleted_at = OLD.deleted_at
          AND NEW.created_at = OLD.created_at
          AND json_array_length(OLD.record_json, '$.removed') = 0
          AND json_array_length(NEW.record_json, '$.removed') > 0
        )
        BEGIN SELECT RAISE(ABORT, 'deleted run tombstones are immutable once their tally is settled'); END`,
      `CREATE TRIGGER checkpoint_payloads_never_deleted
        BEFORE DELETE ON checkpoint_payloads
        WHEN substr(OLD.record_key, 37, 1) <> ':'
          OR NOT EXISTS (
            SELECT 1 FROM deleted_runs
            WHERE record_key = substr(OLD.record_key, 1, 36)
          )
        BEGIN
          SELECT RAISE(ABORT, 'checkpoint payloads are never deleted outside a D308 deleted_runs tombstone');
        END`,
      SQLITE_TABLE_DDL.protected_settings_current,
      `CREATE TRIGGER protected_settings_current_never_deleted
        BEFORE DELETE ON protected_settings_current
        BEGIN SELECT RAISE(ABORT, 'protected settings current authority is never deleted'); END`,
      `CREATE TRIGGER protected_settings_current_revision_advances
        BEFORE UPDATE ON protected_settings_current
        WHEN NEW.revision <> OLD.revision + 1
        BEGIN SELECT RAISE(ABORT, 'protected settings current revision must advance exactly once'); END`,
      SQLITE_TABLE_DDL.authority_upgrades,
      "CREATE UNIQUE INDEX authority_upgrades_baseline_unique ON authority_upgrades(upgrade_id) WHERE phase = 'baseline'",
      "CREATE UNIQUE INDEX authority_upgrades_committed_unique ON authority_upgrades(upgrade_id) WHERE phase = 'committed'",
      "CREATE UNIQUE INDEX authority_upgrades_settled_unique ON authority_upgrades(upgrade_id) WHERE phase = 'settled'",
      `CREATE TRIGGER authority_upgrades_immutable_update
        BEFORE UPDATE ON authority_upgrades
        BEGIN SELECT RAISE(ABORT, 'authority upgrade journal rows are immutable'); END`,
      `CREATE TRIGGER authority_upgrades_never_deleted
        BEFORE DELETE ON authority_upgrades
        BEGIN SELECT RAISE(ABORT, 'authority upgrade journal rows are never deleted'); END`,
    ],
  },
  {
    // D330.9 / Task 1.6.2-1: relaunch provenance belongs to the NEW run.
    // Removing an archived source therefore preserves every live descendant's
    // lineage; deleting the new run still removes its row behind that run's
    // own D308 tombstone. No other authority shape changes in v31.
    version: 31,
    statements: [
      "DROP TRIGGER archive_relaunches_immutable_update",
      "DROP TRIGGER archive_relaunches_never_deleted",
      "DROP INDEX archive_relaunches_source_idx",
      `CREATE TABLE archive_relaunches_v31 (
        record_key TEXT PRIMARY KEY REFERENCES tasks(record_key) ON DELETE RESTRICT,
        archived_run_id TEXT NOT NULL,
        record_json TEXT NOT NULL CHECK (json_valid(record_json)),
        created_at TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO archive_relaunches_v31
        (record_key, archived_run_id, record_json, created_at)
        SELECT record_key, archived_run_id, record_json, created_at FROM archive_relaunches`,
      "DROP TABLE archive_relaunches",
      "ALTER TABLE archive_relaunches_v31 RENAME TO archive_relaunches",
      "CREATE INDEX archive_relaunches_source_idx ON archive_relaunches(archived_run_id, created_at)",
      `CREATE TRIGGER archive_relaunches_immutable_update
        BEFORE UPDATE ON archive_relaunches
        BEGIN
          SELECT RAISE(ABORT, 'relaunch provenance is immutable; a second relaunch is a second row');
        END`,
      `CREATE TRIGGER archive_relaunches_never_deleted
        BEFORE DELETE ON archive_relaunches
        WHEN NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = OLD.record_key)
        BEGIN
          SELECT RAISE(ABORT, 'relaunch provenance is never deleted outside its new run D308 tombstone');
        END`,
    ],
  },
  {
    // D336: ordinary values share the current command/audit transaction. An
    // existing row must be enriched by the stopped upgrade before this step;
    // silently importing empty defaults would lose settings authority.
    version: 32,
    statements: [
      "DROP TRIGGER settings_current_never_deleted",
      "DROP TRIGGER settings_current_revision_advances",
      "ALTER TABLE settings_current RENAME TO settings_current_v31",
      SQLITE_TABLE_DDL.settings_current.replace(
        "CHECK (json_valid(record_json))",
        "CHECK (json_valid(record_json) AND json_type(record_json, '$.settings') IS 'object')",
      ),
      "INSERT INTO settings_current SELECT * FROM settings_current_v31",
      "DROP TABLE settings_current_v31",
      `CREATE TRIGGER settings_current_never_deleted
        BEFORE DELETE ON settings_current
        BEGIN SELECT RAISE(ABORT, 'settings current authority is never deleted'); END`,
      `CREATE TRIGGER settings_current_revision_advances
        BEFORE UPDATE ON settings_current
        WHEN NEW.revision <> OLD.revision + 1
        BEGIN SELECT RAISE(ABORT, 'settings current revision must advance exactly once'); END`,
      "DROP TABLE protected_settings_current",
    ],
  },
  {
    // Workflow batches own queue presentation; run identity and membership survive unchanged.
    version: 33,
    statements: [
      "ALTER TABLE tasks RENAME TO workflow_runs",
      "ALTER TABLE run_sessions RENAME TO workflow_run_batches",
      "DROP TRIGGER run_sessions_never_updated",
      "ALTER TABLE workflow_run_batches ADD COLUMN group_in_queue INTEGER NOT NULL DEFAULT 0 CHECK (group_in_queue IN (0, 1))",
      "ALTER TABLE workflow_run_batches ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)",
      `UPDATE workflow_run_batches SET record_json = json_set(record_json, '$.groupInQueue', json('false'), '$.version', 1)`,
      `CREATE TRIGGER workflow_run_batches_presentation_only
        BEFORE UPDATE ON workflow_run_batches
        WHEN NEW.record_key IS NOT OLD.record_key OR NEW.workflow IS NOT OLD.workflow
          OR NEW.started_at IS NOT OLD.started_at OR NEW.created_at IS NOT OLD.created_at
          OR EXISTS (SELECT fullkey, type, atom FROM json_tree(json_remove(NEW.record_json, '$.groupInQueue', '$.version')) EXCEPT SELECT fullkey, type, atom FROM json_tree(json_remove(OLD.record_json, '$.groupInQueue', '$.version')))
          OR EXISTS (SELECT fullkey, type, atom FROM json_tree(json_remove(OLD.record_json, '$.groupInQueue', '$.version')) EXCEPT SELECT fullkey, type, atom FROM json_tree(json_remove(NEW.record_json, '$.groupInQueue', '$.version')))
          OR NEW.version <> OLD.version + 1
          OR NEW.version IS NOT json_extract(NEW.record_json, '$.version')
          OR NEW.group_in_queue IS NOT json_extract(NEW.record_json, '$.groupInQueue')
        BEGIN SELECT RAISE(ABORT, 'workflow batch identity is immutable; presentation must advance one version'); END`,
    ],
  },
  {
    // A3: canonical read/list replaced the write-only run projection mirror.
    version: 34,
    statements: ["DROP TABLE runs_view"],
  },
  {
    version: 35,
    statements: [
      "ALTER TABLE leases RENAME TO workflow_workers",
      "ALTER TABLE duo_ceremony_leases RENAME TO worker_auth",
      "ALTER TABLE start_plans RENAME TO workflow_run_requests",
    ],
  },
  {
    // Operation names preserve row bytes, keys, foreign keys and tombstone admission.
    version: 36,
    statements: [
      "ALTER TABLE write_intents RENAME TO run_operations",
      "ALTER TABLE write_attempts RENAME TO run_operation_attempts",
      "ALTER TABLE durable_outbox RENAME TO operation_outbox",
      "DROP INDEX durable_outbox_intent_id_idx",
      "CREATE INDEX operation_outbox_intent_id_idx ON operation_outbox(write_intent_id)",
      "DROP INDEX durable_outbox_kind_idx",
      "CREATE INDEX operation_outbox_kind_idx ON operation_outbox(kind, created_at)",
      "DROP INDEX write_attempts_intent_id_idx",
      "CREATE INDEX run_operation_attempts_intent_id_idx ON run_operation_attempts(write_intent_id)",
      "DROP TRIGGER write_intents_require_permanent_key_insert",
      "CREATE TRIGGER run_operations_require_permanent_key_insert\n        BEFORE INSERT ON run_operations\n        WHEN NEW.system IS NULL OR NEW.idempotency_key IS NULL\n        BEGIN\n          SELECT RAISE(ABORT, 'run_operations requires system and idempotency_key');\n        END",
      "DROP TRIGGER write_intents_require_permanent_key_update",
      "CREATE TRIGGER run_operations_require_permanent_key_update\n        BEFORE UPDATE OF system, idempotency_key ON run_operations\n        WHEN NEW.system IS NULL OR NEW.idempotency_key IS NULL\n        BEGIN\n          SELECT RAISE(ABORT, 'run_operations requires system and idempotency_key');\n        END",
      "DROP INDEX write_intents_system_idempotency_key_idx",
      "CREATE UNIQUE INDEX run_operations_system_idempotency_key_idx ON run_operations(system, idempotency_key)",
    ],
  },
  {
    // side/command-groups: data-aware preflight/linkage runs in the stopped adapter.
    version: 37,
    statements: [
      "ALTER TABLE commands ADD COLUMN parent_command_id TEXT REFERENCES commands(record_key) ON DELETE RESTRICT",
      "CREATE INDEX commands_parent_idx ON commands(parent_command_id)",
      "ALTER TABLE delegation_manifests RENAME TO run_delegations",
      "ALTER TABLE dependencies RENAME TO delegation_dependencies",
      `INSERT INTO commands(record_key, family, record_json, created_at)
        SELECT record_key, 'bulk-parent', json_object('kind', 'bulk-parent', 'commandId', record_key, 'acceptance', json(record_json)), created_at
        FROM bulk_command_acceptances`,
      "DROP TABLE bulk_command_acceptances",
      `CREATE TRIGGER commands_bulk_immutable_update
        BEFORE UPDATE ON commands WHEN OLD.family = 'bulk-parent'
        BEGIN SELECT RAISE(ABORT, 'bulk parent acceptance is immutable'); END`,
      `CREATE TRIGGER commands_bulk_never_deleted
        BEFORE DELETE ON commands WHEN OLD.family = 'bulk-parent'
        BEGIN SELECT RAISE(ABORT, 'bulk parent acceptance is never deleted'); END`,
      `CREATE TRIGGER command_audits_no_bulk_parent_insert
        BEFORE INSERT ON command_audits
        WHEN EXISTS (SELECT 1 FROM commands WHERE record_key = NEW.command_id AND family = 'bulk-parent')
        BEGIN SELECT RAISE(ABORT, 'bulk parent acceptance has no execution audit'); END`,
      `CREATE TRIGGER commands_parent_immutable_update
        BEFORE UPDATE OF parent_command_id ON commands
        WHEN NEW.parent_command_id IS NOT OLD.parent_command_id
        BEGIN SELECT RAISE(ABORT, 'command parent linkage is immutable'); END`,
      `CREATE TRIGGER commands_parent_kind_insert
        BEFORE INSERT ON commands
        WHEN NEW.parent_command_id IS NOT NULL AND
          (NEW.record_key = NEW.parent_command_id OR NEW.family <> 'run' OR
           NOT EXISTS (SELECT 1 FROM commands WHERE record_key = NEW.parent_command_id
             AND family = 'bulk-parent' AND parent_command_id IS NULL))
        BEGIN SELECT RAISE(ABORT, 'command parent must be a direct bulk parent'); END`,
    ],
  },
  {
    version: 38,
    statements: [TIMELINE_EVENT_TABLE_DDL, ...TIMELINE_EVENT_INDEX_DDL],
  },
  {
    version: 39,
    statements: [
      "ALTER TABLE authority_meta RENAME TO database_state",
      "ALTER TABLE authority_upgrades RENAME TO database_upgrades",
      "ALTER TABLE diagnostic_bundles RENAME TO diagnostic_snapshots",
      "ALTER TABLE diagnostic_attachments RENAME TO diagnostic_files",
      "ALTER TABLE evidence_receipts RENAME TO run_receipts",
      "ALTER TABLE config_snapshots RENAME TO settings_snapshots",
      "ALTER TABLE dry_run_scenario_results RENAME TO dryrun_results",
    ],
  },
  {
    version: 40,
    statements: [
      SQLITE_TABLE_DDL.timeline_operation_sources,
      "ALTER TABLE archived_runs ADD COLUMN transactions_json TEXT CHECK (transactions_json IS NULL OR json_valid(transactions_json))",
      "ALTER TABLE archived_runs ADD COLUMN transactions_digest TEXT",
      "DROP TRIGGER archived_runs_immutable_update",
      `CREATE TRIGGER archived_runs_immutable_update BEFORE UPDATE ON archived_runs
        WHEN NEW.record_json IS NOT OLD.record_json OR NEW.content_digest IS NOT OLD.content_digest
          OR NEW.record_key IS NOT OLD.record_key OR NEW.application_id IS NOT OLD.application_id
          OR NEW.workflow IS NOT OLD.workflow OR NEW.descriptor_version IS NOT OLD.descriptor_version
          OR NEW.contract_fingerprint IS NOT OLD.contract_fingerprint OR NEW.app_version IS NOT OLD.app_version
          OR NEW.created_at IS NOT OLD.created_at OR OLD.transactions_json IS NOT NULL
          OR NEW.transactions_json IS NULL OR NEW.transactions_digest IS NULL
        BEGIN SELECT RAISE(ABORT, 'archive content and transaction enrichment are immutable'); END`,
      "DROP TABLE ledger_projections",
      "DROP TABLE ledger_partitions",
      "DROP TABLE operation_outbox",
      `CREATE TRIGGER timeline_operation_sources_immutable BEFORE UPDATE ON timeline_operation_sources
        BEGIN SELECT RAISE(ABORT, 'historical operation sources are immutable'); END`,
      `CREATE TRIGGER timeline_operation_sources_owned_delete BEFORE DELETE ON timeline_operation_sources
        WHEN NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = json_extract(OLD.record_json, '$.runId'))
        BEGIN SELECT RAISE(ABORT, 'historical operation source requires owner deletion'); END`,
    ],
  },
  {
    // C: stopped conversion validates and enriches every row before these retirements.
    version: 41,
    statements: [
      "ALTER TABLE failures RENAME TO run_failures",
      "DROP INDEX failures_run_id_idx",
      "CREATE INDEX run_failures_run_id_idx ON run_failures(run_id)",
      "DROP INDEX failures_fingerprint_idx",
      "CREATE INDEX run_failures_fingerprint_idx ON run_failures(fingerprint, created_at)",
      "DROP TRIGGER failures_require_fingerprint_insert",
      `CREATE TRIGGER run_failures_require_fingerprint_insert BEFORE INSERT ON run_failures
        WHEN NEW.fingerprint IS NULL OR NEW.fingerprint IS NOT json_extract(NEW.record_json, '$.fingerprint')
        BEGIN SELECT RAISE(ABORT, 'run_failures requires the searchable fingerprint column'); END`,
      "DROP TABLE run_terminal_outbox",
      "DROP TABLE run_terminal_authorizations",
      `CREATE TRIGGER workflow_runs_completion_insert BEFORE INSERT ON workflow_runs
        WHEN COALESCE(json_extract(NEW.record_json, '$.lifecycle.outcome') IN ('done','failed'), 0)
          IS NOT (json_type(NEW.record_json, '$.completion') IS 'object')
          OR (json_type(NEW.record_json, '$.completion') IS 'object' AND (
            json_extract(NEW.record_json, '$.completion.schemaVersion') IS NOT 1
            OR json_extract(NEW.record_json, '$.lifecycle.state') IS NOT 'terminal'
            OR json_extract(NEW.record_json, '$.completion.kind') IS NOT json_extract(NEW.record_json, '$.lifecycle.outcome')
            OR json_extract(NEW.record_json, '$.completion.authorizedAt') IS NOT json_extract(NEW.record_json, '$.lifecycle.endedAt')
            OR json_extract(NEW.record_json, '$.completion.claim.claimGeneration') IS NOT NEW.claim_generation
            OR json_type(NEW.record_json, '$.completion.claim.workerId') IS NOT 'text'
            OR json_type(NEW.record_json, '$.completion.expectedVersion') IS NOT 'integer'
            OR json_extract(NEW.record_json, '$.completion.expectedVersion') < 1
            OR NEW.version < json_extract(NEW.record_json, '$.completion.expectedVersion') + 1
            OR (json_extract(NEW.record_json, '$.completion.kind') = 'failed' AND
              json_extract(NEW.record_json, '$.completion.failureId') IS NOT json_extract(NEW.record_json, '$.lifecycle.failureId'))
            OR (json_extract(NEW.record_json, '$.completion.kind') = 'done' AND
              json_type(NEW.record_json, '$.completion.resultDigest') IS NOT 'text')
          ))
        BEGIN SELECT RAISE(ABORT, 'run completion must bind its exact terminal consequence'); END`,
      `CREATE TRIGGER workflow_runs_completion_update BEFORE UPDATE ON workflow_runs
        WHEN COALESCE(json_extract(NEW.record_json, '$.lifecycle.outcome') IN ('done','failed'), 0)
          IS NOT (json_type(NEW.record_json, '$.completion') IS 'object')
          OR (json_type(NEW.record_json, '$.completion') IS 'object' AND (
            json_extract(NEW.record_json, '$.completion.schemaVersion') IS NOT 1
            OR json_extract(NEW.record_json, '$.lifecycle.state') IS NOT 'terminal'
            OR json_extract(NEW.record_json, '$.completion.kind') IS NOT json_extract(NEW.record_json, '$.lifecycle.outcome')
            OR json_extract(NEW.record_json, '$.completion.authorizedAt') IS NOT json_extract(NEW.record_json, '$.lifecycle.endedAt')
            OR json_extract(NEW.record_json, '$.completion.claim.claimGeneration') IS NOT NEW.claim_generation
            OR json_type(NEW.record_json, '$.completion.claim.workerId') IS NOT 'text'
            OR json_type(NEW.record_json, '$.completion.expectedVersion') IS NOT 'integer'
            OR json_extract(NEW.record_json, '$.completion.expectedVersion') < 1
            OR NEW.version < json_extract(NEW.record_json, '$.completion.expectedVersion') + 1
            OR (json_extract(NEW.record_json, '$.completion.kind') = 'failed' AND
              json_extract(NEW.record_json, '$.completion.failureId') IS NOT json_extract(NEW.record_json, '$.lifecycle.failureId'))
            OR (json_extract(NEW.record_json, '$.completion.kind') = 'done' AND
              json_type(NEW.record_json, '$.completion.resultDigest') IS NOT 'text')
          ))
        BEGIN SELECT RAISE(ABORT, 'run completion must bind its exact terminal consequence'); END`,
      `CREATE TRIGGER workflow_runs_completion_immutable BEFORE UPDATE ON workflow_runs
        WHEN (json_type(OLD.record_json, '$.completion') IS 'object' AND (
            json_extract(NEW.record_json, '$.completion') IS NOT json_extract(OLD.record_json, '$.completion')
            OR json_extract(NEW.record_json, '$.lifecycle') IS NOT json_extract(OLD.record_json, '$.lifecycle')
            OR NEW.claim_generation IS NOT OLD.claim_generation))
          OR (json_type(OLD.record_json, '$.completion') IS NULL AND json_type(NEW.record_json, '$.completion') IS 'object' AND (
            OLD.state NOT IN ('claimed','validating','running')
            OR json_extract(NEW.record_json, '$.completion.claim.workerId') IS NOT OLD.owner_worker_id
            OR json_extract(NEW.record_json, '$.completion.claim.claimGeneration') IS NOT OLD.claim_generation
            OR json_extract(NEW.record_json, '$.completion.expectedVersion') IS NOT OLD.version
            OR NEW.version IS NOT OLD.version + 1
            OR json_extract(NEW.record_json, '$.updatedAt') IS NOT json_extract(NEW.record_json, '$.completion.authorizedAt')))
        BEGIN SELECT RAISE(ABORT, 'run completion is immutable and requires the exact current claim'); END`,
    ],
  },
  {
    version: 42,
    statements: [
      IMPORTED_ARTIFACT_DDL,
      ...IMPORTED_ARTIFACT_TRIGGERS,
      "DROP TABLE intake_sessions",
      "DROP TABLE intake_manifests",
      "ALTER TABLE ocr_extractions RENAME TO extracted_artifacts",
    ],
  },
  { version: 43, statements: [
    PROVIDER_REQUEST_DDL, PROVIDER_USAGE_DDL, ...PROVIDER_STORAGE_CONSTRAINTS,
    "CREATE INDEX provider_requests_run_idx ON provider_requests(run_id)",
    "CREATE INDEX provider_requests_capability_state_idx ON provider_requests(capability,state)",
    "DROP TABLE provider_admissions", "DROP TABLE provider_budget_counters",
  ] },
  { version: 44, statements: [APP_SETTINGS_DDL, "DROP TABLE runtime_config", "DROP TABLE settings_current"] },
  { version: 45, statements: [
    `ALTER TABLE run_failures ADD COLUMN resolution_json TEXT NOT NULL DEFAULT '{"status":"unresolved","version":1}' CHECK(json_valid(resolution_json))`,
    "ALTER TABLE run_failures ADD COLUMN resolution_version INTEGER NOT NULL DEFAULT 1 CHECK(resolution_version > 0)",
    `CREATE TRIGGER run_failures_evidence_immutable BEFORE UPDATE ON run_failures
      WHEN NEW.record_key IS NOT OLD.record_key OR NEW.run_id IS NOT OLD.run_id OR NEW.fingerprint IS NOT OLD.fingerprint
        OR NEW.record_json IS NOT OLD.record_json OR NEW.created_at IS NOT OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'run failure evidence is immutable'); END`,
    `CREATE TRIGGER run_failures_resolution_advances BEFORE UPDATE ON run_failures
      WHEN NEW.resolution_version <> OLD.resolution_version + 1 OR NEW.resolution_version IS NOT json_extract(NEW.resolution_json,'$.version')
      BEGIN SELECT RAISE(ABORT, 'failure resolution requires next version'); END`,
  ] },
  { version: 46, statements: [GENERATED_ARTIFACT_DDL, ...GENERATED_ARTIFACT_CONSTRAINTS, "DROP TABLE artifact_outbox", "DROP TABLE artifact_sink_heads", "DROP TABLE operator_xlsx_exports"] },
  { version: 47, statements: ["DROP TABLE spans", "DROP TABLE gates", "DROP TABLE notes", "DROP TABLE ocr_approvals", "DROP TABLE knowledge_records", "DROP TABLE fix_records"] },
  { version: 48, statements: ["DROP TABLE activity_person_pseudonyms", "DROP TABLE activity_person_pseudonym_generations", VERSION_CHANGES_DDL, ARCHIVE_TRANSFER_DDL, RUN_SUMMARIES_DDL, SUMMARY_PUBLICATION_DDL,
    `CREATE TRIGGER archive_transfers_immutable BEFORE UPDATE ON archive_transfers BEGIN SELECT RAISE(ABORT,'archive transfer identity is immutable'); END`,
    `CREATE TRIGGER archive_transfers_no_replace BEFORE INSERT ON archive_transfers WHEN EXISTS (SELECT 1 FROM archive_transfers WHERE record_key=NEW.record_key) BEGIN SELECT RAISE(ABORT,'archive transfer identity already exists'); END`,
    `CREATE TRIGGER archive_transfers_delete BEFORE DELETE ON archive_transfers WHEN NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key=OLD.record_key) BEGIN SELECT RAISE(ABORT,'archive transfer requires deletion receipt'); END`,
    `CREATE TRIGGER workflow_runs_reserved_identity BEFORE INSERT ON workflow_runs WHEN EXISTS (SELECT 1 FROM archive_transfers WHERE record_key=NEW.record_key) BEGIN SELECT RAISE(ABORT,'run identity is archived'); END`,
    "DROP TRIGGER timeline_events_confirmed_retained",
    `CREATE TRIGGER timeline_events_confirmed_retained BEFORE DELETE ON timeline_events
      WHEN OLD.retention_class='confirmed-operation'
        AND NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key=OLD.run_id)
        AND NOT EXISTS (SELECT 1 FROM archive_transfers WHERE record_key=OLD.run_id)
      BEGIN SELECT RAISE(ABORT,'confirmed timeline history requires owner deletion or verified transfer'); END`,
    "DROP TRIGGER deleted_runs_require_live_run_insert",
    `CREATE TRIGGER deleted_runs_require_live_run_insert BEFORE INSERT ON deleted_runs
      WHEN NOT EXISTS (SELECT 1 FROM workflow_runs WHERE record_key=NEW.record_key)
        AND NOT EXISTS (SELECT 1 FROM archive_transfers WHERE record_key=NEW.record_key)
      BEGIN SELECT RAISE(ABORT,'a deleted run tombstone names a run that authority does not hold'); END`,
    ...[
      ["archived_runs_never_deleted","archived_runs","record_key"],
      ["archive_relaunches_never_deleted","archive_relaunches","record_key"],
      ["dry_run_scenario_results_never_deleted","dryrun_results","run_id"],
    ].flatMap(([trigger,table,key]) => [`DROP TRIGGER ${trigger}`,
      `CREATE TRIGGER ${trigger} BEFORE DELETE ON ${table}
       WHEN NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key=OLD.${key})
         AND NOT EXISTS (SELECT 1 FROM archive_transfers WHERE record_key=OLD.${key})
       BEGIN SELECT RAISE(ABORT,'owned evidence is never deleted outside deletion or verified transfer'); END`]),
    "CREATE INDEX run_summaries_filter_idx ON run_summaries(workflow,local_day,state,record_key)", "CREATE INDEX run_summaries_parent_idx ON run_summaries(parent_run_id)"] },
  { version: 49, statements: [
    "DROP TABLE archived_runs",
    "DROP TRIGGER version_bump_applications_never_deleted",
    "DROP TABLE version_bump_applications",
    "DROP TABLE version_plans",
    `CREATE TRIGGER version_changes_historical_immutable BEFORE UPDATE ON version_changes
      WHEN json_extract(OLD.record_json,'$.schemaVersion')='historical-archive-v1'
      BEGIN SELECT RAISE(ABORT,'historical version change is immutable'); END`,
    `CREATE TRIGGER version_changes_historical_no_replace BEFORE INSERT ON version_changes
      WHEN EXISTS (SELECT 1 FROM version_changes WHERE record_key=NEW.record_key AND json_extract(record_json,'$.schemaVersion')='historical-archive-v1')
      BEGIN SELECT RAISE(ABORT,'historical version change is immutable'); END`,
    `CREATE TRIGGER version_changes_historical_retained BEFORE DELETE ON version_changes
      WHEN json_extract(OLD.record_json,'$.schemaVersion')='historical-archive-v1'
      BEGIN SELECT RAISE(ABORT,'historical version change is retained'); END`,
  ] },
  { version: 50, statements: ["DROP TABLE archive_relaunches"] },
  { version: 51, statements: [EXPLORER_OVERRIDES_DDL, ...EXPLORER_OVERRIDE_CONSTRAINTS] },
  { version: 52, statements: [NOTIFICATION_PUBLICATIONS_DDL, NOTIFICATION_HEALTH_DDL,
    "CREATE INDEX notification_publications_owner_idx ON notification_publications(notification_id)",
    "CREATE TRIGGER notification_publications_immutable BEFORE UPDATE ON notification_publications BEGIN SELECT RAISE(ABORT, 'notification publication is immutable'); END",
  ] },
  { version: 53, statements: [WORKER_CONTROL_DDL, WORKER_BROWSER_DDL,
    "CREATE INDEX worker_controls_scope_idx ON worker_controls(scope)",
    "CREATE INDEX worker_browsers_owner_idx ON worker_browsers(worker_id)",
    `CREATE TRIGGER worker_controls_identity_immutable BEFORE UPDATE ON worker_controls
      WHEN NEW.record_key IS NOT OLD.record_key OR NEW.scope IS NOT OLD.scope OR NEW.created_at IS NOT OLD.created_at
        OR json_extract(NEW.record_json,'$.request') IS NOT json_extract(OLD.record_json,'$.request')
      BEGIN SELECT RAISE(ABORT,'worker control identity is immutable'); END`,
    "CREATE TRIGGER worker_controls_retained BEFORE DELETE ON worker_controls BEGIN SELECT RAISE(ABORT,'worker controls are retained'); END",
  ] },
  { version: 54, statements: [TRANSACTION_SELECTION_DDL, ...TRANSACTION_SELECTION_CONSTRAINTS, RUN_SEARCH_INDEX_DDL, RUN_SEARCH_GRAMS_DDL, RUN_SEARCH_PUBLICATION_DDL, RUN_SEARCH_DECLARATIONS_DDL, RUN_SEARCH_ACTORS_DDL,
    ...RUN_SEARCH_INDEX_CONSTRAINTS, ...RUN_SEARCH_ACTOR_BACKFILL_SQL,
    `INSERT INTO run_search_publication SELECT 'current',json_object('state',CASE WHEN EXISTS(SELECT 1 FROM workflow_runs) THEN 'invalid' ELSE 'published' END,'sourceGeneration',authority_generation,'afterRun',NULL,'rowCount',0),updated_at FROM database_state`,
  ] },
] as const);

export function auditMigrationTableCoverage(): readonly string[] {
  const violations: string[] = [];
  const renamed = (name: string): string => {
    const renames: Readonly<Record<string, string>> = {
      ...DATABASE_TABLE_RENAMES, ocr_extractions: "extracted_artifacts", failures: "run_failures",
      write_intents: "run_operations", write_attempts: "run_operation_attempts", durable_outbox: "operation_outbox",
      dependencies: "delegation_dependencies", delegation_manifests: "run_delegations",
      tasks: "workflow_runs", run_sessions: "workflow_run_batches",
      leases: "workflow_workers", duo_ceremony_leases: "worker_auth", start_plans: "workflow_run_requests",
    };
    return renames[name] ?? name;
  };
  const ddlNames = Object.keys(SQLITE_TABLE_DDL).map(renamed);
  const registeredNames = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name);
  const retiredNames: readonly string[] = ["archive_relaunches", "archived_runs", "version_plans", "version_bump_applications", "activity_person_pseudonyms", "activity_person_pseudonym_generations", ...RETIRED_PHONE_CAPTURE_TABLES, "protected_settings_current", "runs_view", "bulk_command_acceptances", "ledger_partitions", "ledger_projections", "operation_outbox", "run_terminal_authorizations", "run_terminal_outbox", "intake_sessions", "intake_manifests", "provider_admissions", "provider_budget_counters", "settings_current", "runtime_config", "artifact_outbox", "artifact_sink_heads", "operator_xlsx_exports", "spans", "gates", "notes", "ocr_approvals", "knowledge_records", "fix_records"];
  for (const name of registeredNames) if (!ddlNames.includes(name)) violations.push(`registered table ${name} has no DDL`);
  for (const name of ddlNames) {
    if (!registeredNames.some((registeredName) => registeredName === name) && !retiredNames.includes(name)) {
      violations.push(`DDL table ${name} is neither registered nor retired`);
    }
  }
  if (new Set(TABLE_ORDER).size !== TABLE_ORDER.length) violations.push("migration table order contains duplicates");
  for (const name of registeredNames) if (![...TABLE_ORDER.map(renamed), "timeline_operation_sources", "imported_artifacts", "provider_requests", "provider_usage", "app_settings", "generated_artifacts", "run_summaries", "summary_publication", "archive_transfers", "version_changes", "explorer_overrides", "notification_publications", "notification_health", "worker_controls", "worker_browsers", "transaction_selection", "run_search_index", "run_search_grams", "run_search_publication", "run_search_declarations", "run_search_actors"].includes(name)) violations.push(`registered table ${name} is absent from migration order`);
  for (const name of retiredNames) {
    if (!TABLE_ORDER.some((migrationName) => migrationName === name || renamed(migrationName) === name)) {
      violations.push(`retired table ${name} is absent from migration history`);
    }
  }
  return violations;
}

export function tableClassification(name: TableName): TableSpec["classification"] {
  const spec = AUTHORITY_TABLE_REGISTRY.find((entry) => entry.name === name);
  if (spec === undefined) throw new Error(`table ${name} has no authority classification`);
  return spec.classification;
}
