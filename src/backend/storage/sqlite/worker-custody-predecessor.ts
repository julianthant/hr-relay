import { z } from "zod";
import type { PredecessorRunRecord } from "../../../models/run/record.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { IsoInstantSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { predecessorRunRecordFromRow } from "./run-record-row.js";
import { workerSlotFromRow } from "./worker-slots.js";

/** Stopped stores below the custody schema stored a claim's worker lifetime; only the custody conversion reads it. */
const PredecessorWorkerLifetimeSchema = z.strictObject({ membershipRevision: PositiveIntSchema, leaseGeneration: PositiveIntSchema });
const PREDECESSOR_PHASES = ["starting", "running", "idle", "waiting", "paused", "failed"] as const;

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
