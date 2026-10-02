/** Stopped schema <=40 conversion. Never reads retired authority during runtime. */
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { HistoricalRunRecordV40Schema, RunRecordSchema } from "../../../domain/run/record.js";
import { HistoricalTerminalAuthorizationSchema, HistoricalTerminalOutboxRecordSchema } from "../../../domain/run/completion-history.js";
import { TerminalAuthorizationRecordSchema } from "../../../domain/run/terminal-authorization.js";
import { completionFromAuthorization } from "../../../domain/run/completion.js";
import { RunResultRecordSchema } from "../../../domain/run/result.js";
import { FailureRecordSchema } from "../../../domain/trust/failure.js";
import { RunLifecycleCommandAuditRecordSchema } from "../../../domain/commands.js";

const RowSchema = z.object({ record_key: z.string(), record_json: z.string() });

export class RunCompletionMigrationError extends Error {
  constructor() { super("run-completion-conversion-refused: missing or contradictory settlement authority; restore the verified source and reconcile evidence"); }
}

export function convertRunCompletions(database: DatabaseSync): void {
  try {
    const authorizations = database.prepare("SELECT * FROM run_terminal_authorizations").all().map((row) => ({
      row: z.object({ record_key: z.string(), record_json: z.string(), kind: z.string(), expected_version: z.number(),
        worker_id: z.string(), claim_generation: z.number(), created_at: z.string() }).parse(row),
    }));
    const results = new Map(database.prepare("SELECT * FROM run_results").all().map((row) => {
      const raw = RowSchema.parse(row); return [raw.record_key, RunResultRecordSchema.parse(JSON.parse(raw.record_json))];
    }));
    const failures = new Map(database.prepare("SELECT * FROM failures").all().map((row) => {
      const raw = RowSchema.parse(row); return [raw.record_key, FailureRecordSchema.parse(JSON.parse(raw.record_json))];
    }));
    const outboxes = new Map(database.prepare("SELECT * FROM run_terminal_outbox").all().map((row) => {
      const raw = z.object({ record_key: z.string(), run_id: z.string(), state: z.string(), record_json: z.string(), created_at: z.string() }).parse(row);
      const receipt = HistoricalTerminalOutboxRecordSchema.parse(JSON.parse(raw.record_json));
      if (raw.record_key !== receipt.outboxId || raw.run_id !== receipt.payload.runId
        || raw.state !== receipt.projection.state || raw.created_at !== receipt.createdAt) throw new RunCompletionMigrationError();
      return [raw.run_id, { raw, receipt }];
    }));
    const runs = new Map(database.prepare("SELECT * FROM workflow_runs").all().map((row) => {
      const raw = RowSchema.parse(row); return [raw.record_key, HistoricalRunRecordV40Schema.parse(JSON.parse(raw.record_json))];
    }));
    const converted = new Map<string, string>();
    for (const { row } of authorizations) {
      const old = HistoricalTerminalAuthorizationSchema.parse(JSON.parse(row.record_json));
      const run = runs.get(row.record_key);
      if (run === undefined || row.record_key !== old.runId || row.kind !== old.kind
        || row.expected_version !== old.expectedVersion || row.worker_id !== old.claim.workerId
        || row.claim_generation !== old.claim.claimGeneration || row.created_at !== old.authorizedAt) throw new RunCompletionMigrationError();
      const { outboxId: _outbox, ...request } = old.kind === "done" ? old : { ...old, outboxId: undefined };
      const completion = completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(request));
      const outbox = outboxes.get(old.runId);
      const current = RunRecordSchema.parse({ ...run, completion: { ...completion,
        historical: { schemaVersion: 40, authorizationJson: row.record_json,
          ...(outbox === undefined ? {} : { outboxJson: outbox.raw.record_json }) } } });
      // Later revisions must be accounted for by the existing lifecycle journal.
      for (let version = old.expectedVersion + 2; version <= run.version; version++) {
        const audits = database.prepare("SELECT record_json FROM command_audits WHERE json_extract(record_json, '$.kind') = 'run-lifecycle'").all();
        const matching = audits.map((audit) => RunLifecycleCommandAuditRecordSchema.parse(JSON.parse(z.object({ record_json: z.string() }).parse(audit).record_json)))
          .filter((audit) => audit.result.kind === "run" && audit.result.runId === old.runId && audit.result.appliedVersion === version
            && ["transition", "archive"].includes(audit.request.operation)
            && audit.request.fence.kind === "version" && audit.request.fence.expectedVersion === version - 1);
        if (matching.length !== 1) throw new RunCompletionMigrationError();
      }
      if (old.kind === "done") {
        const result = results.get(old.runId);
        if (result === undefined || result.resultDigest !== old.resultDigest || result.runId !== old.runId
          || result.workflowId !== run.envelope.workflow || result.attempt !== run.envelope.attempt
          || result.descriptorVersion !== run.envelope.descriptorVersion || result.contractFingerprint !== run.envelope.contractFingerprint
          || result.configSnapshotId !== run.envelope.configSnapshotId || result.configFingerprint !== run.envelope.configFingerprint
          || outbox === undefined || outbox.receipt.outboxId !== old.outboxId) throw new RunCompletionMigrationError();
        results.delete(old.runId); outboxes.delete(old.runId);
      } else {
        const failure = failures.get(old.failureId);
        if (failure === undefined || failure.runId !== old.runId || failure.workflowId !== run.envelope.workflow
          || failure.traceId !== run.envelope.traceId || failure.attempt !== run.envelope.attempt
          || failure.failureId !== old.failureId || current.lifecycle.state !== "terminal"
          || current.lifecycle.errorSummary !== failure.summary
          || current.lifecycle.diagnosticSafetyVersion !== failure.diagnosticSafetyVersion) throw new RunCompletionMigrationError();
        failures.delete(old.failureId);
      }
      converted.set(old.runId, canonicalJsonStringify(current));
    }
    if (results.size || failures.size || outboxes.size) throw new RunCompletionMigrationError();
    for (const [id, run] of runs) {
      if (run.lifecycle.state === "terminal" && ["done", "failed"].includes(run.lifecycle.outcome) && !converted.has(id)) throw new RunCompletionMigrationError();
    }
    // Validation finishes before the first mutation. The caller owns the exclusive transaction.
    const update = database.prepare("UPDATE workflow_runs SET record_json = ? WHERE record_key = ?");
    for (const [id, json] of converted) update.run(json, id);
  } catch (error) {
    if (error instanceof RunCompletionMigrationError) throw error;
    throw new RunCompletionMigrationError();
  }
}
