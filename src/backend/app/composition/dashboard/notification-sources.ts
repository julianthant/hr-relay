import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { RunRecord } from "../../../../models/run/record.js";
import { FailureRecordSchema, type FailureRecord } from "../../../../models/trust/failure.js";
import { RunEvidenceReceiptSchema } from "../../../../models/trust/evidence.js";
import type { NotificationObservation, NotificationSourceRead } from "../../../runs/notifications/observation.js";
import { z } from "zod";
import { NotificationTriggerEventSchema } from "../../../../rules/notifications/notification-triggers.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { listCanonicalRuns } from "../../../runs/queries/canonical-runs.js";

function observation(event: z.input<typeof NotificationTriggerEventSchema>, identity: string, occurredAt: string): NotificationObservation {
  return { event: NotificationTriggerEventSchema.parse(event), source: { identity: sha256Hex(`notification-occurrence:${event.kind}:${identity}`), occurredAt } };
}
/** Private canonical evidence is narrowed here to closed events, never passed to the day wire. */
export function readNotificationSources(database: AuthorityDatabase, reader: Pick<RunRecordService, "read" | "list">): NotificationSourceRead {
  return database.withAuthorityReadSnapshot(() => {
    const live = listCanonicalRuns(reader, "live");
    const runs = new Map<string, RunRecord>(live.map(run => [run.envelope.runId, run]));
    const failures = new Map<string, FailureRecord>();
    const result: NotificationObservation[] = [];
    const diagnostics: "NOTIFICATION_RECEIPT_MISSING"[] = [];
    const repeated = new Map(database.authority.notificationPublications.list().flatMap(source => source.event.kind === "repeating-failure" ? [[source.event.failureId, source.event] as const] : []));
    const consumeFailure = (input: unknown, run: RunRecord) => {
      const failure = FailureRecordSchema.parse(input);
      if (failure.runId !== run.envelope.runId || failure.workflowId !== run.envelope.workflow || failure.attempt !== run.envelope.attempt || failure.traceId !== run.envelope.traceId) throw new Error("NOTIFICATION_FAILURE_IDENTITY_MISMATCH");
      const prior = failures.get(failure.failureId);
      if (prior !== undefined && canonicalJsonStringify(prior) !== canonicalJsonStringify(failure)) throw new Error("NOTIFICATION_FAILURE_SOURCE_CONFLICT");
      failures.set(failure.failureId, failure);
    };
    const consumeReceipt = (input: unknown, run: RunRecord) => {
      const receipt = RunEvidenceReceiptSchema.parse(input);
      if (receipt.runId !== run.envelope.runId || receipt.workflowId !== run.envelope.workflow || receipt.attempt !== run.envelope.attempt || receipt.traceId !== run.envelope.traceId || receipt.descriptorFingerprint !== run.envelope.contractFingerprint || receipt.configFingerprint !== run.envelope.configFingerprint) throw new Error("NOTIFICATION_RECEIPT_IDENTITY_MISMATCH");
      if (run.envelope.dryRun || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done" || receipt.result !== "verified-done" || receipt.confidence !== "verified") return;
      result.push(observation({ kind: "verified-done", runId: run.envelope.runId, workflowId: run.envelope.workflow }, receipt.receiptId, receipt.generatedAt));
    };
    for (const run of live) {
      for (const failure of database.authority.failures.listByRun(run.envelope.runId)) consumeFailure(failure, run);
      const receipts = database.authority.evidenceReceipts.listByRun(run.envelope.runId);
      for (const receipt of receipts) consumeReceipt(receipt, run);
      const state = run.lifecycle;
      if (!run.envelope.dryRun && state.state === "terminal" && state.outcome === "done" && receipts.length === 0) diagnostics.push("NOTIFICATION_RECEIPT_MISSING");
      if (state.state === "parked-gate") result.push(observation({ kind: "gate-opened", runId: run.envelope.runId, workflowId: run.envelope.workflow, gateId: state.gateId }, `${run.envelope.runId}:${state.gateId}:${state.parkedAt}`, state.parkedAt));
      if (state.state === "parked-write") result.push(observation({ kind: "write-parked", runId: run.envelope.runId, workflowId: run.envelope.workflow, writeIntentId: state.writeIntentId }, `${state.writeIntentId}:${String(state.intentGeneration)}:${state.parkedAt}`, state.parkedAt));
    }
    const groups = new Map<string, number>();
    for (const failure of [...failures.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.failureId.localeCompare(b.failureId))) {
      if (!runs.has(failure.runId)) throw new Error("NOTIFICATION_FAILURE_RUN_MISSING");
      const shared = { runId: failure.runId, workflowId: failure.workflowId, failureId: failure.failureId, failureFingerprint: failure.fingerprint };
      result.push(observation({ kind: "run-failed", ...shared, code: failure.code }, failure.failureId, failure.occurredAt));
      if (failure.code === "SUBJECT_MISMATCH" || (failure.subject?.expected !== undefined && failure.subject.observed !== undefined)) result.push(observation({ kind: "subject-mismatch", ...shared }, failure.failureId, failure.occurredAt));
      const fingerprint = sha256Hex(canonicalJsonStringify({ workflow: failure.workflowId, step: failure.nodeId ?? failure.taskId ?? null, code: failure.code }));
      const count = (groups.get(fingerprint) ?? 0) + 1; groups.set(fingerprint, count);
      if (count >= 3 || repeated.has(failure.failureId)) result.push(observation(repeated.get(failure.failureId) ?? { kind: "repeating-failure", ...shared, failureFingerprint: fingerprint, occurrences: count, threshold: 3 }, failure.failureId, failure.occurredAt));
    }
    return { observations: result, diagnostics };
  });
}
