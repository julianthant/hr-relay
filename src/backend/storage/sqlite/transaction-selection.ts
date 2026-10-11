import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { TransactionHistorySelectionSchema, TransactionSelectionRecordSchema } from "../../../rules/write-safety/transaction-selection.js";
import { TimelineAppendSchema, TimelineEventRecordSchema } from "../../../models/events/timeline.js";

/** Reject the entire selection before loading evidence if it exceeds the admitted bound. */
export function selectTransactions(database: DatabaseSync, input: unknown) {
  const selection = TransactionHistorySelectionSchema.parse(input);
  const where: string[] = [], params: string[] = [];
  if (selection.from !== "0001-01-01") {
    where.push("confirmed_at >= ?"); params.push(new Date(`${selection.from}T00:00:00`).toISOString());
  }
  if (selection.to !== "9999-12-31") {
    const end = new Date(`${selection.to}T00:00:00`); end.setDate(end.getDate() + 1);
    where.push("confirmed_at < ?"); params.push(end.toISOString());
  }
  if (selection.runId !== undefined) { where.push("run_id = ?"); params.push(selection.runId); }
  if (selection.system !== undefined) { where.push("system = ?"); params.push(selection.system); }
  const rows = database.prepare(`WITH sources AS (
      SELECT id,run_id,confirmed_at,system,payload_json FROM timeline_events WHERE retention_class='confirmed-operation'
      UNION ALL
      SELECT json_extract(publication_json,'$.timeline.eventId') AS id,run_id,
        json_extract(publication_json,'$.ledger.confirmedAt') AS confirmed_at,system,
        json_extract(publication_json,'$.timeline') AS payload_json FROM write_intents
      WHERE status='committed' AND NOT EXISTS (
        SELECT 1 FROM timeline_events WHERE id=json_extract(write_intents.publication_json,'$.timeline.eventId'))
    ) SELECT id,run_id,confirmed_at,system,payload_json FROM sources
    ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`} ORDER BY confirmed_at,id LIMIT 10001`).all(...params);
  if (rows.length > 10000) throw new Error("transaction-history-selection-too-broad");
  return rows.map(raw => {
    const row = z.strictObject({ id:z.string(),run_id:z.string(),confirmed_at:z.string(),system:z.string(),payload_json:z.string() }).parse(raw);
    const event = z.union([TimelineEventRecordSchema,TimelineAppendSchema]).parse(JSON.parse(row.payload_json));
    if (event.payload.kind !== "operation-confirmed") throw new Error("transaction-selection-kind-mismatch");
    const facts = event.payload.facts;
    const record = TransactionSelectionRecordSchema.parse({ eventId:event.eventId,runId:facts.runId,confirmedAt:facts.confirmedAt,
      system:facts.system,operationId:facts.writeIntentId,generation:facts.intentGeneration });
    if (record.eventId !== row.id || record.runId !== row.run_id || record.confirmedAt !== row.confirmed_at || record.system !== row.system) throw new Error("transaction-selection-column-mismatch");
    return record;
  });
}

