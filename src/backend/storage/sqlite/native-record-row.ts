import { confirmationPublicationFromRow } from "../../../models/events/confirmed-operation.js";
import { WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { validateNotificationPublicationArray } from "./notification-publications.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { RunCheckpointRecordSchema, checkpointRecordKey } from "../../../models/workflow/checkpoint.js";
import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";
import { deriveCheckpointOutputDigest } from "../../../models/run/result.js";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "./storage-records.js";
import { FailureResolutionSchema } from "../../../models/trust/failure-resolution.js";
import { type AuthorityTableName } from "../../../models/config/authority.js";

const RowSchema = z.record(z.string(), z.union([z.string(),z.number(),z.null()]));
const fields = {
  assistant_grants: {id:"id",profile_id:"profileId",revision:"policy.revision",command_id:"commandId",updated_at:"updatedAt"},
  assistant_chats: {id:"id",profile_id:"profileId",epoch:"epoch",created_at:"createdAt",expires_at:"expiresAt"},
  assistant_actions: {id:"id",chat_id:"chatId",command_id:"command.commandId",revision:"revision",state:"state",created_at:"createdAt",expires_at:"expiresAt"},
  database_upgrades: {id:"recordKey",upgrade_id:"upgradeId",phase:"phase",backup_digest:"backup.sha256",created_at:"recordedAt"},
  settings_snapshots: {id:"configSnapshotId",revision:"revision",fingerprint:"fingerprint",captured_at:"capturedAt"},
  command_audits: {id:"auditId",command_id:"request.commandId",code:"result.code",created_at:"completedAt"},
  run_batches: {id:"sessionId",workflow:"workflow",started_at:"startedAt",group_in_queue:"groupInQueue",version:"version",created_at:"createdAt"},
  run_requests: {id:"startPlanId",workflow:"workflowId",actor_id:"plannedBy",consumed_by:"consumedBy.commandId",expires_at:"expiresAt",version:"version",created_at:"createdAt"},
  run_delegations: {id:"manifestId",parent_run_id:"parentRunId",created_at:"createdAt"},
  delegation_dependencies: {id:"dependencyId",delegation_id:"manifestId",created_at:"createdAt"},
  run_checkpoints: {run_id:"runId",workflow:"workflowId",item_id:"itemId",node_id:"nodeId",attempt:"attempt",claim_generation:"claimGeneration",created_at:"writtenAt"},
  gate_results: {run_id:"runId",node_id:"nodeId",gate_id:"gateId",created_at:"resolvedAt"},
  run_results: {run_id:"runId",workflow:"workflowId",attempt:"attempt",result_digest:"resultDigest",created_at:"createdAt"},
  run_failures: {id:"failureId",run_id:"runId",fingerprint:"fingerprint",code:"code",created_at:"occurredAt"},
  run_receipts: {id:"receiptId",run_id:"runId",workflow:"workflowId",attempt:"attempt",result:"result",confidence:"confidence",failure_id:"failure.value",created_at:"generatedAt"},
  write_intents: {id:"writeIntentId",system:"system",idempotency_key:"idempotencyKey",idempotency_key_digest:"idempotencyKeyDigest",status:"status",generation:"generation",run_id:"runId",created_at:"createdAt",updated_at:"updatedAt"},
  write_attempts: {id:"writeAttemptId",intent_id:"writeIntentId",generation:"generation",run_id:"runId",created_at:"recordedAt"},
  worker_pools: {workflow:"workflow",desired_workers:"desiredWorkers",version:"version",created_at:"createdAt",updated_at:"updatedAt"},
  worker_leases: {id:"workerId",worker_id:"workerId",workflow:"workflow",lease_generation:"leaseGeneration",control_revision:"controlRevision",state:"lifecycle.state",directive:"control.directive",heartbeat_at:"lifecycle.heartbeatAt",version:"version",created_at:"createdAt",updated_at:"updatedAt"},
  auth_leases: {credential_key:"credentialKey",generation:"generation",holder_worker_id:"holder.workerId",holder_system:"holder.system",state:"state",expires_at:"expiresAt",version:"version",updated_at:"updatedAt"},
  notifications: {id:"notificationId",actor_id:"actorId",dedupe_fingerprint:"dedupeFingerprint",status:"status",seen_count:"count",version:"version",created_at:"createdAt",updated_at:"updatedAt"},
  notification_states: {id:"concern",updated_at:"observedAt"},
  explorer_overrides: {id:"workflowId",revision:"revision",command_id:"appliedCommandId"},
  diagnostic_snapshots: {id:"bundleId",run_id:"runId",origin_kind:"origin.kind",failure_id:"origin.failureId",content_digest:"contentDigest",retention_kind:"retention.kind",purge_after:"retention.purgeAfter",created_at:"createdAt"},
  diagnostic_files: {snapshot_id:"bundleId",artifact_id:"attachment.artifactId",kind:"attachment.kind",digest:"attachment.digest",sensitivity:"attachment.sensitivity",created_at:"createdAt"},
  dryrun_results: {id:"resultId",scenario_id:"scenarioId",workflow:"workflow",subject_label:"subjectLabel",manifest_digest:"manifestDigest",verdict:"verdict",execution_state:"execution.state",run_id:"execution.runId",trace_id:"execution.traceId",wall_time_ms:"wallTimeMs",created_at:"recordedAt"},
} as const;
export type NativeOrdinaryTable = keyof typeof fields;
function valueAt(record: unknown, path: string): string | number | null {
  let value: unknown = record;
  for (const part of path.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value,part) : undefined;
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return Number(value);
  return z.union([z.string(),z.number()]).parse(value);
}
export function isNativeOrdinaryTable(table: AuthorityTableName): table is NativeOrdinaryTable { return Object.hasOwn(fields,table); }
export function nativeOrdinaryRecordFromRow(table: NativeOrdinaryTable, input: unknown): unknown {
  const row = RowSchema.parse(input);
  let record: unknown;
  if (table === "run_results") {
    try { record = AUTHORITY_RECORD_SCHEMA_REGISTRY[table].parse(JSON.parse(z.string().parse(row.payload_json))); }
    catch { throw new Error("run-result-payload-invalid"); }
  } else record = AUTHORITY_RECORD_SCHEMA_REGISTRY[table].parse(JSON.parse(z.string().parse(row.payload_json)));
  for (const [column,path] of Object.entries(fields[table])) {
    if (row[column] !== valueAt(record,path)) throw new Error(`${table}-row-${column}-mismatch`);
  }
  const object = z.record(z.string(),z.unknown()).parse(record);
  const extras: Record<string,string | number | null> = {};
  if (table === "run_checkpoints") {
    extras.id = checkpointRecordKey(RunCheckpointRecordSchema.parse(record));
    extras.output_digest = deriveCheckpointOutputDigest(object.output);
  } else if (table === "gate_results") extras.id = `${String(object.runId)}:${String(object.gateId)}`;
  else if (table === "diagnostic_files") {
    const attachment = z.record(z.string(),z.unknown()).parse(object.attachment);
    extras.id = `${String(object.bundleId)}:${String(attachment.artifactId)}`;
  } else if (table === "run_failures") {
    let resolution;
    try { resolution=FailureResolutionSchema.parse(JSON.parse(z.string().parse(row.resolution_json))); }
    catch { throw new Error("failure-resolution-annotation-invalid"); }
    extras.resolution_json = z.string().parse(row.resolution_json); extras.resolution_version = resolution.version;
  } else if (table === "write_intents") {
    confirmationPublicationFromRow(WriteIntentRecordSchema.parse(record),row.publication_json);
    extras.publication_json = row.publication_json ?? null;
  } else if (table === "notifications") {
    extras.publications_json = z.string().parse(row.publications_json);
    validateNotificationPublicationArray(record,JSON.parse(extras.publications_json));
    extras.run_id = NotificationRecordSchema.parse(record).links.find(link => "runId" in link)?.runId ?? null;
  }
  for (const [key,value] of Object.entries(extras)) if (row[key] !== value) throw new Error(`${table}-row-${key}-mismatch`);
  const expectedKeys = [...Object.keys(fields[table]),...Object.keys(extras),"payload_json"].sort();
  if (canonicalJsonStringify(Object.keys(row).sort()) !== canonicalJsonStringify(expectedKeys)) throw new Error(`${table}-row-columns-mismatch`);
  return record;
}
