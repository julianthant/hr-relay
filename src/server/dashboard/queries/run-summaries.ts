import { z } from "zod";
import type { RunQueueStatus } from "../run-status.js";
import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import { RunSummaryQuerySchema } from "../../../infra/sqlite/run-summaries.js";

/** Internal only: source identities must never be serialized by a route. */
export function readRunSummarySource(database: AuthorityDatabase) {
  return database.readRunSummaries();
}
export function queryRunSummarySource(database:AuthorityDatabase,query:Parameters<AuthorityDatabase["queryRunSummaries"]>[0]) {
  return database.queryRunSummaries(query);
}

export const QueueSummaryQuerySchema = z.strictObject({...RunSummaryQuerySchema.shape,workflow:z.string().min(1).optional()}).refine(query=>query.fromDay===undefined||query.toDay===undefined||query.fromDay<=query.toDay,{message:"run-summary-range-invalid"});
type SummaryRow = ReturnType<AuthorityDatabase["queryRunSummaries"]>["items"][number];

function statusOf(row:SummaryRow):RunQueueStatus {
  if(row.lifecycle.state === "terminal") {
    switch(row.lifecycle.outcome) {
      case "done":return "done";
      case "failed":return "failed";
      case "interrupted":return "blocked";
      case "cancelled":case "discarded":case "superseded":return "cancelled";
    }
  }
  if(row.lifecycle.state === "parked-write")return "blocked";
  if(row.lifecycle.state === "parked-gate")return "awaiting-approval";
  if(row.lifecycle.state === "queued")return "queued";
  return row.cancelRequested ? "cancelling" : "running";
}

/** Public-safe bounded Queue facts. V owns route composition and action authorization. */
export function queryQueueSummaries(database:AuthorityDatabase,input:z.infer<typeof QueueSummaryQuerySchema>) {
  const query=QueueSummaryQuerySchema.parse(input);
  return database.withAuthorityReadSnapshot(()=>{
    const workflows=query.workflow === undefined ? database.summaryWorkflows() : [query.workflow];
    const pages=workflows.map(workflow=>database.queryRunSummaries({...query,workflow,topLevel:query.topLevel??true}));
    const candidates=pages.flatMap(page=>page.items).sort((a,b)=>a.localDay.localeCompare(b.localDay)||a.runId.localeCompare(b.runId));
    const selected=candidates.slice(0,query.limit),last=selected.at(-1);
    const items=selected.map(row=>{
      const batch=row.sessionId===null?null:database.authority.runSessions.get(row.sessionId);
      if(row.sessionId!==null && (batch===undefined || batch?.workflow!==row.workflow))throw new Error("run-summary-batch-unavailable");
      return {runId:row.runId,workflow:row.workflow,title:row.title,localDay:row.localDay,status:statusOf(row),
        shape:row.shape,parentRunId:row.parentRunId,attempt:row.attempt,priority:row.priority,
        startedAt:row.startedAt,endedAt:row.endedAt,durationMs:row.durationMs,warningCount:row.warningCount,
        session:batch===null||batch===undefined?null:{sessionId:batch.sessionId,groupInQueue:batch.groupInQueue,version:batch.version,startedAt:batch.startedAt},
        children:row.children,dependencyRunIds:row.dependencyRunIds};
    });
    return {items,next:last!==undefined && (candidates.length>query.limit||pages.some(page=>page.next!==null))?{localDay:last.localDay,runId:last.runId}:null};
  });
}

/** Selected live summary rows, streamed in bounded indexed pages inside one database snapshot. */
function visitRange(database:AuthorityDatabase,from:string,to:string,visit:(row:SummaryRow)=>void) {
  for(const workflow of database.summaryWorkflows()) {
    let after: {localDay:string;runId:string}|undefined;
    do {
      const page=database.queryRunSummaries({workflow,fromDay:from,toDay:to,limit:500,...(after===undefined?{}:{after})});
      page.items.forEach(visit);
      after=page.next??undefined;
    }while(after!==undefined);
  }
}

