/**
 * `RunDetailWire` header + the lazy sections Person Lookup needs (doc 13
 * §3.3, §6.2): logs (from the notes stream) and the context data/attempts
 * slices. Sections whose owning service lands later (receipt in 2g, review/
 * people/captures in 2h) are typed-absent through the wire's absence unions
 * or refused by name — never fabricated.
 *
 * Closed mappings this query owns (stated, not silent):
 * - terminal outcome → OutcomeWire result: `done→verified-done` (a done run's
 *   result IS factory-verified terminal authority, D110), `failed→failed`,
 *   `cancelled|discarded|superseded→cancelled`; an `interrupted` run keeps an
 *   ABSENT outcome ("recovery will requeue or settle it") because the landed
 *   enum has no arm that names it without claiming a verdict.
 * - gate resolutionKey → GateDecisionWire resolution: only the literal keys
 *   `approved`/`rejected` map; any other key renders the gate absent with the
 *   key named in the reason rather than coercing it into a boolean verdict.
 * - note level → NoteWire level: `error→error`, `warn|waiting→warning`,
 *   everything else `info`.
 */
import { z } from "zod";
import { localDatePart } from "../../../domain/clock.js";
import {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../../domain/dashboard/run-detail.js";
import type { RunRecord } from "../../../domain/run/record.js";
import {
  readEventStreamLines,
  type EventStreamLine,
} from "../../../infra/events/jsonl-streams.js";
import { NoteWireSchema as NoteAtRestSchema } from "../../../events/types.js";
import type { RunFoldRecord, RunQueueProjection } from "../projectors/run-queue-projection.js";
import { deterministicUuid } from "../support.js";

export interface RunDetailQueryDeps {
  readonly stateRoot: string;
  readonly projection: RunQueueProjection;
  readonly authority: { getRun(runId: string): RunRecord | undefined };
}

const LOGS_PAGE_SIZE = 200;

function panelKindOf(shape: RunFoldRecord["queued"]["shape"]): "run" | "member" | "group" {
  if (shape === "operation") return "group";
  if (shape === "operation-member") return "member";
  return "run";
}

function statusOf(row: RunFoldRecord, authority: RunRecord): "queued" | "running" | "blocked" | "awaiting-approval" | "done" | "failed" | "cancelled" | "partial" {
  const { lifecycle } = authority;
  if (lifecycle.state === "terminal") {
    const map = { done: "done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", superseded: "cancelled", interrupted: "blocked" } as const;
    return map[lifecycle.outcome];
  }
  if (lifecycle.state === "parked-write") return "blocked";
  if (lifecycle.state === "parked-gate" || row.openGates.length > 0) return "awaiting-approval";
  if (lifecycle.state === "claimed" || lifecycle.state === "validating" || lifecycle.state === "running") return "running";
  return "queued";
}

function requireRun(deps: RunDetailQueryDeps, runId: string): { row: RunFoldRecord; authority: RunRecord } {
  const row = deps.projection.runFold(runId);
  if (row === undefined) {
    throw new Error(`run ${runId} has no span fold; it was never enqueued through this projection`);
  }
  const authority = deps.authority.getRun(runId);
  if (authority === undefined) {
    throw new Error(`run ${runId} exists in the span stream but not in authority`);
  }
  return { row, authority };
}

export function availableSections(_row: RunFoldRecord, authority: RunRecord): readonly ("logs" | "context-data" | "context-attempts" | "failure")[] {
  return [
    "logs",
    "context-data",
    "context-attempts",
    ...(authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "failed"
      ? (["failure"] as const)
      : []),
  ];
}

export function buildRunDetail(deps: RunDetailQueryDeps, runId: string): RunDetailWire {
  const { row, authority } = requireRun(deps, runId);
  const status = statusOf(row, authority);

  const timelineEvents: { at: string; label: string; state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled"; seed: string }[] = [];
  for (const span of row.taskSpans) {
    const state = span.outcome === undefined
      ? "active"
      : ({ done: "done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", skipped: "cancelled", interrupted: "blocked", superseded: "cancelled" } as const)[span.outcome];
    timelineEvents.push({ at: span.startedAt ?? span.endedAt ?? row.queued.ts, label: span.name, state, seed: `task:${span.spanPath}` });
  }
  for (const gate of row.openGates) {
    timelineEvents.push({ at: gate.openedAt, label: `gate:${gate.gate}`, state: "blocked", seed: `gate-open:${gate.gate}` });
  }
  for (const gate of row.resolvedGates) {
    timelineEvents.push({ at: gate.resolvedAt, label: `gate:${gate.gate}`, state: "done", seed: `gate-resolved:${gate.gate}` });
  }
  timelineEvents.sort((a, b) => a.at.localeCompare(b.at) || a.seed.localeCompare(b.seed));

  const openGate = row.openGates.at(-1);
  const lastResolved = row.resolvedGates.at(-1);
  let gate: unknown;
  if (openGate !== undefined) {
    gate = {
      state: "open",
      gateId: deterministicUuid(`gate:${runId}:${openGate.gate}`),
      label: openGate.gate,
      openedAt: openGate.openedAt,
      revision: 1,
    };
  } else if (lastResolved !== undefined) {
    gate = lastResolved.resolutionKey === "approved" || lastResolved.resolutionKey === "rejected"
      ? {
        state: "resolved",
        gateId: deterministicUuid(`gate:${runId}:${lastResolved.gate}`),
        label: lastResolved.gate,
        resolution: lastResolved.resolutionKey,
        resolvedAt: lastResolved.resolvedAt,
        revision: 2,
      }
      : {
        state: "absent",
        reason: `gate ${lastResolved.gate} resolved with key ${lastResolved.resolutionKey}, which is not an approve/reject verdict`,
      };
  } else {
    gate = { state: "absent", reason: "this run declares no operator gate" };
  }

  const { lifecycle } = authority;
  const outcome = lifecycle.state === "terminal"
    ? lifecycle.outcome === "interrupted"
      ? { state: "absent", reason: "run interrupted; doc-09 recovery will requeue or settle it" }
      : {
        state: "terminal",
        result: ({ done: "verified-done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", superseded: "cancelled" } as const)[lifecycle.outcome],
        completedAt: lifecycle.endedAt,
      }
    : { state: "absent", reason: `run is ${status}` };

  return RunDetailWireSchema.parse({
    runId,
    rowRevision: authority.version,
    panelKind: panelKindOf(row.queued.shape),
    header: {
      runId,
      traceId: row.queued.traceId,
      workflowId: row.queued.workflow,
      actorId: row.queued.actorId,
      title: authority.displayName ?? row.queued.title,
      status,
      attempt: row.attempt,
    },
    timeline: {
      events: timelineEvents.map((event, index) => ({
        noteId: deterministicUuid(`timeline:${runId}:${event.seed}`),
        sequence: index,
        at: event.at,
        label: event.label,
        state: event.state,
      })),
    },
    gate,
    outcome,
    context: {
      // Every done task recorded provenance-validated data (1f mandate); the
      // evidence service is 2g, so its count is genuinely zero today.
      dataFacts: row.taskSpans.filter((span) => span.outcome === "done").length,
      evidenceFacts: 0,
      attempts: row.attempt,
    },
    availableSections: availableSections(row, authority),
  });
}

/* ── lazy sections ───────────────────────────────────────────────────────── */

const SectionNameSchema = z.enum([
  "logs", "receipt", "review", "people", "context-data", "context-evidence", "context-attempts", "failure", "captures",
]);

const LEVEL_MAP = { error: "error", warn: "warning", waiting: "warning", step: "info", success: "info", debug: "info" } as const;

function noteLinesForRun(deps: RunDetailQueryDeps, workflow: string, runId: string): readonly { line: EventStreamLine; note: z.infer<typeof NoteAtRestSchema> }[] {
  const matches: { line: EventStreamLine; note: z.infer<typeof NoteAtRestSchema> }[] = [];
  for (const line of readEventStreamLines(deps.stateRoot, "notes")) {
    if (line.file.workflow !== workflow) continue;
    const note = NoteAtRestSchema.parse(JSON.parse(line.text));
    if ("runId" in note && note.runId === runId) matches.push({ line, note });
  }
  return matches;
}

export function buildRunSection(
  deps: RunDetailQueryDeps,
  runId: string,
  sectionInput: string,
  cursorInput?: string,
): RunDetailSectionResponse {
  const section = SectionNameSchema.parse(sectionInput);
  const { row, authority } = requireRun(deps, runId);
  const served = availableSections(row, authority);
  if (!served.includes(section as (typeof served)[number])) {
    if (section === "receipt") {
      return RunDetailSectionResponseSchema.parse({
        section,
        payload: { state: "missing", reason: "evidence receipts land with the 2g trust surfaces" },
      });
    }
    if (section === "failure") {
      return RunDetailSectionResponseSchema.parse({
        section,
        payload: { state: "missing", reason: "this run holds no structured failure record" },
      });
    }
    throw new Error(`section ${section} is not available for run ${runId}; served sections are ${served.join(", ")}`);
  }

  if (section === "logs") {
    const offset = cursorInput === undefined
      ? 0
      : Number(z.string().regex(/^pc:[1-9]\d*$/).parse(cursorInput).slice(3)) - 1;
    const all = noteLinesForRun(deps, row.queued.workflow, runId);
    const page = all.slice(offset, offset + LOGS_PAGE_SIZE);
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: {
        runId,
        notes: page.map(({ line, note }, index) => ({
          noteId: deterministicUuid(`note:${line.file.path}:${String(line.lineNumber)}`),
          runId,
          sequence: offset + index,
          at: note.ts,
          level: LEVEL_MAP[note.level],
          message: note.message,
        })),
        nextCursor: offset + LOGS_PAGE_SIZE < all.length
          ? { state: "present", value: `pc:${String(offset + LOGS_PAGE_SIZE + 1)}` }
          : { state: "absent", reason: "end-of-page" },
      },
    });
  }

  if (section === "context-data") {
    // The descriptor-declared detail patches ARE the display-safe data facts
    // (doc 03 §1.1); nothing else is served until the 2g context ledger.
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: {
        runId,
        entries: Object.entries(row.details).map(([label, value]) => ({
          label,
          valueRedacted: typeof value === "string" ? value : JSON.stringify(value),
        })),
      },
    });
  }

  if (section === "context-attempts") {
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: {
        runId,
        entries: [
          { label: "current-attempt", valueRedacted: String(row.attempt) },
          { label: "requeues", valueRedacted: String(row.requeues) },
          { label: "enqueued-day", valueRedacted: localDatePart(new Date(row.queued.ts)) },
        ],
      },
    });
  }

  // section === "failure" and it IS served: the run is terminal-failed.
  if (authority.lifecycle.state !== "terminal" || authority.lifecycle.outcome !== "failed"
    || authority.lifecycle.failureId === undefined) {
    throw new Error(`run ${runId} advertises a failure section without a terminal failure record`);
  }
  return RunDetailSectionResponseSchema.parse({
    section: "failure",
    payload: { state: "available", value: { runId, failureId: authority.lifecycle.failureId } },
  });
}
