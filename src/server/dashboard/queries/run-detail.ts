/**
 * `RunDetailWire` header + the lazy sections Person Lookup needs (ref frontend-backend-integration
 * §3.3, §6.2): logs (from the notes stream) and the context data/attempts
 * slices. Sections whose owning service lands later (receipt in 2g, review/
 * people in 2h) are typed-absent through the wire's absence unions
 * or refused by name — never fabricated.
 * DCA3/D292 live captures use verified diagnostic authority and retain every
 * same-run bundle origin beside each unique artifact ref.
 *
 * Closed mappings this query owns (stated, not silent):
 * - terminal outcome → OutcomeWire result: `done→verified-done` (a done run's
 *   result IS factory-verified terminal authority, D110), `failed→failed`,
 *   `cancelled|discarded|superseded→cancelled`; an `interrupted` run keeps an
 *   ABSENT outcome ("recovery will requeue or settle it") because the landed
 *   enum has no arm that names it without claiming a verdict. **D238**: a
 *   `done` run whose own envelope asked for a dry run is a PREVIEW terminal and
 *   takes `partial` with `rehearsal: true` — the same verdict
 *   `buildRunEvidenceReceipt` derives for it, because `verified-done` names an
 *   independently verified REAL completion and a rehearsal wrote nothing.
 * - the gate's durable `gate_results` row → GateDecisionWire resolution
 *   (**D237**). NOT the span stream's `resolutionKey`, which the command
 *   service deliberately emits as the literal `resolved` for every gate: the
 *   verdict comes from D204's declared arm table over the row's own payload,
 *   and `resolvedBy`/`resolvedAt` come from the row the kernel wrote inside the
 *   resolving transaction (D202). Every way that read can fail to produce a
 *   verdict — no row, no declaration, an unlisted arm value, a declared outcome
 *   that is not an approve/reject verdict — renders the gate absent with the
 *   exact gap named, never coerced into a boolean.
 * - note level → NoteWire level: `error→error`, `warn|waiting→warning`,
 *   everything else `info`.
 * - task span outcome → timeline state: `done→done`, `failed→failed`,
 *   `skipped→skipped`, `interrupted→blocked`,
 *   `cancelled|discarded|superseded→cancelled`. `skipped` got its own arm on
 *   2026-08-04 (D123): it used to fold into `cancelled`, which names an act
 *   someone took, and the live exit run rendered a `condition-false` branch as
 *   "Cancelled". A skipped row now also carries the executor's recorded
 *   `not-run` reason, or an explicit statement that none was recorded.
 *   **D268**: this mapping is no longer owned here — it is `taskStateOf` in
 *   `../run-status.ts`, shared with the queue projector's pipeline chip, whose
 *   own copy used to answer `blocked` for the same three outcomes.
 *
 * Queue and detail share authority-only deriveRunStatus and panelKindOf.
 * Optional spans supply execution evidence; they never determine existence,
 * lifecycle, membership or envelope identity.
 */
import { availableSections, buildRunGate } from "./run-trust.js";
import { readRunCaptureAvailability } from "./run-captures.js";
import {
  RunDetailWireSchema,
  type RunDetailWire,
  type RunCaptureAvailabilityWire,
  type TimelineDuration,
  type TimelineStepWire,
} from "../../../domain/dashboard/run-detail.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { RunFoldRecord } from "../projectors/run-queue-projection.js";
import { resolveSubjectTitle } from "../projectors/run-subject-title.js";
import { deterministicUuid, nodeIdOfTaskSpanPath } from "../support.js";
import { deriveRunStatus, foldCategoryState, panelKindOf, taskStateOf, type TaskSpanOutcome } from "../run-status.js";
import {
  ProjectionDegradedError,
} from "../../failures.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "./run-detail-types.js";
import { requireCanonicalRun } from "./run-read.js";