import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { ActivityReportWireSchema, ACTIVITY_SAMPLE_LIMIT, type ActivityReportWire, type ActivityWorkflowTotal } from "../../../domain/dashboard/activity.js";
import { TERMINAL_QUEUE_STATUSES } from "../../../domain/dashboard/projection.js";

type ActivityWorkflowCounts = Omit<ActivityWorkflowTotal,"workflowId"|"registration">;
function emptyActivityWorkflowCounts():ActivityWorkflowCounts {
  return {runs:0,completion:{readBack:0,warnings:0,warningsUnknown:0},failed:0,cancelled:0,partial:0,open:0};
}
const ACTIVITY_STATUS_BUCKET = {partial:"partial",done:"completion",failed:"failed",cancelled:"cancelled",blocked:"open",queued:"open",running:"open",cancelling:"open","awaiting-approval":"open"} as const;

/** Same run metrics as the retained projector; ledger and registry remain explicitly supplied authorities. */
export function queryActivitySummaries(database:AuthorityDatabase,input:{from:string;to:string;generatedAt:string},deps:{
  descriptors:{resolve(workflow:string):AnyWorkflowDescriptor|undefined};
  ledger:{foldActivityRange(from:string,to:string):ActivityReportWire["ledger"]};
}):ActivityReportWire {
  const bounds=z.strictObject({from:z.iso.date(),to:z.iso.date(),generatedAt:z.iso.datetime({offset:true})}).parse(input);
  if(bounds.from>bounds.to)throw new Error("run-summary-range-invalid");
  return database.withAuthorityReadSnapshot(()=>{
    const start=bounds.from,end=bounds.to;
    const inRange:SummaryRow[]=[];
    const identities=new Set<string>();let evidenceRows=0,unavailableRows=0;
    visitRange(database,start,end,row=>{
      if(row.workflow==="separations" && row.shape!=="operation") {
        if(row.person.state==="available"){identities.add(row.person.identity);evidenceRows++;}
        else unavailableRows++;
      }
      if(row.shape!=="operation-member")inRange.push(row);
    });
    const people=unavailableRows===0?{state:"present",distinct:identities.size,evidenceRows}:{state:"absent",evidenceRows,unavailableRows,
      reason:`${String(unavailableRows)} of ${String(evidenceRows+unavailableRows)} current Separations run/member rows lack validated canonical identity; distinct people is unavailable`};
    const days = new Map<string, number>();
    const workflows = new Map<string, ActivityWorkflowCounts>();
    const statuses = new Map<string, { runs: number; sample: string[] }>();
    const outcomes = new Map<string, number>();
    const failures = new Map<string, { runs: number; transient: number; sample: string[] }>();
    const measured: { runId: string; ms: number }[] = [];

    const completion = { readBack: 0, warnings: 0, warningsUnknown: 0 };
    let unmeasured = 0;
    let terminalRuns = 0;

    for (const row of inRange) {
      const day=row.localDay,authority=row;
      const surface={workflowId:row.workflow,status:statusOf(row),runId:row.runId};
      const warningVerdict={kind:row.warningCount===null?"unread":row.warningCount===0?"none":"present"};
      days.set(day, (days.get(day) ?? 0) + 1);
      const counts = workflows.get(surface.workflowId) ?? emptyActivityWorkflowCounts();
      counts.runs += 1;
      workflows.set(surface.workflowId, counts);

      const statusBucket = statuses.get(surface.status) ?? { runs: 0, sample: [] };
      statusBucket.runs += 1;


      if (
        !TERMINAL_QUEUE_STATUSES.has(surface.status)
        && statusBucket.sample.length < ACTIVITY_SAMPLE_LIMIT
      ) {
        statusBucket.sample.push(surface.runId);
      }
      statuses.set(surface.status, statusBucket);

      const axis = ACTIVITY_STATUS_BUCKET[surface.status];
      if (axis !== "completion") {
        counts[axis] += 1;
      } else {



        const arm = warningVerdict.kind === "present"
          ? "warnings"
          : warningVerdict.kind === "none"
            ? "readBack"
            : "warningsUnknown";
        counts.completion[arm] += 1;
        completion[arm] += 1;
      }

      if (authority.lifecycle.state !== "terminal") continue;
      terminalRuns += 1;
      outcomes.set(authority.lifecycle.outcome, (outcomes.get(authority.lifecycle.outcome) ?? 0) + 1);



      if (row.durationMs !== null) {
        measured.push({
          runId: surface.runId,
          ms: row.durationMs,
        });
      } else {
        unmeasured += 1;
      }
      const { failureId } = authority.lifecycle;
      if (failureId === undefined) continue;
      if (row.failureCode === null || row.failureTransient === null) throw new Error("run-summary-failure-unavailable");
      const failure={code:row.failureCode,transient:row.failureTransient};
      const bucket = failures.get(failure.code) ?? { runs: 0, transient: 0, sample: [] };
      bucket.runs += 1;
      if (failure.transient) bucket.transient += 1;
      if (bucket.sample.length < ACTIVITY_SAMPLE_LIMIT) bucket.sample.push(surface.runId);
      failures.set(failure.code, bucket);
    }

    const categories = new Map<string, number>();
    let unregisteredCategoryRuns = 0;
    const workflowTotals = [...workflows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workflowId, counts]) => {
      const descriptor = deps.descriptors.resolve(workflowId);
      if (descriptor === undefined) {
        unregisteredCategoryRuns += counts.runs;
        return {
          ...counts,
          workflowId,
          registration: {
            state: "unregistered",
            reason: `workflow ${workflowId} is no longer registered; its label and category are unavailable`,
          },
        };
      }
      categories.set(descriptor.category, (categories.get(descriptor.category) ?? 0) + counts.runs);
      return {
        ...counts,
        workflowId,
        registration: {
          state: "registered",
          label: descriptor.label,
          code: descriptor.code,
          categoryId: descriptor.category,
        },
      };
    });

    const sorted = [...measured].sort((a, b) => a.ms - b.ms);
    const longest = sorted.at(-1);
    const median = sorted.length === 0 ? undefined : sorted[Math.floor((sorted.length - 1) / 2)];

    return ActivityReportWireSchema.parse({
      wireVersion: 1,
      from: start,
      to: end,
      generatedAt: bounds.generatedAt,
      totalRuns: inRange.length,
      terminalRuns,
      inFlightRuns: inRange.length - terminalRuns,
      people,
      completion,
      days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, runs]) => ({ day, runs })),
      workflows: workflowTotals,
      categories: [
        ...[...categories.entries()].sort(([a], [b]) => a.localeCompare(b))
          .map(([categoryId, runs]) => ({ category: { state: "registered", categoryId }, runs })),
        ...(unregisteredCategoryRuns === 0 ? [] : [{
          category: { state: "unregistered", reason: "the workflows behind these runs are no longer registered" },
          runs: unregisteredCategoryRuns,
        }]),
      ],
      statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([status, bucket]) => ({ status, runs: bucket.runs, sample: bucket.sample })),
      outcomes: [...outcomes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([outcome, runs]) => ({ outcome, runs })),
      failures: [...failures.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([code, bucket]) => ({ code, runs: bucket.runs, transient: bucket.transient, sample: bucket.sample })),
      durations: {
        measuredRuns: measured.length,
        unmeasuredRuns: unmeasured,
        medianMs: median === undefined
          ? { state: "absent", reason: "no terminal run in range carries both a start and an end instant" }
          : { state: "present", value: median.ms },
        longestMs: longest === undefined
          ? { state: "absent", reason: "no terminal run in range carries both a start and an end instant" }
          : { state: "present", value: longest.ms, runId: longest.runId },
        totalMs: measured.reduce((total, entry) => total + entry.ms, 0),
      },

      ledger: deps.ledger.foldActivityRange(start, end),
    });
  });
}
