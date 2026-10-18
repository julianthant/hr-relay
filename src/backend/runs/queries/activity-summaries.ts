import { z } from "zod";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { RunSummaryQuerySchema } from "../../storage/sqlite/run-summaries.js";
import { runtimeTimeZone } from "../../../rules/time/clock.js";
import { deriveRunStatus } from "../lifecycle/run-status.js";
type SummaryRow = ReturnType<AuthorityDatabase["queryRunSummaries"]>["items"][number];
/** Selected live summary rows, streamed in bounded indexed pages inside one database snapshot. */
function visitRange(database:AuthorityDatabase,from:string,to:string,visit:(row:SummaryRow)=>void) {
  for(const workflow of database.summaryWorkflows()) {
    let after: z.output<typeof RunSummaryQuerySchema>["after"];
    do {
      const page=database.queryRunSummaries({workflow,fromDay:from,toDay:to,limit:500,...(after===undefined?{}:{after})});
      page.items.forEach(visit);
      after=page.next??undefined;
    }while(after!==undefined);
  }
}

import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { ActivityReportWireSchema, ACTIVITY_SAMPLE_LIMIT, type ActivityReportWire, type ActivityWorkflowTotal } from "../../../models/dashboard/activity.js";
import { buildActivityVolumeBoundarySkeleton, createActivityDatePartReader } from "../../../models/dashboard/activity-volume.js";
import { TERMINAL_QUEUE_STATUSES } from "../../../models/dashboard/projection.js";

type ActivityWorkflowCounts = Omit<ActivityWorkflowTotal,"workflowId"|"registration">;
function emptyActivityWorkflowCounts():ActivityWorkflowCounts {
  return {runs:0,completion:{readBack:0,warnings:0,warningsUnknown:0},failed:0,cancelled:0,partial:0,open:0};
}
const ACTIVITY_STATUS_BUCKET = {partial:"partial",done:"completion",failed:"failed",cancelled:"cancelled",blocked:"open",queued:"open",running:"open",cancelling:"open","awaiting-approval":"open"} as const;

/** A zone change can shift a local date by at most two days; inspect that bounded edge so it cannot hide a run as zero. */
function shiftActivityDay(value:string,days:number):string {
  const date=new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate()+days);
  if(date.getUTCFullYear()<0)return "0000-01-01";
  if(date.getUTCFullYear()>9999)return "9999-12-31";
  return date.toISOString().slice(0,10);
}

export function visitActivitySummaryRange(database: AuthorityDatabase, from: string, to: string, timeZone: string, visit: (row: SummaryRow) => void) {
  const reportDayOf = createActivityDatePartReader(timeZone);
  visitRange(database, shiftActivityDay(from, -2), shiftActivityDay(to, 2), row => {
    const enqueuedDay = reportDayOf(row.enqueuedAt);
    const storedDayIsInRange = row.localDay >= from && row.localDay <= to;
    if (row.localDay !== enqueuedDay) {
      if (storedDayIsInRange || (enqueuedDay >= from && enqueuedDay <= to)) throw new Error("activity-summary-local-day-time-zone-mismatch");
      return;
    }
    if (storedDayIsInRange) visit(row);
  });
}

function bucketForInstant(buckets:readonly {start:string;endExclusive:string}[],instant:number):number {
  let low=0,high=buckets.length;
  while(low<high) {
    const middle=Math.floor((low+high)/2);
    if(Date.parse(buckets[middle].start)<=instant)low=middle+1;
    else high=middle;
  }
  const index=low-1,bucket=buckets[index];
  if(bucket===undefined||instant>=Date.parse(bucket.endExclusive))throw new Error("activity-volume-enqueue-outside-interval");
  return index;
}

/** Same run metrics as the retained projector; ledger and registry remain explicitly supplied authorities. */
export function queryActivitySummaries(database:AuthorityDatabase,input:{from:string;to:string;generatedAt:string},deps:{
  descriptors:{resolve(workflow:string):AnyWorkflowDescriptor|undefined};
  ledger:{foldActivityRange(from:string,to:string):ActivityReportWire["ledger"]};
  timeZone?:string;
}):ActivityReportWire {
  const bounds=z.strictObject({from:z.iso.date(),to:z.iso.date(),generatedAt:z.iso.datetime({offset:true})}).parse(input);
  if(bounds.from>bounds.to)throw new Error("run-summary-range-invalid");
  const timeZone=deps.timeZone??runtimeTimeZone();
  return database.withAuthorityReadSnapshot(()=>{
    const start=bounds.from,end=bounds.to;
    const volumeSkeleton=buildActivityVolumeBoundarySkeleton({from:start,to:end},timeZone);
    const volumeCounts=volumeSkeleton.buckets.map(()=>0);
    const volumeStart=Date.parse(volumeSkeleton.interval.start),volumeEnd=Date.parse(volumeSkeleton.interval.endExclusive);
    const inRange:SummaryRow[]=[];
    const identities=new Set<string>();let evidenceRows=0,unavailableRows=0;
    visitActivitySummaryRange(database,start,end,timeZone,row=>{
      if(row.workflow==="separations" && row.shape!=="operation") {
        if(row.person.state==="available"){identities.add(row.person.identity);evidenceRows++;}
        else unavailableRows++;
      }
      if(row.shape==="operation-member")return;
      const enqueuedAt=Date.parse(row.enqueuedAt);
      if(!Number.isFinite(enqueuedAt))throw new Error("activity-summary-enqueued-at-invalid");
      if(enqueuedAt<volumeStart||enqueuedAt>=volumeEnd)throw new Error("activity-volume-enqueue-outside-interval");
      volumeCounts[bucketForInstant(volumeSkeleton.buckets,enqueuedAt)]+=1;
      inRange.push(row);
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
      const surface={workflowId:row.workflow,status:deriveRunStatus(row),runId:row.runId};
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
          : warningVerdict.kind === "none" && row.receiptResult === "verified-done"
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
    const volume = {
      state:"complete" as const,
      timeZone:volumeSkeleton.timeZone,
      granularity:volumeSkeleton.granularity,
      interval:volumeSkeleton.interval,
      coveredRuns:inRange.length,
      buckets:volumeSkeleton.buckets.map((bucket,index)=>({...bucket,runs:volumeCounts[index]})),
    };
    if(volumeCounts.reduce((total,count)=>total+count,0)!==inRange.length)throw new Error("activity-volume-count-mismatch");

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
      volume,
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
