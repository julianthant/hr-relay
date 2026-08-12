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
import type { JsonValue } from "../../../domain/canonical-json.js";
import { localDatePart } from "../../../domain/clock.js";
import {
  FailureDetailWireSchema,
  ParkedWriteDetailWireSchema,
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../../domain/dashboard/run-detail.js";
import type { WriteBindingProof, WriteIntentRecord } from "../../../domain/write-safety.js";
import type { RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import type { FailureRecord } from "../../../domain/trust/failure.js";
import { runClaim, type RunRecord } from "../../../domain/run/record.js";
import type { RunCheckpointRecord } from "../../../domain/workflow/checkpoint.js";
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

/**
 * The slice of a workflow descriptor the context-data section reads (2i-C):
 * the detail specs give every served value its field identity, and the
 * `editData` capability is the ONLY source of "this field is correctable" —
 * the same declaration the command kernel enforces on save. Structural and
 * unbranded, so both the registry's broad descriptor view and a test fixture
 * satisfy it.
 */
export interface RunDetailDescriptorView {
  readonly details: readonly Readonly<{
    key: string;
    label: string;
    source: Readonly<{ nodeId: string; fieldPath: string }>;
  }>[];
  readonly capabilities?: Readonly<{
    editData?:
      | boolean
      | Readonly<{
        fields: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[];
      }>;
  }>;
}

export interface RunDetailQueryDeps {
  readonly stateRoot: string;
  readonly projection: RunQueueProjection;
  readonly authority: {
    getRun(runId: string): RunRecord | undefined;
    /** Doc 02 §5.7's "latest compatible attempt wins" read, for edit values. */
    latestCheckpoint(
      workflowId: string,
      itemId: string,
      nodeId: string,
    ): RunCheckpointRecord | undefined;
    /**
     * Doc 09 §4.1: the durable `write_intents` row a `parked-write` run names.
     * Read at REQUEST time, never folded into the projection — the intent is
     * the write-safety authority, and a resolution CASes against the exact
     * generation this read returned. A stale copy would let a browser resolve
     * a generation recovery has since advanced.
     */
    getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;
  };
  /** Resolves the CURRENT registered descriptor for a workflow. */
  readonly descriptors: {
    resolve(workflowId: string): RunDetailDescriptorView | undefined;
  };
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
 *
 * `parked-write` needs NO seam and no condition beyond the lifecycle itself: a
 * `parked-write` run is one whose durable intent row authority already holds,
 * and a parked run with no intent is a contradiction the serving arm refuses
 * loudly rather than hides by not advertising.
 */
export function availableSections(
  _row: RunFoldRecord,
  authority: RunRecord,
  trust?: RunDetailTrustDeps,
): readonly ("logs" | "receipt" | "context-data" | "context-attempts" | "failure" | "parked-write")[] {
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
    ...(lifecycle.state === "parked-write" ? (["parked-write"] as const) : []),
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
  "parked-write",
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
    // (doc 03 §1.1), joined back to their declaring specs for field identity;
    // the descriptor's editData fields extend them with the raw checkpoint
    // scalars a correction targets (doc 06 §6, 2i-C).
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: buildContextDataPayload(deps, row, authority),
    });
  }

  if (section === "parked-write") {
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: buildParkedWritePayload(deps, authority),
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

/* ── the parked-write section (doc 09 §4.1) ──────────────────────────────── */

/**
 * The binding proof's subject. A `subject-match` proof pins `expected` and
 * `observed` as canonically identical — its own `superRefine` refuses any
 * proof where they are not — so `expected` IS the fact, not half of it.
 *
 * The evidence is copied, not re-shaped: `SubjectEvidenceSchema` is already the
 * display-safe form doc 09 binds a write against, and every arm of it is a
 * digest, a branded id, or a bounded suffix. A second projection here could
 * only invent a name for a redaction that happened at binding time.
 */
function parkedWriteSubject(proof: WriteBindingProof): unknown {
  return proof.kind === "unscoped"
    ? {
      state: "unscoped",
      proofId: proof.proofId,
      observedAt: proof.observedAt,
      reviewedReasonId: proof.reviewedReasonId,
    }
    : {
      state: "subject-match",
      proofId: proof.proofId,
      observedAt: proof.observedAt,
      evidence: proof.expected,
    };
}

/**
 * The two typed resolutions, both always served (doc 09 §4.1, doc 13 §8.5).
 *
 * Serving only one would be this query deciding what the operator's look at
 * the target system is going to find, and there is no third arm on purpose:
 * doc 09 is explicit that no "force done" or "retry anyway" endpoint exists.
 * Both carry `confirm` copy that names the CASUALTY in the operator's terms —
 * confirmed-present settles the run as though the transaction happened, and
 * confirmed-absent authorizes a fresh fence that will click again.
 */
function parkedWriteActions(
  authority: RunRecord,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
): unknown[] {
  const writeTarget = { writeIntentId: intent.writeIntentId, intentGeneration: intent.generation };
  return [
    {
      key: "resolve-write-present",
      label: "I confirmed it IS there",
      detail: "Record the transaction you found, with its proof. The run settles as committed and never clicks again.",
      intent: "warning",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-present",
      expectedVersion: authority.version,
      confirm: {
        title: "Confirm the transaction exists",
        body: `This files ${intent.system} transaction ${intent.writeIntentId} as committed on this run's `
          + "evidence. If it is not actually there, the run finishes reporting work nobody did.",
        confirmLabel: "It is there",
        tone: "destructive",
      },
      writeTarget,
    },
    {
      key: "resolve-write-absent",
      label: "I confirmed it is NOT there",
      detail: "Release the fence so the run may attempt the write again under a new generation.",
      intent: "primary",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-absent",
      expectedVersion: authority.version,
      confirm: {
        title: "Confirm the transaction is absent",
        body: `This authorizes a fresh attempt against ${intent.system}. If the transaction does exist, `
          + "the retry submits it a SECOND time.",
        confirmLabel: "It is not there",
        tone: "destructive",
      },
      writeTarget,
    },
  ];
}

function buildParkedWritePayload(deps: RunDetailQueryDeps, authority: RunRecord): unknown {
  const { lifecycle } = authority;
  const runId = authority.envelope.runId;
  if (lifecycle.state !== "parked-write") {
    throw new Error(`run ${runId} advertises a parked-write section while it is ${lifecycle.state}`);
  }
  const intent = deps.authority.getWriteIntent(lifecycle.writeIntentId);
  if (intent === undefined) {
    // The run's own park NAMES this intent. Its absence is a storage fault on
    // the one record that says whether a real HR transaction exists — serving
    // an empty panel here would let an operator resolve nothing while being
    // told they resolved something.
    throw new Error(
      `run ${runId} is parked on write intent ${lifecycle.writeIntentId}, which authority does not hold`,
    );
  }
  if (intent.status !== "parked") {
    throw new Error(
      `run ${runId} is parked on write intent ${lifecycle.writeIntentId}, which is ${intent.status}; `
      + "the run park and the intent disagree about what happened to this write",
    );
  }
  if (intent.runId !== runId) {
    throw new Error(
      `run ${runId} is parked on write intent ${lifecycle.writeIntentId}, but that intent belongs to `
      + `run ${intent.runId}`,
    );
  }
  if (intent.generation !== lifecycle.intentGeneration) {
    throw new Error(
      `run ${runId} is parked on generation ${String(lifecycle.intentGeneration)} of write intent `
      + `${lifecycle.writeIntentId}, which is at generation ${String(intent.generation)}`,
    );
  }
  return ParkedWriteDetailWireSchema.parse({
    runId,
    writeIntentId: intent.writeIntentId,
    generation: intent.generation,
    runAttempt: intent.runAttempt,
    system: intent.system,
    taskId: intent.taskId,
    idempotencyKeyDigest: intent.idempotencyKeyDigest,
    fencedAt: intent.fencedAt,
    // The run's park instant, not the intent's `updatedAt`: the operator is
    // being told when THIS run stopped, and a later intent row touch is a
    // different event.
    parkedAt: lifecycle.parkedAt,
    parkedCode: intent.parkedCode,
    parkedMessage: intent.message,
    subject: parkedWriteSubject(intent.bindingProof),
    actions: parkedWriteActions(authority, intent),
  });
}

/* ── the context-data edit projection (2i-C) ─────────────────────────────── */

type EditableScalar = string | number | boolean;

/** Plain-string drafts; `RunDetailSectionResponseSchema.parse` brands them. */
type ContextDataEditing =
  | { state: "editable"; expectedVersion: number }
  | { state: "locked"; reason: string };
/**
 * The three provenance leaves the Data section serves (doc 02 §5.6).
 *
 * They are OMITTED, never nulled: the wire's members are optional and an absent
 * one says "this build cannot date this value". A checkpoint that recorded no
 * covering provenance point, an entry with no field identity, and a step that
 * never checkpointed all land here, and all three mean the same thing to the
 * rail — which is why they render identically rather than through three arms
 * the operator would have to tell apart.
 */
type FactProvenanceWire = {
  observedAt?: string;
  source?: "live" | "derived" | "operator";
  correctedAt?: string;
};

type ContextDataEntry = FactProvenanceWire & {
  label: string;
  valueRedacted: string;
  edit:
    | {
      state: "editable";
      nodeId: string;
      fieldPath: string;
      value: EditableScalar;
      pendingCorrection:
        | { state: "none" }
        | { state: "pending"; value: EditableScalar; correctedAt: string };
    }
    | { state: "locked"; reason: string };
};

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditableScalar(value: JsonValue): value is EditableScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

type ScalarLookup =
  | { kind: "scalar"; value: EditableScalar }
  | { kind: "absent" }
  | { kind: "not-scalar" };

/**
 * Walk a stored output to the declared leaf. `absent` is a real outcome (the
 * value routinely lives on one arm of a present/absent union), and a value
 * that is not a single scalar is named as such rather than stringified into a
 * field the operator could "correct" without understanding its shape.
 */
function scalarAtPath(output: JsonValue, fieldPath: string): ScalarLookup {
  let current: JsonValue = output;
  for (const part of fieldPath.split(".")) {
    if (!isJsonRecord(current) || !Object.hasOwn(current, part)) return { kind: "absent" };
    const next = current[part];
    if (next === undefined) return { kind: "absent" };
    current = next;
  }
  return isEditableScalar(current) ? { kind: "scalar", value: current } : { kind: "not-scalar" };
}

function displayScalar(value: EditableScalar): string {
  const text = String(value);
  return text.length === 0 ? "(empty)" : text;
}

/**
 * The run-level half of the edit policy. Same facts, same order, as the
 * kernel's `executeEditCheckpoint` refusal arms — this projection exists so
 * the rail can show the reason BEFORE a save is attempted, never so the
 * client can decide differently from the kernel.
 */
function contextEditingOf(
  authority: RunRecord,
  descriptor: RunDetailDescriptorView | undefined,
): ContextDataEditing {
  if (descriptor === undefined) {
    return {
      state: "locked",
      reason: `workflow ${authority.envelope.workflow} has no registered descriptor in this build`,
    };
  }
  const editData = descriptor.capabilities?.editData;
  if (editData === undefined || typeof editData === "boolean") {
    return { state: "locked", reason: "this workflow declares no correctable fields" };
  }
  if (runClaim(authority) !== undefined) {
    return {
      state: "locked",
      reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
        + "editing reopens when it parks or finishes",
    };
  }
  const { state } = authority.lifecycle;
  if (state !== "queued" && state !== "parked-gate") {
    return {
      state: "locked",
      reason: `run is ${state}; corrections apply only to a non-executing resumable run`,
    };
  }
  return { state: "editable", expectedVersion: authority.version };
}

type PendingCorrectionLookup =
  | { state: "none" }
  | { state: "pending"; value: EditableScalar; correctedAt: string }
  | { state: "not-scalar" };

function pendingCorrectionOf(
  authority: RunRecord,
  source: { nodeId: string; fieldPath: string },
): PendingCorrectionLookup {
  const pending = (authority.envelope.injected ?? []).find(
    (patch) => String(patch.nodeId) === source.nodeId && patch.fieldPath === source.fieldPath,
  );
  if (pending === undefined) return { state: "none" };
  if (!isEditableScalar(pending.value)) return { state: "not-scalar" };
  return { state: "pending", value: pending.value, correctedAt: pending.correctedAt };
}

/**
 * The provenance point that DATES a leaf, off the checkpoint that produced it.
 *
 * Exact path first, then the longest COVERING PREFIX. The prefix arm is not a
 * convenience: `task-provenance.ts` records at leaf granularity but a wrapper
 * value is dated through the prefix that covers it — D82's evidence receipt
 * resolves a transaction commit's output leaves the same way, through the
 * `output`/`proof` wrapper the checkpoint actually recorded. Longest wins so a
 * point recorded for `startsOn.value` beats one recorded for `startsOn`, which
 * is the more specific and therefore the more truthful observation.
 *
 * A path is a prefix only at a SEGMENT boundary: `starts` must never cover
 * `startsOn.value`, or a leaf would inherit a date from an unrelated field
 * whose name it merely begins with.
 */
function provenanceFor(
  stored: RunCheckpointRecord,
  fieldPath: string,
): FactProvenanceWire {
  let best: RunCheckpointRecord["provenance"][number] | undefined;
  for (const point of stored.provenance) {
    const path = String(point.path);
    if (path !== fieldPath && !fieldPath.startsWith(`${path}.`)) continue;
    if (best === undefined || path.length > String(best.path).length) best = point;
  }
  if (best === undefined) return {};
  return {
    observedAt: best.observedAt,
    source: best.source,
    ...(best.correctedAt === undefined ? {} : { correctedAt: best.correctedAt }),
  };
}

/**
 * One entry for a correctable field: the raw recorded scalar from the latest
 * compatible checkpoint plus any pending injected correction. `display` is
 * the already-projected detail value when the field also backs a detail —
 * the two views of the same leaf must not drift apart on the same row.
 */
function editableEntryOf(
  deps: RunDetailQueryDeps,
  row: RunFoldRecord,
  authority: RunRecord,
  label: string,
  source: { nodeId: string; fieldPath: string },
  display: string | undefined,
): ContextDataEntry {
  const stored = deps.authority.latestCheckpoint(
    row.queued.workflow,
    authority.envelope.itemId,
    source.nodeId,
  );
  if (stored === undefined) {
    return {
      label,
      valueRedacted: display === undefined ? "not recorded" : display,
      edit: {
        state: "locked",
        reason: `step "${source.nodeId}" has no stored checkpoint yet; a correction supersedes a recorded fact`,
      },
    };
  }
  // Dated once, for EVERY arm below: a locked row is as much a recorded fact
  // as an editable one, and "when was this observed" is the question the lock
  // makes more pressing rather than less.
  const provenance = provenanceFor(stored, source.fieldPath);
  const lookup = scalarAtPath(stored.output.value, source.fieldPath);
  if (lookup.kind === "absent") {
    return {
      label,
      valueRedacted: display === undefined ? "not recorded on this outcome" : display,
      edit: {
        state: "locked",
        reason: `the recorded outcome carries no ${source.fieldPath} — there is no stored value to correct`,
      },
      ...provenance,
    };
  }
  if (lookup.kind === "not-scalar") {
    return {
      label,
      valueRedacted: display === undefined ? "structured value" : display,
      edit: {
        state: "locked",
        reason: "not a single text/number value; structured output is corrected by a new run, not a field edit",
      },
      ...provenance,
    };
  }
  const pending = pendingCorrectionOf(authority, source);
  if (pending.state === "not-scalar") {
    return {
      label,
      valueRedacted: display === undefined ? displayScalar(lookup.value) : display,
      edit: {
        state: "locked",
        reason: "a pending correction holds a structured value; it applies when the run resumes",
      },
      ...provenance,
    };
  }
  return {
    label,
    valueRedacted: display === undefined ? displayScalar(lookup.value) : display,
    edit: {
      state: "editable",
      nodeId: source.nodeId,
      fieldPath: source.fieldPath,
      value: lookup.value,
      pendingCorrection: pending,
    },
    ...provenance,
  };
}

function buildContextDataPayload(
  deps: RunDetailQueryDeps,
  row: RunFoldRecord,
  authority: RunRecord,
): { runId: string; editing: ContextDataEditing; entries: ContextDataEntry[] } {
  const descriptor = deps.descriptors.resolve(row.queued.workflow);
  const editing = contextEditingOf(authority, descriptor);
  const editData = descriptor?.capabilities?.editData;
  const editFields = typeof editData === "object" ? editData.fields : [];
  const editByIdentity = new Map(
    editFields.map((field) => [`${String(field.nodeId)}\0${field.fieldPath}`, field]),
  );
  const specs = new Map((descriptor?.details ?? []).map((spec) => [spec.key, spec]));

  const entries: ContextDataEntry[] = [];
  const covered = new Set<string>();
  for (const [key, value] of Object.entries(row.details)) {
    const spec = specs.get(key);
    const display = typeof value === "string" ? value : JSON.stringify(value);
    if (spec === undefined) {
      // The key is real recorded data from a run that predates the current
      // descriptor's detail set; it stays served, and stays uneditable
      // because its field identity cannot be established.
      entries.push({
        label: key,
        valueRedacted: display,
        edit: {
          state: "locked",
          reason: "recorded under an earlier descriptor version; the current build does not know "
            + "this value's field identity",
        },
      });
      continue;
    }
    const identity = `${String(spec.source.nodeId)}\0${spec.source.fieldPath}`;
    if (!editByIdentity.has(identity)) {
      // Uneditable, and still DATED: this row has a real field identity, so
      // the checkpoint that produced it can date it. "You may not change this"
      // and "nobody knows when this was read" are unrelated facts, and the
      // rail must not imply the first causes the second.
      const stored = deps.authority.latestCheckpoint(
        row.queued.workflow,
        authority.envelope.itemId,
        String(spec.source.nodeId),
      );
      entries.push({
        label: spec.label,
        valueRedacted: display,
        edit: { state: "locked", reason: "not declared correctable by this workflow" },
        ...(stored === undefined ? {} : provenanceFor(stored, spec.source.fieldPath)),
      });
      continue;
    }
    covered.add(identity);
    entries.push(editableEntryOf(
      deps,
      row,
      authority,
      spec.label,
      { nodeId: String(spec.source.nodeId), fieldPath: spec.source.fieldPath },
      display,
    ));
  }
  for (const field of editFields) {
    const identity = `${String(field.nodeId)}\0${field.fieldPath}`;
    if (covered.has(identity)) continue;
    const stored = deps.authority.latestCheckpoint(
      row.queued.workflow,
      authority.envelope.itemId,
      String(field.nodeId),
    );
    // The Data section lists values the run TOUCHED (doc 03 §1.1(c)); a
    // declared-correctable field whose step never recorded is not among them.
    if (stored === undefined) continue;
    entries.push(editableEntryOf(
      deps,
      row,
      authority,
      field.label,
      { nodeId: String(field.nodeId), fieldPath: field.fieldPath },
      undefined,
    ));
  }
  return { runId: authority.envelope.runId, editing, entries };
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
