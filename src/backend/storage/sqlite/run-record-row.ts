import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { PredecessorRunRecordSchema, RunRecordSchema, runClaim, runTransitionViolation, type PredecessorRunRecord, type RunRecord } from "../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import { interruptTransition } from "../../../rules/runs/run-interrupt.js";

export const RUN_RECORD_JSON_SQL = "json_set(lifecycle_json, '$.envelope', json(envelope_json))";

function runRecordScalarColumns(record: PredecessorRunRecord) {
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
    pause_state: record.pause?.state ?? null,
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

export function runRecordColumns(input: PredecessorRunRecord, schema: z.ZodType<PredecessorRunRecord> = RunRecordSchema) {
  const record = schema.parse(input);
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
  return readRunRow(input, RunRecordSchema);
}

/** Reads a run stored before envelopes carried a build id, for the stopped upgrade that deletes it. */
export function predecessorRunRecordFromRow(input: unknown): PredecessorRunRecord {
  return readRunRow(input, PredecessorRunRecordSchema);
}

function readRunRow<Record extends PredecessorRunRecord>(input: unknown, schema: z.ZodType<Record>): Record {
  const row = RowSchema.parse(input);
  if (typeof row.envelope_json !== "string" || typeof row.lifecycle_json !== "string") {
    throw new Error("run row is missing whole-record JSON");
  }
  const envelope: unknown = JSON.parse(row.envelope_json);
  const lifecycle: unknown = JSON.parse(row.lifecycle_json);
  if (typeof lifecycle !== "object" || lifecycle === null || Array.isArray(lifecycle)
    || Object.hasOwn(lifecycle, "envelope")) throw new Error("run lifecycle JSON must contain exactly the non-envelope record");
  const record = schema.parse({ ...lifecycle, envelope });
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

export function updateRunRecord(database: DatabaseSync, record: PredecessorRunRecord, schema: z.ZodType<PredecessorRunRecord> = RunRecordSchema): number {
  const entries = Object.entries(runRecordColumns(record, schema)).filter(([key]) => key !== "id");
  const changed = Number(database.prepare(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
    .run(...entries.map(([, value]) => value), record.envelope.runId, record.version - 1).changes);
  if (changed !== 1) throw new Error("run-version-fence-lost");
  return changed;
}

export function transitionRunRecord(current: RunRecord, candidate: RunRecord, now: string): RunRecord {
  return transitionStoredRun(current, candidate, now, RunRecordSchema) as RunRecord;
}

export function transitionStoredRun(current: PredecessorRunRecord, candidate: PredecessorRunRecord, now: string, schema: z.ZodType<PredecessorRunRecord>): PredecessorRunRecord {
  const violation = runTransitionViolation(current.lifecycle, candidate.lifecycle);
  if (violation !== undefined) throw new Error(`run ${current.envelope.runId}: ${violation}`);
  const { pause: candidatePause, ...withoutPause } = candidate;
  // The pause field moves on its own: a pending stop does not keep a released claim's pause from settling.
  const moved = interruptTransition({ lifecycle: current.lifecycle, ...(current.pause === undefined ? {} : { pause: current.pause }) },
    { kind: "lifecycle", to: candidate.lifecycle.state });
  if (moved.state === "refused") throw new Error(`run ${current.envelope.runId}: ${current.lifecycle.state} -> ${candidate.lifecycle.state} refused (${moved.reason})`);
  const pause = current.pause !== undefined && moved.interrupt === "none" ? undefined
    : current.pause?.state === "requested" && moved.interrupt === "paused" ? { ...current.pause, state: "paused" as const, pausedAt: now } : candidatePause;
  return schema.parse({ ...withoutPause, ...(pause === undefined ? {} : { pause }), version: current.version + 1, updatedAt: now });
}
