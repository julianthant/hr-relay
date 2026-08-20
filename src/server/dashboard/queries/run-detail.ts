/**
 * `RunDetailWire` header + the lazy sections Person Lookup needs (ref frontend-backend-integration
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
 */
import { z } from "zod";
import type { JsonValue } from "../../../domain/canonical-json.js";
import { localDatePart } from "../../../domain/clock.js";
import { MatchIdentityOutputSchema } from "../../../domain/contracts/separations/match-identity.js";
import type { IdentityEvidencePacket } from "../../../domain/separations/identity-evidence.js";
import {
  FailureDetailWireSchema,
  IdentityGateDetailWireSchema,
  ParkedWriteDetailWireSchema,
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
  type TimelineDuration,
  type TimelineStepWire,
} from "../../../domain/dashboard/run-detail.js";
import type { WriteBindingProof, WriteIntentRecord } from "../../../domain/write-safety.js";
import type { ProofShape } from "../../../validation/proof-shape.js";
import type { GateResultRecord } from "../../../domain/gates.js";
import { evidenceLeaves } from "../../../domain/trust/evidence-classification.js";
import { findGateDecision } from "../../../domain/trust/gate-decisions.js";
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
import { resolveSubjectTitle } from "../projectors/run-subject-title.js";
import { deterministicUuid, nodeIdOfTaskSpanPath } from "../support.js";

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
/**
 * The gate facts the identity-gate section needs, derived from the descriptor by
 * the composition rather than re-derived here.
 *
 * `dependsOn` is what locates the packet: the gate's evidence is the stored
 * output of the node the gate WAITS ON, which is a graph fact, so nothing here
 * hard-codes a node name. `resultSchemaHash` is the descriptor's own gate-schema
 * identity — the exact value the kernel will demand on a `resolve-gate` payload
 * — served so a surface never computes it.
 */
export interface RunDetailGateNodeView {
  readonly nodeId: string;
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly resultSchemaHash: string;
}

/**
 * ONE transaction node's commit contract, in the shape ref write-safety §4.1's
 * confirmed-present resolution needs (D245).
 *
 * `proofSchemaHash` is `deriveSchemaHash(completion.proofSchema, "output")` —
 * byte for byte the value `resolvePresent` compares an incoming
 * `proof.schemaHash` against, so a surface that echoes it back cannot be
 * refused for naming a schema this build does not have. `proof` is the same
 * schema described as a field list, or the named reason it cannot be.
 */
export interface RunDetailWriteContractView {
  /** The commit task the intent's `taskId` names. */
  readonly commitTaskId: string;
  readonly completionKind: "receipt" | "save-verify" | "upload-verify";
  readonly proofSchemaHash: string;
  readonly proof: ProofShape;
}

/**
 * D252 — one graph node, in the shape the Data rail's origin line needs.
 *
 * Derived at the composition root beside `gateNodes` and `writeContracts`, for
 * the reason those two state: this directory never reaches the descriptor
 * builders or the module's store list, so a query that re-derived a node's
 * label, a task's effect or a freshness precedence would be a second copy of a
 * declaration the runtime already owns.
 *
 * `dir` is the node's own task EFFECT, not an inference: a task node runs a
 * `read` contract and a transaction node's sink is a `commit`. `system` is the
 * driver system of the store that implements the task — absent for a headless
 * store, which owns none. `freshness` is pre-resolved per field path through
 * `resolveFreshnessBound`, already in the wire's shape (`unbounded` rather than
 * an `Infinity` that `JSON.stringify` would flatten to `null`); a path with no
 * entry has no declared bound, and a `prepare`/`commit` contract declares no
 * policy at all.
 */
export interface RunDetailDataOriginView {
  readonly nodeId: string;
  readonly step: string;
  readonly dir: "read" | "write";
  readonly system?: string;
  readonly freshness?: readonly Readonly<{
    fieldPath: string;
    maxAge: number | "unbounded";
    override: "forbidden" | "audited";
  }>[];
  /** Commit nodes this node's facts can statically reach (ref workflow-model §5.5). */
  readonly feeds: readonly Readonly<{ nodeId: string; label: string }>[];
}

