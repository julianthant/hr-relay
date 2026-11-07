import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createRunTerminalEvidenceResult, RunResultRecordSchema, terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runLifecycleRequestFingerprint } from "../../../../src/backend/storage/sqlite/native-lifecycle-request.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { runSettlementColumns, runSettlementContext } from "../../../../src/backend/storage/sqlite/run-settlement-row.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { restoreSchema22WorkerCustodyFixture } from "./historical-run-schema.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

const Json = z.record(z.string(), z.unknown());
export const PREDECESSOR_LIFETIME = Object.freeze({ membershipRevision: 1, leaseGeneration: 1 });

export function withTriggersDropped(raw: DatabaseSync, tables: readonly string[], work: () => void): void {
  const triggers = raw.prepare(`SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name IN (${tables.map(() => "?").join(",")})`).all(...tables);
  for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
  try { work(); } finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
}

/** Rewrites one stored lifecycle command as the predecessor wrote it, re-deriving its digest, outcome, audit and any result bound to its fingerprint. */
export function rewritePredecessorCommand(raw: DatabaseSync, commandId: string, rewrite: (operation: string, request: Record<string, unknown>) => Record<string, unknown>): void {
  withTriggersDropped(raw, ["commands", "command_audits", "run_results"], () => {
    const row = z.object({ request_json: z.string(), outcome_json: z.string().nullable() }).passthrough().parse(raw.prepare("SELECT * FROM commands WHERE id=?").get(commandId));
    const record = z.object({ operation: z.string(), requestFingerprint: z.string(), request: Json }).passthrough().parse(JSON.parse(row.request_json));
    const request = rewrite(record.operation, record.request);
    const command = { ...record, request, requestFingerprint: runLifecycleRequestFingerprint(record.operation, request) };
    const json = canonicalJsonStringify(command);
    const audit = row.outcome_json === null ? null : canonicalJsonStringify({ ...Json.parse(JSON.parse(row.outcome_json)), request: command });
    raw.prepare("UPDATE commands SET request_json=?, request_digest=?, outcome_json=? WHERE id=?").run(json, sha256Hex(json), audit, commandId);
    if (audit !== null) raw.prepare("UPDATE command_audits SET payload_json=? WHERE command_id=?").run(audit, commandId);
    for (const result of raw.prepare("SELECT * FROM run_results").all()) {
      const stored = RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results", result));
      const evidence = terminalEvidenceResult(stored);
      if (evidence?.kind !== "lifecycle-evidence" || evidence.requestFingerprint !== record.requestFingerprint) continue;
      const run = runSettlementContext(result);
      const columns = runSettlementColumns(run, createRunTerminalEvidenceResult(RunRecordSchema.parse(run), { ...evidence, requestFingerprint: FingerprintSchema.parse(command.requestFingerprint) }));
      raw.prepare("DELETE FROM run_results WHERE id=?").run(String(Json.parse(result).id));
      raw.prepare(`INSERT INTO run_results (${Object.keys(columns).join(",")}) VALUES (${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
    }
  });
}

/** Returns a current store to the schema 22 custody tables (the caller sets the version), keeping each worker slot in its predecessor row shape. */
export function restorePredecessorCustodySchema(raw: DatabaseSync): void {
  const slots = z.array(z.object({ id: z.string(), workflow: z.string(), ordinal: z.number(), pool_index: z.number(), retired_at: z.string().nullable(),
    created_at: z.string(), updated_at: z.string() })).parse(raw.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all());
  raw.exec("DELETE FROM worker_slots");
  restoreSchema22WorkerCustodyFixture(raw);
  for (const slot of slots) {
    const row = { workerId: slot.id, workflow: slot.workflow, ordinal: slot.ordinal, poolIndex: slot.pool_index, membershipRevision: 1, phase: "idle",
      retiredAt: slot.retired_at, retirementCommandId: null, reservationCommandId: null, createdAt: slot.created_at, updatedAt: slot.updated_at };
    raw.prepare("INSERT INTO worker_slots(id,workflow,ordinal,membership_revision,phase,retired_at,retirement_command_id,reservation_command_id,payload_json,created_at,updated_at) VALUES(?,?,?,1,'idle',?,NULL,NULL,?,?,?)")
      .run(row.workerId, row.workflow, row.ordinal, row.retiredAt, canonicalJsonStringify(row), row.createdAt, row.updatedAt);
  }
}

/** Gives a run's claim, worker transitions and crash recovery the worker lifetime schemas 20-22 stored on them. */
export function writePredecessorWorkerLifetimes(raw: DatabaseSync, runId: string, lifetime: unknown = PREDECESSOR_LIFETIME): readonly string[] {
  const ids = raw.prepare(`SELECT id FROM commands WHERE family='run-lifecycle' AND (target_id=? OR json_extract(outcome_json,'$.result.runId')=?)
    AND json_extract(request_json,'$.operation') IN ('claim-next','recover-crash','worker-transition') ORDER BY id`).all(runId, runId).map(row => String(row.id));
  for (const id of ids) rewritePredecessorCommand(raw, id, (operation, request) => operation === "worker-transition"
    ? { ...request, lifecycle: { ...Json.parse(request.lifecycle), workerLifetime: lifetime } }
    : { ...request, workerLifetime: lifetime });
  return ids;
}
