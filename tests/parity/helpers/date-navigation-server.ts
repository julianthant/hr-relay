import { DashboardStreamEnvelopeSchema } from "../../../src/domain/dashboard/subscription.js";
import type { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import type { Clock } from "../../../src/domain/clock.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { queryActivitySummaries, queryQueueSummaries } from "../../../src/server/dashboard/queries/run-summaries.js";
import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";

export const DATE_HISTORY = ["2024-12-31", "2025-01-02", "2026-06-15", "2026-07-01", "2026-07-30"] as const;
export const dateRunId = (index: number) => `00000000-0000-4000-8000-${String(700000 + index).padStart(12, "0")}`;

/** Production summary reads; the projector retains its canonical startup/reconciliation reader. */
export function dateNavigationReader(database: AuthorityDatabase, clock: Clock) {
  const reader = sqliteRunReader(database, clock);
  const ledger = createTransactionHistory(database.authority);
  return { ...reader, summaries: {
    withSnapshot: <T>(read: () => T): T => database.withAuthorityReadSnapshot(read),
    queue: (query: Parameters<typeof queryQueueSummaries>[1]) => queryQueueSummaries(database, query),
    activity: (from: string, to: string) => queryActivitySummaries(database, { from, to, generatedAt: clock.now().toISOString() },
      { descriptors: { resolve: () => undefined }, ledger }),
  } };
}

export function seedDateNavigation(database: AuthorityDatabase, sourceRunId: string): void {
  const source = database.authority.runs.get(sourceRunId);
  if (source === undefined) throw new Error("date-proof-seed-missing");
  const template = { ...source };
  delete template.runNumber;
  for (const [i, day] of DATE_HISTORY.entries()) {
    const at = `${day}T17:00:00.000Z`;
    database.authority.runs.enqueue(RunRecordSchema.parse({ ...template,
      envelope: { ...source.envelope, runId: dateRunId(i), itemId: dateRunId(i), shape: "single",
        traceId: `pl-100000-${String(i).padStart(4, "0")}`, enqueuedAt: at },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: at, updatedAt: at }));
  }
  database.refreshRunSummaries();
  database.readRunSummaries = () => { throw new Error("date-proof-whole-history-forbidden"); };
}

/** Correlate the browser's selected partition with a real HTTP day stream snapshot. */
export async function readDateSnapshot(baseUrl: string, day: string) {
  const response = await fetch(`${baseUrl}/events/v1?topics=dashboard-day:${day}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok || response.body === null) throw new Error("date-proof-stream-unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("date-proof-stream-ended-before-snapshot");
      buffered += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffered.indexOf("\n\n")) >= 0) {
        const block = buffered.slice(0, end); buffered = buffered.slice(end + 2);
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (!data) continue;
        const envelope = DashboardStreamEnvelopeSchema.parse(JSON.parse(data));
        if (envelope.type === "snapshot" && envelope.topic === "dashboard-day") return envelope.payload;
      }
    }
  } finally { await reader.cancel(); }
}