/**
 * What this query reads off a descriptor. `details` was a member until D254:
 * the Context rail joined the retired `span.patched` fold to the descriptor's
 * declared detail specs, and with the fold gone the rail's rows are exactly
 * `capabilities.editData.fields` that recorded a checkpoint. The descriptor
 * still DECLARES `details` — the evidence receipt's mandatory-leaf set, the
 * data-origin bound and the Explorer's field census all read it — this query
 * simply no longer does.
 */
export interface RunDetailDescriptorView {
  /** Ref dashboard-surfaces §1.2: where the RUN resolves the subject's name, if it ever does. */
  readonly subjectProjection?: Readonly<{ nodeId: string; fieldPath: string }>;
  /**
   * D225 — the descriptor's factory-derived categorical timeline (declared
   * categories, or the one-per-node default). Optional in the VIEW only
   * because a fixture may omit it; the registry's descriptors always carry it,
   * and an absent value serves no `steps` (the client then renders events).
   */
  readonly timeline?: readonly Readonly<{
    label: string;
    nodes: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  /** Absent for a descriptor with no gate node; empty is the same answer. */
  readonly gateNodes?: readonly RunDetailGateNodeView[];
  /**
   * D245 — one entry per TRANSACTION node, carrying what ref write-safety §4.1's
   * confirmed-present resolution has to satisfy for that node's commit
   * contract. Derived by the composition root beside `gateNodes` and for the
   * same stated reason: this directory never reaches the descriptor builders,
   * and a query that re-derived a schema hash or re-walked a proof schema
   * would be a second copy of the contract's identity.
   *
   * Absent for a descriptor with no transaction node; empty is the same
   * answer, and a parked run naming a task no entry covers gets a NAMED
   * unavailable reason rather than a form.
   */
  readonly writeContracts?: readonly RunDetailWriteContractView[];
  /**
   * D252 — one entry per node that can produce a Data-section value. Optional
   * in the VIEW only because a fixture may omit it; the registry's descriptors
   * always carry it, and an absent entry serves an entry with no origin block,
   * which is the honest "this build cannot attribute this value".
   */
  readonly dataOrigins?: readonly RunDetailDataOriginView[];
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
    /** Ref workflow-model §5.7's "latest compatible attempt wins" read, for edit values. */
    latestCheckpoint(
      workflowId: string,
      itemId: string,
      nodeId: string,
    ): RunCheckpointRecord | undefined;
    /**
     * Ref write-safety §4.1: the durable `write_intents` row a `parked-write` run names.
     * Read at REQUEST time, never folded into the projection — the intent is
     * the write-safety authority, and a resolution CASes against the exact
     * generation this read returned. A stale copy would let a browser resolve
     * a generation recovery has since advanced.
     */
    getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;
    /**
     * D237: every gate this run resolved, oldest first — the SAME
     * `authority.gateResults.listByRun` read D204 gave the receipt. The panel
     * and the receipt therefore cannot disagree about who answered a gate, and
     * the span stream (whose `resolutionKey` is the literal `resolved`) is not
     * consulted for the verdict at all.
     */
    listGateResults(runId: string): readonly GateResultRecord[];
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
 * D237 — what a SETTLED gate's panel says: approved or rejected, by whom, when.
 *
 * The verdict is read from the gate's own durable `gate_results` row through
 * D204's declared arm table, which is the same derivation the evidence receipt
 * uses — so the panel and the receipt cannot disagree about a human decision.
 * The span stream is deliberately NOT the source: the command service emits
 * `resolutionKey: "resolved"` for every gate (the one key that is true without
 * a display vocabulary), so a wire arm keyed on it was structurally unreachable
 * and every settled gated run's panel said the gate was absent — separations
 * §9.17 item 7(a).
 *
 * Every way this read can fail to produce a verdict is a NAMED absence, not a
 * coerced one. That is the split with the receipt, and it is deliberate: the
 * receipt is the durable artifact and REFUSES to derive at all when a gate is
 * undeclared or stores an arm value nobody declared (D204), while the panel
 * must still render the run it is explaining — so it states the exact gap in
 * the reason an operator reads instead of taking the surface down. Neither ever
 * guesses the word.
 */
function settledGateWire(
  runId: string,
  workflowId: string,
  stored: GateResultRecord | undefined,
  folded: RunFoldRecord["resolvedGates"][number] | undefined,
): unknown {
  if (stored === undefined) {
    return folded === undefined
      ? { state: "absent", reason: "this run declares no operator gate" }
      : {
        state: "absent",
        reason: `this run's span stream recorded gate ${folded.gate} resolved at ${folded.resolvedAt}, `
          + "and authority holds no gate result row for it — the decision cannot be attributed to anyone",
      };
  }
  const gateId = String(stored.gateId);
  const declaration = findGateDecision(workflowId, gateId);
  if (declaration === undefined) {
    return {
      state: "absent",
      reason: `gate ${gateId} of ${workflowId} has no declared decision in `
        + "src/domain/trust/gate-decisions.ts, so this build cannot say what its stored answer means",
    };
  }
  const leaves = evidenceLeaves(stored.result.value);
  const decided = leaves.find((leaf) => leaf.path === declaration.decisionPath);
  if (decided === undefined) {
    return {
      state: "absent",
      reason: `gate ${gateId} stored no leaf at its declared decision path "${declaration.decisionPath}" `
        + `(it stored: ${leaves.map((leaf) => leaf.path).join(", ")})`,
    };
  }
  const arm = declaration.arms.find((candidate) => candidate.value === decided.value);
  if (arm === undefined) {
    return {
      state: "absent",
      reason: `gate ${gateId} stored ${JSON.stringify(decided.value)} at "${declaration.decisionPath}" and no `
        + `declared arm matches it (declared: ${declaration.arms.map((candidate) => candidate.value).join(", ")})`,
    };
  }
  if (arm.outcome !== "approved" && arm.outcome !== "rejected") {
    return {
      state: "absent",
      reason: `gate ${gateId} resolved as ${arm.outcome}, which is not an approve/reject verdict`,
    };
  }
  return {
    state: "resolved",
    gateId: deterministicUuid(`gate:${runId}:${gateId}`),
    label: gateId,
    resolution: arm.outcome,
    resolvedBy: stored.resolvedBy,
    resolvedAt: stored.resolvedAt,
    revision: 2,
  };
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
): readonly ("logs" | "receipt" | "context-data" | "context-attempts" | "failure" | "parked-write" | "identity-gate")[] {
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
    /*
     * Every `parked-gate` run advertises the section, and the payload is a wire
     * RESOURCE: a run parked on a gate whose evidence node stored no identity
     * packet answers `missing` with the reason, exactly as `receipt` does for a
     * composition without the trust seam. Advertising only for gates this query
     * can fully serve would need the descriptor here, and would make "no gate
     * section" indistinguishable from "the packet is gone" — which is the
     * absence-versus-failure conflation this program bans.
     */
    ...(lifecycle.state === "parked-gate" ? (["identity-gate"] as const) : []),
  ];
}

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

/** Same closed mapping the per-event fold uses; one vocabulary, two shapes. */
const TASK_OUTCOME_STEP = {
  done: "done", failed: "failed", cancelled: "cancelled", discarded: "cancelled",
  skipped: "skipped", interrupted: "blocked", superseded: "cancelled",
} as const;

/**
 * Fold the member node states into ONE category state. Precedence tells the
 * truth loudest-first: a failure anywhere in the category is the category's
 * fact; a gate waiting beats everything but a failure; live work beats a
 * cancellation record. The last arm is the only judgement call: a category
 * with some members executed and the rest never started is IN PROGRESS on a
 * live run (the executor is between two of its nodes) and is rendered
 * `pending` on a terminal one — the run stopped elsewhere and the members that
 * never ran never ran; the member list carries the exact breakdown either way.
 */
function foldCategoryState(states: readonly TimelineStepState[], runTerminal: boolean): TimelineStepState {
  if (states.includes("failed")) return "failed";
  if (states.includes("blocked")) return "blocked";
  if (states.includes("active")) return "active";
  if (states.includes("cancelled")) return "cancelled";
  if (states.every((state) => state === "pending")) return "pending";
  if (states.every((state) => state === "replayed")) return "replayed";
  // D259 — a category where something executed is a category that RAN; a
  // replayed member is settled work, so it never holds the fold back. Only a
  // category whose members ALL replayed is `replayed`, and the member list
  // carries the breakdown in every mixed case.
  if (states.every((state) => state === "done" || state === "skipped" || state === "replayed")) {
    return states.includes("done") ? "done" : states.includes("replayed") ? "replayed" : "skipped";
  }
  return runTerminal ? "pending" : "active";
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
    const state: TimelineStepState = latest?.outcome === undefined
      ? "active"
      : TASK_OUTCOME_STEP[latest.outcome];
    let ms = 0;
    let measured = false;
    for (const span of executions) {
      const duration = spanDuration(span);
      if (duration.state === "present") {
        ms += duration.ms;
        measured = true;
      }
    }
    return { label: node.label, state, ...(measured ? { durationMs: ms } : {}), executions: executions.length };
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
      })),
    };
  });
}

