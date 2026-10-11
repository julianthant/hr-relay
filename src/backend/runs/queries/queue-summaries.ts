import { z } from "zod";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { RunSummaryQuerySchema } from "../../storage/sqlite/run-summaries.js";
import { deriveRunStatus } from "../lifecycle/run-status.js";
export const QueueSummaryQuerySchema = z.strictObject({...RunSummaryQuerySchema.shape,workflow:z.string().min(1).optional()}).refine(query=>query.fromDay===undefined||query.toDay===undefined||query.fromDay<=query.toDay,{message:"run-summary-range-invalid"});
/** Public-safe bounded Queue facts. V owns route composition and action authorization. */
export function queryQueueSummaries(database:AuthorityDatabase,input:z.input<typeof QueueSummaryQuerySchema>) {
  const query=QueueSummaryQuerySchema.parse(input);
  return database.withAuthorityReadSnapshot(()=>{
    const workflows=query.workflow === undefined ? database.summaryWorkflows() : [query.workflow];
    const pages=workflows.map(workflow=>database.queryRunSummaries({...query,workflow,topLevel:query.topLevel??true}));
    const candidates=pages.flatMap(page=>page.items).sort((a,b)=>a.localDay.localeCompare(b.localDay)||a.runId.localeCompare(b.runId));
    const selected=candidates.slice(0,query.limit),last=selected.at(-1);
    const items=selected.map(row=>{
      const batch=row.sessionId===null?null:database.authority.runSessions.get(row.sessionId);
      if(row.sessionId!==null && (batch===undefined || batch?.workflow!==row.workflow))throw new Error("run-summary-batch-unavailable");
      return {runId:row.runId,workflow:row.workflow,title:row.title,localDay:row.localDay,status:deriveRunStatus(row),
        shape:row.shape,parentRunId:row.parentRunId,attempt:row.attempt,priority:row.priority,
        startedAt:row.startedAt,endedAt:row.endedAt,durationMs:row.durationMs,warningCount:row.warningCount,
        session:batch===null||batch===undefined?null:{sessionId:batch.sessionId,groupInQueue:batch.groupInQueue,version:batch.version,startedAt:batch.startedAt},
        children:row.children,dependencyRunIds:row.dependencyRunIds};
    });
    return {items,next:last!==undefined && (candidates.length>query.limit||pages.some(page=>page.next!==null))?{localDay:last.localDay,runId:last.runId}:null};
  });
}
