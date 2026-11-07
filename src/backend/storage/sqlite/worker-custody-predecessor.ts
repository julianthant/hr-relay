import { z } from "zod";
import type { PredecessorRunRecord } from "../../../models/run/record.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { CommandIdSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { commandFromRow } from "./command-record-row.js";
import { runLifecycleRequestFingerprint, validateNativeLifecycleRequest } from "./native-lifecycle-request.js";
import { predecessorRunRecordFromRow } from "./run-record-row.js";
import { workerSlotFromRow } from "./worker-slots.js";

/** Stopped stores below the custody schema stored a claim's worker lifetime; only the custody conversion reads it. */
const PredecessorWorkerLifetimeSchema = z.strictObject({ membershipRevision: PositiveIntSchema, leaseGeneration: PositiveIntSchema });
const PredecessorResetSourceSchema = z.strictObject({ kind: z.literal("worker-reset"), commandId: CommandIdSchema, rootRunId: RunIdSchema });
const PREDECESSOR_PHASES = ["starting", "running", "idle", "waiting", "paused", "failed"] as const;
/** Lifecycle operations of the removed worker leases; with the worker-browser family they are the stopped store's worker history. */
export const PREDECESSOR_WORKER_OPERATIONS: ReadonlySet<string> = new Set(["worker-admission", "worker-standing-recovery", "worker-verification-admission", "worker-verification-retirement"]);

function withoutWorkerLifetime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutWorkerLifetime);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key !== "workerLifetime") return [[key, withoutWorkerLifetime(item)]];
    PredecessorWorkerLifetimeSchema.parse(item);
    return [];
  }));
}

/** A predecessor run row with each validated worker lifetime removed, for the stopped store's own strict run reader. */
export function predecessorCustodyRunRow(input: unknown): Record<string, unknown> {
  const row = z.record(z.string(), z.unknown()).parse(input);
  if (typeof row.lifecycle_json !== "string") return row;
  return { ...row, lifecycle_json: canonicalJsonStringify(withoutWorkerLifetime(JSON.parse(row.lifecycle_json))) };
}

export function predecessorCustodyRunFromRow(input: unknown): PredecessorRunRecord {
  return predecessorRunRecordFromRow(predecessorCustodyRunRow(input));
}

const PredecessorSlotRowSchema = z.strictObject({ id: WorkerIdSchema, workflow: WorkflowIdSchema, ordinal: PositiveIntSchema,
  membership_revision: PositiveIntSchema, phase: z.enum(PREDECESSOR_PHASES), retired_at: IsoInstantSchema.nullable(),
  retirement_command_id: z.string().nullable(), reservation_command_id: z.string().nullable(),
  payload_json: z.string(), created_at: IsoInstantSchema, updated_at: IsoInstantSchema });

/** Reads a predecessor slot row as the slot rebuild keeps it: its payload must agree with every stored column. */
export function predecessorWorkerSlotFromRow(input: unknown): WorkerSlotRecord {
  const row = PredecessorSlotRowSchema.parse(input);
  const payload = z.object({ workerId: z.literal(row.id), workflow: z.literal(row.workflow), ordinal: z.literal(row.ordinal),
    poolIndex: PositiveIntSchema, membershipRevision: z.literal(row.membership_revision), phase: z.literal(row.phase),
    retiredAt: z.literal(row.retired_at), retirementCommandId: z.literal(row.retirement_command_id),
    reservationCommandId: z.literal(row.reservation_command_id), createdAt: z.literal(row.created_at), updatedAt: z.literal(row.updated_at),
  }).parse(JSON.parse(row.payload_json));
  return workerSlotFromRow({ id: row.id, workflow: row.workflow, ordinal: row.ordinal, pool_index: payload.poolIndex, paused: 0,
    retired_at: row.retired_at, created_at: row.created_at, updated_at: row.updated_at });
}

const JsonRecordSchema = z.record(z.string(), z.unknown());

function dropValidated(owner: Record<string, unknown>, key: string, schema: z.ZodType): void {
  if (owner[key] === undefined) return;
  schema.parse(owner[key]);
  delete owner[key];
}

/**
 * A predecessor lifecycle request in the current grammar. The removed worker fields are admitted only where the predecessor
 * wrote them, each checked against its predecessor shape: the claim-next and recover-crash lifetime (required on recover-crash),
 * a transition lifecycle's lifetime, and the worker-reset cancellation source of transition and cancellation terminalize.
 */
