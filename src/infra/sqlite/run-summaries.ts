import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunRecordSchema } from "../../domain/run/record.js";
import { RunSummarySchema, SummaryPublicationSchema, RunSummarySourceSchema, SummaryQuerySchema, type SummaryQuery } from "../../domain/run/summary.js";
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
  const write = (runs: z.infer<typeof RunRecordSchema>[], sourceGeneration:number, now:string) => {
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
        const cursor=z.object({cursor:z.number().int().nonnegative()}).parse(database.prepare("SELECT COALESCE(MAX(cursor),0) AS cursor FROM timeline_events WHERE run_id=?").get(run.envelope.runId)).cursor;
        const dependencies=database.prepare("SELECT json_extract(record_json,'$.childRunId') AS runId FROM delegation_dependencies WHERE json_extract(record_json,'$.parentRunId')=? ORDER BY record_key").all(run.envelope.runId).map(row=>z.object({runId:z.string()}).parse(row).runId);
        const source = RunSummarySourceSchema.parse({ run,
          cursor,startedAt:spanEvents.find(event=>event.t==="run.claimed")?.ts ?? ("claimedAt" in run.lifecycle ? run.lifecycle.claimedAt : null),
          queueTitle:spanEvents.find(event=>event.t==="run.queued")?.title ?? null,
          children:database.prepare("SELECT record_json FROM workflow_runs WHERE json_extract(record_json,'$.envelope.parent.runId')=? ORDER BY record_key").all(run.envelope.runId).map(row=>RunRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json))).map(child=>({runId:child.envelope.runId,state:child.lifecycle.state,outcome:child.lifecycle.state==="terminal"?child.lifecycle.outcome:null})),
          dependencyRunIds:dependencies,
          result: read("SELECT record_json FROM run_results WHERE record_key=?"),
          receipt: read("SELECT record_json FROM run_receipts WHERE run_id=?"),
          failure: read("SELECT record_json FROM run_failures WHERE run_id=?"),
          resolution: read("SELECT resolution_json AS record_json FROM run_failures WHERE run_id=?"),
        });
        const summary = deriveRunSummary(source, sourceGeneration);
        const existing=database.prepare("SELECT record_json FROM run_summaries WHERE record_key=?").get(summary.runId);
        if(existing!==undefined && RunSummarySchema.parse(JSON.parse(JsonRowSchema.parse(existing).record_json)).sourceDigest===summary.sourceDigest) continue;
        database.prepare("INSERT INTO run_summaries VALUES (?,?,?,?,?,?,?) ON CONFLICT(record_key) DO UPDATE SET workflow=excluded.workflow,local_day=excluded.local_day,state=excluded.state,parent_run_id=excluded.parent_run_id,record_json=excluded.record_json,created_at=excluded.created_at").run(summary.runId,summary.workflow,summary.localDay,summary.lifecycle.state,summary.parentRunId,canonicalJsonStringify(summary),now);
      }
  };
  const publish = (sourceGeneration:number, now:string) => {
    const prior=publication();
    const rowCount=z.object({count:z.number().int().nonnegative()}).parse(database.prepare("SELECT count(*) AS count FROM run_summaries").get()).count;
    const next=SummaryPublicationSchema.parse({state:"published",generation:prior.generation+1,sourceGeneration,rowCount});
    database.prepare("INSERT INTO summary_publication VALUES ('current',?,?) ON CONFLICT(record_key) DO UPDATE SET record_json=excluded.record_json,created_at=excluded.created_at").run(canonicalJsonStringify(next),now);
    return next;
  };
  const assertCurrent=(sourceGeneration:number)=>{
    const current=publication();
    if(current.state!=="published" || current.sourceGeneration!==sourceGeneration)throw new Error("run-summary-generation-unavailable");
    return current;
  };
  return {
    publication,
    /** TEMP triggers participate in the same savepoint/transaction as their source mutation. */
    installTracking() {
      database.exec("CREATE TEMP TABLE IF NOT EXISTS summary_dirty (run_id TEXT PRIMARY KEY) WITHOUT ROWID");
      const sources: Record<string,string[]> = {
        workflow_runs:["$.envelope.runId","$.envelope.parent.runId"], run_results:["$.runId"],
        run_receipts:["$.runId"],run_failures:["$.runId"],timeline_events:["$.runId"],
        delegation_dependencies:["$.parentRunId","$.childRunId"],run_delegations:["$.parentRunId"],
        archived_runs:["$.runId"],archive_transfers:["$.run.envelope.runId"],
      };
      for(const [table,paths] of Object.entries(sources)) for(const action of ["INSERT","UPDATE","DELETE"]) {
        const refs=action==="INSERT"?["NEW"]:action==="DELETE"?["OLD"]:["OLD","NEW"];
        const inserts=refs.flatMap(ref=>paths.map(path=>`INSERT OR IGNORE INTO summary_dirty SELECT json_extract(${ref}.record_json,'${path}') WHERE json_extract(${ref}.record_json,'${path}') IS NOT NULL;`)).join("\n");
        const when=action==="UPDATE" ? ` WHEN OLD.record_json IS NOT NEW.record_json${table==="run_failures" ? " OR OLD.resolution_json IS NOT NEW.resolution_json" : ""}` : "";
        database.exec(`CREATE TEMP TRIGGER IF NOT EXISTS summary_${table}_${action} AFTER ${action} ON main.${table}${when} BEGIN ${inserts} END`);
      }
    },
    /** Explicit rebuild; no half-publication escapes the caller's write transaction. */
    refresh(sourceGeneration:number,now:string) {
      const runs=database.prepare("SELECT record_json FROM workflow_runs WHERE record_key NOT IN (SELECT record_key FROM archived_runs)").all().map(row=>RunRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)));
      database.exec("DELETE FROM run_summaries");write(runs,sourceGeneration,now);return publish(sourceGeneration,now);
    },
    /** Shared transaction hook. Q can refine maintenance inside this owned adapter. */
    commit(sourceGeneration:number,now:string) {
      if(publication().state==="published") {
        const ids=database.prepare("SELECT run_id FROM summary_dirty UNION SELECT parent_run_id FROM run_summaries WHERE record_key IN (SELECT run_id FROM summary_dirty) AND parent_run_id IS NOT NULL UNION SELECT json_extract(record_json,'$.envelope.parent.runId') FROM workflow_runs WHERE record_key IN (SELECT run_id FROM summary_dirty) AND json_extract(record_json,'$.envelope.parent.runId') IS NOT NULL").all().map(row=>z.object({run_id:z.string()}).parse(row).run_id);
        for(const id of ids) {
          const row=database.prepare("SELECT record_json FROM workflow_runs WHERE record_key=? AND record_key NOT IN (SELECT record_key FROM archived_runs)").get(id);
          if(row===undefined)database.prepare("DELETE FROM run_summaries WHERE record_key=?").run(id);
          else write([RunRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json))],sourceGeneration,now);
        }
        publish(sourceGeneration,now);
      }
      database.exec("DELETE FROM summary_dirty");
    },
    workflows(sourceGeneration:number) {
      assertCurrent(sourceGeneration);
      return database.prepare("SELECT DISTINCT workflow FROM run_summaries ORDER BY workflow").all().map(row=>z.object({workflow:z.string()}).parse(row).workflow);
    },
    query(sourceGeneration:number,input:SummaryQuery) {
      const query=SummaryQuerySchema.parse(input);assertCurrent(sourceGeneration);
      const clauses=["workflow=?"],parameters:(string|number)[]=[query.workflow];
      if(query.fromDay!==undefined){clauses.push("local_day>=?");parameters.push(query.fromDay);}
      if(query.toDay!==undefined){clauses.push("local_day<=?");parameters.push(query.toDay);}
      if(query.state!==undefined){clauses.push("state=?");parameters.push(query.state);}
      if(query.parentRunId!==undefined){clauses.push("parent_run_id IS ?");parameters.push(query.parentRunId ?? "");if(query.parentRunId===null){clauses[clauses.length-1]="parent_run_id IS NULL";parameters.pop();}}
      if(query.after!==undefined){clauses.push("(local_day,record_key)>(?,?)");parameters.push(query.after.localDay,query.after.runId);}
      const rows=database.prepare(`SELECT record_json FROM run_summaries WHERE ${clauses.join(" AND ")} ORDER BY local_day,record_key LIMIT ?`).all(...parameters,query.limit+1)
        .map(row=>RunSummarySchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)));
      if(rows.some(row=>row.sourceGeneration>sourceGeneration))throw new Error("run-summary-generation-corrupt");
      const items=rows.slice(0,query.limit),last=items.at(-1);
      return {items,next:rows.length>query.limit && last!==undefined ? {localDay:last.localDay,runId:last.runId} : null};
    },
    read(sourceGeneration: number) {
      const current = publication();
      if (current.state !== "published" || current.sourceGeneration !== sourceGeneration) throw new Error("run-summary-generation-unavailable");
      const rows = database.prepare("SELECT record_json FROM run_summaries ORDER BY local_day,record_key").all()
        .map((row) => RunSummarySchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)));
      if (rows.length !== current.rowCount || rows.some((row) => row.sourceGeneration > sourceGeneration)) throw new Error("run-summary-generation-corrupt");
      return rows;
    },
  };
}