export { availableSections } from "./run-trust.js";
export { buildRunSection, readRunSection } from "./run-sections.js";
export { createRunNoteScanCache, runNotePartitionScope } from "./run-logs.js";
export type { RunLogScanEntry, RunNoteScanEntry, RunNoteScanCache } from "./run-logs.js";
export type {
  RunDetailTrustDeps,
  RunDetailGateNodeView,
  RunDetailWriteContractView,
  RunDetailDataOriginView,
  RunDetailDescriptorView,
  RunDetailQueryDeps,
} from "./run-detail-types.js";

/**
 * ONE task span's own duration, from the executor's own two instants.
 *
 * `startedAt` and `endedAt` are the `span.started` / `span.ended` emissions of
 * the SAME `(attempt, spanPath)` identity, so this is the step's measurement
 * and not the gap between whatever two events happen to be adjacent in the
 * sorted timeline. Every way it can fail to be a number is named:
 *
 * - a span still in flight has no end;
 * - a span whose `span.started` never reached the fold (a projection tail
 *   seeded mid-run) has no start to subtract from — the run's queue instant
 *   would be a plausible substitute and a wrong one;
 * - an end that precedes its start is a clock anomaly, and clamping it to zero
 *   would report a real disagreement as a real measurement of nothing.
 */
function spanDuration(span: Readonly<{ startedAt?: string; endedAt?: string }>): TimelineDuration {
  if (span.endedAt === undefined) {
    return { state: "absent", reason: "this step has not ended; its span carries no end instant yet" };
  }
  if (span.startedAt === undefined) {
    return { state: "absent", reason: "no span.started was folded for this step, so it has no start instant to measure from" };
  }
  const started = Date.parse(span.startedAt);
  const ended = Date.parse(span.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return { state: "absent", reason: `this step's span instants are not both readable (${span.startedAt} → ${span.endedAt})` };
  }
  if (ended < started) {
    return { state: "absent", reason: `this step's span ended before it started (${span.startedAt} → ${span.endedAt}); the instants disagree` };
  }
  return { state: "present", ms: ended - started };
}

/* ── D225: the categorical timeline fold ─────────────────────────────────── */

type TimelineStepState = TimelineStepWire["state"];
/** D307 — the closed reason a member span recorded for not running. */
type TimelineNotRunReason = NonNullable<TimelineStepWire["members"][number]["notRunReason"]>;

/**
 * D307 — one span's not-run reason, and the CONTRADICTION that used to be
 * dropped on the floor beside it.
 *
 * Both readers below asked "is this fold skipped?" before reading the span's
 * `notRunReason`, so a span carrying a reason whose own outcome folds to `done`,
 * `failed` or anything else simply lost it: the strip drew a step that RAN, the
 * wire's own refinement never saw the pair (it refuses a reason on a member that
 * ran, and the reason had already been discarded), and authority's disagreement
 * with itself reached nobody. A span that says both "I did not run, for this
 * reason" and "I finished" is a recorder defect, and this projection refuses it
 * by name rather than picking the half that renders.
 *
 * The message names the node id, the outcome and the closed reason — all
 * repository-authored or closed vocabulary. No span path, trace id or run id:
 * this reaches the operator as an HTTP body.
 */
function spanNotRunReason(
  span: Readonly<{ outcome?: TaskSpanOutcome; notRunReason?: TimelineNotRunReason }> | undefined,
  nodeId: string | undefined,
): TimelineNotRunReason | undefined {
  const reason = span?.notRunReason;
  if (reason === undefined) return undefined;
  const state = taskStateOf(span?.outcome);
  if (state !== "skipped") {
    throw new ProjectionDegradedError(
      `${nodeId === undefined ? "a task span with no resolvable node" : `node "${nodeId}"`} recorded the `
      + `not-run reason "${reason}" and an outcome this projection folds to "${state}"; a span cannot both `
      + "have not run and have finished, and this projection will not choose which half to draw",
    );
  }
  return reason;
}

