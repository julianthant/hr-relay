import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { LegacyProviderRequestSchema, ProviderRequestStorageSchema, ProviderUsageStorageSchema, type ProviderRequestStorage, type ProviderUsageStorage } from "../../domain/provider-accounting.js";
import { ProviderAdmissionRecordSchema, ProviderBudgetCounterSchema } from "../../domain/provider-admission.js";
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
const RowSchema = z.strictObject({ record_json: z.string() });
export function readProviderRequest(db: DatabaseSync, id: string): ProviderRequestStorage | undefined {
 const row = db.prepare("SELECT record_json FROM provider_requests WHERE record_key=?").get(id);
 return row === undefined ? undefined : ProviderRequestStorageSchema.parse(JSON.parse(RowSchema.parse(row).record_json));
}
export function readProviderUsage(db: DatabaseSync, id: string): ProviderUsageStorage | undefined {
 const row = db.prepare("SELECT record_json FROM provider_usage WHERE record_key=?").get(id);
 return row === undefined ? undefined : ProviderUsageStorageSchema.parse(JSON.parse(RowSchema.parse(row).record_json));
}
export function writeProviderRequest(db: DatabaseSync, input: ProviderRequestStorage, expectedVersion: number | null): void {
 const record = ProviderRequestStorageSchema.parse(input);
 const r = record.kind === "legacy-capability" ? record.record : record;
 const lifecycle = record.kind === "legacy-capability" ? record.record.lifecycle : undefined;
 const id = record.kind === "legacy-capability" ? record.record.admissionId : record.requestId;
 if(expectedVersion!==null && r.version!==expectedVersion+1)throw new Error("provider-request-version-conflict");
 const state = lifecycle?.state ?? (record.kind === "generic" ? record.state : "");
 const reserved = record.kind === "legacy-capability" ? record.record.reservation.maximumCostUsdMicros : null;
 const actual = lifecycle?.state === "settled" ? lifecycle.actualUsage.costUsdMicros : null;
 const lease = lifecycle?.state === "reserved" ? lifecycle.leaseExpiresAt : record.kind === "generic" ? record.leaseExpiresAt : null;
 const deadline = lifecycle?.state === "reserved" ? lifecycle.deadlineAt : record.kind === "generic" ? record.deadlineAt : null;
 const values = [r.execution.runId, r.capability, r.configSnapshotId, r.configFingerprint, r.requestFingerprint,
   state, reserved, actual, lease, deadline, r.version, canonicalJsonStringify(record), r.createdAt];
 const changes = expectedVersion === null
  ? db.prepare(`INSERT INTO provider_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, ...values).changes
  : db.prepare(`UPDATE provider_requests SET run_id=?,capability=?,config_snapshot_id=?,config_fingerprint=?,request_fingerprint=?,
    state=?,reserved_cost_usd_micros=?,actual_cost_usd_micros=?,lease_expires_at=?,deadline_at=?,version=?,record_json=?,created_at=? WHERE record_key=? AND version=?`)
    .run(...values,id,expectedVersion).changes;
 if (changes !== 1) throw new Error("provider-request-version-conflict");
}
export function writeProviderUsage(db: DatabaseSync, input: ProviderUsageStorage, expectedVersion: number | null): void {
 const record = ProviderUsageStorageSchema.parse(input); const r = record.kind === "legacy-capability" ? record.record : undefined;
 const version = r?.version ?? (record.kind === "generic" ? record.version : 0);
 if(record.kind==="generic"&&expectedVersion!==null&&version!==expectedVersion+1)throw new Error("provider-usage-version-conflict");
 const createdAt = r?.createdAt ?? (record.kind === "generic" ? record.createdAt : "");
 const id = r?.capability ?? (record.kind === "generic" ? record.usageId : "");
 const values = [r?.capability ?? null,r?.minuteWindowStartedAt ?? null,r?.minuteRequests ?? null,r?.dayWindowStartedAt ?? null,
  r?.dayRequests ?? null,r?.dayReservedCostUsdMicros ?? null,r?.activeReservations ?? null,r?.blockedByAdmissionId ?? null,
  version,canonicalJsonStringify(record),createdAt];
 const changes = expectedVersion === null ? db.prepare("INSERT INTO provider_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id,...values).changes
  : db.prepare(`UPDATE provider_usage SET capability=?,minute_window_started_at=?,minute_requests=?,day_window_started_at=?,day_requests=?,
    day_reserved_cost_usd_micros=?,active_reservations=?,blocked_by_admission_id=?,version=?,record_json=?,created_at=? WHERE record_key=? AND version=?`)
    .run(...values,id,expectedVersion).changes;
 if (changes !== 1) throw new Error("provider-usage-version-conflict");
}
export function convertProviderStorage(db: DatabaseSync, now: string): void {
 const tracking = LegacyProviderRequestSchema.shape.tracking.parse({ startedAt: now, coverage: "historical-gaps", evidence: "legacy-reported" });
 for (const row of db.prepare("SELECT record_json FROM provider_budget_counters ORDER BY record_key").all()) {
  const record = ProviderBudgetCounterSchema.parse(JSON.parse(RowSchema.parse(row).record_json));
  writeProviderUsage(db,{ format: 1,kind: "legacy-capability",record,tracking,cumulative: { requests: 0,chargedUsdMicros: 0 } },null);
 }
 for (const row of db.prepare("SELECT record_json FROM provider_admissions ORDER BY record_key").all()) {
  const record = ProviderAdmissionRecordSchema.parse(JSON.parse(RowSchema.parse(row).record_json));
  writeProviderRequest(db,{ format: 1,kind: "legacy-capability",record,tracking,origin: "pre-tracking",attribution: { kind: "legacy-capability",capability: record.capability } },null);
 }
}
