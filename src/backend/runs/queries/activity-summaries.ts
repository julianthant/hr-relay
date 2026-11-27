import { queryAssistantUsage } from "../../assistant/usage-counts.js";
import { z } from "zod";
import { isQueueTopLevel } from "../../../models/dashboard/queue-parent.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { RunSummaryQuery } from "../../storage/sqlite/run-summaries.js";
import { PACIFIC_TIME_ZONE } from "../../../models/dashboard/search-calendar.js";
import { deriveRunStatus } from "../../../rules/runs/run-status.js";
import { runResultCurrent } from "../../storage/sqlite/delegation-refresh.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { ActivityReportWire } from "../../../models/dashboard/activity.js";
import type { RunSummary } from "../../../models/run/summary.js";
import { buildActivityReport, failureStepOfTaskSpans, taskSpansForRun, type ActivityReportRow } from "./activity-analytics.js";
import { createActivityDatePartReader } from "../../../models/dashboard/activity-volume.js";

type SummaryRow = ReturnType<AuthorityDatabase["queryRunSummaries"]>["items"][number];
/** Selected live summary rows, streamed in bounded indexed pages inside one database snapshot. */
function visitRange(database:AuthorityDatabase,from:string,to:string,topLevel:boolean,visit:(row:SummaryRow)=>void) {
  for(const workflow of database.summaryWorkflows()) {
    let after: RunSummaryQuery["after"];
    do {
      // Separations uses canonical person evidence from inline runs as well.
      const page=database.queryRunSummaries({workflow,fromDay:from,toDay:to,limit:500,
        topLevel:topLevel&&workflow!=="separations",...(after===undefined?{}:{after})});
      page.items.forEach(visit);
      after=page.next??undefined;
    }while(after!==undefined);
  }
}

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
  // In other zones, the date-mismatch check also needs to see inline runs.
  visitRange(database, shiftActivityDay(from, -2), shiftActivityDay(to, 2), timeZone === PACIFIC_TIME_ZONE, row => {
    const enqueuedDay = reportDayOf(row.enqueuedAt);
    const storedDayIsInRange = row.localDay >= from && row.localDay <= to;
    if (row.localDay !== enqueuedDay) {
      if (storedDayIsInRange || (enqueuedDay >= from && enqueuedDay <= to)) throw new Error("activity-summary-local-day-time-zone-mismatch");
      return;
    }
    if (storedDayIsInRange) visit(row);
  });
}

export function queryActivitySummaries(database: AuthorityDatabase, input: { from: string; to: string; generatedAt: string }, deps: {
  descriptors: { resolve(workflow: string): AnyWorkflowDescriptor | undefined };
  ledger: { foldActivityRange(from: string, to: string): ActivityReportWire["ledger"] };
}, visitTopLevel?: (row: SummaryRow) => void): ActivityReportWire {
  const bounds = z.strictObject({ from: z.iso.date(), to: z.iso.date(), generatedAt: z.iso.datetime({ offset: true }) }).parse(input);
  if (bounds.from > bounds.to) throw new Error("run-summary-range-invalid");

  return database.withAuthorityReadSnapshot(() => {
    const inRange: SummaryRow[] = [];
    const people: RunSummary["person"][] = [];
    visitActivitySummaryRange(database, bounds.from, bounds.to, PACIFIC_TIME_ZONE, row => {
      if (row.workflow === "separations" && row.shape !== "operation") people.push(row.person);
      if (!isQueueTopLevel(row)) return;
      inRange.push(row);
      visitTopLevel?.(row);
    });

    function* rows(): Generator<ActivityReportRow> {
      for (const row of inRange) {
        const status = deriveRunStatus(row);
        const durationMs = row.lifecycle.state === "terminal" ? row.durationMs : null;
        const failureStep = status === "failed"
          ? failureStepOfTaskSpans(taskSpansForRun(database, row.runId), deps.descriptors.resolve(row.workflow)?.timeline)
          : undefined;
        let terminal: ActivityReportRow["terminal"];
        if (runResultCurrent(row)) {
          terminal = { outcome: row.lifecycle.outcome };
          if (row.lifecycle.failureId !== undefined) {
            if (row.failureCode === null || row.failureTransient === null) throw new Error("run-summary-failure-unavailable");
            terminal.failure = { code: row.failureCode, transient: row.failureTransient };
          }
        }
        const completion = row.warningCount !== null && row.warningCount > 0 ? "warnings"
          : row.warningCount === 0 && row.receiptResult === "verified-done" ? "readBack" : "warningsUnknown";
        yield { day: row.localDay, enqueuedAt: row.enqueuedAt, workflowId: row.workflow, runId: row.runId,
          parentRunId: row.parent?.runId ?? null, status, lifecycleState: row.lifecycle.state, durationMs, completion,
          ...(terminal === undefined ? {} : { terminal }), ...(failureStep === undefined ? {} : { failureStep }) };
      }
    }

    return buildActivityReport({
      ...bounds, rows: rows(), people, descriptors: deps.descriptors,
      assistantUsage: () => queryAssistantUsage(database, bounds),
      ledger: () => deps.ledger.foldActivityRange(bounds.from, bounds.to),
    });
  });
}