export function buildRunDetail(deps: RunDetailQueryDeps, runId: string): RunDetailWire {
  const { row, authority } = requireRun(deps, runId);
  const status = statusOf(row, authority);
  const descriptorView = deps.descriptors.resolve(row.queued.workflow);

  const timelineEvents: {
    at: string;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    notRun: { state: "absent"; reason: string } | { state: "present"; reason: "condition-false" | "branch-not-selected" };
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
    // The seed carries ref dashboard-surfaces §1.1's whole span identity. `<trace>/<node>#<taskAttempt>`
    // repeats verbatim across RUN attempts, so a node re-run after a recovered
    // failure yields two genuinely distinct folded spans that share a path — both
    // are real history and both must render, so the attempt has to reach the id.
    timelineEvents.push({
      at: span.startedAt ?? span.endedAt ?? row.queued.ts,
      label: span.name,
      state,
      notRun,
      durationMs: spanDuration(span),
      seed: `task:${String(span.attempt)}:${span.spanPath}`,
    });
  }
  const gateNotRun = { state: "absent", reason: "a gate is not a workflow step" } as const;
  for (const gate of row.openGates) {
    timelineEvents.push({ at: gate.openedAt, label: `gate:${gate.gate}`, state: "blocked", notRun: gateNotRun, durationMs: gateDuration, seed: `gate-open:${gate.gate}:${gate.openedAt}` });
  }
  for (const gate of row.resolvedGates) {
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
  } else {
    gate = settledGateWire(
      runId,
      authority.envelope.workflow,
      deps.authority.listGateResults(runId).at(-1),
      lastResolved,
    );
  }

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
  const outcome = lifecycle.state === "terminal"
    ? lifecycle.outcome === "interrupted"
      ? { state: "absent", reason: "run interrupted; ref write-safety recovery will requeue or settle it" }
      : {
        state: "terminal",
        result: rehearsed
          ? "partial"
          : ({ done: "verified-done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", superseded: "cancelled" } as const)[lifecycle.outcome],
        completedAt: lifecycle.endedAt,
        ...(rehearsed ? { rehearsal: true } : {}),
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
          { workflowId: row.queued.workflow, itemId: authority.envelope.itemId },
          deps.authority,
        )
        ?? row.queued.title,
      status,
      attempt: row.attempt,
    },
    timeline: {
      events: timelineWire,
      // D225: absent only when no registered descriptor can say what the
      // graph's shape is (a replayed historical workflow) — the client then
      // keeps the per-event strip, exactly as it does for pre-D225 archives.
      ...(descriptorView?.timeline === undefined
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
  "parked-write", "identity-gate",
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
    // (ref dashboard-surfaces §1.1), joined back to their declaring specs for field identity;
    // the descriptor's editData fields extend them with the raw checkpoint
    // scalars a correction targets (ref data-intake-and-edit-data §6, 2i-C).
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

  if (section === "identity-gate") {
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: buildIdentityGatePayload(deps, row, authority),
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

/* ── the parked-write section (ref write-safety §4.1) ──────────────────────────────── */

/**
 * The binding proof's subject. A `subject-match` proof pins `expected` and
 * `observed` as canonically identical — its own `superRefine` refuses any
 * proof where they are not — so `expected` IS the fact, not half of it.
 *
 * The evidence is copied, not re-shaped: `SubjectEvidenceSchema` is already the
 * display-safe form ref write-safety binds a write against, and every arm of it is a
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
 * WHAT A CONFIRMED-PRESENT RESOLUTION MUST CARRY (D245, ref write-safety §4.1).
 *
 * `resolvePresent` refuses any proof whose `schemaHash` is not
 * `deriveSchemaHash(node.commit.uses.writeSafety.completion.proofSchema)` and
 * then parses the value through that exact schema. This wire served neither,
 * so the present arm was drawn DISABLED on every parked run in the build —
 * a fenced write that DID land could only be recorded as absent, which is a
 * durable lie, or left parked forever.
 *
 * Everything here is DERIVED and nothing is re-derived: the hash and the field
 * list are the composition root's `writeContracts` view, computed from the
 * descriptor beside `gateNodes` and for the same stated reason — this directory
 * never reaches the descriptor builders, and a query that recomputed a schema
 * hash would be a second copy of the contract's identity.
 *
 * Every failure is a NAMED `unavailable` reason rather than a throw, and that
 * split is deliberate: the checks above this one throw because a parked run
 * whose intent authority cannot produce is a storage fault, while a build that
 * cannot describe a proof is a build limitation — the panel must still render,
 * and the confirmed-ABSENT arm must still be reachable, for a run whose
 * workflow this build no longer registers.
 */
function parkedWriteProofContract(
  deps: RunDetailQueryDeps,
  authority: RunRecord,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
): unknown {
  const unavailable = (reason: string): unknown => ({ state: "unavailable", reason });
  const workflow = authority.envelope.workflow;
  const descriptor = deps.descriptors.resolve(workflow);
  if (descriptor === undefined) {
    return unavailable(
      `workflow ${workflow} has no registered descriptor in this build, so the proof this write would `
      + "have to carry cannot be stated. Recording it PRESENT is unavailable until the build that "
      + "declares this workflow is running (ref write-safety §4.1, D136).",
    );
  }
  const contract = (descriptor.writeContracts ?? [])
    .find((candidate) => candidate.commitTaskId === intent.taskId);
  if (contract === undefined) {
    return unavailable(
      `${workflow} declares no transaction node committing ${intent.taskId} in this build, so there is no `
      + "commit contract to take a proof for. Recording it PRESENT is unavailable until that node is back "
      + "— ref write-safety §4.1's `transaction-node` check would refuse the resolution for the same reason.",
    );
  }
  if (contract.proof.state === "undescribable") {
    return unavailable(
      `${contract.commitTaskId}'s completion proof cannot be rendered as a form by this build: `
      + `${contract.proof.reason}. Nothing here will guess at a shape the kernel would then refuse — `
      + "record the absence instead, or extend the proof describer.",
    );
  }
  return {
    state: "served",
    commitTaskId: contract.commitTaskId,
    completionKind: contract.completionKind,
    schemaHash: contract.proofSchemaHash,
    fields: contract.proof.fields,
  };
}

/**
 * The two typed resolutions, both always served (ref write-safety §4.1, ref frontend-backend-integration §8.5).
 *
 * Serving only one would be this query deciding what the operator's look at
 * the target system is going to find, and there is no third arm on purpose:
 * ref write-safety is explicit that no "force done" or "retry anyway" endpoint exists.
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

/**
 * The identity-approval gate section (ref write-safety §14.4).
 *
 * Everything is DERIVED and nothing is minted. The packet is the stored output
 * of the node the gate waits on — located through the descriptor's `dependsOn`,
 * so no node name is hard-coded — and the digest is the one that node stored
 * beside it, which is the value an approval must carry. `missing` is a real
 * answer with a reason: a run parked on a gate this composition cannot describe
 * says so rather than serving a half panel an operator could act on.
 */
function buildIdentityGatePayload(
  deps: RunDetailQueryDeps,
  row: RunFoldRecord,
  authority: RunRecord,
): unknown {
  const { lifecycle } = authority;
  const runId = authority.envelope.runId;
  if (lifecycle.state !== "parked-gate") {
    throw new Error(`run ${runId} advertises an identity-gate section while it is ${lifecycle.state}`);
  }
  const missing = (reason: string): unknown => ({ state: "missing", reason });
  const descriptor = deps.descriptors.resolve(authority.envelope.workflow);
  if (descriptor === undefined) {
    return missing(`workflow ${authority.envelope.workflow} has no registered descriptor in this build`);
  }
  const gate = (descriptor.gateNodes ?? [])
    .find(({ nodeId }) => nodeId === String(lifecycle.gateId));
  if (gate === undefined) {
    return missing(
      `${authority.envelope.workflow} declares no gate "${String(lifecycle.gateId)}"; this build cannot `
      + "describe the decision this run is parked on",
    );
  }
  const evidence = gate.dependsOn
    .map((nodeId) => deps.authority.latestCheckpoint(row.queued.workflow, authority.envelope.itemId, nodeId))
    .flatMap((stored) => {
      if (stored === undefined) return [];
      // `stored.output` is the schema-BOUND envelope; the packet is its value.
      const parsed = MatchIdentityOutputSchema.safeParse(stored.output.value);
      return parsed.success ? [parsed.data] : [];
    });
  if (evidence.length !== 1) {
    return missing(
      `gate "${gate.nodeId}" waits on ${String(gate.dependsOn.length)} node(s), and `
      + `${String(evidence.length)} of them hold an identity decision packet; exactly one must, or the `
      + "packet this gate is about is not identifiable",
    );
  }
  const found = evidence[0];
  if (found === undefined) throw new Error(`gate "${gate.nodeId}" evidence disappeared mid-projection`);
  const { packet, evidenceDigest } = found;
  const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
  const options = packet.approvableEids.map((eid) => ({
    eid,
    chosenFrom: eid === packet.emplId ? "checked" : eid === nameSearchEid ? "name-search" : "manual",
    displayName: eid === packet.emplId
      ? packet.ucpathName
      : eid === nameSearchEid && packet.nameSearch.status === "resolved"
        ? packet.nameSearch.candidate.name
        : `EID ${eid}`,
    origin: eid === packet.emplId
      ? `the EID this run checked (${packet.emplIdSource})`
      : eid === nameSearchEid
        ? `a UCPath search on the document's name "${packet.documentName}" resolved this person`
        : `a UCPath search on the document's name "${packet.documentName}" listed this EID among its candidates`,
  }));
  return {
    state: "available",
    value: IdentityGateDetailWireSchema.parse({
      runId,
      gateId: gate.nodeId,
      label: gate.label,
      parkedAt: lifecycle.parkedAt,
      resumeAt: lifecycle.resumeAt,
      expectedVersion: authority.version,
      resultSchemaHash: gate.resultSchemaHash,
      evidenceDigest,
      packet,
      options,
      approvalShape: packet.approvalShape,
      actions: identityGateActions(authority, packet),
    }),
  };
}

/**
 * The two typed resolutions, always both served.
 *
 * Which one is right is a question only the operator's look at the evidence can
 * answer, so hiding either would be this wire pre-deciding it — the same
 * argument the parked-write section makes. What DOES change with the risk is
 * the ceremony: `approvalShape` says whether approval is one click or an
 * explicit choice, and the approve action's `confirm` block names the
 * disagreements the operator is approving over.
 */
function identityGateActions(authority: RunRecord, packet: IdentityEvidencePacket): unknown[] {
  const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
  return [
    {
      key: "resolve-gate-approved",
      label: packet.approvalShape === "one-click" ? "Approve this person" : "Approve the chosen EID",
      detail: packet.approvalShape === "type-the-eid"
        ? "This decision is ambiguous: the EID must be typed, not selected."
        : packet.approvalShape === "choose-a-candidate"
          ? "Choose which candidate the separation document means."
          : "One unambiguous candidate, one active job, and the names agree.",
      intent: "primary",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: authority.version,
      resolution: "approved",
      confirm: {
        title: "Approve this identity",
        body: disagreements.length === 0
          ? `Every compared field agreed for ${packet.documentName} on separation document `
            + `${packet.documentNumber}. Approving binds the rest of this separation to this person.`
          : `${String(disagreements.length)} field(s) DISAGREE: ${
            disagreements.map(({ field }) => field).join(", ")
          }. Approving files the rest of this separation against this person anyway.`,
        confirmLabel: "Approve",
        tone: disagreements.length === 0 ? "neutral" : "destructive",
      },
    },
    {
      key: "resolve-gate-rejected",
      label: "Reject — this is not the right person",
      detail: "Ends the run with the reason recorded. Nothing downstream runs.",
      intent: "destructive",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: authority.version,
      resolution: "rejected",
      confirm: {
        title: "Reject this identity",
        body: `The run ends and records why. Separation document ${packet.documentNumber} stays untouched.`,
        confirmLabel: "Reject",
        tone: "neutral",
      },
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
    proofContract: parkedWriteProofContract(deps, authority, intent),
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
 * The three provenance leaves the Data section serves (ref workflow-model §5.6).
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

/**
 * D252 — the origin/freshness half of an entry, projected onto the wire's
 * shape. Both are omitted together when the descriptor names no origin for
 * the entry's node: `ContextDataSectionSchema` refuses a bound with no step to
 * attribute it to.
 */
type ContextDataOriginWire = {
  origin?: {
    nodeId: string;
    step: string;
    dir: "read" | "write";
    system?: string;
  };
  freshness?: {
    maxAge: number | "unbounded";
    override: "forbidden" | "audited";
    feeds: readonly Readonly<{ nodeId: string; label: string }>[];
  };
};

type ContextDataEntry = FactProvenanceWire & ContextDataOriginWire & {
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
 * D252 — where this entry's value came from, and the bound it is held under.
 *
 * Both facts are the DESCRIPTOR's, not the row's: the node that produced the
 * value declares whether its task reads or writes, which system it runs
 * against, and how old the fact may be before a scheduled commit refuses it.
 * A node the current build has no origin for yields neither — the same
 * absence as an entry with no field identity at all.
 */
function originOf(
  descriptor: RunDetailDescriptorView | undefined,
  nodeId: string,
  fieldPath: string,
): ContextDataOriginWire {
  const origin = descriptor?.dataOrigins?.find((entry) => entry.nodeId === nodeId);
  if (origin === undefined) return {};
  const bound = origin.freshness?.find((entry) => entry.fieldPath === fieldPath);
  return {
    origin: {
      nodeId: origin.nodeId,
      step: origin.step,
      dir: origin.dir,
      ...(origin.system === undefined ? {} : { system: origin.system }),
    },
    ...(bound === undefined
      ? {}
      : { freshness: { maxAge: bound.maxAge, override: bound.override, feeds: origin.feeds } }),
  };
}

/**
 * One entry for a correctable field: the raw recorded scalar from the
 * caller-resolved latest compatible checkpoint, plus any pending injected
 * correction.
 *
 * The checkpoint is a PARAMETER rather than a lookup, because the caller has
 * already had to resolve it: ref dashboard-surfaces §1.1(c)'s Data section lists what the run
 * touched, so a declared-correctable field with no stored checkpoint is not an
 * entry at all. Before D254 the retired `span.patched` fold could reach this
 * function with no checkpoint behind it, and the `display` argument carried
 * that fold's projected value; with the channel gone both are unreachable
 * shapes, and stating "there is a stored checkpoint" in the type is stronger
 * than re-deriving it here and re-answering a question the caller settled.
 */
function editableEntryOf(
  descriptor: RunDetailDescriptorView | undefined,
  authority: RunRecord,
  stored: RunCheckpointRecord,
  label: string,
  source: { nodeId: string; fieldPath: string },
): ContextDataEntry {
  // D252 — the origin is a DESCRIPTOR fact, so it is served on every arm
  // below: "which step owns this value" is exactly the question a locked row
  // makes more pressing.
  const attribution = originOf(descriptor, source.nodeId, source.fieldPath);
  // Dated once, for EVERY arm below: a locked row is as much a recorded fact
  // as an editable one, and "when was this observed" is the question the lock
  // makes more pressing rather than less.
  const provenance = provenanceFor(stored, source.fieldPath);
  const lookup = scalarAtPath(stored.output.value, source.fieldPath);
  if (lookup.kind === "absent") {
    return {
      label,
      valueRedacted: "not recorded on this outcome",
      edit: {
        state: "locked",
        reason: `the recorded outcome carries no ${source.fieldPath} — there is no stored value to correct`,
      },
      ...provenance,
      ...attribution,
    };
  }
  if (lookup.kind === "not-scalar") {
    return {
      label,
      valueRedacted: "structured value",
      edit: {
        state: "locked",
        reason: "not a single text/number value; structured output is corrected by a new run, not a field edit",
      },
      ...provenance,
      ...attribution,
    };
  }
  const pending = pendingCorrectionOf(authority, source);
  if (pending.state === "not-scalar") {
    return {
      label,
      valueRedacted: displayScalar(lookup.value),
      edit: {
        state: "locked",
        reason: "a pending correction holds a structured value; it applies when the run resumes",
      },
      ...provenance,
      ...attribution,
    };
  }
  return {
    label,
    valueRedacted: displayScalar(lookup.value),
    edit: {
      state: "editable",
      nodeId: source.nodeId,
      fieldPath: source.fieldPath,
      value: lookup.value,
      pendingCorrection: pending,
    },
    ...provenance,
    ...attribution,
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
  const entries: ContextDataEntry[] = [];
  for (const field of editFields) {
    const stored = deps.authority.latestCheckpoint(
      row.queued.workflow,
      authority.envelope.itemId,
      String(field.nodeId),
    );
    // The Data section lists values the run TOUCHED (ref dashboard-surfaces §1.1(c)); a
    // declared-correctable field whose step never recorded is not among them.
    if (stored === undefined) continue;
    entries.push(editableEntryOf(
      descriptor,
      authority,
      stored,
      field.label,
      { nodeId: String(field.nodeId), fieldPath: field.fieldPath },
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
  return "run was interrupted; ref write-safety recovery will requeue or settle it before a receipt can name a verdict";
}

/**
 * Project the durable `FailureRecord` onto the strict wire. The projection is
 * a whitelist BY CONSTRUCTION — every field is named here — so a field added
 * to the durable record later reaches no surface until someone decides how it
 * is classified. `sameFingerprintSeen` counts occurrences of the failure
 * CLASS, which is ref operator-trust §2.1's "same failure seen before" link.
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
