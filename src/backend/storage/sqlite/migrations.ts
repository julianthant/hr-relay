import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { WORKBOOK_LIBRARY_MIGRATION } from "./workbook-library-repository.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { AUTHORITY_TABLE_REGISTRY, AuthorityTableNameSchema, type AuthorityTableName, type TableName, type TableSpec } from "../../../models/config/authority.js";

export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 9;

export const SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export function isSupportedStoppedAuthoritySchemaVersion(version: number): version is typeof SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS[number] {
  return SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS.some(supported => supported === version);
}

export function isCurrentAuthoritySchemaVersion(version: number): boolean {
  return version === CURRENT_AUTHORITY_SCHEMA_VERSION;
}

export const SQLITE_MIGRATIONS = deepFreeze([
  { version: 1, statements: [`CREATE TABLE database_states (
 id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version>0),
 authority_generation INTEGER NOT NULL CHECK(authority_generation>=0), updated_at TEXT NOT NULL,
 search_generation INTEGER, search_state TEXT NOT NULL CHECK(search_state IN ('unbuilt','ready','invalid')),
 CHECK(search_state<>'ready' OR search_generation=authority_generation)
) STRICT;

CREATE TABLE database_upgrades (
 id TEXT PRIMARY KEY, upgrade_id TEXT NOT NULL, phase TEXT NOT NULL,
 backup_digest TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
 UNIQUE(upgrade_id,phase)
) STRICT;

CREATE TABLE settings_snapshots (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), fingerprint TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), captured_at TEXT NOT NULL
) STRICT;

CREATE TABLE commands (
 id TEXT PRIMARY KEY, family TEXT NOT NULL, actor_id TEXT NOT NULL, parent_id TEXT REFERENCES commands(id),
 target_id TEXT, request_digest TEXT NOT NULL, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 state TEXT NOT NULL CHECK(state IN ('admitted','executing','succeeded','refused','uncertain')),
 outcome_json TEXT CHECK(outcome_json IS NULL OR json_valid(outcome_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE command_audits (
 id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES commands(id), code TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
 id TEXT PRIMARY KEY CHECK(id='current'), revision INTEGER NOT NULL CHECK(revision>0),
 snapshot_id TEXT NOT NULL REFERENCES settings_snapshots(id), command_id TEXT NOT NULL REFERENCES commands(id),
 audit_id TEXT NOT NULL REFERENCES command_audits(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_batches (
 id TEXT PRIMARY KEY, workflow TEXT NOT NULL, started_at TEXT NOT NULL,
 group_in_queue INTEGER NOT NULL CHECK(group_in_queue IN (0,1)), version INTEGER NOT NULL CHECK(version>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE deleted_runs (
 run_id TEXT PRIMARY KEY, workflow TEXT NOT NULL, item_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0),
 run_number INTEGER CHECK(run_number IS NULL OR run_number>0), trace_id TEXT NOT NULL,
 command_id TEXT NOT NULL REFERENCES commands(id), deleted_at TEXT NOT NULL,
 cleanup_state TEXT NOT NULL CHECK(cleanup_state IN ('pending','complete')),
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)), files_json TEXT NOT NULL CHECK(json_valid(files_json)),
 UNIQUE(workflow,item_id,attempt)
) STRICT;

CREATE TABLE runs (
 id TEXT PRIMARY KEY, workflow TEXT NOT NULL, item_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0),
 run_number INTEGER CHECK(run_number IS NULL OR run_number>0), batch_id TEXT REFERENCES run_batches(id), parent_id TEXT REFERENCES runs(id),
 state TEXT NOT NULL CHECK(state IN ('queued','claimed','validating','running','parked-gate','parked-write','terminal')),
 outcome TEXT CHECK(outcome IS NULL OR outcome IN ('done','failed','cancelled','discarded','interrupted','superseded')),
 priority TEXT NOT NULL CHECK(priority IN ('interactive','bulk')), not_before TEXT,
 owner_worker_id TEXT, claim_generation INTEGER NOT NULL CHECK(claim_generation>=0), heartbeat_at TEXT,
 version INTEGER NOT NULL CHECK(version>0), settings_snapshot_id TEXT NOT NULL REFERENCES settings_snapshots(id),
 descriptor_version INTEGER NOT NULL, contract_fingerprint TEXT NOT NULL, trace_id TEXT NOT NULL,
 dry_run INTEGER NOT NULL CHECK(dry_run IN (0,1)), local_day TEXT NOT NULL, enqueued_at TEXT NOT NULL,
 session_id TEXT, envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json)),
 lifecycle_json TEXT NOT NULL CHECK(json_valid(lifecycle_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workflow,item_id,attempt), UNIQUE(workflow,run_number),
 CHECK((state IN ('claimed','validating','running') AND owner_worker_id IS NOT NULL AND heartbeat_at IS NOT NULL AND claim_generation>0)
    OR (state NOT IN ('claimed','validating','running') AND owner_worker_id IS NULL AND heartbeat_at IS NULL)),
 CHECK((state='terminal')=(outcome IS NOT NULL))
) STRICT;

CREATE TABLE run_requests (
 id TEXT PRIMARY KEY, workflow TEXT NOT NULL, actor_id TEXT NOT NULL, consumed_by TEXT REFERENCES commands(id),
 expires_at TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_delegations (
 id TEXT PRIMARY KEY, parent_run_id TEXT NOT NULL REFERENCES runs(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE delegation_dependencies (
 id TEXT PRIMARY KEY, delegation_id TEXT NOT NULL REFERENCES run_delegations(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_checkpoints (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), workflow TEXT NOT NULL, item_id TEXT NOT NULL,
 node_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0), claim_generation INTEGER NOT NULL CHECK(claim_generation>0),
 output_digest TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
 UNIQUE(workflow,item_id,node_id,attempt,claim_generation)
) STRICT;

CREATE TABLE gate_results (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), node_id TEXT NOT NULL, gate_id TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_results (
 run_id TEXT PRIMARY KEY REFERENCES runs(id), workflow TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0),
 result_digest TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_failures (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), fingerprint TEXT NOT NULL,
 code TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 resolution_json TEXT CHECK(resolution_json IS NULL OR json_valid(resolution_json)),
 resolution_version INTEGER NOT NULL CHECK(resolution_version>0), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_receipts (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES run_results(run_id), workflow TEXT NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt>0), result TEXT NOT NULL, confidence TEXT NOT NULL,
 failure_id TEXT REFERENCES run_failures(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE write_intents (
 id TEXT PRIMARY KEY, system TEXT NOT NULL, idempotency_key TEXT NOT NULL, idempotency_key_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('observed-present','attempting','committed','retryable','parked')),
 generation INTEGER NOT NULL CHECK(generation>0), run_id TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 publication_json TEXT CHECK(publication_json IS NULL OR json_valid(publication_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(system,idempotency_key), UNIQUE(idempotency_key_digest)
) STRICT;

CREATE TABLE write_attempts (
 id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES write_intents(id), generation INTEGER NOT NULL CHECK(generation>0),
 run_id TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
 UNIQUE(intent_id,generation)
) STRICT;

CREATE TABLE worker_pools (
 workflow TEXT PRIMARY KEY, desired_workers INTEGER NOT NULL CHECK(desired_workers BETWEEN 0 AND 3),
 version INTEGER NOT NULL CHECK(version>0), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE worker_slots (
 id TEXT PRIMARY KEY, workflow TEXT NOT NULL REFERENCES worker_pools(workflow), ordinal INTEGER NOT NULL UNIQUE CHECK(ordinal>0),
 membership_revision INTEGER NOT NULL CHECK(membership_revision>0),
 phase TEXT NOT NULL CHECK(phase IN ('starting','running','idle','waiting','paused','failed')),
 retired_at TEXT, retirement_command_id TEXT REFERENCES commands(id), reservation_command_id TEXT REFERENCES commands(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((retired_at IS NULL)=(retirement_command_id IS NULL))
) STRICT;

CREATE TABLE worker_leases (
 id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES worker_slots(id), workflow TEXT NOT NULL,
 lease_generation INTEGER NOT NULL CHECK(lease_generation>0), control_revision INTEGER NOT NULL CHECK(control_revision>0),
 state TEXT NOT NULL, directive TEXT NOT NULL CHECK(directive IN ('run','pause','stop')),
 heartbeat_at TEXT, version INTEGER NOT NULL CHECK(version>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(worker_id,lease_generation)
) STRICT;

CREATE TABLE worker_controls (
 command_id TEXT PRIMARY KEY REFERENCES commands(id), scope TEXT NOT NULL, worker_id TEXT REFERENCES worker_slots(id),
 phase TEXT NOT NULL CHECK(phase IN ('admitted','ready','executing','succeeded','refused','uncertain')),
 audited_at TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE browser_sessions (
 id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES worker_slots(id), lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
 system TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('starting','authenticated','unknown','failed','closed')),
 auth_fingerprint TEXT NOT NULL, presentation TEXT NOT NULL CHECK(presentation IN ('headed','headless')),
 profile_revision INTEGER NOT NULL CHECK(profile_revision>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), opened_at TEXT NOT NULL, observed_at TEXT NOT NULL
) STRICT;

CREATE TABLE auth_leases (
 credential_key TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK(generation>0), holder_worker_id TEXT REFERENCES worker_slots(id),
 holder_system TEXT, state TEXT NOT NULL CHECK(state IN ('held','released')), expires_at TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE notifications (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, dedupe_fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('read','unread')),
 seen_count INTEGER NOT NULL CHECK(seen_count>0), version INTEGER NOT NULL CHECK(version>0),
 run_id TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 publications_json TEXT NOT NULL CHECK(json_valid(publications_json) AND json_type(publications_json)='array'),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(actor_id,dedupe_fingerprint)
) STRICT;

CREATE TABLE notification_states (
 id TEXT PRIMARY KEY, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE explorer_overrides (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), command_id TEXT NOT NULL REFERENCES commands(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
) STRICT;

CREATE TABLE artifacts (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('imported','extracted','generated')),
 workflow TEXT, source_sha256 TEXT, source_page INTEGER CHECK(source_page IS NULL OR source_page>0),
 form_type TEXT, page_kind TEXT, page_fingerprint TEXT, source_kind TEXT,
 session_id TEXT UNIQUE, manifest_id TEXT UNIQUE, sink_id TEXT UNIQUE, export_id TEXT UNIQUE,
 version INTEGER NOT NULL CHECK(version>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
 CHECK(kind<>'imported' OR (workflow IS NOT NULL AND source_sha256 IS NOT NULL)),
 CHECK(kind<>'extracted' OR (source_sha256 IS NOT NULL AND source_page IS NOT NULL AND page_fingerprint IS NOT NULL)),
 CHECK(kind<>'generated' OR ((sink_id IS NULL)<>(export_id IS NULL)))
) STRICT;

CREATE TABLE timeline_events (
 cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 workflow TEXT, run_id TEXT REFERENCES runs(id), worker_id TEXT,
 kind TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, retention_date TEXT NOT NULL,
 retention_class TEXT NOT NULL CHECK(retention_class IN ('ordinary','confirmed-operation','protected')),
 operation_id TEXT REFERENCES write_intents(id), operation_generation INTEGER, confirmed_at TEXT, system TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 CHECK((retention_class='confirmed-operation')=(kind='operation-confirmed')),
 CHECK(kind<>'operation-confirmed' OR (run_id IS NOT NULL AND operation_id IS NOT NULL AND operation_generation>0 AND confirmed_at IS NOT NULL AND system IS NOT NULL))
) STRICT;

CREATE TABLE diagnostic_snapshots (
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), origin_kind TEXT NOT NULL,
 failure_id TEXT REFERENCES run_failures(id), content_digest TEXT NOT NULL, retention_kind TEXT NOT NULL,
 purge_after TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE diagnostic_files (
 id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES diagnostic_snapshots(id), artifact_id TEXT NOT NULL,
 kind TEXT NOT NULL, digest TEXT NOT NULL, sensitivity TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE dryrun_results (
 id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, workflow TEXT NOT NULL, subject_label TEXT NOT NULL,
 manifest_digest TEXT NOT NULL, verdict TEXT NOT NULL, execution_state TEXT NOT NULL,
 run_id TEXT REFERENCES runs(id), trace_id TEXT, wall_time_ms INTEGER CHECK(wall_time_ms IS NULL OR wall_time_ms>=0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_search (
 run_id TEXT PRIMARY KEY REFERENCES runs(id), workflow TEXT NOT NULL, trace TEXT NOT NULL, local_day TEXT NOT NULL,
 state TEXT NOT NULL, shape TEXT NOT NULL, dry_run INTEGER NOT NULL CHECK(dry_run IN (0,1)), enqueued_ms INTEGER NOT NULL,
 subject TEXT, actor_id TEXT, descriptor_version INTEGER NOT NULL, failure_code TEXT,
 has_receipt INTEGER NOT NULL CHECK(has_receipt IN (0,1)), has_diagnostic INTEGER NOT NULL CHECK(has_diagnostic IN (0,1)),
 systems_json TEXT NOT NULL CHECK(json_valid(systems_json)), source_version INTEGER NOT NULL CHECK(source_version>0),
 declaration_json TEXT CHECK(declaration_json IS NULL OR json_valid(declaration_json)),
 actor_source_json TEXT CHECK(actor_source_json IS NULL OR json_valid(actor_source_json)),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX commands_parent_idx ON commands(parent_id);

CREATE INDEX command_audits_command_idx ON command_audits(command_id,created_at,id);

CREATE INDEX runs_claim_idx ON runs(workflow,state,priority,not_before,enqueued_at,id);

CREATE INDEX runs_day_idx ON runs(local_day,workflow,enqueued_at,id);

CREATE INDEX runs_parent_idx ON runs(parent_id,id);

CREATE INDEX run_requests_expiry_idx ON run_requests(workflow,expires_at,id);

CREATE INDEX delegations_parent_idx ON run_delegations(parent_run_id,id);

CREATE INDEX dependencies_manifest_idx ON delegation_dependencies(delegation_id,id);

CREATE INDEX checkpoints_replay_idx ON run_checkpoints(workflow,item_id,node_id,attempt,claim_generation);

CREATE INDEX gates_owner_idx ON gate_results(run_id,node_id,gate_id);

CREATE INDEX failures_run_idx ON run_failures(run_id,created_at,id);

CREATE INDEX write_intents_owner_idx ON write_intents(run_id,status,id);

CREATE INDEX worker_leases_current_idx ON worker_leases(worker_id,lease_generation DESC);

CREATE INDEX worker_controls_pending_idx ON worker_controls(scope,audited_at,command_id);

CREATE INDEX browser_sessions_worker_idx ON browser_sessions(worker_id,lease_generation,system,id);

CREATE INDEX notifications_inbox_idx ON notifications(actor_id,status,updated_at,id);

CREATE INDEX artifacts_source_idx ON artifacts(kind,source_sha256,created_at,id);

CREATE INDEX timeline_run_idx ON timeline_events(run_id,cursor);

CREATE INDEX timeline_workflow_idx ON timeline_events(workflow,cursor);

CREATE INDEX timeline_retention_idx ON timeline_events(retention_class,retention_date,cursor);

CREATE INDEX timeline_transactions_idx ON timeline_events(confirmed_at,id);

CREATE INDEX timeline_run_transactions_idx ON timeline_events(run_id,confirmed_at,id);

CREATE INDEX diagnostics_run_idx ON diagnostic_snapshots(run_id,created_at,id);

CREATE INDEX diagnostic_files_snapshot_idx ON diagnostic_files(snapshot_id,id);

CREATE INDEX run_search_day_idx ON run_search(local_day,run_id);

CREATE INDEX run_search_workflow_idx ON run_search(workflow,local_day,run_id);

CREATE INDEX run_search_state_idx ON run_search(state,local_day,run_id);

CREATE UNIQUE INDEX timeline_confirmation_idx ON timeline_events(operation_id,operation_generation) WHERE kind='operation-confirmed';
CREATE UNIQUE INDEX worker_controls_unresolved_idx ON worker_controls(scope) WHERE audited_at IS NULL;

CREATE TRIGGER runs_no_resurrection BEFORE INSERT ON runs
WHEN EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=NEW.id OR (workflow=NEW.workflow AND item_id=NEW.item_id AND attempt=NEW.attempt) OR (workflow=NEW.workflow AND run_number=NEW.run_number))
BEGIN SELECT RAISE(ABORT,'run-identity-deleted'); END;
CREATE TRIGGER runs_delete_tombstone BEFORE DELETE ON runs
WHEN OLD.state<>'terminal' OR NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'terminal-run-tombstone-required'); END;
CREATE TRIGGER deleted_runs_identity BEFORE UPDATE ON deleted_runs
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.workflow IS NOT OLD.workflow OR NEW.item_id IS NOT OLD.item_id
 OR NEW.attempt IS NOT OLD.attempt OR NEW.run_number IS NOT OLD.run_number OR NEW.trace_id IS NOT OLD.trace_id
 OR NEW.command_id IS NOT OLD.command_id OR NEW.deleted_at IS NOT OLD.deleted_at
 OR NEW.receipt_json IS NOT OLD.receipt_json OR NEW.files_json IS NOT OLD.files_json
 OR NOT(OLD.cleanup_state='pending' AND NEW.cleanup_state='complete')
BEGIN SELECT RAISE(ABORT,'deletion-evidence-immutable'); END;
CREATE TRIGGER write_intents_no_retry BEFORE UPDATE ON write_intents
WHEN (OLD.status='parked' AND NEW.status='attempting')
 OR (OLD.status IN ('committed','observed-present') AND NEW.status IS NOT OLD.status)
 OR NEW.id IS NOT OLD.id OR NEW.system IS NOT OLD.system OR NEW.idempotency_key IS NOT OLD.idempotency_key
 OR NEW.idempotency_key_digest IS NOT OLD.idempotency_key_digest
BEGIN SELECT RAISE(ABORT,'write-retry-or-identity-refused'); END;
CREATE TRIGGER timeline_events_immutable BEFORE UPDATE ON timeline_events
BEGIN SELECT RAISE(ABORT,'timeline-history-immutable'); END;
CREATE TRIGGER timeline_events_confirmed_retained BEFORE DELETE ON timeline_events
WHEN OLD.retention_class IN ('confirmed-operation','protected') AND NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'protected-timeline-owner-deletion-required'); END;
CREATE TRIGGER notification_publications_immutable BEFORE UPDATE ON notifications
WHEN EXISTS(SELECT 1 FROM json_each(OLD.publications_json) prior WHERE NOT EXISTS(
 SELECT 1 FROM json_each(NEW.publications_json) added WHERE added.key=prior.key AND added.value=prior.value))
BEGIN SELECT RAISE(ABORT,'notification-publication-immutable'); END;
CREATE TRIGGER notification_publications_unique_insert BEFORE INSERT ON notifications
WHEN EXISTS(SELECT 1 FROM json_each(NEW.publications_json) a JOIN json_each(NEW.publications_json) b
 ON a.key<>b.key AND json_extract(a.value,'$.sourceId')=json_extract(b.value,'$.sourceId'))
 OR EXISTS(SELECT 1 FROM notifications n,json_each(n.publications_json) prior,json_each(NEW.publications_json) added
 WHERE json_extract(prior.value,'$.sourceId')=json_extract(added.value,'$.sourceId'))
BEGIN SELECT RAISE(ABORT,'notification-publication-source-conflict'); END;
CREATE TRIGGER notification_publications_unique_update BEFORE UPDATE ON notifications
WHEN EXISTS(SELECT 1 FROM json_each(NEW.publications_json) a JOIN json_each(NEW.publications_json) b
 ON a.key<>b.key AND json_extract(a.value,'$.sourceId')=json_extract(b.value,'$.sourceId'))
 OR EXISTS(SELECT 1 FROM notifications n,json_each(n.publications_json) prior,json_each(NEW.publications_json) added
 WHERE n.id<>OLD.id AND json_extract(prior.value,'$.sourceId')=json_extract(added.value,'$.sourceId'))
BEGIN SELECT RAISE(ABORT,'notification-publication-source-conflict'); END;
CREATE TRIGGER browser_sessions_closed BEFORE UPDATE ON browser_sessions
WHEN OLD.state='closed' AND NEW.state<>'closed'
BEGIN SELECT RAISE(ABORT,'closed-browser-session-cannot-reopen'); END;
CREATE TRIGGER artifacts_import_submission BEFORE UPDATE ON artifacts
WHEN OLD.kind='imported' AND json_type(OLD.payload_json,'$.submittedJson')='text' AND
 (NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id OR NEW.manifest_id IS NOT OLD.manifest_id
 OR NEW.source_sha256 IS NOT OLD.source_sha256 OR NEW.kind IS NOT OLD.kind OR NEW.workflow IS NOT OLD.workflow
 OR json_extract(NEW.payload_json,'$.submittedJson') IS NOT json_extract(OLD.payload_json,'$.submittedJson'))
BEGIN SELECT RAISE(ABORT,'submitted-import-immutable'); END;
CREATE TRIGGER artifacts_generated_evidence BEFORE UPDATE ON artifacts
WHEN OLD.kind='generated' AND (NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.sink_id IS NOT OLD.sink_id
 OR NEW.export_id IS NOT OLD.export_id OR NEW.created_at IS NOT OLD.created_at OR NEW.version<>OLD.version+1
 OR (json_extract(OLD.payload_json,'$.exportEvidenceJson') IS NOT NULL AND json_extract(NEW.payload_json,'$.exportEvidenceJson') IS NOT json_extract(OLD.payload_json,'$.exportEvidenceJson'))
 OR (json_extract(OLD.payload_json,'$.exportEvidenceFingerprint') IS NOT NULL AND json_extract(NEW.payload_json,'$.exportEvidenceFingerprint') IS NOT json_extract(OLD.payload_json,'$.exportEvidenceFingerprint'))
 OR json_extract(NEW.payload_json,'$.exportRequest') IS NOT json_extract(OLD.payload_json,'$.exportRequest')
 OR json_extract(NEW.payload_json,'$.registration') IS NOT json_extract(OLD.payload_json,'$.registration')
 OR EXISTS(SELECT 1 FROM json_each(OLD.payload_json,'$.versions') prior WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.versions') added WHERE added.key=prior.key AND added.value=prior.value))
 OR EXISTS(SELECT 1 FROM json_each(OLD.payload_json,'$.updates') prior WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.updates') added WHERE added.key=prior.key
 AND json_remove(added.value,'$.record.state','$.record.projectedAt')=json_remove(prior.value,'$.record.state','$.record.projectedAt')
 AND (json_extract(prior.value,'$.record.state')='pending' OR added.value=prior.value))))
BEGIN SELECT RAISE(ABORT,'generated-artifact-evidence-immutable'); END;

CREATE TRIGGER deleted_runs_no_replace BEFORE INSERT ON deleted_runs
WHEN EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=NEW.run_id OR (workflow=NEW.workflow AND item_id=NEW.item_id AND attempt=NEW.attempt))
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER deleted_runs_retained BEFORE DELETE ON deleted_runs
BEGIN SELECT RAISE(ABORT,'retained-evidence-required'); END;

CREATE TRIGGER command_audits_no_replace BEFORE INSERT ON command_audits
WHEN EXISTS(SELECT 1 FROM command_audits WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER command_audits_immutable BEFORE UPDATE ON command_audits
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER command_audits_retained BEFORE DELETE ON command_audits
BEGIN SELECT RAISE(ABORT,'retained-evidence-required'); END;

CREATE TRIGGER settings_snapshots_no_replace BEFORE INSERT ON settings_snapshots
WHEN EXISTS(SELECT 1 FROM settings_snapshots WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER settings_snapshots_immutable BEFORE UPDATE ON settings_snapshots
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER settings_snapshots_retained BEFORE DELETE ON settings_snapshots
BEGIN SELECT RAISE(ABORT,'retained-evidence-required'); END;

CREATE TRIGGER gate_results_no_replace BEFORE INSERT ON gate_results
WHEN EXISTS(SELECT 1 FROM gate_results WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER gate_results_immutable BEFORE UPDATE ON gate_results
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER gate_results_owner_delete BEFORE DELETE ON gate_results
WHEN NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'owner-deletion-required'); END;

CREATE TRIGGER run_checkpoints_no_replace BEFORE INSERT ON run_checkpoints
WHEN EXISTS(SELECT 1 FROM run_checkpoints WHERE id=NEW.id OR (workflow=NEW.workflow AND item_id=NEW.item_id AND node_id=NEW.node_id AND attempt=NEW.attempt AND claim_generation=NEW.claim_generation))
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER run_checkpoints_immutable BEFORE UPDATE ON run_checkpoints
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER run_checkpoints_owner_delete BEFORE DELETE ON run_checkpoints
WHEN NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'owner-deletion-required'); END;

CREATE TRIGGER run_results_no_replace BEFORE INSERT ON run_results
WHEN EXISTS(SELECT 1 FROM run_results WHERE run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER run_results_immutable BEFORE UPDATE ON run_results
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER run_results_owner_delete BEFORE DELETE ON run_results
WHEN NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'owner-deletion-required'); END;

CREATE TRIGGER dryrun_results_no_replace BEFORE INSERT ON dryrun_results
WHEN EXISTS(SELECT 1 FROM dryrun_results WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER dryrun_results_immutable BEFORE UPDATE ON dryrun_results
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER dryrun_results_owner_delete BEFORE DELETE ON dryrun_results
WHEN NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'owner-deletion-required'); END;

CREATE TRIGGER run_receipts_no_replace BEFORE INSERT ON run_receipts
WHEN EXISTS(SELECT 1 FROM run_receipts WHERE id=NEW.id OR run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER run_receipts_immutable BEFORE UPDATE ON run_receipts
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER run_receipts_owner_delete BEFORE DELETE ON run_receipts
WHEN NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'owner-deletion-required'); END;

CREATE TRIGGER write_attempts_no_replace BEFORE INSERT ON write_attempts
WHEN EXISTS(SELECT 1 FROM write_attempts WHERE id=NEW.id OR (intent_id=NEW.intent_id AND generation=NEW.generation))
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER write_attempts_immutable BEFORE UPDATE ON write_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.intent_id IS NOT OLD.intent_id OR NEW.generation IS NOT OLD.generation
 OR NEW.run_id IS NOT OLD.run_id OR json_extract(OLD.payload_json,'$.outcome.state')<>'attempting'
 OR json_remove(NEW.payload_json,'$.outcome','$.recordedAt') IS NOT json_remove(OLD.payload_json,'$.outcome','$.recordedAt')
BEGIN SELECT RAISE(ABORT,'write-attempt-proof-immutable'); END;

CREATE TRIGGER write_attempts_retained BEFORE DELETE ON write_attempts
BEGIN SELECT RAISE(ABORT,'retained-evidence-required'); END;

CREATE TRIGGER database_upgrades_no_replace BEFORE INSERT ON database_upgrades
WHEN EXISTS(SELECT 1 FROM database_upgrades WHERE id=NEW.id OR (upgrade_id=NEW.upgrade_id AND phase=NEW.phase))
BEGIN SELECT RAISE(ABORT,'retained-identity-conflict'); END;

CREATE TRIGGER database_upgrades_immutable BEFORE UPDATE ON database_upgrades
BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END;

CREATE TRIGGER database_upgrades_retained BEFORE DELETE ON database_upgrades
BEGIN SELECT RAISE(ABORT,'retained-evidence-required'); END;

CREATE TRIGGER write_intents_retained BEFORE DELETE ON write_intents
BEGIN SELECT RAISE(ABORT,'write-identity-retained'); END;
CREATE TRIGGER deleted_runs_terminal BEFORE INSERT ON deleted_runs
WHEN NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id AND state='terminal')
 OR EXISTS(SELECT 1 FROM write_intents WHERE run_id=NEW.run_id AND status IN ('attempting','parked'))
BEGIN SELECT RAISE(ABORT,'run-deletion-unsafe'); END;
CREATE TRIGGER artifacts_retained BEFORE DELETE ON artifacts
WHEN OLD.kind='generated' OR (OLD.kind='imported' AND json_type(OLD.payload_json,'$.submittedJson')='text')
BEGIN SELECT RAISE(ABORT,'artifact-evidence-retained'); END;
CREATE UNIQUE INDEX browser_sessions_profile_owner_idx ON browser_sessions(worker_id,system) WHERE state<>'closed';
CREATE TRIGGER worker_slots_retained BEFORE DELETE ON worker_slots
BEGIN SELECT RAISE(ABORT,'worker-slot-retirement-retained'); END;
CREATE TRIGGER auth_leases_retained BEFORE DELETE ON auth_leases
BEGIN SELECT RAISE(ABORT,'auth-lease-identity-retained'); END;
CREATE TRIGGER write_intents_no_replace BEFORE INSERT ON write_intents
WHEN EXISTS(SELECT 1 FROM write_intents WHERE id=NEW.id OR (system=NEW.system AND idempotency_key=NEW.idempotency_key) OR idempotency_key_digest=NEW.idempotency_key_digest)
BEGIN SELECT RAISE(ABORT,'write-identity-conflict'); END;
CREATE TRIGGER artifacts_no_replace BEFORE INSERT ON artifacts
WHEN EXISTS(SELECT 1 FROM artifacts WHERE id=NEW.id OR session_id=NEW.session_id OR manifest_id=NEW.manifest_id OR sink_id=NEW.sink_id OR export_id=NEW.export_id)
BEGIN SELECT RAISE(ABORT,'artifact-identity-conflict'); END;
CREATE TRIGGER artifacts_identity BEFORE UPDATE ON artifacts
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.workflow IS NOT OLD.workflow
 OR NEW.source_sha256 IS NOT OLD.source_sha256 OR NEW.source_page IS NOT OLD.source_page
 OR NEW.form_type IS NOT OLD.form_type OR NEW.page_kind IS NOT OLD.page_kind
 OR NEW.page_fingerprint IS NOT OLD.page_fingerprint OR NEW.source_kind IS NOT OLD.source_kind
 OR NEW.session_id IS NOT OLD.session_id OR NEW.manifest_id IS NOT OLD.manifest_id
 OR NEW.sink_id IS NOT OLD.sink_id OR NEW.export_id IS NOT OLD.export_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'artifact-provenance-immutable'); END;
CREATE TRIGGER runs_identity BEFORE UPDATE ON runs
WHEN NEW.id IS NOT OLD.id OR NEW.workflow IS NOT OLD.workflow OR NEW.item_id IS NOT OLD.item_id
 OR NEW.attempt IS NOT OLD.attempt OR NEW.run_number IS NOT OLD.run_number OR NEW.trace_id IS NOT OLD.trace_id
 OR NEW.settings_snapshot_id IS NOT OLD.settings_snapshot_id OR NEW.descriptor_version IS NOT OLD.descriptor_version
 OR NEW.contract_fingerprint IS NOT OLD.contract_fingerprint OR NEW.created_at IS NOT OLD.created_at
 OR EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=NEW.id OR (workflow=NEW.workflow AND item_id=NEW.item_id AND attempt=NEW.attempt) OR (workflow=NEW.workflow AND run_number=NEW.run_number))
BEGIN SELECT RAISE(ABORT,'run-identity-immutable-or-deleted'); END;
CREATE TRIGGER worker_slots_identity BEFORE UPDATE ON worker_slots
WHEN NEW.id IS NOT OLD.id OR NEW.workflow IS NOT OLD.workflow OR NEW.ordinal IS NOT OLD.ordinal
 OR NEW.created_at IS NOT OLD.created_at OR (OLD.retired_at IS NOT NULL AND (NEW.retired_at IS NOT OLD.retired_at OR NEW.retirement_command_id IS NOT OLD.retirement_command_id))
BEGIN SELECT RAISE(ABORT,'worker-slot-identity-immutable'); END;
CREATE TRIGGER worker_slots_no_replace BEFORE INSERT ON worker_slots
WHEN EXISTS(SELECT 1 FROM worker_slots WHERE id=NEW.id OR ordinal=NEW.ordinal)
BEGIN SELECT RAISE(ABORT,'worker-slot-identity-conflict'); END;
CREATE TRIGGER browser_sessions_no_replace BEFORE INSERT ON browser_sessions
WHEN EXISTS(SELECT 1 FROM browser_sessions WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'browser-session-identity-conflict'); END;
CREATE TRIGGER notifications_no_replace BEFORE INSERT ON notifications
WHEN EXISTS(SELECT 1 FROM notifications WHERE id=NEW.id OR (actor_id=NEW.actor_id AND dedupe_fingerprint=NEW.dedupe_fingerprint))
BEGIN SELECT RAISE(ABORT,'notification-identity-conflict'); END;
CREATE TRIGGER run_failures_evidence BEFORE UPDATE ON run_failures
WHEN NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.fingerprint IS NOT OLD.fingerprint
 OR NEW.code IS NOT OLD.code OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at
 OR NEW.resolution_version<>OLD.resolution_version+1
BEGIN SELECT RAISE(ABORT,'failure-evidence-immutable'); END;
CREATE TRIGGER run_failures_no_replace BEFORE INSERT ON run_failures
WHEN EXISTS(SELECT 1 FROM run_failures WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'failure-identity-conflict'); END;

CREATE TRIGGER auth_leases_no_replace BEFORE INSERT ON auth_leases
WHEN EXISTS(SELECT 1 FROM auth_leases WHERE credential_key=NEW.credential_key)
BEGIN SELECT RAISE(ABORT,'auth-lease-identity-conflict'); END;
CREATE TRIGGER timeline_events_no_replace BEFORE INSERT ON timeline_events
WHEN EXISTS(SELECT 1 FROM timeline_events WHERE id=NEW.id OR cursor=NEW.cursor
 OR (NEW.kind='operation-confirmed' AND kind='operation-confirmed' AND operation_id=NEW.operation_id AND operation_generation=NEW.operation_generation))
BEGIN SELECT RAISE(ABORT,'timeline-identity-conflict'); END;

CREATE TRIGGER command_audits_no_bulk_parent
        BEFORE INSERT ON command_audits
        WHEN EXISTS (SELECT 1 FROM commands WHERE id = NEW.command_id AND family = 'bulk-parent')
        BEGIN SELECT RAISE(ABORT,'command-audits-no-bulk-parent'); END;

CREATE TRIGGER commands_bulk_immutable
        BEFORE UPDATE ON commands WHEN OLD.family = 'bulk-parent'
        BEGIN SELECT RAISE(ABORT,'commands-bulk-immutable'); END;

CREATE TRIGGER commands_bulk_retained
        BEFORE DELETE ON commands WHEN OLD.family = 'bulk-parent'
        BEGIN SELECT RAISE(ABORT,'commands-bulk-retained'); END;

CREATE TRIGGER commands_parent_immutable
        BEFORE UPDATE OF parent_id ON commands
        WHEN NEW.parent_id IS NOT OLD.parent_id
        BEGIN SELECT RAISE(ABORT,'commands-parent-immutable'); END;

CREATE TRIGGER commands_parent_kind
        BEFORE INSERT ON commands
        WHEN NEW.parent_id IS NOT NULL AND
          (NEW.id = NEW.parent_id OR NEW.family <> 'run' OR
           NOT EXISTS (SELECT 1 FROM commands WHERE id = NEW.parent_id
             AND family = 'bulk-parent' AND parent_id IS NULL))
        BEGIN SELECT RAISE(ABORT,'commands-parent-kind'); END;

CREATE TRIGGER artifacts_extracted_immutable BEFORE UPDATE ON artifacts
WHEN OLD.kind='extracted'
BEGIN SELECT RAISE(ABORT,'artifacts-extracted-immutable'); END;

CREATE TRIGGER worker_pools_retained BEFORE DELETE ON worker_pools
BEGIN SELECT RAISE(ABORT,'worker-pools-retained'); END;

CREATE TRIGGER run_batches_retained
        BEFORE DELETE ON "run_batches"
        BEGIN SELECT RAISE(ABORT,'run-batches-retained'); END;

CREATE TRIGGER run_batches_presentation
        BEFORE UPDATE ON run_batches
        WHEN NEW.id IS NOT OLD.id OR NEW.workflow IS NOT OLD.workflow
          OR NEW.started_at IS NOT OLD.started_at OR NEW.created_at IS NOT OLD.created_at
          OR EXISTS (SELECT fullkey, type, atom FROM json_tree(json_remove(NEW.payload_json, '$.groupInQueue', '$.version')) EXCEPT SELECT fullkey, type, atom FROM json_tree(json_remove(OLD.payload_json, '$.groupInQueue', '$.version')))
          OR EXISTS (SELECT fullkey, type, atom FROM json_tree(json_remove(OLD.payload_json, '$.groupInQueue', '$.version')) EXCEPT SELECT fullkey, type, atom FROM json_tree(json_remove(NEW.payload_json, '$.groupInQueue', '$.version')))
          OR NEW.version <> OLD.version + 1
          OR NEW.version IS NOT json_extract(NEW.payload_json, '$.version')
          OR NEW.group_in_queue IS NOT json_extract(NEW.payload_json, '$.groupInQueue')
        BEGIN SELECT RAISE(ABORT,'run-batches-presentation'); END;

CREATE TRIGGER runs_completion_immutable BEFORE UPDATE ON runs
        WHEN (json_type(OLD.lifecycle_json, '$.completion') IS 'object' AND (
            json_extract(NEW.lifecycle_json, '$.completion') IS NOT json_extract(OLD.lifecycle_json, '$.completion')
            OR json_extract(NEW.lifecycle_json, '$.lifecycle') IS NOT json_extract(OLD.lifecycle_json, '$.lifecycle')
            OR NEW.claim_generation IS NOT OLD.claim_generation))
          OR (json_type(OLD.lifecycle_json, '$.completion') IS NULL AND json_type(NEW.lifecycle_json, '$.completion') IS 'object' AND (
            OLD.state NOT IN ('claimed','validating','running')
            OR json_extract(NEW.lifecycle_json, '$.completion.claim.workerId') IS NOT OLD.owner_worker_id
            OR json_extract(NEW.lifecycle_json, '$.completion.claim.claimGeneration') IS NOT OLD.claim_generation
            OR json_extract(NEW.lifecycle_json, '$.completion.expectedVersion') IS NOT OLD.version
            OR NEW.version IS NOT OLD.version + 1
            OR json_extract(NEW.lifecycle_json, '$.updatedAt') IS NOT json_extract(NEW.lifecycle_json, '$.completion.authorizedAt')))
        BEGIN SELECT RAISE(ABORT,'runs-completion-immutable'); END;

CREATE TRIGGER runs_completion_insert BEFORE INSERT ON runs
        WHEN COALESCE(json_extract(NEW.lifecycle_json, '$.lifecycle.outcome') IN ('done','failed'), 0)
          IS NOT (json_type(NEW.lifecycle_json, '$.completion') IS 'object')
          OR (json_type(NEW.lifecycle_json, '$.completion') IS 'object' AND (
            json_extract(NEW.lifecycle_json, '$.completion.schemaVersion') IS NOT 1
            OR json_extract(NEW.lifecycle_json, '$.lifecycle.state') IS NOT 'terminal'
            OR json_extract(NEW.lifecycle_json, '$.completion.kind') IS NOT json_extract(NEW.lifecycle_json, '$.lifecycle.outcome')
            OR json_extract(NEW.lifecycle_json, '$.completion.authorizedAt') IS NOT json_extract(NEW.lifecycle_json, '$.lifecycle.endedAt')
            OR json_extract(NEW.lifecycle_json, '$.completion.claim.claimGeneration') IS NOT NEW.claim_generation
            OR json_type(NEW.lifecycle_json, '$.completion.claim.workerId') IS NOT 'text'
            OR json_type(NEW.lifecycle_json, '$.completion.expectedVersion') IS NOT 'integer'
            OR json_extract(NEW.lifecycle_json, '$.completion.expectedVersion') < 1
            OR NEW.version < json_extract(NEW.lifecycle_json, '$.completion.expectedVersion') + 1
            OR (json_extract(NEW.lifecycle_json, '$.completion.kind') = 'failed' AND
              json_extract(NEW.lifecycle_json, '$.completion.failureId') IS NOT json_extract(NEW.lifecycle_json, '$.lifecycle.failureId'))
            OR (json_extract(NEW.lifecycle_json, '$.completion.kind') = 'done' AND
              json_type(NEW.lifecycle_json, '$.completion.resultDigest') IS NOT 'text')
          ))
        BEGIN SELECT RAISE(ABORT,'runs-completion-insert'); END;

CREATE TRIGGER runs_completion_update BEFORE UPDATE ON runs
        WHEN COALESCE(json_extract(NEW.lifecycle_json, '$.lifecycle.outcome') IN ('done','failed'), 0)
          IS NOT (json_type(NEW.lifecycle_json, '$.completion') IS 'object')
          OR (json_type(NEW.lifecycle_json, '$.completion') IS 'object' AND (
            json_extract(NEW.lifecycle_json, '$.completion.schemaVersion') IS NOT 1
            OR json_extract(NEW.lifecycle_json, '$.lifecycle.state') IS NOT 'terminal'
            OR json_extract(NEW.lifecycle_json, '$.completion.kind') IS NOT json_extract(NEW.lifecycle_json, '$.lifecycle.outcome')
            OR json_extract(NEW.lifecycle_json, '$.completion.authorizedAt') IS NOT json_extract(NEW.lifecycle_json, '$.lifecycle.endedAt')
            OR json_extract(NEW.lifecycle_json, '$.completion.claim.claimGeneration') IS NOT NEW.claim_generation
            OR json_type(NEW.lifecycle_json, '$.completion.claim.workerId') IS NOT 'text'
            OR json_type(NEW.lifecycle_json, '$.completion.expectedVersion') IS NOT 'integer'
            OR json_extract(NEW.lifecycle_json, '$.completion.expectedVersion') < 1
            OR NEW.version < json_extract(NEW.lifecycle_json, '$.completion.expectedVersion') + 1
            OR (json_extract(NEW.lifecycle_json, '$.completion.kind') = 'failed' AND
              json_extract(NEW.lifecycle_json, '$.completion.failureId') IS NOT json_extract(NEW.lifecycle_json, '$.lifecycle.failureId'))
            OR (json_extract(NEW.lifecycle_json, '$.completion.kind') = 'done' AND
              json_type(NEW.lifecycle_json, '$.completion.resultDigest') IS NOT 'text')
          ))
        BEGIN SELECT RAISE(ABORT,'runs-completion-update'); END;

CREATE TRIGGER notifications_identity
        BEFORE UPDATE ON notifications
        WHEN NEW.id IS NOT OLD.id
          OR NEW.actor_id IS NOT OLD.actor_id
          OR NEW.dedupe_fingerprint IS NOT OLD.dedupe_fingerprint
          OR NEW.created_at IS NOT OLD.created_at
        BEGIN
          SELECT RAISE(ABORT,'notifications-identity');
        END;

CREATE TRIGGER notifications_monotonic
        BEFORE UPDATE OF seen_count, version ON notifications
        WHEN NEW.version <> OLD.version + 1 OR NEW.seen_count < OLD.seen_count
        BEGIN
          SELECT RAISE(ABORT,'notifications-monotonic');
        END;

CREATE TRIGGER run_requests_consume_once
        BEFORE UPDATE OF consumed_by ON "run_requests"
        WHEN OLD.consumed_by IS NOT NULL AND NEW.consumed_by IS NOT OLD.consumed_by
        BEGIN
          SELECT RAISE(ABORT,'run-requests-consume-once');
        END;`] },
  { version: 2, statements: ["CREATE INDEX timeline_confirmed_action_head_idx ON timeline_events(json_extract(payload_json,'$.payload.note.confirmedAction.workerStreamId'),cursor)"] },
  { version: 3, statements: [`PRAGMA defer_foreign_keys=ON;
CREATE TABLE worker_pools_unbounded (
 workflow TEXT PRIMARY KEY, desired_workers INTEGER NOT NULL CHECK(desired_workers>=0),
 version INTEGER NOT NULL CHECK(version>0), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
INSERT INTO worker_pools_unbounded SELECT * FROM worker_pools;
DROP TABLE worker_pools;
ALTER TABLE worker_pools_unbounded RENAME TO worker_pools;
CREATE TRIGGER worker_pools_retained BEFORE DELETE ON worker_pools
BEGIN SELECT RAISE(ABORT,'worker-pools-retained'); END;
PRAGMA defer_foreign_keys=OFF;`] },
  { version: 4, statements: [...WORKBOOK_LIBRARY_MIGRATION.statements, `CREATE TRIGGER artifacts_import_workbook_source BEFORE UPDATE ON artifacts
WHEN OLD.kind='imported' AND json_type(OLD.payload_json,'$.preparationJson')='text'
 AND json_extract(json_extract(NEW.payload_json,'$.preparationJson'),'$.workbookSource') IS NOT json_extract(json_extract(OLD.payload_json,'$.preparationJson'),'$.workbookSource')
BEGIN SELECT RAISE(ABORT,'imported-artifact-workbook-source-immutable'); END;`] },
  { version: 5, statements: ["UPDATE run_requests SET payload_json=json_set(payload_json, '$.workers', 'auto')"] },
  { version: 6, statements: ["UPDATE run_requests SET payload_json=json_remove(payload_json, '$.workers')"] },
  { version: 7, statements: [`CREATE TABLE database_states_bound (
 id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version>0),
 authority_generation INTEGER NOT NULL CHECK(authority_generation>=0), updated_at TEXT NOT NULL,
 search_generation INTEGER, search_state TEXT NOT NULL CHECK(search_state IN ('unbuilt','ready','invalid')),
 installation_id TEXT NOT NULL CHECK(length(installation_id)=36), profile_id TEXT NOT NULL CHECK(length(profile_id)=36),
 CHECK(search_state<>'ready' OR search_generation=authority_generation)
) STRICT;`, "DROP TABLE database_states", "ALTER TABLE database_states_bound RENAME TO database_states",
    `CREATE TRIGGER database_states_binding_immutable BEFORE UPDATE OF installation_id,profile_id ON database_states
BEGIN SELECT RAISE(ABORT,'profile-database-binding-immutable'); END;`] },
  { version: 8, statements: [`CREATE TABLE assistant_grants (
 id TEXT PRIMARY KEY CHECK(id='current'), profile_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 command_id TEXT NOT NULL REFERENCES commands(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE assistant_chats (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE assistant_actions (
 id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES assistant_chats(id), command_id TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('prepared','approved','claimed','settled','unknown','cancelled')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER assistant_chats_immutable BEFORE UPDATE ON assistant_chats
BEGIN SELECT RAISE(ABORT,'assistant-chat-immutable'); END;
CREATE TRIGGER assistant_grants_revision BEFORE UPDATE ON assistant_grants
WHEN NEW.profile_id IS NOT OLD.profile_id OR NEW.revision <> OLD.revision+1 OR NEW.command_id IS OLD.command_id
BEGIN SELECT RAISE(ABORT,'assistant-grant-revision-conflict'); END;
CREATE TRIGGER assistant_actions_transition BEFORE UPDATE ON assistant_actions
WHEN NEW.id IS NOT OLD.id OR NEW.chat_id IS NOT OLD.chat_id OR NEW.command_id IS NOT OLD.command_id
 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.revision <> OLD.revision+1
 OR json_remove(NEW.payload_json,'$.revision','$.state','$.result') IS NOT json_remove(OLD.payload_json,'$.revision','$.state','$.result')
 OR NOT ((OLD.state='prepared' AND NEW.state IN ('approved','cancelled'))
 OR (OLD.state='approved' AND NEW.state IN ('claimed','cancelled'))
 OR (OLD.state='claimed' AND NEW.state IN ('settled','unknown')) OR (OLD.state='unknown' AND NEW.state='settled'))
BEGIN SELECT RAISE(ABORT,'assistant-action-state-conflict'); END;`] },
  { version: 9, statements: [
    `CREATE TABLE assistant_model_preference (
      id TEXT PRIMARY KEY CHECK(id='current'), profile_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), command_id TEXT NOT NULL UNIQUE REFERENCES commands(id),
      audit_id TEXT NOT NULL UNIQUE REFERENCES command_audits(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TRIGGER assistant_model_preference_monotonic BEFORE UPDATE ON assistant_model_preference
      WHEN NEW.id IS NOT OLD.id OR NEW.profile_id IS NOT OLD.profile_id OR NEW.revision != OLD.revision+1
        OR NEW.command_id=OLD.command_id OR NEW.audit_id=OLD.audit_id
      BEGIN SELECT RAISE(ABORT,'assistant-preference-revision-conflict'); END`,
    `CREATE TRIGGER assistant_model_preference_no_delete BEFORE DELETE ON assistant_model_preference
      BEGIN SELECT RAISE(ABORT,'assistant-preference-delete-refused'); END`,
  ] },
]);

