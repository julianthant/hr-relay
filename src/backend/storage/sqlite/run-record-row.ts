import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunRecordSchema, runClaim, runTransitionViolation, type RunRecord } from "../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";

export const RUN_RECORD_JSON_SQL = "json_set(lifecycle_json, '$.envelope', json(envelope_json))";

function runRecordScalarColumns(record: RunRecord) {
  const { envelope } = record;
  const claim = runClaim(record);
  return {
    id: envelope.runId,
    workflow: envelope.workflow,
    item_id: envelope.itemId,
    attempt: envelope.attempt,
    run_number: record.runNumber ?? null,
    batch_id: record.sessionId ?? null,
    parent_id: envelope.parent?.runId ?? null,
    state: record.lifecycle.state,
    outcome: record.lifecycle.state === "terminal" ? record.lifecycle.outcome : null,
    priority: envelope.priority,
    not_before: record.lifecycle.state === "queued" ? record.lifecycle.notBefore ?? null : null,
    owner_worker_id: claim?.workerId ?? null,
    claim_generation: record.claimGeneration,
    heartbeat_at: claim?.heartbeatAt ?? null,
    version: record.version,
    settings_snapshot_id: envelope.configSnapshotId,
    descriptor_version: envelope.descriptorVersion,
    contract_fingerprint: envelope.contractFingerprint,
    trace_id: envelope.traceId,
    dry_run: Number(envelope.dryRun),
    local_day: searchPartitionDay(new Date(envelope.enqueuedAt)),
    enqueued_at: envelope.enqueuedAt,
    session_id: record.sessionId ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function runRecordColumns(input: RunRecord) {
  const record = RunRecordSchema.parse(input);
  const { envelope, ...lifecycle } = record;
  const { created_at, updated_at, ...columns } = runRecordScalarColumns(record);
  return {
    ...columns,
    envelope_json: canonicalJsonStringify(envelope),
    lifecycle_json: canonicalJsonStringify(lifecycle),
    created_at,
    updated_at,
  };
}

const ScalarSchema = z.union([z.string(), z.number(), z.null()]);
const RowSchema = z.record(z.string(), ScalarSchema);

export function runRecordFromRow(input: unknown): RunRecord {
  const row = RowSchema.parse(input);
  if (typeof row.envelope_json !== "string" || typeof row.lifecycle_json !== "string") {
    throw new Error("run row is missing whole-record JSON");
  }
  const envelope: unknown = JSON.parse(row.envelope_json);
  const lifecycle: unknown = JSON.parse(row.lifecycle_json);
  if (typeof lifecycle !== "object" || lifecycle === null || Array.isArray(lifecycle)
    || Object.hasOwn(lifecycle, "envelope")) throw new Error("run lifecycle JSON must contain exactly the non-envelope record");
  const record = RunRecordSchema.parse({ ...lifecycle, envelope });
  const columns = runRecordScalarColumns(record);
  const actualKeys = Object.keys(row).sort();
  const expectedKeys = [...Object.keys(columns), "envelope_json", "lifecycle_json"].sort();
  if (canonicalJsonStringify(actualKeys) !== canonicalJsonStringify(expectedKeys)) {
    throw new Error("run row columns do not match the native schema");
  }
  for (const [key, expected] of Object.entries(columns)) {
    if (row[key] !== expected) throw new Error(`run row ${key} does not match its whole-record JSON`);
  }
  return Object.freeze(record);
}

export function updateRunRecord(database: DatabaseSync, record: RunRecord): number {
  const entries = Object.entries(runRecordColumns(record)).filter(([key]) => key !== "id");
  const changed = Number(database.prepare(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
    .run(...entries.map(([, value]) => value), record.envelope.runId, record.version - 1).changes);
  if (changed !== 1) throw new Error("run-version-fence-lost");
  return changed;
}

export function transitionRunRecord(current: RunRecord, candidate: RunRecord, now: string): RunRecord {
  if ("workerId" in current.lifecycle && "workerId" in candidate.lifecycle
    && canonicalJsonStringify(current.lifecycle.workerLifetime ?? null) !== canonicalJsonStringify(candidate.lifecycle.workerLifetime ?? null)) throw new Error("run-claim-lifetime-immutable");
  const violation = runTransitionViolation(current.lifecycle, candidate.lifecycle);
  if (violation !== undefined) throw new Error(`run ${current.envelope.runId}: ${violation}`);
  return RunRecordSchema.parse({ ...candidate, version: current.version + 1, updatedAt: now });
}