/**
 * D259 — WHERE a node with no span of its own got its fact, or why this build
 * refuses to say.
 *
 * A replayed node emits no spans by design (ref workflow-model §5.3) and this timeline
 * folds spans, so replay is invisible to it — which is how a terminal run
 * rendered `Identity check — pending, took 0s` one minute after the operator
 * approved that very gate (separations §9.22 item 3). The reader moves, exactly
 * as D144/D203/D204 moved it: the stored checkpoint is read, and NOTHING
 * fabricates a span.
 *
 * Three conditions, and each closes a way the claim could be false:
 *
 * 1. **The run is terminal `done`.** Only then did the executor visit every
 *    node, so "no span" cannot mean "the run stopped before reaching it". A
 *    failed or cancelled run keeps `pending` for exactly that reason: nodes
 *    after the stop never ran, and prior-run checkpoints sit under them.
 * 2. **A checkpoint exists at `(workflow, itemId, nodeId)`** — the SAME
 *    item-scoped read the executor's planner itself makes (ref workflow-model §5.7).
 * 3. **A DIFFERENT run wrote it.** A row this run wrote is evidence the node
 *    executed HERE, so calling that a replay would be a second wrong word; the
 *    honest arm for "executed, span not folded" (a pruned stream) is a
 *    different one, and this build does not claim it.
 *
 * Residual, stated rather than hidden: a node this run's branch excluded — or
 * whose declared `when` was false — while an EARLIER run of the same item did
 * execute it also lands here, because the executor's replay/skip decision is
 * durable nowhere this projection reads. The trigger that closes it is the
 * terminal result's own `not-run` reasons (D114) reaching this query.
 */
function replaySourceOf(
  deps: RunDetailQueryDeps,
  authority: RunRecord,
  nodeId: string,
): { attempt: number; claimGeneration?: number } | undefined {
  const { lifecycle } = authority;
  if (lifecycle.state !== "terminal" || lifecycle.outcome !== "done") return undefined;
  const stored = deps.authority.latestCheckpoint(
    authority.envelope.workflow,
    authority.envelope.itemId,
    nodeId,
  );
  if (stored === undefined) return undefined;
  if (stored.runId === authority.envelope.runId) return undefined;
  return {
    attempt: stored.attempt,
    ...(stored.claimGeneration === undefined ? {} : { claimGeneration: stored.claimGeneration }),
  };
}

/**
 * D225 — one wire step per descriptor-declared timeline category. A node's
 * state is its LATEST execution's state (a re-execution across a gate resume
 * is real history — it folds into the count, never into a duplicate segment);
 * its duration is the sum of every measured execution. A gate member with no
 * task spans reads its state off the run's own gate records.
 */
