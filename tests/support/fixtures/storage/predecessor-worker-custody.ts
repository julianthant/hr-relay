import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createRunTerminalEvidenceResult, RunResultRecordSchema, terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runLifecycleRequestFingerprint } from "../../../../src/backend/storage/sqlite/native-lifecycle-request.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { runSettlementColumns, runSettlementContext } from "../../../../src/backend/storage/sqlite/run-settlement-row.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { lifecycleCommandId } from "../../../../src/rules/commands/lifecycle-command-id.js";
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
      raw.prepare(`UPDATE run_results SET ${Object.keys(columns).map(column => `${column}=?`).join(",")} WHERE id=?`).run(...Object.values(columns), String(Json.parse(result).id));
    }
  });
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

/**
 * Rebinds the delegation settlement and retry journals a parent derived from a member's result to that result's predecessor digest,
 * as the predecessor itself derived them: the settlement id, each request fingerprint and each audit follow the new digest.
 * The caller holds the transaction with deferred foreign keys.
 */
export function rebindPredecessorResultDigest(raw: DatabaseSync, previous: string, next: string): readonly string[] {
  const rebound: string[] = [];
  withTriggersDropped(raw, ["commands", "command_audits"], () => {
    for (const row of raw.prepare("SELECT id, request_json, outcome_json FROM commands WHERE family='run-lifecycle' AND instr(request_json, ?) > 0").all(previous)) {
      const id = String(row.id), stored = z.object({ operation: z.string(), request: Json }).passthrough().parse(JSON.parse(String(row.request_json)));
      if (stored.operation !== "delegation-settlement" && stored.operation !== "delegation-retry") throw new Error(`predecessor-digest-unexpected-journal:${stored.operation}`);
      let request = Json.parse(JSON.parse(JSON.stringify(stored.request).replaceAll(previous, next)));
      let commandId = id;
      if (stored.operation === "delegation-settlement") {
        commandId = lifecycleCommandId("delegation-settlement", { dependencyId: request.dependencyId, childRunId: request.runId, childAttempt: request.childAttempt,
          resultDigest: next, ...(request.settlement === undefined ? {} : { settlement: request.settlement }) });
        request = { ...request, commandId };
      }
      const renamed = Json.parse(JSON.parse(JSON.stringify({ ...stored, request }).replaceAll(id, commandId)));
      const command = { ...renamed, requestFingerprint: runLifecycleRequestFingerprint(stored.operation, request) };
      const json = canonicalJsonStringify(command);
      const audit = row.outcome_json === null ? null
        : canonicalJsonStringify({ ...Json.parse(JSON.parse(String(row.outcome_json).replaceAll(id, commandId)) as unknown), request: command });
      raw.prepare("UPDATE commands SET id=?, request_json=?, request_digest=?, outcome_json=? WHERE id=?").run(commandId, json, sha256Hex(json), audit, id);
      raw.prepare("UPDATE command_audits SET id=CASE WHEN id=? THEN ? ELSE id END, command_id=?, payload_json=COALESCE(?, payload_json) WHERE command_id=?").run(id, commandId, commandId, audit, id);
      rebound.push(commandId);
    }
  });
  return rebound;
}

/**
 * Writes an operator retry the predecessor admitted against a crashed worker and settled uncertain within its window: no effect,
 * no outcome, never audited. It is bound to the worker's lease `leaseGeneration`.
 */
export function writePredecessorUncertainRetry(raw: DatabaseSync, input: { workflowId: string; workerId: string; leaseGeneration: number; now: string; effect?: unknown }): string {
  const { workflowId, workerId, leaseGeneration, now } = input, commandId = randomUUID();
  const basis = { leaseGeneration, controlRevision: 1 };
  const request = { commandId, requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "retry-worker",
    target: { workflowId, workerId, membershipRevision: 1, expectedVersion: 1, controlBasis: basis } };
  const json = canonicalJsonStringify(request);
  raw.prepare("INSERT INTO commands VALUES(?,'worker-browser','local-operator',NULL,?,?,?,'uncertain',NULL,?,?)").run(commandId, workerId, sha256Hex(json), json, now, now);
  const control = { commandId, request, scope: `worker-pool:${workflowId}`, executorId: randomUUID(), admittedAt: now, expiresAt: now, basisVersion: 1,
    phase: { state: "uncertain", startedAt: now, observedAt: now, message: "The worker retry outcome is unknown." },
    lifecycle: { commandId, member: { workflowId, workerId, membershipRevision: 1 }, lifetime: { leaseGeneration, processId: 4242, startedAt: now }, basis,
      reservedControlRevision: 2, poolVersion: 1, desiredWorkers: 1, operation: { kind: "retry", mode: "initialize", systems: [] } },
    ...(input.effect === undefined ? {} : { effect: input.effect }) };
  raw.prepare("INSERT INTO worker_controls VALUES(?,?,?,'uncertain',NULL,?,?)").run(commandId, control.scope, workerId, canonicalJsonStringify(control), now);
  return commandId;
}
