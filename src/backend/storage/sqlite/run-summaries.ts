import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { timelineEventFromRow } from "./timeline-repository.js";
import { FailureResolutionSchema } from "../../../models/trust/failure-resolution.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CalendarQuerySchema, CalendarWireSchema } from "../../../models/dashboard/calendar.js";
import { QueueStatusSchema } from "../../../models/dashboard/projection.js";
import { RunStateSchema, type RunRecord } from "../../../models/run/record.js";
import { RunSummarySourceSchema, SummaryQuerySchema } from "../../../models/run/summary.js";
import { DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { deriveRunSummary } from "../../../rules/runs/summary-derivation.js";
import { runRecordFromRow } from "./run-record-row.js";

export const RunSummaryQuerySchema = SummaryQuerySchema.extend({
  state: RunStateSchema.optional(), status: QueueStatusSchema.optional(),
  topLevel: z.boolean().optional(), sessionId: z.string().uuid().optional(),
}).refine(query => query.fromDay === undefined || query.toDay === undefined || query.fromDay <= query.toDay,
  { message: "run-summary-range-invalid" });
export type RunSummaryQuery = z.infer<typeof RunSummaryQuerySchema>;

export function createRunSummaries(database: DatabaseSync) {
  const snapshot = (sourceGeneration: number, selected?: readonly RunRecord[]) => {
    const runs = selected ?? database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow);
    const ids = JSON.stringify(runs.map(run => run.envelope.runId));
    const selectSources = (table: string, key: string, suffix: string) => selected === undefined
      ? database.prepare(`SELECT * FROM ${table} ${suffix}`).all()
      : database.prepare(`SELECT * FROM ${table} WHERE ${key} IN (SELECT value FROM json_each(?)) ${suffix}`).all(ids);
    const sources=(table:"run_results"|"run_receipts"|"run_failures")=>{
      const grouped=new Map<string,unknown>();
      const resolutions=new Map<string,unknown>();
      for(const raw of selectSources(table,"run_id","ORDER BY run_id")) {
        const record=nativeOrdinaryRecordFromRow(table,raw);
        const row=z.object({run_id:z.string()}).parse(raw);
        if(grouped.has(row.run_id))throw new Error("summary-source-ambiguous");
        grouped.set(row.run_id,record);
        if(table === "run_failures")resolutions.set(row.run_id,FailureResolutionSchema.parse(JSON.parse(z.object({resolution_json:z.string()}).parse(raw).resolution_json)));
      }
      return {grouped,resolutions};
    };
    const results=sources("run_results").grouped,receipts=sources("run_receipts").grouped,failureSources=sources("run_failures");
    const failures=failureSources.grouped,resolutions=failureSources.resolutions;
    const events=new Map<string,{cursor:number;startedAt:string|null;queueTitle:string|null}>();
    const byRun=new Map(runs.map(run=>[String(run.envelope.runId),run]));
    const eventFilter = "json_extract(payload_json,'$.payload.event.t') IN ('run.queued','run.claimed')";
    const eventRows = selected === undefined
      ? database.prepare(`SELECT * FROM timeline_events WHERE ${eventFilter} ORDER BY cursor`).all()
      : database.prepare(`SELECT * FROM timeline_events WHERE run_id IN (SELECT value FROM json_each(?)) AND ${eventFilter} ORDER BY cursor`).all(ids);
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
    const childRuns = selected === undefined ? runs : database.prepare("SELECT * FROM runs WHERE parent_id IN (SELECT value FROM json_each(?)) ORDER BY id").all(ids).map(runRecordFromRow);
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
      : database.prepare(`SELECT dependency.* FROM delegation_dependencies dependency JOIN run_delegations delegation ON delegation.id=dependency.delegation_id
        WHERE delegation.parent_run_id IN (SELECT value FROM json_each(?)) ORDER BY dependency.id`).all(ids);
    for (const raw of dependencyRows) {
      const dependency=DependencyRecordSchema.parse(nativeOrdinaryRecordFromRow("delegation_dependencies",raw));
      const group = dependencies.get(dependency.parentRunId) ?? [];
      group.push(dependency.childRunId); dependencies.set(dependency.parentRunId, group);
    }
    const summaries = runs.map(run => {
      const id = run.envelope.runId, event = events.get(id);
      return { ...deriveRunSummary(RunSummarySourceSchema.parse({ run,
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
      return database.prepare("SELECT DISTINCT workflow FROM runs ORDER BY workflow").all().map(row => z.object({ workflow: z.string() }).parse(row).workflow);
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
      if (query.topLevel === true) add("json_extract(envelope_json,'$.shape')<>'operation-member'");
      if (query.sessionId !== undefined) add("session_id=?", query.sessionId);
      if (query.state !== undefined) add("state=?", query.state);
      if (query.status === "done" || query.status === "failed") add("state='terminal' AND outcome=?", query.status);
      else if (query.status === "cancelled") add("state='terminal' AND outcome IN ('cancelled','discarded','superseded')");
      else if (query.status === "blocked") add("(state='parked-write' OR (state='terminal' AND outcome='interrupted'))");
      else if (query.status === "queued") add("state='queued'");
      else if (query.status === "awaiting-approval") add("state='parked-gate'");
      else if (query.status === "partial") add("0");
      else if (query.status !== undefined) add("state IN ('claimed','validating','running') AND COALESCE(json_extract(lifecycle_json,'$.cancelRequested'),0)=?", Number(query.status === "cancelling"));
      if (query.after !== undefined) add("(local_day>? OR (local_day=? AND id>?))", query.after.localDay, query.after.localDay, query.after.runId);
      const selected = database.prepare(`SELECT * FROM runs INDEXED BY runs_day_idx WHERE ${clauses.join(" AND ")}
        ORDER BY local_day,id LIMIT ?`).all(...values, query.limit + 1).map(runRecordFromRow);
      const rows = snapshot(sourceGeneration, selected);
      const items = rows.slice(0, query.limit), last = items.at(-1);
      return { items, next: rows.length > query.limit && last !== undefined ? { localDay: last.localDay, runId: last.runId } : null };
    },
    calendar(sourceGeneration: number, input: { month: string; day: string; today: string }) {
      const { month, day, today } = CalendarQuerySchema.extend({ today: z.iso.date() }).parse(input);
      if (day > today) throw new Error("calendar-future-day");
      const dateRow = z.object({ day: z.iso.date() });
      const boundary = (where: string, order: "ASC" | "DESC", values: string[]) => {
        const raw = database.prepare(`SELECT local_day AS day FROM runs INDEXED BY runs_day_idx
          WHERE json_extract(envelope_json,'$.shape')<>'operation-member' AND local_day<=? ${where} ORDER BY local_day ${order} LIMIT 1`).get(today, ...values);
        return raw === undefined ? null : dateRow.parse(raw).day;
      };
      const next = boundary("AND local_day>?", "ASC", [day]);
      return CalendarWireSchema.parse({ month, day, today, authorityGeneration: sourceGeneration,
        monthCounts: database.prepare(`SELECT local_day AS day,count(*) AS count FROM runs INDEXED BY runs_day_idx
          WHERE json_extract(envelope_json,'$.shape')<>'operation-member' AND local_day<=? AND local_day>=? AND local_day<=?
          GROUP BY local_day ORDER BY local_day`).all(today, `${month}-01`, `${month}-31`)
          .map(row => z.object({ day: z.iso.date(), count: z.number().int().positive() }).parse(row)),
        firstDay: boundary("", "ASC", []), lastDay: boundary("", "DESC", []),
        previousDay: boundary("AND local_day<?", "DESC", [day]),
        nextDay: day < today && (next === null || today < next) ? today : next });
    },
  };
}
