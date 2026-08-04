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
 * - task span outcome → timeline state: `done→done`, `failed→failed`,
 *   `skipped→skipped`, `interrupted→blocked`,
 *   `cancelled|discarded|superseded→cancelled`. `skipped` got its own arm on
 *   2026-08-04 (D123): it used to fold into `cancelled`, which names an act
 *   someone took, and the live exit run rendered a `condition-false` branch as
 *   "Cancelled". A skipped row now also carries the executor's recorded
 *   `not-run` reason, or an explicit statement that none was recorded.
 */
import { z } from "zod";
import { localDatePart } from "../../../domain/clock.js";
import {
  FailureDetailWireSchema,
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../../domain/dashboard/run-detail.js";
import type { RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import type { FailureRecord } from "../../../domain/trust/failure.js";
import type { RunRecord } from "../../../domain/run/record.js";
import {
  readEventStreamLines,
  type EventStreamLine,
} from "../../../infra/events/jsonl-streams.js";
import { NoteWireSchema as NoteAtRestSchema } from "../../../events/types.js";
import type { RunFoldRecord, RunQueueProjection } from "../projectors/run-queue-projection.js";
import { deterministicUuid } from "../support.js";

/**
 * The trust reads the receipt and failure sections need (D140/D142). They are
 * separate from `getRun` on purpose: the query never opens a database, and a
 * composition that cannot serve trust content must say so by omission rather
 * than by handing in a stub that returns nothing.
 */
export interface RunDetailTrustDeps {
  /** Derive-and-persist the run's receipt; see `ensureRunEvidenceReceipt`. */
  ensureReceipt(runId: string): RunEvidenceReceipt;
  getFailure(failureId: string): FailureRecord | undefined;
  countFailuresByFingerprint(fingerprint: string): number;
}

export interface RunDetailQueryDeps {
  readonly stateRoot: string;
  readonly projection: RunQueueProjection;
  readonly authority: { getRun(runId: string): RunRecord | undefined };
  /** Absent until a composition wires the 2g trust services. */
  readonly trust?: RunDetailTrustDeps;
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

/**
 * A section is advertised only when this composition can genuinely serve it.
 * `receipt` needs BOTH a terminal run (a receipt states a settled verdict) and
 * the trust seam; `failure` needs a terminal failure and the same seam, since
 * without it the panel could only serve the pointer it used to.
 */
export function availableSections(
  _row: RunFoldRecord,
  authority: RunRecord,
  trust?: RunDetailTrustDeps,
): readonly ("logs" | "receipt" | "context-data" | "context-attempts" | "failure")[] {
  const { lifecycle } = authority;
  const terminal = lifecycle.state === "terminal";
  const settled = terminal && lifecycle.outcome !== "interrupted";
  return [
    "logs",
    ...(settled && trust !== undefined ? (["receipt"] as const) : []),
    "context-data",
    "context-attempts",
    ...(terminal && lifecycle.outcome === "failed" && trust !== undefined
      ? (["failure"] as const)
      : []),
  ];
}

export function buildRunDetail(deps: RunDetailQueryDeps, runId: string): RunDetailWire {
  const { row, authority } = requireRun(deps, runId);
  const status = statusOf(row, authority);

  const timelineEvents: {
    at: string;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    notRun: { state: "absent"; reason: string } | { state: "present"; reason: "condition-false" | "branch-not-selected" };
    seed: string;
  }[] = [];
  for (const span of row.taskSpans) {
    const state = span.outcome === undefined
      ? "active"
      : ({ done: "done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", skipped: "skipped", interrupted: "blocked", superseded: "cancelled" } as const)[span.outcome];
    // A skip is not a cancellation, and a skip WITHOUT a recorded reason is
    // not a skip with a guessed one. Both absences stay named.
    const notRun = state !== "skipped"
      ? { state: "absent", reason: "this step ran" } as const
      : span.notRunReason === undefined
        ? { state: "absent", reason: "this step did not run; its span recorded no reason" } as const
        : { state: "present", reason: span.notRunReason } as const;
    // The seed carries doc 03 §1.1's whole span identity. `<trace>/<node>#<taskAttempt>`
    // repeats verbatim across RUN attempts, so a node re-run after a recovered
    // failure yields two genuinely distinct folded spans that share a path — both
    // are real history and both must render, so the attempt has to reach the id.
    timelineEvents.push({ at: span.startedAt ?? span.endedAt ?? row.queued.ts, label: span.name, state, notRun, seed: `task:${String(span.attempt)}:${span.spanPath}` });
  }
  const gateNotRun = { state: "absent", reason: "a gate is not a workflow step" } as const;
  for (const gate of row.openGates) {
    timelineEvents.push({ at: gate.openedAt, label: `gate:${gate.gate}`, state: "blocked", notRun: gateNotRun, seed: `gate-open:${gate.gate}:${gate.openedAt}` });
  }
  for (const gate of row.resolvedGates) {
    timelineEvents.push({ at: gate.resolvedAt, label: `gate:${gate.gate}`, state: "done", notRun: gateNotRun, seed: `gate-resolved:${gate.gate}:${gate.resolvedAt}` });
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
        notRun: event.notRun,
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
    availableSections: availableSections(row, authority, deps.trust),
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
  const served = availableSections(row, authority, deps.trust);
  if (!served.includes(section as (typeof served)[number])) {
    if (section === "receipt") {
      return RunDetailSectionResponseSchema.parse({
        section,
        payload: { state: "missing", reason: receiptAbsenceReason(authority, deps.trust) },
      });
    }
    if (section === "failure") {
      return RunDetailSectionResponseSchema.parse({
        section,
        payload: {
          state: "missing",
          reason: deps.trust === undefined
            ? "this composition wires no trust service, so the structured failure record cannot be read"
            : "this run holds no structured failure record",
        },
      });
    }
    throw new Error(`section ${section} is not available for run ${runId}; served sections are ${served.join(", ")}`);
  }
  /** Only the two trust sections need the seam; logs and context never did. */
  const requireTrust = (): RunDetailTrustDeps => {
    if (deps.trust === undefined) {
      throw new Error(`section ${section} was advertised for run ${runId} without a trust service`);
    }
    return deps.trust;
  };

  if (section === "receipt") {
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: { state: "available", value: requireTrust().ensureReceipt(runId) },
    });
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
  const { failureId } = authority.lifecycle;
  const trust = requireTrust();
  const failure = trust.getFailure(failureId);
  if (failure === undefined) {
    // The run's terminal transition NAMES this record; its absence is a
    // storage fault, not an empty panel. Failing loud is the only honest arm.
    throw new Error(
      `run ${runId} terminalized failed against failure ${failureId}, which authority does not hold`,
    );
  }
  return RunDetailSectionResponseSchema.parse({
    section: "failure",
    payload: { state: "available", value: failureDetailWire(runId, failure, trust) },
  });
}

function receiptAbsenceReason(authority: RunRecord, trust?: RunDetailTrustDeps): string {
  if (trust === undefined) {
    return "this composition wires no trust service, so no receipt can be derived";
  }
  const { lifecycle } = authority;
  if (lifecycle.state !== "terminal") {
    return `run is ${lifecycle.state}; a receipt states a settled verdict and this run has none yet`;
  }
  return "run was interrupted; doc-09 recovery will requeue or settle it before a receipt can name a verdict";
}

/**
 * Project the durable `FailureRecord` onto the strict wire. The projection is
 * a whitelist BY CONSTRUCTION — every field is named here — so a field added
 * to the durable record later reaches no surface until someone decides how it
 * is classified. `sameFingerprintSeen` counts occurrences of the failure
 * CLASS, which is doc 12 §2.1's "same failure seen before" link.
 */
function failureDetailWire(
  runId: string,
  failure: FailureRecord,
  trust: RunDetailTrustDeps,
): z.infer<typeof FailureDetailWireSchema> {
  const seen = trust.countFailuresByFingerprint(failure.fingerprint);
  return FailureDetailWireSchema.parse({
    runId,
    failureId: failure.failureId,
    traceId: failure.traceId,
    attempt: failure.attempt,
    workflowId: failure.workflowId,
    ...(failure.nodeId === undefined ? {} : { nodeId: failure.nodeId }),
    ...(failure.taskId === undefined ? {} : { taskId: failure.taskId }),
    fingerprint: failure.fingerprint,
    code: failure.code,
    summary: failure.summary,
    transient: failure.transient,
    writeState: failure.writeState,
    subject: failure.subject === undefined
      ? { state: "absent", reason: "this failure bound no transaction subject" }
      : { state: "present", ...failure.subject },
    ...(failure.page === undefined ? {} : { page: failure.page }),
    ...(failure.action === undefined ? {} : { action: failure.action }),
    causeChain: failure.causeChain,
    remediation: failure.remediation,
    // The record being projected is itself one occurrence, so a count that
    // came back short of 1 means the index disagrees with the row.
    sameFingerprintSeen: Math.max(1, seen),
    diagnosticBundle: failure.diagnosticBundleId === undefined
      ? {
        state: "absent",
        reason: "no diagnostic bundle was captured; automatic capture is a separate 2g slice",
      }
      : { state: "present", bundleId: failure.diagnosticBundleId },
    occurredAt: failure.occurredAt,
  });
}