function buildTimelineSteps(
  timeline: NonNullable<RunDetailDescriptorView["timeline"]>,
  row: RunFoldRecord,
  runTerminal: boolean,
  replaySource: (nodeId: string) => { attempt: number; claimGeneration?: number } | undefined,
): TimelineStepWire[] {
  type SpanFold = RunFoldRecord["taskSpans"][number];
  const spansByNode = new Map<string, SpanFold[]>();
  for (const span of row.taskSpans) {
    const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
    if (nodeId === undefined) continue;
    const bucket = spansByNode.get(nodeId);
    if (bucket === undefined) spansByNode.set(nodeId, [span]);
    else bucket.push(span);
  }

  const memberOf = (node: Readonly<{ id: string; label: string }>): {
    label: string;
    state: TimelineStepState;
    durationMs?: number;
    executions: number;
    replayedFrom?: { attempt: number; claimGeneration?: number };
    notRunReason?: TimelineNotRunReason;
  } => {
    const executions = spansByNode.get(node.id) ?? [];
    if (executions.length === 0) {
      // A gate owns no task span; its category presence IS its state.
      if (row.openGates.some((gate) => gate.gate === node.id)) {
        return { label: node.label, state: "blocked", executions: 0 };
      }
      if (row.resolvedGates.some((gate) => gate.gate === node.id)) {
        return { label: node.label, state: "done", executions: 0 };
      }
      // D259 — no span of its own, and a stored fact this run replayed. The
      // arm is `replayed`, never `pending`, and it carries no duration: a
      // replay emits no span, so nothing measured it.
      const replayedFrom = replaySource(node.id);
      if (replayedFrom !== undefined) {
        return { label: node.label, state: "replayed", executions: 0, replayedFrom };
      }
      return { label: node.label, state: "pending", executions: 0 };
    }
    const ordered = [...executions].sort((a, b) =>
      (a.startedAt ?? a.endedAt ?? "").localeCompare(b.startedAt ?? b.endedAt ?? ""));
    const latest = ordered[ordered.length - 1];
    const state: TimelineStepState = taskStateOf(latest?.outcome);
    /*
     * D307 — the member's own closed not-run reason, off the LATEST execution's
     * span, so the strip can draw an operator-asserted node distinctly from an
     * omitted one. A span that recorded no reason contributes none: a member
     * whose reason authority does not hold says nothing rather than a likely
     * thing — and a span that recorded one beside a non-skipped outcome REFUSES
     * rather than losing it (`spanNotRunReason`).
     */
    const notRunReason = spanNotRunReason(latest, node.id);
    let ms = 0;
    let measured = false;
    for (const span of executions) {
      const duration = spanDuration(span);
      if (duration.state === "present") {
        ms += duration.ms;
        measured = true;
      }
    }
    return {
      label: node.label,
      state,
      ...(measured ? { durationMs: ms } : {}),
      executions: executions.length,
      ...(notRunReason === undefined ? {} : { notRunReason }),
    };
  };

  return timeline.map((category) => {
    const members = category.nodes.map(memberOf);
    const measured = members.filter((member) => member.durationMs !== undefined);
    const totalMs = measured.reduce((sum, member) => sum + (member.durationMs ?? 0), 0);
    const maxExecutions = Math.max(...members.map((member) => member.executions));
    return {
      label: category.label,
      state: foldCategoryState(members.map((member) => member.state), runTerminal),
      ...(measured.length > 0 ? { durationSec: Math.round(totalMs / 1000) } : {}),
      ...(maxExecutions >= 2 ? { executions: maxExecutions } : {}),
      members: members.map((member) => ({
        label: member.label,
        state: member.state,
        ...(member.durationMs === undefined ? {} : { durationSec: Math.round(member.durationMs / 1000) }),
        ...(member.replayedFrom === undefined ? {} : { replayedFrom: member.replayedFrom }),
        ...(member.notRunReason === undefined ? {} : { notRunReason: member.notRunReason }),
      })),
    };
  });
}

