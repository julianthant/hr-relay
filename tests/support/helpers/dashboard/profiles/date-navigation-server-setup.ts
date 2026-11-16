import { sqliteRunReader } from "../../canonical-run-reader.js";
import { queryActivitySummaries } from "../../../../../src/backend/runs/queries/run-summaries.js";
import { composeQueueSummaries } from "../../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { DashboardStreamEnvelopeSchema } from "../../../../../src/models/dashboard/subscription.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import type { AuthorityDatabase } from "../../synthetic-storage-admission.js";

export function createDateNavigationServerSetup() {
  const DATE_HISTORY = ["2024-12-31", "2025-01-02", "2026-06-15", "2026-07-01", "2026-07-30"] as const;

  const dateRunId = (index: number) => `00000000-0000-4000-8000-${String(700000 + index).padStart(12, "0")}`;

  function dateNavigationReader(database: AuthorityDatabase, clock: Clock) {
    const reader = sqliteRunReader(database, clock);
    const ledger = createTransactionHistory(database.authority);
    return { ...reader, summaries: {
      ...composeQueueSummaries(database),
      activity: (from: string, to: string) => queryActivitySummaries(database, { from, to, generatedAt: clock.now().toISOString() },
        { descriptors: { resolve: () => undefined }, ledger }),
    } };
  }

  function seedDateNavigation(database: AuthorityDatabase, sourceRunId: string): void {
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
    database.readRunSummaries = () => { throw new Error("date-proof-whole-history-forbidden"); };
  }

  async function readDateSnapshot(baseUrl: string, day: string) {
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

  return { DATE_HISTORY, dateRunId, dateNavigationReader, seedDateNavigation, readDateSnapshot };
}
