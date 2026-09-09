import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunRecordSchema } from "../../domain/run/record.js";
import { RunSummarySchema, SummaryPublicationSchema, RunSummarySourceSchema } from "../../domain/run/summary.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { deriveRunSummary } from "../../core/run-summary.js";

export const RUN_SUMMARIES_DDL = `CREATE TABLE run_summaries (
 record_key TEXT PRIMARY KEY, workflow TEXT NOT NULL, local_day TEXT NOT NULL, state TEXT NOT NULL,
 parent_run_id TEXT, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const SUMMARY_PUBLICATION_DDL = `CREATE TABLE summary_publication (
 record_key TEXT PRIMARY KEY CHECK(record_key='current'), record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
const JsonRowSchema = z.strictObject({ record_json: z.string() });
export function createRunSummaries(database: DatabaseSync) {
  const publication = () => {
    const row = database.prepare("SELECT record_json FROM summary_publication WHERE record_key='current'").get();
    return row === undefined ? SummaryPublicationSchema.parse({ state:"absent",generation:0,sourceGeneration:0,rowCount:0 })
      : SummaryPublicationSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json));
  };
  return {
    publication,
    /** Caller holds the live authority write transaction, including the final generation update. */
    refresh(sourceGeneration: number, now: string) {
      const prior = publication();
      const runs = database.prepare(`SELECT record_json FROM workflow_runs WHERE record_key NOT IN (SELECT record_key FROM archived_runs)`).all()
        .map((row) => RunRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)));
      database.exec("DELETE FROM run_summaries");
      for (const run of runs) {
        const read = (sql: string) => {
          const rows = database.prepare(sql).all(run.envelope.runId);
          if (rows.length > 1) throw new Error("summary-source-ambiguous");
          const row = rows[0];
          return row === undefined ? null : JSON.parse(JsonRowSchema.parse(row).record_json) as unknown;
        };
        const events=database.prepare("SELECT record_json FROM timeline_events WHERE run_id=? ORDER BY cursor").all(run.envelope.runId)
          .map(row=>JSON.parse(JsonRowSchema.parse(row).record_json) as unknown);
        const spanEvents=events.flatMap(event=>{
          const parsed=z.object({payload:z.object({kind:z.string(),event:z.object({t:z.string(),ts:z.string(),title:z.string().optional()}).optional()})}).safeParse(event);
          return parsed.success && parsed.data.payload.kind === "span" && parsed.data.payload.event !== undefined ? [parsed.data.payload.event] : [];
        });
        const cursor=z.object({cursor:z.number().int().nonnegative()}).parse(database.prepare("SELECT COALESCE(MAX(cursor),0) AS cursor FROM timeline_events").get()).cursor;
        const dependencies=database.prepare("SELECT json_extract(record_json,'$.childRunId') AS runId FROM delegation_dependencies WHERE json_extract(record_json,'$.parentRunId')=? ORDER BY record_key").all(run.envelope.runId).map(row=>z.object({runId:z.string()}).parse(row).runId);
        const source = RunSummarySourceSchema.parse({ run,
          cursor,startedAt:spanEvents.find(event=>event.t==="run.claimed")?.ts ?? ("claimedAt" in run.lifecycle ? run.lifecycle.claimedAt : null),
          queueTitle:spanEvents.find(event=>event.t==="run.queued")?.title ?? null,
          children:runs.filter(child=>child.envelope.parent?.runId===run.envelope.runId).map(child=>({runId:child.envelope.runId,state:child.lifecycle.state,outcome:child.lifecycle.state==="terminal"?child.lifecycle.outcome:null})),
          dependencyRunIds:dependencies,
          result: read("SELECT record_json FROM run_results WHERE record_key=?"),
          receipt: read("SELECT record_json FROM run_receipts WHERE run_id=?"),
          failure: read("SELECT record_json FROM run_failures WHERE run_id=?"),
          resolution: read("SELECT resolution_json AS record_json FROM run_failures WHERE run_id=?"),
        });
        const summary = deriveRunSummary(source, sourceGeneration);
        database.prepare("INSERT INTO run_summaries VALUES (?,?,?,?,?,?,?)").run(summary.runId,summary.workflow,summary.localDay,summary.lifecycle.state,summary.parentRunId,canonicalJsonStringify(summary),now);
      }
      const next = SummaryPublicationSchema.parse({ state:"published",generation:prior.generation+1,sourceGeneration,rowCount:runs.length });
      database.prepare("INSERT INTO summary_publication VALUES ('current',?,?) ON CONFLICT(record_key) DO UPDATE SET record_json=excluded.record_json,created_at=excluded.created_at").run(canonicalJsonStringify(next),now);
      return next;
    },
    read(sourceGeneration: number) {
      const current = publication();
      if (current.state !== "published" || current.sourceGeneration !== sourceGeneration) throw new Error("run-summary-generation-unavailable");
      const rows = database.prepare("SELECT record_json FROM run_summaries ORDER BY local_day,record_key").all()
        .map((row) => RunSummarySchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)));
      if (rows.length !== current.rowCount || rows.some((row) => row.sourceGeneration !== sourceGeneration)) throw new Error("run-summary-generation-corrupt");
      return rows;
    },
  };
}
