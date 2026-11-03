import { terminalEvidenceResult, type RunResultRecord } from "../../../models/run/result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunRecordSchema, type RunRecord } from "../../../models/run/record.js";

export const CURRENT_RUN_SETTLEMENT_SQL = `run.state='terminal'
  AND json_extract(settlement.terminal_run_json,'$.lifecycle') IS json_extract(run.lifecycle_json,'$.lifecycle')
  AND ((run.outcome IN ('done','failed') AND settlement.settlement_version=json_extract(run.lifecycle_json,'$.completion.expectedVersion')+1)
    OR (run.outcome NOT IN ('done','failed','interrupted') AND settlement.settlement_version=json_extract(settlement.payload_json,'$.result.value.appliedVersion')))`;

export function readRunSettlementRow(database: DatabaseSync, runId: string, appliedVersion?: number) {
  const rows = appliedVersion === undefined
    ? database.prepare(`SELECT settlement.* FROM run_results settlement JOIN runs run ON run.id=settlement.run_id
      WHERE settlement.run_id=? AND ${CURRENT_RUN_SETTLEMENT_SQL}`).all(runId)
    : database.prepare("SELECT * FROM run_results WHERE run_id=? AND settlement_version=?").all(runId, appliedVersion);
  if (rows.length > 1) throw new Error("run-current-settlement-ambiguous");
  return rows[0];
}

export function runSettlementContext(raw: unknown) {
  const row = z.object({ run_id: z.string(), settlement_version: z.number().int().positive(), terminal_run_json: z.string() }).parse(raw);
  const run = RunRecordSchema.parse(JSON.parse(row.terminal_run_json));
  if (run.envelope.runId !== row.run_id || run.version !== row.settlement_version || run.lifecycle.state !== "terminal"
    || run.completion !== undefined && run.completion.expectedVersion + 1 !== row.settlement_version) throw new Error("run-settlement-context-mismatch");
  return run;
}

export function runSettlementColumns(run: RunRecord, result: RunResultRecord) {
  const evidence = terminalEvidenceResult(result);
  const version = z.number().int().positive().parse(run.completion === undefined
    ? evidence?.kind === "lifecycle-evidence" ? evidence.appliedVersion : undefined : run.completion.expectedVersion + 1);
  if (run.lifecycle.state !== "terminal" || run.version < version || run.envelope.runId !== result.runId
    || run.lifecycle.endedAt !== result.createdAt) throw new Error("run-settlement-context-mismatch");
  const terminal = RunRecordSchema.parse({ ...run, version, updatedAt: result.createdAt });
  return { id: `${result.runId}:${version}`, run_id: result.runId, settlement_version: version,
    terminal_run_json: canonicalJsonStringify(terminal), workflow: result.workflowId, attempt: result.attempt,
    result_digest: result.resultDigest, payload_json: canonicalJsonStringify(result), created_at: result.createdAt };
}