export function buildRunDetail(
  deps: RunDetailQueryDeps,
  runId: string,
  captures?: RunCaptureAvailabilityWire,
): RunDetailWire {
  const { row, authority } = requireCanonicalRun(deps, runId);
  const status = deriveRunStatus(authority);
  const descriptorView = deps.descriptors.resolve(authority.envelope.workflow);
  const omittedSteps = [...new Set(
    (authority.envelope.stepOmissions ?? []).map((entry) => String(entry.step)),
  )].sort();

  const timelineEvents: {
    at: string;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    notRun: { state: "absent"; reason: string } | { state: "present"; reason: "condition-false" | "branch-not-selected" | "operator-asserted" | "step-omitted" };
    durationMs: TimelineDuration;
    seed: string;
  }[] = [];
  /**
   * A gate's timeline events are not task spans, so the executor measures no
   * duration for them. The wait a park represents is a real fact and it is a
   * different one — it belongs to the gate, not to a step — and reporting it
   * in the step column would put a human's thinking time under a node's name.
   */
  const gateDuration = {
    state: "absent",
    reason: "a gate is not a task span; the executor measures no duration for it",
  } as const;
  for (const span of row?.taskSpans ?? []) {
    const state = taskStateOf(span.outcome);
    // A skip is not a cancellation, and a skip WITHOUT a recorded reason is
    // not a skip with a guessed one. Both absences stay named — and a reason
    // recorded beside a non-skipped outcome refuses here too, through the one
    // helper both timeline readers share.
    const spanReason = spanNotRunReason(span, nodeIdOfTaskSpanPath(span.spanPath));
    const notRun = state !== "skipped"
      ? { state: "absent", reason: "this step ran" } as const
      : spanReason === undefined
        ? { state: "absent", reason: "this step did not run; its span recorded no reason" } as const
        : { state: "present", reason: spanReason } as const;
    // The seed carries ref dashboard-surfaces §1.1's whole span identity. `<trace>/<node>#<taskAttempt>`
    // repeats verbatim across RUN attempts, so a node re-run after a recovered
    // failure yields two genuinely distinct folded spans that share a path — both
    // are real history and both must render, so the attempt has to reach the id.
    timelineEvents.push({
      at: span.startedAt ?? span.endedAt ?? authority.envelope.enqueuedAt,
      label: span.name,
      state,
      notRun,
      durationMs: spanDuration(span),
      seed: `task:${String(span.attempt)}:${span.spanPath}`,
    });
  }
  const gateNotRun = { state: "absent", reason: "a gate is not a workflow step" } as const;
  for (const gate of row?.openGates ?? []) {
    timelineEvents.push({ at: gate.openedAt, label: `gate:${gate.gate}`, state: "blocked", notRun: gateNotRun, durationMs: gateDuration, seed: `gate-open:${gate.gate}:${gate.openedAt}` });
  }
  for (const gate of row?.resolvedGates ?? []) {
    timelineEvents.push({ at: gate.resolvedAt, label: `gate:${gate.gate}`, state: "done", notRun: gateNotRun, durationMs: gateDuration, seed: `gate-resolved:${gate.gate}:${gate.resolvedAt}` });
  }
  timelineEvents.sort((a, b) => a.at.localeCompare(b.at) || a.seed.localeCompare(b.seed));
  /**
   * D258 — the OCCURRENCE ordinal, appended read-forward.
   *
   * `seed` is the whole span identity this build can emit — and a run written
   * before D214 taught the span path its claim generation can hold two
   * executions of one node at ONE `(attempt, spanPath)`: a gate park and its
   * resume are two executions inside one attempt, and an `always-rerun` node
   * re-executes across that boundary by design. Those lines are durable
   * history and are never rewritten (ref dashboard-surfaces §2.3), so the id is disambiguated
   * at the FOLD: the first execution at a seed keeps the id it has always had,
   * and each further one appends `~<n>`. Read forward exactly as D214's own
   * key is — an ordinal of 1 appends nothing, so every id this projection has
   * ever derived stays byte-identical — while the second and later executions
   * become the two distinct rows they truly were, instead of one duplicate id
   * that `RunDetailWireSchema` refuses and that took the whole workflow's
   * archive down with it (separations §9.22 item 6).
   */
  const seedOccurrences = new Map<string, number>();
  const timelineWire = timelineEvents.map((event, index) => {
    const occurrence = (seedOccurrences.get(event.seed) ?? 0) + 1;
    seedOccurrences.set(event.seed, occurrence);
    const seed = occurrence === 1 ? event.seed : `${event.seed}~${String(occurrence)}`;
    return {
      noteId: deterministicUuid(`timeline:${runId}:${seed}`),
      sequence: index,
      at: event.at,
      label: event.label,
      state: event.state,
      notRun: event.notRun,
      durationMs: event.durationMs,
    };
  });

  const gate = buildRunGate(deps, runId, row, authority);

  const { lifecycle } = authority;
  /**
   * D238 — a PREVIEW terminal is not a verified completion.
   *
   * The run's own envelope is the authority for "this was a rehearsal": it is
   * retained at plan time and is the same fact `buildRunEvidenceReceipt` checks
   * against the stored terminal row's preview schema hash (D210). A `done` run
   * that asked for a dry run reached its preview terminal — it staged nothing
   * durable, wrote no intent, fenced nothing and committed nothing — so the
   * result it may wear is the one the receipt derives for it, `partial`, and
   * never `verified-done`.
   */
  const rehearsed = lifecycle.state === "terminal"
    && lifecycle.outcome === "done"
    && authority.envelope.dryRun;
  /**
   * D307 — the same rule for an OMITTED step, for the same reason. A run whose
   * operator omitted a step read that step from a typed form instead of a
   * system: nothing verified those values, so the run may not wear
   * `verified-done` either. It is `partial`, which is exactly what its receipt
   * derives for it (its omitted-step warning is load-bearing). It carries no
   * `rehearsal` marker — that word names a dry run, and an omitted step in a
   * REAL run is a different fact the panel must not blur into it.
   */
  const omitted = lifecycle.state === "terminal"
    && lifecycle.outcome === "done"
    && omittedSteps.length > 0;
  const outcome = lifecycle.state === "terminal"
    ? lifecycle.outcome === "interrupted"
      ? { state: "absent", reason: "run interrupted; ref write-safety recovery will requeue or settle it" }
      : {
        state: "terminal",
        result: rehearsed || omitted
          ? "partial"
          : ({ done: "verified-done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", superseded: "cancelled" } as const)[lifecycle.outcome],
        completedAt: lifecycle.endedAt,
        ...(rehearsed ? { rehearsal: true } : {}),
      }
    : { state: "absent", reason: `run is ${status}` };

  return RunDetailWireSchema.parse({
    runId,
    rowRevision: authority.version,
    panelKind: panelKindOf(authority.envelope.shape),
    header: {
      runId,
      traceId: authority.envelope.traceId,
      workflowId: authority.envelope.workflow,
      ...(row === undefined ? {} : { actorId: row.queued.actorId }),
      /**
       * The SAME title the queue row shows, through the same resolver (ref dashboard-surfaces
       * §1.2): the composed start-input title, replaced by the subject's name
       * once this run has resolved one, with the operator's own name winning
       * over both. Two surfaces naming one run two ways is the divergence this
       * doc's "one projection" rule exists to prevent, and the row and the
       * panel it opens are the pair an operator sees side by side.
       */
      title: authority.displayName
        ?? resolveSubjectTitle(
          descriptorView?.subjectProjection,
          { workflowId: authority.envelope.workflow, itemId: authority.envelope.itemId },
          deps.authority,
        )
        ?? row?.queued.title ?? authority.envelope.runId,
      status,
      attempt: authority.envelope.attempt,
    },
    timeline: {
      events: timelineWire,
      // D225: absent only when no registered descriptor can say what the
      // graph's shape is (a replayed historical workflow) — the client then
      // keeps the per-event strip, exactly as it does for pre-D225 archives.
      ...(descriptorView?.timeline === undefined || row === undefined
        ? {}
        : {
          steps: buildTimelineSteps(
            descriptorView.timeline,
            row,
            authority.lifecycle.state === "terminal",
            (nodeId) => replaySourceOf(deps, authority, nodeId),
          ),
        }),
    },
    gate,
    outcome,
    context: {
      // Every done task recorded provenance-validated data (1f mandate); the
      // evidence service is 2g, so its count is genuinely zero today.
      dataFacts: row?.taskSpans.filter((span) => span.outcome === "done").length ?? 0,
      evidenceFacts: 0,
      attempts: authority.envelope.attempt,
    },
    ...(captures === undefined ? {} : { captures }),
    /*
     * D307 — the run envelope's own list, by step KEY. It is read from the
     * envelope and never re-derived from spans: a step whose every node happens
     * to have been skipped for some other reason is not an omitted step, and
     * only the envelope says what the operator chose at start. The typed facts
     * beside each key stay in authority.
     */
    ...(omittedSteps.length === 0 ? {} : { omittedSteps }),
    availableSections: availableSections(row, authority, deps.trust, captures),
  });
}

/** The live route adds async capture verification; Archive's synchronous `buildRunDetail` freeze does not inspect that authority. */
export async function readRunDetail(
  deps: RunDetailQueryDeps,
  runId: string,
  signal?: AbortSignal,
): Promise<RunDetailWire> {
  const captures = await readRunCaptureAvailability(deps, runId, signal);
  return buildRunDetail(deps, runId, captures);
}
