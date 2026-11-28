import { queryAssistantUsage } from "../../assistant/usage-counts.js";
import { z } from "zod";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { PACIFIC_TIME_ZONE } from "../../../models/dashboard/search-calendar.js";
import { deriveRunStatus } from "../../../rules/runs/run-status.js";
import { deriveCanonicalPerson } from "../../../rules/runs/summary-derivation.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { ActivityReportWire } from "../../../models/dashboard/activity.js";
import type { ActivityPopulationRun } from "../../../models/dashboard/activity-population.js";
import type { RunRecord } from "../../../models/run/record.js";
import { buildActivityReport, type ActivityReportRow } from "./activity-analytics.js";
import { createActivityDatePartReader } from "../../../models/dashboard/activity-volume.js";
import type { NodeId } from "../../../rules/identity/ids.js";

type ActivityRun = ReturnType<AuthorityDatabase["readActivityRuns"]>[number];
type ActivitySummaryRun = Omit<ActivityPopulationRun, "shape"> & Pick<RunRecord["envelope"], "shape">;

/** A zone change can shift a local date by at most two days; inspect that bounded edge so it cannot hide a run as zero. */
function shiftActivityDay(value:string,days:number):string {
  const date=new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate()+days);
  if(date.getUTCFullYear()<0)return "0000-01-01";
  if(date.getUTCFullYear()>9999)return "9999-12-31";
  return date.toISOString().slice(0,10);
}

export function visitActivitySummaryRange(database: AuthorityDatabase, from: string, to: string, timeZone: string, visit: (row: ActivityRun) => void) {
  const reportDayOf = createActivityDatePartReader(timeZone);
  for (const row of database.readActivityRuns(shiftActivityDay(from, -2), shiftActivityDay(to, 2))) {
    const { workflow, enqueuedAt } = row.run.envelope;
    // Separations uses canonical person evidence from inline runs as well.
    if (timeZone === PACIFIC_TIME_ZONE && workflow !== "separations" && !row.topLevel) continue;
    const enqueuedDay = reportDayOf(enqueuedAt);
    const storedDayIsInRange = row.localDay >= from && row.localDay <= to;
    if (row.localDay !== enqueuedDay) {
      if (storedDayIsInRange || (enqueuedDay >= from && enqueuedDay <= to)) throw new Error("activity-summary-local-day-time-zone-mismatch");
      continue;
    }
    if (storedDayIsInRange) visit(row);
  }
}

function failureStep(nodeId: NodeId | undefined, descriptor: AnyWorkflowDescriptor | undefined): ActivityReportRow["failureStep"] {
  if (nodeId === undefined) return { state: "unavailable", reason: "the failure record does not name a workflow node" };
  const categories = descriptor?.timeline.filter(category => category.nodes.some(node => node.id === nodeId)) ?? [];
  if (categories.length > 1) throw new Error("activity-failure-step-category-ambiguous");
  const category = categories[0];
  const title = category?.label || category?.nodes.find(node => node.id === nodeId)?.label;
  return title === undefined ? { state: "unavailable", reason: "the recorded workflow node has no registered step title" } : { state: "known", nodeId, title };
}

export function queryActivitySummaries(database: AuthorityDatabase, input: { from: string; to: string; generatedAt: string }, deps: {
  descriptors: { resolve(workflow: string): AnyWorkflowDescriptor | undefined };
  ledger: { foldActivityRange(from: string, to: string): ActivityReportWire["ledger"] };
}, visitTopLevel?: (row: ActivitySummaryRun) => void): ActivityReportWire {
  const bounds = z.strictObject({ from: z.iso.date(), to: z.iso.date(), generatedAt: z.iso.datetime({ offset: true }) }).parse(input);
  if (bounds.from > bounds.to) throw new Error("run-summary-range-invalid");

  return database.withAuthorityReadSnapshot(() => {
    const inRange: ActivityRun[] = [];
    const peopleRuns: RunRecord[] = [];
    visitActivitySummaryRange(database, bounds.from, bounds.to, PACIFIC_TIME_ZONE, row => {
      const { run } = row;
      if (run.envelope.workflow === "separations" && run.envelope.shape !== "operation") peopleRuns.push(run);
      if (row.topLevel) inRange.push(row);
    });
    const evidence = database.readActivityEvidence({
      terminal: inRange.flatMap(({ run }) => run.lifecycle.state === "terminal" ? [run.envelope.runId] : []),
      people: peopleRuns.flatMap(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done" ? [run.envelope.runId] : []),
      failures: inRange.flatMap(({ run }) => run.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined ? [run.lifecycle.failureId] : []),
      untitled: visitTopLevel === undefined ? [] : inRange.flatMap(({ run }) => run.displayName === undefined ? [run.envelope.runId] : []),
    });
    const people = peopleRuns.map(run => deriveCanonicalPerson(run, evidence.people.get(run.envelope.runId) ?? null));

    function* rows(): Generator<ActivityReportRow> {
      for (const { run, localDay, delegationWait } of inRange) {
        const { lifecycle } = run;
        const { workflow, runId, enqueuedAt, attempt, shape } = run.envelope;
        const status = deriveRunStatus({ ...run, delegationWait });
        const elapsed = lifecycle.state === "terminal" ? Date.parse(lifecycle.endedAt) - Date.parse(enqueuedAt) : -1;
        const durationMs = elapsed >= 0 ? elapsed : null;
        const parentRunId = run.envelope.parent?.runId ?? null;
        const receipt = evidence.receipts.get(runId);
        const warningCount = receipt?.warnings.length ?? null;
        let terminal: ActivityReportRow["terminal"];
        let step: ActivityReportRow["failureStep"];
        if (lifecycle.state === "terminal") {
          terminal = { outcome: lifecycle.outcome };
          if (lifecycle.failureId !== undefined) {
            const failure = evidence.failures.get(lifecycle.failureId);
            if (failure === undefined || failure.runId !== runId || failure.workflowId !== workflow || failure.attempt !== attempt) throw new Error("run-summary-failure-unavailable");
            terminal.failure = { code: failure.code, transient: failure.transient };
            if (status === "failed") step = failureStep(failure.nodeId, deps.descriptors.resolve(workflow));
          }
        }
        if (visitTopLevel !== undefined) {
          visitTopLevel({ runId, workflowId: workflow, title: run.displayName ?? evidence.titles.get(runId) ?? workflow, attempt, day: localDay, parentRunId, shape, status,
            terminal: terminal !== undefined, durationMs, receiptResult: receipt?.result ?? null, warningCount,
            readback: receipt === undefined ? null : receipt.result === "verified-done" });
        }
        const completion = warningCount !== null && warningCount > 0 ? "warnings"
          : warningCount === 0 && receipt?.result === "verified-done" ? "readBack" : "warningsUnknown";
        yield { day: localDay, enqueuedAt, workflowId: workflow, runId, parentRunId, status, lifecycleState: lifecycle.state, durationMs, completion,
          ...(terminal === undefined ? {} : { terminal }), ...(step === undefined ? {} : { failureStep: step }) };
      }
    }

    return buildActivityReport({
      ...bounds, rows: rows(), people, descriptors: deps.descriptors,
      assistantUsage: () => queryAssistantUsage(database, bounds),
      ledger: () => deps.ledger.foldActivityRange(bounds.from, bounds.to),
    });
  });
}
