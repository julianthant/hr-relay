import { TransactionHistorySelectionSchema, type TransactionHistorySelection } from "../../../rules/write-safety/transaction-selection.js";
export { TransactionHistorySelectionSchema } from "../../../rules/write-safety/transaction-selection.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { NonNegativeIntSchema } from "../../../rules/identity/ids.js";
import { hasProtectedTransactionInput } from "../../../models/write-safety/protected-input.js";
import { ActivityLedgerBlockSchema } from "../../../models/dashboard/activity.js";
import { resolveLedgerLine } from "../../../models/run/transaction-resolution.js";
import { reconstructConfirmedOperation } from "../../../models/events/confirmed-operation.js";
import type { TimelineRepository } from "../../../models/events/timeline.js";
import { TimelineAppendSchema, TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { DeletedRunRecord } from "../../../models/run/deleted-run.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";

/** One consistent database query serves Activity and explicit exports. */
type HistoryRepositories = Parameters<typeof reconstructConfirmedOperation>[0] & {
  timelineEvents: TimelineRepository;
  confirmedTransactionSources: { select(selection: TransactionHistorySelection): Readonly<{
    events: readonly (z.infer<typeof TimelineEventRecordSchema> | z.infer<typeof TimelineAppendSchema>)[];
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
      const records = selected.events;
      const selectedIds = new Set(selected.eventIds);
      const rows = records.map(event => {
        const evidence = repositories;
        if (event.payload.kind !== "operation-confirmed" || !selectedIds.has(event.eventId)) throw new Error("transaction-history-selection-mismatch");
        const facts = event.payload.facts;
        const run = evidence.runs.get(facts.runId);
        const deleted = repositories.deletedRuns.get(facts.runId);
        if ((run === undefined) === (deleted === undefined)) throw new Error("transaction-history-owner-missing-or-ambiguous");
        const publication = evidence.writeIntents.getPublication(facts.writeIntentId);
        if (run === undefined && (publication === undefined
          || !evidence.writeIntents.authenticatedDeletion(facts.runId,publication))) throw new Error("transaction-history-deletion-unverified");
        const operation = evidence.writeIntents.get(facts.writeIntentId);
        if (operation === undefined || operation.status === "observed-present" || (run !== undefined && (run.envelope.dryRun
          || run.envelope.workflow !== facts.workflowId || run.envelope.itemId !== facts.itemId
          || run.envelope.configFingerprint !== facts.configFingerprint
          || run.envelope.resolvedInstance[facts.system] !== facts.instance))) throw new Error("transaction-history-owner-mismatch");
        const { ledger } = reconstructConfirmedOperation(evidence, event);
        const localDate = localDatePart(new Date(facts.confirmedAt));
        if (localDate < range.from || localDate > range.to || (range.system !== undefined && facts.system !== range.system)
          || (range.runId !== undefined && facts.runId !== range.runId)) throw new Error("transaction-history-selection-mismatch");
        const pointer = run === undefined
          ? { state: "unavailable" as const, reason: "delivery cursor removed by authenticated run deletion" as const }
          : { system:facts.system,date:facts.confirmedAt.slice(0,10),sequence:NonNegativeIntSchema.parse(TimelineEventRecordSchema.parse(event).cursor) };
        return { eventId: event.eventId, operationId: facts.writeIntentId, generation: facts.intentGeneration,
          runId: facts.runId, localDate, ledger, checkpoint: event.payload.checkpoint,
          sourceDigest: null,
          presentation: resolveLedgerLine(pointer, ledger, run === undefined ? "unavailable" : hasProtectedTransactionInput(run) ? "protected" : "public") };
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

  });
}
export type TransactionHistory = ReturnType<typeof createTransactionHistory>;
