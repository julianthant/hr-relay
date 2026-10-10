export const PROVIDER_REQUEST_DDL = `CREATE TABLE provider_requests (
 record_key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(record_key) ON DELETE RESTRICT,
 capability TEXT NOT NULL, config_snapshot_id TEXT NOT NULL REFERENCES settings_snapshots(record_key) ON DELETE RESTRICT,
 config_fingerprint TEXT NOT NULL, request_fingerprint TEXT NOT NULL, state TEXT NOT NULL,
 reserved_cost_usd_micros INTEGER, actual_cost_usd_micros INTEGER, lease_expires_at TEXT, deadline_at TEXT,
 version INTEGER NOT NULL CHECK(version>0), record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL,
 CHECK(json_extract(record_json,'$.kind') IN ('generic','legacy-capability')),
 CHECK(record_key IS coalesce(json_extract(record_json,'$.requestId'),json_extract(record_json,'$.record.admissionId'))),
 CHECK(run_id IS coalesce(json_extract(record_json,'$.execution.runId'),json_extract(record_json,'$.record.execution.runId'))),
 CHECK(config_snapshot_id IS coalesce(json_extract(record_json,'$.configSnapshotId'),json_extract(record_json,'$.record.configSnapshotId'))),
 CHECK(config_fingerprint IS coalesce(json_extract(record_json,'$.configFingerprint'),json_extract(record_json,'$.record.configFingerprint'))),
 CHECK(request_fingerprint IS coalesce(json_extract(record_json,'$.requestFingerprint'),json_extract(record_json,'$.record.requestFingerprint'))),
 CHECK(capability IS coalesce(json_extract(record_json,'$.capability'),json_extract(record_json,'$.record.capability'))),
 CHECK(state IS coalesce(json_extract(record_json,'$.state'),json_extract(record_json,'$.record.lifecycle.state'))),
 CHECK(version IS coalesce(json_extract(record_json,'$.version'),json_extract(record_json,'$.record.version'))),
 CHECK(lease_expires_at IS coalesce(json_extract(record_json,'$.leaseExpiresAt'),json_extract(record_json,'$.record.lifecycle.leaseExpiresAt'))),
 CHECK(deadline_at IS coalesce(json_extract(record_json,'$.deadlineAt'),json_extract(record_json,'$.record.lifecycle.deadlineAt'))),
 CHECK(reserved_cost_usd_micros IS json_extract(record_json,'$.record.reservation.maximumCostUsdMicros')),
 CHECK(actual_cost_usd_micros IS json_extract(record_json,'$.record.lifecycle.actualUsage.costUsdMicros'))
) STRICT`;
export const PROVIDER_USAGE_DDL = `CREATE TABLE provider_usage (
 record_key TEXT PRIMARY KEY, capability TEXT, minute_window_started_at TEXT, minute_requests INTEGER,
 day_window_started_at TEXT, day_requests INTEGER, day_reserved_cost_usd_micros INTEGER,
 active_reservations INTEGER, blocked_by_admission_id TEXT, version INTEGER NOT NULL,
 record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL,
 CHECK(json_extract(record_json,'$.kind') IN ('generic','legacy-capability')),
 CHECK(record_key IS coalesce(json_extract(record_json,'$.usageId'),json_extract(record_json,'$.record.capability'))),
 CHECK(version IS coalesce(json_extract(record_json,'$.version'),json_extract(record_json,'$.record.version'))),
 CHECK(created_at IS coalesce(json_extract(record_json,'$.createdAt'),json_extract(record_json,'$.record.createdAt')))
) STRICT`;
export const PROVIDER_STORAGE_CONSTRAINTS = [
 `CREATE UNIQUE INDEX provider_usage_scope_meter ON provider_usage(json_extract(record_json,'$.scope.id'),json_extract(record_json,'$.meter')) WHERE json_extract(record_json,'$.kind')='generic'`,
 `CREATE TRIGGER provider_requests_insert_conflict BEFORE INSERT ON provider_requests
 WHEN EXISTS(SELECT 1 FROM provider_requests WHERE record_key=NEW.record_key)
 BEGIN SELECT RAISE(ABORT,'provider request insert conflicts with retained identity'); END`,
 `CREATE TRIGGER provider_usage_insert_conflict BEFORE INSERT ON provider_usage
 WHEN EXISTS(SELECT 1 FROM provider_usage WHERE record_key=NEW.record_key OR
 (json_extract(record_json,'$.kind')='generic' AND json_extract(NEW.record_json,'$.kind')='generic'
 AND json_extract(record_json,'$.scope.id')=json_extract(NEW.record_json,'$.scope.id') AND json_extract(record_json,'$.meter')=json_extract(NEW.record_json,'$.meter')))
 BEGIN SELECT RAISE(ABORT,'provider usage insert conflicts with retained accounting'); END`,
 `CREATE TRIGGER provider_requests_identity_immutable BEFORE UPDATE ON provider_requests
 WHEN NEW.record_key IS NOT OLD.record_key OR NEW.run_id IS NOT OLD.run_id OR NEW.capability IS NOT OLD.capability
 OR NEW.config_snapshot_id IS NOT OLD.config_snapshot_id OR NEW.config_fingerprint IS NOT OLD.config_fingerprint
 OR NEW.request_fingerprint IS NOT OLD.request_fingerprint OR NEW.created_at IS NOT OLD.created_at
 OR json_extract(NEW.record_json,'$.attribution') IS NOT json_extract(OLD.record_json,'$.attribution')
 OR json_extract(NEW.record_json,'$.allocations') IS NOT json_extract(OLD.record_json,'$.allocations')
 BEGIN SELECT RAISE(ABORT,'provider request identity is immutable'); END`,
 `CREATE TRIGGER provider_usage_never_deleted BEFORE DELETE ON provider_usage BEGIN SELECT RAISE(ABORT,'provider usage records are never deleted'); END`,
] as const;
