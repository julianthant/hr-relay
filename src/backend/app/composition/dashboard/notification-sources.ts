import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { RunRecord } from "../../../../models/run/record.js";
import { FailureRecordSchema, type FailureRecord } from "../../../../models/trust/failure.js";
import { RunEvidenceReceiptSchema } from "../../../../models/trust/evidence.js";
import type { NotificationObservation, NotificationSourceRead } from "../../../runs/notifications/observation.js";
import { notificationSourceId } from "../../../runs/notifications/inbox.js";
import { z } from "zod";
import { NotificationTriggerEventSchema } from "../../../../rules/notifications/notification-triggers.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { listCanonicalRuns } from "../../../runs/queries/canonical-runs.js";
import { createTrustRunReader } from "../../../runs/trust/canonical-reader.js";
import { defineLaneRead, type DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { FingerprintSchema, IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";

function observation(event: z.input<typeof NotificationTriggerEventSchema>, identity: string, occurredAt: string): NotificationObservation {
  return { event: NotificationTriggerEventSchema.parse(event), source: { identity: sha256Hex(`notification-occurrence:${event.kind}:${identity}`), occurredAt } };
}
export const NOTIFICATION_SOURCE_TABLES = Object.freeze(["runs", "deleted_runs", "run_failures", "run_receipts", "notifications"] as const);
const NotificationSourceReadSchema = z.strictObject({
  observations: z.array(z.strictObject({ event: NotificationTriggerEventSchema,
    source: z.strictObject({ identity: FingerprintSchema, occurredAt: IsoInstantSchema }) })),
  diagnostics: z.array(z.literal("NOTIFICATION_RECEIPT_MISSING")),
});

/** Private canonical evidence is narrowed here to closed events, never passed to the day wire. */
function scanNotificationSources(database: AuthorityDatabase, reader: Pick<RunRecordService, "list">, unpublishedOnly = false): NotificationSourceRead {
  const live = listCanonicalRuns({ list(request) {
    const page = reader.list(request);
    if (page.state === "refused") throw new Error("notification-scan-cursor-stale");
    return page;
  } }, "live");
  const runs = new Map<string, RunRecord>(live.map(run => [run.envelope.runId, run]));
  const failures = new Map<string, FailureRecord>();
  const result: NotificationObservation[] = [];
  const diagnostics: "NOTIFICATION_RECEIPT_MISSING"[] = [];
  const publications = database.authority.notificationPublications.list();
  // A failure already published as run-failed keeps that publication; a mismatch never adds a second alert for it.
  const publishedFailed = new Set(publications.flatMap(source => source.event.kind === "run-failed" ? [source.event.failureId] : []));
  const repeated = new Map(publications.flatMap(source => source.event.kind === "repeating-failure" ? [[source.event.failureId, source.event] as const] : []));
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
    const currentReceipt = database.authority.evidenceReceipts.findByRun(run.envelope.runId);
    const receipts = currentReceipt === undefined ? [] : [currentReceipt];
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
    // One alert per failure: a subject mismatch is the more specific notice of the same failure.
    const mismatch = !publishedFailed.has(failure.failureId) && (failure.code === "SUBJECT_MISMATCH" || (failure.subject?.expected !== undefined && failure.subject.observed !== undefined));
    result.push(observation(mismatch ? { kind: "subject-mismatch", ...shared } : { kind: "run-failed", ...shared, code: failure.code }, failure.failureId, failure.occurredAt));
    const fingerprint = sha256Hex(canonicalJsonStringify({ workflow: failure.workflowId, step: failure.nodeId ?? failure.taskId ?? null, code: failure.code }));
    const count = (groups.get(fingerprint) ?? 0) + 1; groups.set(fingerprint, count);
    if (count >= 3 || repeated.has(failure.failureId)) result.push(observation(repeated.get(failure.failureId) ?? { kind: "repeating-failure", ...shared, failureFingerprint: fingerprint, occurrences: count, threshold: 3 }, failure.failureId, failure.occurredAt));
  }
  if (!unpublishedOnly) return { observations: result, diagnostics };
  const published = new Map(publications.map(record => [record.sourceId, record]));
  const observations = result.filter(({ event, source }) => {
    const prior = published.get(notificationSourceId(LOCAL_OPERATOR_ACTOR_ID, source.identity));
    return prior === undefined || canonicalJsonStringify(prior.event) !== canonicalJsonStringify(event);
  });
  return { observations, diagnostics };
}

export const notificationSourceScan = defineLaneRead(import.meta.url, "notification-source-scan", {
  lane: "navigation", priority: "background", args: z.strictObject({}), tables: NOTIFICATION_SOURCE_TABLES,
  run({ native }) {
    // Publication and run membership belong to the native inbox, including on profile copies.
    return scanNotificationSources(native, createTrustRunReader(native), true);
  },
});

export function createLaneNotificationSourceReader(lanes: Pick<DashboardReadLanes, "read">): () => Promise<NotificationSourceRead> {
  let diagnostics: NotificationSourceRead["diagnostics"] | undefined;
  return async () => {
    const previous = diagnostics;
    // A failed reply may have populated the lane cache without delivering the result.
    diagnostics = undefined;
    const { body, cached } = await lanes.read(notificationSourceScan, {});
    if (cached && previous !== undefined) {
      diagnostics = previous;
      return { observations: [], diagnostics };
    }
    const read = NotificationSourceReadSchema.parse(JSON.parse(body));
    diagnostics = read.diagnostics;
    return read;
  };
}

const lastRead = new WeakMap<AuthorityDatabase, ReturnType<AuthorityDatabase["capturedChangeKey"]> & {
  diagnostics: NotificationSourceRead["diagnostics"];
}>();

/** Compositions without a read host, such as seeded services, read the same sources on their own snapshot. */
export function readNotificationSources(database: AuthorityDatabase, reader: Pick<RunRecordService, "list">): NotificationSourceRead {
  const prior = lastRead.get(database);
  const { position, read } = database.withAuthorityReadSnapshot(() => {
    const position = database.capturedChangeKey();
    if (prior?.schemaCookie === position.schemaCookie && database.readChangeInterval(prior.changeLogSeq, NOTIFICATION_SOURCE_TABLES).clear) {
      return { position, read: { observations: [], diagnostics: prior.diagnostics } };
    }
    return { position, read: scanNotificationSources(database, reader) };
  });
  lastRead.set(database, { ...position, diagnostics: read.diagnostics });
  return read;
}
