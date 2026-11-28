import { runIndex } from "./isolated-history-store.js";
import { CURRENT_RUN_SETTLEMENT_SQL } from "./run-settlement-row.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { timelineEventFromRow } from "./timeline-repository.js";
import { failureResolutionFromRow } from "./failure-resolution.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CalendarStoreQuerySchema, CalendarWireSchema } from "../../../models/dashboard/calendar.js";
import { QueueStatusSchema } from "../../../models/dashboard/projection.js";
import { RunStateSchema, type RunRecord } from "../../../models/run/record.js";
import { RunEnvelopeSchema } from "../../../models/run/envelope.js";
import { RunIdSchema } from "../../../rules/identity/ids.js";
import { RunSummarySourceSchema, SummaryQuerySchema, type DelegationWaitState } from "../../../models/run/summary.js";
import { deriveRunStatus } from "../../../rules/runs/run-status.js";
import { isQueueTopLevel, type QueueParent } from "../../../models/dashboard/queue-parent.js";
import { DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { deriveRunSummary } from "../../../rules/runs/summary-derivation.js";
import { runRecordFromRow } from "./run-record-row.js";

export const RunSummaryQuerySchema = SummaryQuerySchema.extend({
  state: RunStateSchema.optional(), status: QueueStatusSchema.optional(),
  topLevel: z.boolean().optional(), sessionId: z.string().uuid().optional(),
}).refine(query => query.fromDay === undefined || query.toDay === undefined || query.fromDay <= query.toDay,
  { message: "run-summary-range-invalid" });
export type RunSummaryQuery = z.infer<typeof RunSummaryQuerySchema>;

/** Every workflow with a stored run, in order: one seek of the workflow index per workflow instead of a scan of every run. */
export function listRunWorkflows(database: DatabaseSync): string[] {
  return database.prepare(`WITH RECURSIVE workflows(workflow) AS (SELECT min(workflow) FROM runs
    UNION ALL SELECT (SELECT min(workflow) FROM runs WHERE workflow>workflows.workflow) FROM workflows WHERE workflow IS NOT NULL)
    SELECT workflow FROM workflows WHERE workflow IS NOT NULL`).all().map(row => z.object({ workflow: z.string() }).parse(row).workflow);
}

export function createRunSummaries(database: DatabaseSync, waitState: (run: RunRecord) => DelegationWaitState | null,
  parentage: (envelopes: readonly RunRecord["envelope"][]) => ReadonlyMap<string, QueueParent | null>) {
  const snapshot = (sourceGeneration: number, selected?: readonly RunRecord[], waits?: ReadonlyMap<string, DelegationWaitState | null>,
    parentFacts?: ReadonlyMap<string, QueueParent | null>) => {
    const runs = selected ?? database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow);
    const parents = parentFacts ?? parentage(runs.map(run => run.envelope));
    const ids = JSON.stringify(runs.map(run => run.envelope.runId));
    const selectSources = (table: string, key: string, suffix: string) => selected === undefined
      ? database.prepare(`SELECT * FROM ${table} ${suffix}`).all()
      : database.prepare(`SELECT * FROM ${table} WHERE ${key} IN (SELECT value FROM json_each(?)) ${suffix}`).all(ids);
    const sources=(table:"run_results"|"run_receipts"|"run_failures")=>{
      const grouped=new Map<string,unknown>();
      const resolutions=new Map<string,unknown>();
      const selectedRows = table === "run_failures" ? selectSources(table,"run_id","ORDER BY run_id")
        : database.prepare(`SELECT source.* FROM ${table} source JOIN runs run ON run.id=source.run_id
          JOIN run_results settlement ON settlement.run_id=run.id ${table === "run_receipts" ? "AND settlement.settlement_version=source.settlement_version" : "AND settlement.id=source.id"}
          WHERE ${CURRENT_RUN_SETTLEMENT_SQL} ${selected === undefined ? "" : "AND source.run_id IN (SELECT value FROM json_each(?))"} ORDER BY source.run_id`)
          .all(...(selected === undefined ? [] : [ids]));
      for(const raw of selectedRows) {
        const record=nativeOrdinaryRecordFromRow(table,raw);
        const row=z.object({run_id:z.string()}).parse(raw);
        if(grouped.has(row.run_id))throw new Error("summary-source-ambiguous");
        grouped.set(row.run_id,record);
        if(table === "run_failures")resolutions.set(row.run_id,failureResolutionFromRow(raw).resolution);
      }
      return {grouped,resolutions};
    };
    const results=sources("run_results").grouped,receipts=sources("run_receipts").grouped,failureSources=sources("run_failures");
    const failures=failureSources.grouped,resolutions=failureSources.resolutions;
    const events=new Map<string,{cursor:number;startedAt:string|null;queueTitle:string|null}>();
    const byRun=new Map(runs.map(run=>[String(run.envelope.runId),run]));
    const eventFilter = "kind IN ('run.queued','run.claimed')";
    const eventRows = selected === undefined
      ? database.prepare(`SELECT * FROM timeline_events WHERE ${eventFilter} ORDER BY cursor`).all()
      : database.prepare(`SELECT * FROM timeline_events WHERE run_id IN (SELECT value FROM json_each(?)) AND ${eventFilter} ORDER BY run_id,cursor`).all(ids);
    for(const raw of eventRows) {
      const event=timelineEventFromRow(raw);
      if(event.scope.kind !== "run" || event.payload.kind !== "span"
        || (event.payload.event.t !== "run.queued" && event.payload.event.t !== "run.claimed"))throw new Error("run-summary-span-kind-invalid");
      const owner=byRun.get(event.scope.runId),span=event.payload.event;
      if(owner === undefined || owner.envelope.workflow !== event.workflow || owner.envelope.traceId !== span.traceId
        || owner.envelope.runId !== span.runId || span.attempt > owner.envelope.attempt)throw new Error("run-summary-span-owner-mismatch");
      const prior=events.get(event.scope.runId) ?? {cursor:0,startedAt:null,queueTitle:null};
      events.set(event.scope.runId,{cursor:event.cursor,startedAt:prior.startedAt ?? (span.t === "run.claimed" ? span.ts : null),
        queueTitle:prior.queueTitle ?? (span.t === "run.queued" ? span.title ?? null : null)});
    }
    const children = new Map<string, { runId: string; state: string; outcome: string | null }[]>();
    const childRuns = selected === undefined ? runs : database.prepare(`SELECT * FROM runs ${runIndex(database, "runs_parent_idx")} WHERE parent_id IN (SELECT value FROM json_each(?)) ORDER BY parent_id,id`).all(ids).map(runRecordFromRow);
    for (const run of childRuns) {
      const parent = run.envelope.parent?.runId;
      if (parent === undefined) continue;
      const group = children.get(parent) ?? [];
      group.push({ runId: run.envelope.runId, state: run.lifecycle.state, outcome: run.lifecycle.state === "terminal" ? run.lifecycle.outcome : null });
      children.set(parent, group);
    }
    const dependencies = new Map<string, string[]>();
    const dependencyRows = selected === undefined
      ? database.prepare("SELECT * FROM delegation_dependencies ORDER BY id").all()
      : database.prepare("SELECT * FROM delegation_dependencies WHERE parent_run_id IN (SELECT value FROM json_each(?)) ORDER BY parent_run_id,id").all(ids);
    for (const raw of dependencyRows) {
      const dependency=DependencyRecordSchema.parse(nativeOrdinaryRecordFromRow("delegation_dependencies",raw));
      const group = dependencies.get(dependency.parentRunId) ?? [];
      group.push(dependency.childRunId); dependencies.set(dependency.parentRunId, group);
    }
    const summaries = runs.map(run => {
      const id = run.envelope.runId, event = events.get(id);
      const parent = parents.get(id);
      if (parent === undefined) throw new Error("queue-parent-source-unavailable");
      return { ...deriveRunSummary(RunSummarySourceSchema.parse({ run,
        parent,
        delegationWait: waits?.has(id) === true ? waits.get(id) : waitState(run),
        cursor: event?.cursor ?? 0,
        startedAt: event?.startedAt ?? ("claimedAt" in run.lifecycle ? run.lifecycle.claimedAt : null),
        queueTitle: event?.queueTitle ?? null, children: children.get(id) ?? [], dependencyRunIds: dependencies.get(id) ?? [],
        result: results.get(id) ?? null, receipt: receipts.get(id) ?? null,
        failure: failures.get(id) ?? null, resolution: resolutions.get(id) ?? null,
      }), sourceGeneration), cancelRequested: run.cancelRequested === true };
    });
    return summaries.sort((a, b) => a.localDay.localeCompare(b.localDay) || a.runId.localeCompare(b.runId));
  };
  return {
    workflows(_sourceGeneration: number) {
      return listRunWorkflows(database);
    },
    read(sourceGeneration: number) {
      return snapshot(sourceGeneration).map(({ cancelRequested, ...summary }) => { void cancelRequested; return summary; });
    },
    query(sourceGeneration: number, input: RunSummaryQuery) {
      const query = RunSummaryQuerySchema.parse(input);
      const clauses = ["workflow=?"], values: (string | number)[] = [query.workflow];
      const add = (sql: string, ...parameters: (string | number)[]) => { clauses.push(sql); values.push(...parameters); };
      if (query.fromDay !== undefined) add("local_day>=?", query.fromDay);
      if (query.toDay !== undefined) add("local_day<=?", query.toDay);
      if (query.parentRunId !== undefined) {
        if (query.parentRunId === null) add("parent_id IS NULL");
        else add("parent_id=?", query.parentRunId);
      }
      if (query.sessionId !== undefined) add("session_id=?", query.sessionId);
      if (query.state !== undefined) add("state=?", query.state);
      if (query.status === "done" || query.status === "failed") add("state='terminal' AND outcome=?", query.status);
      else if (query.status === "cancelled") add("state='terminal' AND outcome IN ('cancelled','discarded','superseded')");
      else if (query.status === "blocked") add("(state IN ('queued','parked-write') OR (state='terminal' AND outcome='interrupted'))");
      else if (query.status === "queued") add("state='queued'");
      else if (query.status === "awaiting-approval") add("state='parked-gate'");
      else if (query.status === "partial") add("0");
      else if (query.status !== undefined) add("state IN ('queued','claimed','validating','running')");
      const selected: RunRecord[] = [], waits = new Map<string, DelegationWaitState | null>();
      const parents = new Map<string, QueueParent | null>();
      let after = query.after;
      for (;;) {
        const cursorClause = after === undefined ? "" : " AND (local_day>? OR (local_day=? AND id>?))";
        const cursorValues = after === undefined ? [] : [after.localDay, after.localDay, after.runId];
        const candidates = database.prepare(`SELECT * FROM runs ${runIndex(database, "runs_workflow_day_idx")} WHERE ${clauses.join(" AND ")}${cursorClause}
          ORDER BY local_day,id LIMIT ?`).all(...values, ...cursorValues, query.limit + 1).map(runRecordFromRow);
        if (query.topLevel === true) {
          const missing = candidates.filter(run => !parents.has(run.envelope.runId));
          for (const [runId, parent] of parentage(missing.map(run => run.envelope))) parents.set(runId, parent);
        }
        for (const run of candidates) {
          if (query.topLevel === true) {
            const parent = parents.get(run.envelope.runId);
            if (parent === undefined) throw new Error("queue-parent-source-unavailable");
            if (!isQueueTopLevel({ parent })) continue;
          }
          const delegationWait = waitState(run);
          if (query.status !== undefined && deriveRunStatus({ ...run, delegationWait }) !== query.status) continue;
          waits.set(run.envelope.runId, delegationWait);
          selected.push(run);
          if (selected.length > query.limit) break;
        }
        const last = candidates.at(-1);
        if (selected.length > query.limit || candidates.length <= query.limit || last === undefined) break;
        const day = z.object({ local_day: z.string() }).parse(database.prepare("SELECT local_day FROM runs WHERE id=?").get(last.envelope.runId));
        after = { localDay: day.local_day, runId: last.envelope.runId };
      }
      const rows = snapshot(sourceGeneration, selected, waits, query.topLevel === true ? parents : undefined);
      const items = rows.slice(0, query.limit), last = items.at(-1);
      return { items, next: rows.length > query.limit && last !== undefined ? { localDay: last.localDay, runId: last.runId } : null };
    },
    calendar(sourceGeneration: number, input: { month: string; day: string; today: string }) {
      const { month, day, today } = CalendarStoreQuerySchema.parse(input);
      if (day > today) throw new Error("calendar-future-day");
      const countRow = z.object({ day: z.iso.date(), count: z.number().int().positive() });
      const monthStart = `${month}-01`, monthEnd = `${month}-31`;
      const counts = new Map(database.prepare(`SELECT local_day AS day,count(*) AS count FROM runs ${runIndex(database, "runs_day_idx")}
        WHERE parent_id IS NULL AND local_day BETWEEN ? AND ? AND local_day<=? GROUP BY local_day ORDER BY local_day`)
        .all(monthStart, monthEnd, today)
        .map(raw => { const row = countRow.parse(raw); return [row.day, row.count] as const; }));
      const date = z.iso.date().nullable();
      const roots = z.strictObject({ first: date, last: date, previous: date, next: date }).parse(database.prepare(`
        SELECT min(local_day) AS first,max(local_day) AS last,
          max(CASE WHEN local_day<? THEN local_day END) AS previous,
          min(CASE WHEN local_day>? THEN local_day END) AS next
        FROM runs ${runIndex(database, "runs_day_idx")} WHERE parent_id IS NULL AND local_day<=?`).get(day, day, today));
      const days = new Set(counts.keys());
      for (const boundary of Object.values(roots)) if (boundary !== null) days.add(boundary);
      const dateBindings: string[] = [];
      let childDays = "";
      // A child can only change month counts or extend a boundary already established by a root.
      if (roots.first !== null && roots.last !== null) {
        const relevant = ["local_day BETWEEN ? AND ?", "local_day<?", "local_day>?"];
        dateBindings.push(monthStart, monthEnd, roots.first, roots.last);
        if (roots.previous !== null) {
          relevant.push("(local_day>? AND local_day<?)");
          dateBindings.push(roots.previous, day);
        }
        if (roots.next !== null) {
          relevant.push("(local_day>? AND local_day<?)");
          dateBindings.push(day, roots.next);
        }
        childDays = `AND (${relevant.join(" OR ")})`;
      }
      const parentRow = z.object({ parentId: RunIdSchema, childRunId: RunIdSchema });
      const selectParents = database.prepare(`SELECT parent_id AS parentId,min(id) AS childRunId FROM runs ${runIndex(database, "runs_parent_idx")}
        WHERE parent_id IS NOT NULL AND parent_id>? AND local_day<=? ${childDays}
        GROUP BY parent_id ORDER BY parent_id LIMIT ?`);
      const selectEnvelope = database.prepare("SELECT envelope_json FROM runs WHERE id=?");
      const selectLinkedCounts = database.prepare(`SELECT local_day AS day,count(*) AS count FROM json_each(?) linked
        CROSS JOIN runs ON runs.id=linked.value
        WHERE parent_id=? AND local_day<=? ${childDays} GROUP BY local_day ORDER BY local_day`);
      let afterParent = "";
      for (;;) {
        const parents = selectParents.all(afterParent, today, ...dateBindings, 500).map(raw => parentRow.parse(raw));
        for (const parent of parents) {
          const raw = z.object({ envelope_json: z.string() }).parse(selectEnvelope.get(parent.childRunId));
          const envelope = RunEnvelopeSchema.parse(JSON.parse(raw.envelope_json));
          if (envelope.runId !== parent.childRunId || envelope.parent?.runId !== parent.parentId) throw new Error("queue-parent-source-unavailable");
          const linked = [...parentage([envelope])].filter(([, fact]) => fact?.runId === parent.parentId && fact.visibility === "linked").map(([runId]) => runId);
          if (linked.length === 0) continue;
          const linkedCounts = selectLinkedCounts.all(JSON.stringify(linked), parent.parentId, today, ...dateBindings).map(raw => countRow.parse(raw));
          for (const row of linkedCounts) {
            days.add(row.day);
            if (row.day >= monthStart && row.day <= monthEnd) counts.set(row.day, (counts.get(row.day) ?? 0) + row.count);
          }
        }
        const last = parents.at(-1);
        if (parents.length < 500 || last === undefined) break;
        afterParent = last.parentId;
      }
      const ordered = [...days].sort();
      const next = ordered.find(candidate => candidate > day) ?? null;
      return CalendarWireSchema.parse({ month, day, today, authorityGeneration: sourceGeneration,
        monthCounts: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
        firstDay: ordered.at(0) ?? null, lastDay: ordered.at(-1) ?? null,
        previousDay: ordered.findLast(candidate => candidate < day) ?? null,
        nextDay: day < today && (next === null || today < next) ? today : next });
    },
  };
}