export function predecessorLifecycleRequest(operation: string, input: unknown): unknown {
  const request = { ...JsonRecordSchema.parse(input) };
  if (operation === "recover-crash") PredecessorWorkerLifetimeSchema.parse(request.workerLifetime);
  if (operation === "claim-next" || operation === "recover-crash") dropValidated(request, "workerLifetime", PredecessorWorkerLifetimeSchema);
  if ((operation === "transition" || operation === "worker-transition") && request.lifecycle !== undefined) {
    const lifecycle = { ...JsonRecordSchema.parse(request.lifecycle) };
    dropValidated(lifecycle, "workerLifetime", PredecessorWorkerLifetimeSchema);
    request.lifecycle = lifecycle;
  }
  if (operation === "transition" && JsonRecordSchema.safeParse(request.cancellationSource).data?.kind !== undefined) {
    const { kind: _kind, ...source } = PredecessorResetSourceSchema.parse(request.cancellationSource);
    request.cancellationSource = source;
  }
  if (operation === "terminalize" && request.kind === "cancelled") dropValidated(request, "cancellationSource", PredecessorResetSourceSchema);
  return request;
}

/** The stored command binds its stored request; the rest of the request must satisfy the current strict grammar. */
function validatePredecessorLifecycleCommand(input: unknown): void {
  const command = RunLifecycleCommandRecordSchema.parse(input);
  if (command.requestFingerprint !== runLifecycleRequestFingerprint(command.operation, command.request)) throw new Error("run-lifecycle-request-binding-mismatch");
  const request = predecessorLifecycleRequest(command.operation, command.request);
  validateNativeLifecycleRequest({ ...command, request, requestFingerprint: runLifecycleRequestFingerprint(command.operation, request) });
}

/** A predecessor command row, returned exactly as stored. */
export function predecessorCommandFromRow(input: unknown): ReturnType<typeof commandFromRow> {
  return commandFromRow(input, validatePredecessorLifecycleCommand);
}

const HistoryRowSchema = z.object({ id: CommandIdSchema, family: z.string(), request_digest: z.string(), request_json: z.string(), outcome_json: z.string().nullable() });

export function isPredecessorWorkerHistory(input: unknown): boolean {
  const row = HistoryRowSchema.parse(input);
  return row.family === "worker-browser"
    || row.family === "run-lifecycle" && PREDECESSOR_WORKER_OPERATIONS.has(z.object({ operation: z.string() }).parse(JSON.parse(row.request_json)).operation);
}

function canonicalStored(json: string): unknown {
  const value: unknown = JSON.parse(json);
  if (canonicalJsonStringify(value) !== json) throw new Error("predecessor-worker-history-binding-mismatch");
  return value;
}

/**
 * Worker history has no current grammar and the custody conversion deletes all of it, refusing when a kept row references it.
 * Its row is authenticated by binding: id, digest and lifecycle fingerprint over the stored request, and an outcome and audit
 * that repeat that exact request.
 */
export function assertPredecessorWorkerHistory(commandInput: unknown, auditInput?: unknown): void {
  const row = HistoryRowSchema.parse(commandInput);
  const request = JsonRecordSchema.parse(canonicalStored(row.request_json));
  const lifecycle = row.family === "run-lifecycle" ? z.object({ operation: z.string(), requestFingerprint: z.string(), request: z.unknown() }).parse(request) : undefined;
  if (request.commandId !== row.id || row.request_digest !== sha256Hex(row.request_json)
    || lifecycle !== undefined && lifecycle.requestFingerprint !== runLifecycleRequestFingerprint(lifecycle.operation, lifecycle.request)
    || row.outcome_json !== null && canonicalJsonStringify(z.object({ request: z.unknown() }).parse(canonicalStored(row.outcome_json)).request) !== row.request_json) {
    throw new Error("predecessor-worker-history-binding-mismatch");
  }
  if (auditInput === undefined) return;
  if (row.outcome_json === null || !z.object({ command_id: z.literal(row.id), payload_json: z.literal(row.outcome_json) }).safeParse(auditInput).success) {
    throw new Error("predecessor-worker-history-binding-mismatch");
  }
}
