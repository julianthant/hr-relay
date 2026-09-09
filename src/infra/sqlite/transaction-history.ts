import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { localDatePart } from "../../domain/clock.js";
import { BrowserSystemIdSchema, NonNegativeIntSchema } from "../../domain/ids.js";
import { hasProtectedTransactionInput } from "../../domain/protected-input.js";
import { ActivityLedgerBlockSchema } from "../../domain/dashboard/activity.js";
import { resolveLedgerLine, unresolvedLedgerLine, type LedgerLinePointer } from "../../domain/archive/ledger-resolution.js";
import { ArchivedTransactionsSchema } from "../../domain/archive/model.js";
import { reconstructConfirmedOperation } from "../../events/confirmed-operation.js";
import { readTimelineRecords } from "../events/timeline-reader.js";
import type { TimelineRepository, HistoricalOperationSource } from "../../events/timeline.js";
import type { RunRecord } from "../../domain/run/record.js";
import type { DeletedRunRecord } from "../../domain/run/deleted-run.js";
import type { WriteIntentRecord } from "../../domain/write-safety.js";

export const TransactionHistorySelectionSchema = z.strictObject({
  from: z.iso.date(), to: z.iso.date(), system: BrowserSystemIdSchema.optional(),
}).superRefine((range, context) => {
  if (range.from > range.to) context.addIssue({ code: "custom", message: "transaction range ends before it starts" });
});

/** One consistent database query serves Activity, archive capture and explicit exports. */
type HistoryRepositories = Parameters<typeof reconstructConfirmedOperation>[0] & {
  timelineEvents: TimelineRepository;
  historicalOperationSources: { list(): readonly HistoricalOperationSource[] };
  runs: { get(runId: string): RunRecord | undefined };
  deletedRuns: { get(runId: string): DeletedRunRecord | undefined };
  writeIntents: { get(operationId: string): WriteIntentRecord | undefined };
};
export function createTransactionHistory(repositories: HistoryRepositories) {
  const query = (selection: z.input<typeof TransactionHistorySelectionSchema>) => {
    const range = TransactionHistorySelectionSchema.parse(selection);
    return repositories.timelineEvents.withReadSnapshot(() => {
      const { records } = readTimelineRecords(repositories.timelineEvents);
      const sources = repositories.historicalOperationSources.list();
      const rows = records.flatMap((event) => {
        if (event.payload.kind !== "operation-confirmed") return [];
        const facts = event.payload.facts;
        const run = repositories.runs.get(facts.runId);
        if (run === undefined) throw new Error("transaction-history-owner-missing");
        if (repositories.deletedRuns.get(facts.runId) !== undefined) throw new Error("transaction-history-owner-deleted");
        const operation = repositories.writeIntents.get(facts.writeIntentId);
        if (operation === undefined || operation.status === "observed-present" || run.envelope.dryRun
          || run.envelope.workflow !== facts.workflowId || run.envelope.itemId !== facts.itemId
          || run.envelope.configFingerprint !== facts.configFingerprint
          || run.envelope.resolvedInstance[facts.system] !== facts.instance) throw new Error("transaction-history-owner-mismatch");
        const { ledger, span } = reconstructConfirmedOperation(repositories, event);
        const localDate = localDatePart(new Date(facts.confirmedAt));
        if (localDate < range.from || localDate > range.to || (range.system !== undefined && facts.system !== range.system)) return [];
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
      const rows = query({ from: "0001-01-01", to: "9999-12-31" }).rows.filter((row) => row.runId === runId);
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