export function deriveAuthorityUpgradePlanDigest(fromSchemaVersion: number, sourceContentFingerprint: string,
  toSchemaVersion: 8 | typeof CURRENT_AUTHORITY_SCHEMA_VERSION = CURRENT_AUTHORITY_SCHEMA_VERSION): string {
  if (toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION && !(fromSchemaVersion === 7 && toSchemaVersion === 8)) throw new Error('authority-upgrade-plan-target-unsupported');
  const statements = SQLITE_MIGRATIONS.filter(migration => migration.version > fromSchemaVersion && migration.version <= toSchemaVersion).flatMap(migration => migration.statements);
  return createHash("sha256").update(canonicalJsonStringify({ fromSchemaVersion,
    toSchemaVersion, sourceContentFingerprint, statements })).digest("hex");
}

export function migrationTableNames(version: number): readonly AuthorityTableName[] {
  return AuthorityTableNameSchema.options.filter(name => (version >= 4
    || (name !== "workbook_library" && name !== "workbook_library_history"))
    && (version >= 8 || !name.startsWith("assistant_"))
    && (version >= 9 || name !== "assistant_model_preference"));
}

export function auditMigrationTableCoverage(): readonly string[] {
  const statements = [...SQLITE_MIGRATIONS[0].statements, ...WORKBOOK_LIBRARY_MIGRATION.statements, ...SQLITE_MIGRATIONS.filter(migration => migration.version >= 8).flatMap(migration => migration.statements)];
  const names = statements.flatMap(statement => [...statement.matchAll(/CREATE TABLE ([a-z_]+)/gu)].map(match => match[1]));
  const registered = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name);
  return [
    ...registered.filter(name => !names.includes(name)).map(name => `registered table ${name} has no DDL`),
    ...names.filter(name => !registered.some(registeredName => registeredName === name)).map(name => `DDL table ${name} is not registered`),
  ];
}

export function tableClassification(name: TableName): TableSpec["classification"] {
  const spec = AUTHORITY_TABLE_REGISTRY.find(entry => entry.name === name);
  if (spec === undefined) throw new Error(`table ${name} has no authority classification`);
  return spec.classification;
}
