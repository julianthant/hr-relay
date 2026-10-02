import { TransactionHistorySelectionSchema, type TransactionHistorySelection } from "../../../rules/write-safety/transaction-selection.js";
export { TransactionHistorySelectionSchema } from "../../../rules/write-safety/transaction-selection.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { NonNegativeIntSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { hasProtectedTransactionInput } from "../../../models/write-safety/protected-input.js";
import { ActivityLedgerBlockSchema } from "../../../models/dashboard/activity.js";
import { resolveLedgerLine, unresolvedLedgerLine, type LedgerLinePointer } from "../../../models/archive/ledger-resolution.js";
import { ArchivedTransactionsSchema } from "../../../models/archive/model.js";
import { reconstructConfirmedOperation } from "../../../models/events/confirmed-operation.js";
import type { TimelineRepository, HistoricalOperationSource } from "../../../models/events/timeline.js";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { WriteIntentRecordSchema, WriteAttemptRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import type { LifecycleSourceSnapshot } from "../../../models/archive/lifecycle-source.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { DeletedRunRecord } from "../../../models/run/deleted-run.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";

/** One consistent database query serves Activity, archive capture and explicit exports. */
type HistoryRepositories = Parameters<typeof reconstructConfirmedOperation>[0] & {
  timelineEvents: TimelineRepository;
  confirmedTransactionSources: { select(selection: TransactionHistorySelection): Readonly<{
    events: readonly z.infer<typeof TimelineEventRecordSchema>[];
    archived: readonly LifecycleSourceSnapshot[];
    historical: readonly HistoricalOperationSource[];
    eventIds: readonly string[];
  }> };
  runs: { get(runId: string): RunRecord | undefined };
  deletedRuns: { get(runId: string): DeletedRunRecord | undefined };
  writeIntents: { get(operationId: string): WriteIntentRecord | undefined };
};
export function createTransactionHistory(repositories: HistoryRepositories) {
  const query = (selection: z.input<typeof TransactionHistorySelectionSchema>) => {
    const range = TransactionHistorySelectionSchema.parse(selection);
    return repositories.timelineEvents.withReadSnapshot(() => {
      const selected = repositories.confirmedTransactionSources.select(range);
      const records = selected.events, sources = selected.historical;
      const selectedIds = new Set(selected.eventIds);
      const archived = selected.archived.flatMap(snapshot => {
        const read = <T>(table: string, schema: z.ZodType<T>) => {
          const groups = snapshot.records.filter(group => group.table === table);
          const group = groups[0];
          if (groups.length !== 1 || group === undefined) throw new Error("transaction-history-archive-group-missing-or-duplicate");
          if (new Set(group.rows.map(row => row.key)).size !== group.rows.length) throw new Error("transaction-history-archive-row-duplicate");
          return group.rows.filter(row => table !== "timeline_events" || selectedIds.has(row.key))
            .map(row => schema.parse(JSON.parse(row.json)));
        };
        const events = read("timeline_events", TimelineEventRecordSchema);
        const operations = read("run_operations", WriteIntentRecordSchema);
        const attempts = read("run_operation_attempts", WriteAttemptRecordSchema);
        const checkpoints = read("run_checkpoints", RunCheckpointRecordSchema);
        const evidence = {
          runs: { get: (id: string) => id === snapshot.run.envelope.runId ? snapshot.run : undefined },
          writeIntents: { get: (id: string) => operations.find(row => row.writeIntentId === id) },
          writeAttempts: { get: (id: string) => attempts.find(row => row.writeAttemptId === id) },
          runCheckpoints: { get: (workflow: string, item: string, node: string, attempt: number, claim?: number) =>
            checkpoints.find(row => row.workflowId === workflow && row.itemId === item && row.nodeId === node
              && row.attempt === attempt && row.claimGeneration === claim) },
        };
        return events.map(event => ({ event, evidence }));
      });
      const rows = [...records.map(event => ({ event, evidence: repositories })), ...archived].flatMap(({ event, evidence }) => {
        if (event.payload.kind !== "operation-confirmed" || !selectedIds.has(event.eventId)) throw new Error("transaction-history-selection-mismatch");
        const facts = event.payload.facts;
        const run = evidence.runs.get(facts.runId);
        if (run === undefined) throw new Error("transaction-history-owner-missing");
        if (repositories.deletedRuns.get(facts.runId) !== undefined) throw new Error("transaction-history-owner-deleted");
        const operation = evidence.writeIntents.get(facts.writeIntentId);
        if (operation === undefined || operation.status === "observed-present" || run.envelope.dryRun
          || run.envelope.workflow !== facts.workflowId || run.envelope.itemId !== facts.itemId
          || run.envelope.configFingerprint !== facts.configFingerprint
          || run.envelope.resolvedInstance[facts.system] !== facts.instance) throw new Error("transaction-history-owner-mismatch");
        const { ledger, span } = reconstructConfirmedOperation(evidence, event);
        const localDate = localDatePart(new Date(facts.confirmedAt));
        if (localDate < range.from || localDate > range.to || (range.system !== undefined && facts.system !== range.system)
          || (range.runId !== undefined && facts.runId !== range.runId)) throw new Error("transaction-history-selection-mismatch");
        const source = sources.find((item) => item.operationId === facts.writeIntentId && item.generation === facts.intentGeneration);
        if (source !== undefined && (source.ledgerOutbox.payload.kind !== "ledger-entry"
          || canonicalJsonStringify(source.ledgerOutbox.payload.entry) !== canonicalJsonStringify(ledger)
          || canonicalJsonStringify(source.spanOutbox.payload) !== canonicalJsonStringify(span))) {
          throw new Error("transaction-history-source-disagreement");
        }
        const pointer = source?.projection === undefined || source.projection === null
          ? { system: facts.system, date: facts.confirmedAt.slice(0, 10), sequence: NonNegativeIntSchema.parse(event.cursor) }
          : { system: source.projection.system, date: source.projection.date, sequence: source.projection.seq };
        return [{ eventId: event.eventId, operationId: facts.writeIntentId, generation: facts.intentGeneration,
          runId: facts.runId, localDate, ledger, checkpoint: event.payload.checkpoint,
          sourceDigest: source?.manifestDigest ?? null,
          presentation: resolveLedgerLine(pointer, ledger, hasProtectedTransactionInput(run)) }];
      }).sort((a, b) => a.ledger.confirmedAt.localeCompare(b.ledger.confirmedAt) || a.operationId.localeCompare(b.operationId) || a.generation - b.generation);
      if (rows.length !== selectedIds.size) throw new Error("transaction-history-selection-incomplete");
      const identities = rows.map((row) => `${row.operationId}:${String(row.generation)}`);
      if (new Set(identities).size !== identities.length) throw new Error("transaction-history-duplicate-operation");
      return { digest: sha256Hex(canonicalJsonStringify({ range, rows })), range, rows };
    });
  };
  return Object.freeze({
    query,
    foldActivityRange(from: string, to: string) {
      const totals = new Map<string, { system: string; entries: number; prod: number; test: number }>();
      for (const { ledger } of query({ from, to }).rows) {
        const row = totals.get(ledger.system) ?? { system: ledger.system, entries: 0, prod: 0, test: 0 };
        row.entries += 1; row[ledger.instance] += 1; totals.set(ledger.system, row);
      }
      return ActivityLedgerBlockSchema.parse({ systems: [...totals.values()].sort((a, b) => b.entries - a.entries || a.system.localeCompare(b.system)) });
    },
    capture(runId: string, contentDigest: string, capturedAt: string, pointers: readonly LedgerLinePointer[]) {
      const rows = query({ from: "0001-01-01", to: "9999-12-31", runId: RunIdSchema.parse(runId) }).rows;
      const lines = rows.map((row) => row.presentation);
      for (const pointer of pointers) {
        if (!lines.some((line) => canonicalJsonStringify(line.pointer) === canonicalJsonStringify(pointer))) {
          lines.push(unresolvedLedgerLine(pointer, "partition-missing", "No retained confirmed operation resolves this historical citation"));
        }
      }
      return ArchivedTransactionsSchema.parse({ version: 1, runId, contentDigest, capturedAt, lines,
        eventIds: rows.map((row) => row.eventId), sourceDigests: [...new Set(rows.flatMap((row) => row.sourceDigest === null ? [] : [row.sourceDigest]))].sort() });
    },
  });
}
export type TransactionHistory = ReturnType<typeof createTransactionHistory>;
