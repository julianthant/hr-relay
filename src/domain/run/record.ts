/**
 * The durable run record — ref dashboard-surfaces §2.3's task/claim store, ref workflow-model §4's state
 * machine, made a schema.
 *
 * **Parks are states, not sentinel statuses.** The legacy pairing of a `status`
 * with a sentinel `step` ("running/awaiting-approval", `failed + step:cancelled`)
 * is what made every surface re-derive what a row meant. Here the lifecycle is
 * one discriminated union: a parked run *is* `parked-gate`, and it structurally
 * cannot carry a worker or a claim generation, because a parked run owns no
 * worker (ref execution-and-sessions §2.1).
 *
 * **The claim is the fence.** `(workerId, claimGeneration)` on the row is the
 * whole ownership protocol: a worker renews exactly its one active claim, and a
 * zombie worker whose lease already expired cannot terminalize a row another
 * worker has since claimed, because its generation no longer matches.
 *
 * The input half follows ref workflow-model §2: raw and parsed are stored separately with
 * their schema hashes, and Edit Data can patch neither. Ref dashboard-surfaces §1.1 also allows
 * a sensitive-input authority reference in place of an inline input; no
 * workflow needs one before Phase 2, so that arm is deliberately absent rather
 * than invented here — it lands with the first workflow that carries one.
 */
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "../canonical-json.js";
import { RunDisplayNameSchema } from "../commands.js";
import {
  EvidenceReceiptIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  GateIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  WorkerIdSchema,
  WriteIntentIdSchema,
} from "../ids.js";
import { AppVersionSchema } from "../dashboard/primitives.js";
import { SchemaBoundCanonicalValueSchema } from "../schema-bound-value.js";
import { VerdictKeySchema } from "../workflow/presentation.js";
import { RunEnvelopeSchema } from "./envelope.js";

/**
 * Ref dashboard-surfaces §1.1's outcome union. `cancelled`, `discarded`, `interrupted`, and
 * `superseded` are FIRST-CLASS outcomes — the `failed + step:"cancelled"`
 * sentinel family does not exist in this tree.
 */
export const RunOutcomeSchema = z.enum([
  "done",
  "failed",
  "cancelled",
  "discarded",
  "interrupted",
  "superseded",
]);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

/** Why a queued row is queued — a requeue is never indistinguishable from a first enqueue. */
export const RequeueCauseSchema = z.enum(["reassign", "bump", "recovery", "provider-capacity"]);
export type RequeueCause = z.infer<typeof RequeueCauseSchema>;

/** The lifecycle discriminants, as a value — the `tasks.state` column's domain. */
export const RunStateSchema = z.enum([
  "queued",
  "claimed",
  "validating",
  "running",
  "parked-gate",
  "parked-write",
  "terminal",
]);
export type RunState = z.infer<typeof RunStateSchema>;

const ClaimFields = {
  workerId: WorkerIdSchema,
  claimedAt: IsoInstantSchema,
  heartbeatAt: IsoInstantSchema,
} as const;

export const RunLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("queued"),
    /** Retry backoff rides here; a worker never sleeps holding a run (ref execution-and-sessions §3). */
    notBefore: IsoInstantSchema.optional(),
    requeuedFrom: RequeueCauseSchema.optional(),
  }),
  z.strictObject({ state: z.literal("claimed"), ...ClaimFields }),
  z.strictObject({ state: z.literal("validating"), ...ClaimFields }),
  z.strictObject({
    state: z.literal("running"),
    ...ClaimFields,
    currentNodeId: NodeIdSchema.optional(),
  }),
  z.strictObject({
    state: z.literal("parked-gate"),
    gateId: GateIdSchema,
    parkedAt: IsoInstantSchema,
    /** The node execution resumes at once the gate resolves (ref workflow-model §4). */
    resumeAt: NodeIdSchema,
  }),
  z.strictObject({
    state: z.literal("parked-write"),
    writeIntentId: WriteIntentIdSchema,
    intentGeneration: PositiveIntSchema,
    parkedAt: IsoInstantSchema,
    /** Ref write-safety §4 park codes; there is no generic Done/Retry from here. */
    code: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]),
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("terminal"),
    outcome: RunOutcomeSchema,
    endedAt: IsoInstantSchema,
    failureId: FailureIdSchema.optional(),
    /** Display-safe summary; never the only failure evidence (ref dashboard-surfaces §1.1). */
    errorSummary: z.string().min(1).optional(),
    verdict: VerdictKeySchema.optional(),
    evidenceReceiptId: EvidenceReceiptIdSchema.optional(),
  }),
]).superRefine((lifecycle, context) => {
  if (lifecycle.state !== "terminal") return;
  if (lifecycle.outcome === "failed" && lifecycle.failureId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["failureId"],
      message: "a failed run must name its structured failure record",
    });
  }
  if (lifecycle.outcome !== "failed" && lifecycle.failureId !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["failureId"],
      message: `outcome ${lifecycle.outcome} cannot carry a failure record`,
    });
  }
});
export type RunLifecycle = z.infer<typeof RunLifecycleSchema>;

/** The lifecycle states in which exactly one worker owns the row. */
export const ClaimedRunStateSchema = z.enum(["claimed", "validating", "running"]);
export type ClaimedRunState = z.infer<typeof ClaimedRunStateSchema>;
export const CLAIMED_RUN_STATES = Object.freeze(ClaimedRunStateSchema.options);

export function isClaimedRunState(state: RunState): state is ClaimedRunState {
  return ClaimedRunStateSchema.safeParse(state).success;
}

export function isTerminalRunState(lifecycle: RunLifecycle): boolean {
  return lifecycle.state === "terminal";
}

/**
 * Ref workflow-model §4's state machine as data. Everything absent from this table is
 * illegal — a run cannot slide from `queued` straight to `running` without a
 * claim, and a terminal row can only re-open through the one documented door:
 * an `interrupted` outcome being requeued.
 */
const LEGAL_RUN_TRANSITIONS: ReadonlyMap<RunState, readonly RunState[]> = new Map([
  // Every non-terminal state may also update in place — a running node id
  // advances, a queued row gains a backoff, a rename touches no state at all.
  // `terminal` deliberately has no self-edge: a settled outcome is settled.
  ["queued", ["queued", "claimed", "terminal"]],
  ["claimed", ["claimed", "validating", "queued", "terminal"]],
  ["validating", ["validating", "running", "queued", "terminal"]],
  ["running", ["running", "parked-gate", "parked-write", "queued", "terminal"]],
  // A gate or write resolution re-enqueues; the fresh claim reacquires sessions
  // (ref workflow-model §4). A parked run holds no worker, so it can never resume in place.
  ["parked-gate", ["parked-gate", "queued", "terminal"]],
  ["parked-write", ["parked-write", "queued", "terminal"]],
  ["terminal", ["queued"]],
]);

/**
 * `undefined` when the transition is legal, otherwise the reason it is not.
 * Returning the reason rather than a boolean keeps the refusal legible at the
 * call site, which is the whole point of refusing.
 */
export function runTransitionViolation(from: RunLifecycle, to: RunLifecycle): string | undefined {
  // No state change at all — a rename, a hide — is legal from anywhere,
  // including a terminal run, which is the one state with no self-edge.
  if (canonicalJsonStringify(from) === canonicalJsonStringify(to)) return undefined;
  const allowed = LEGAL_RUN_TRANSITIONS.get(from.state);
  if (allowed === undefined) return `unknown run state ${from.state}`;
  if (!allowed.includes(to.state)) {
    return `${from.state} cannot transition to ${to.state}; legal next states are ${allowed.join(", ")}`;
  }
  if (from.state === "terminal") {
    if (from.outcome !== "interrupted") {
      return `a ${from.outcome} run is final; only an interrupted run may be requeued`;
    }
  }
  if (from.state === "queued" && to.state === "terminal"
    && !["cancelled", "discarded", "superseded"].includes(to.outcome)) {
    return `a queued run cannot end as ${to.outcome} without being claimed first`;
  }
  return undefined;
}

/**
 * Ref workflow-model §2: SQLite stores the raw submission, the parsed canonical value, and
 * both schema hashes separately. Keeping the raw text means a later canonical
 * schema change can be diagnosed against what the operator actually submitted
 * instead of against a value already rewritten by a since-changed default.
 */
export const RunInputStorageSchema = z.strictObject({
  raw: JsonValueSchema,
  /** Parsed through the workflow's canonical-input schema, bound to its hash. */
  parsed: SchemaBoundCanonicalValueSchema,
  ingressSchemaHash: FingerprintSchema,
});
export type RunInputStorage = z.infer<typeof RunInputStorageSchema>;

export const RunRecordSchema = z.strictObject({
  envelope: RunEnvelopeSchema,
  input: RunInputStorageSchema,
  lifecycle: RunLifecycleSchema,
  /**
   * Monotonic across the row's whole life — 0 before the first claim, +1 on
   * every claim. It persists through parks and requeues on purpose: a zombie
   * worker whose process stalled through a recovery sweep and a re-claim must
   * fail its next write, and a counter that reset on unclaim would hand it back
   * a generation that matches.
   */
  claimGeneration: NonNegativeIntSchema,
  /** Operator-assigned label over a stable id (ref dashboard-surfaces D83); never identity. */
  displayName: RunDisplayNameSchema.optional(),
  /**
   * RETIRED (D234) — a parse-tolerated vestige, read by nothing and written by
   * nothing.
   *
   * D49's reversible presentation tombstone is gone: the operator's ruling is
   * that there are runs and archived runs and no third hidden class, so every
   * producer of this field and every reader of it was removed with the verbs.
   * The KEY stays in the schema because `RunRecordSchema` is strict and every
   * row this database already holds carries `"hidden": false` inside its
   * `record_json` — dropping the key would make the authority database refuse
   * to open, which is D133's read-forward rule pointing the other way. It is
   * `optional()` rather than required so that new rows simply omit it; an
   * absent value means nothing and must never be given a meaning.
   *
   * There is no migration to delete it: `hidden` was never a column, only a
   * leaf inside the stored record, and released migration bodies are immutable.
   */
  hidden: z.boolean().optional(),
  /**
   * Charter §25 / D179: the app build this run was ENQUEUED under, stamped
   * once and never rewritten. It is the other half of the archive key — a
   * dashboard update bumps every workflow's effective version, so without a
   * per-run stamp an application-scope bump cannot tell a current run from a
   * prior one.
   *
   * **Optional because it is read forward, never back-filled (D133's rule).**
   * Runs enqueued before D179 carry no stamp, and writing the CURRENT app
   * version into one would claim a build that run never saw. An absent stamp
   * is therefore reported as absent, and an application-scope bump treats it
   * as prior-version — the fail-closed reading, since it demonstrably is not
   * the current build's.
   */
  appVersion: AppVersionSchema.optional(),
  /**
   * D230: this run's ORDINAL within its workflow — the queue footer's `#N`.
   *
   * Assigned once, at the one enqueue transaction, from the maximum this
   * workflow has already spent, and never rewritten. It is durable for the
   * reason the row's own finding names: deriving it from the position of a run
   * in a DAY's page would give the same run a different number on a different
   * day's page, and an ordinal an operator quotes in a support conversation
   * that means something else tomorrow is worse than no ordinal at all.
   *
   * It is NOT identity — `runId` and `traceId` are — and nothing joins on it.
   * It is a short human handle for a run within one workflow's history, which
   * is why a gap is legal (a refused enqueue inside a fan-out leaves nothing
   * behind, and the numbers around it stay meaningful) while a REPEAT is not:
   * `runs.enqueue` refuses a number the workflow has already spent and a
   * `UNIQUE (workflow, run_number)` index is the SQL backstop under it.
   *
   * **Optional because it is read forward, never back-filled (D133).** Every
   * run enqueued before schema v15 carries none, and computing one for those
   * rows now — by created_at order, say — would mint an ordinal that was never
   * true of them and would collide with the live counter. An absent number is
   * reported as absent with its reason; the row draws its trace id, which is
   * the identity every log and receipt already prints.
   */
  runNumber: PositiveIntSchema.optional(),
  /** Optimistic-concurrency token every command target carries. */
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "run record updatedAt precedes createdAt" });
  }
  /*
   * D221: the anchor is the record's VERSION, not its attempt. A run is created
   * at version 1 and every later write advances it, so version 1 is exactly "as
   * enqueued" — while `attempt === 1` stopped meaning that the moment an item's
   * second run began at the item's next attempt, which would have quietly
   * narrowed this check to nothing on every retry.
   */
  if (record.createdAt !== record.envelope.enqueuedAt && record.version === 1) {
    context.addIssue({
      code: "custom",
      path: ["createdAt"],
      message: "a newly enqueued run record is created at the moment it is enqueued",
    });
  }
  if (!isClaimedRunState(record.lifecycle.state) || !("heartbeatAt" in record.lifecycle)) return;
  if (record.claimGeneration === 0) {
    context.addIssue({
      code: "custom",
      path: ["claimGeneration"],
      message: `a ${record.lifecycle.state} run must have been claimed at least once`,
    });
  }
  if (Date.parse(record.lifecycle.heartbeatAt) < Date.parse(record.envelope.enqueuedAt)) {
    context.addIssue({
      code: "custom",
      path: ["lifecycle", "heartbeatAt"],
      message: "a claim heartbeat cannot predate the run's enqueue",
    });
  }
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RunClaimSchema = z.strictObject({
  workerId: WorkerIdSchema,
  /** At least 1: a claimed row has been claimed. */
  claimGeneration: PositiveIntSchema,
  heartbeatAt: IsoInstantSchema,
});
export type RunClaim = z.infer<typeof RunClaimSchema>;

/**
 * The claim a record holds, or `undefined` when it holds none. Callers must
 * branch — there is no "empty claim" value a parked or terminal row could be
 * mistaken for.
 */
export function runClaim(record: RunRecord): RunClaim | undefined {
  const { lifecycle } = record;
  if (!isClaimedRunState(lifecycle.state)) return undefined;
  if (!("workerId" in lifecycle)) return undefined;
  return Object.freeze(RunClaimSchema.parse({
    workerId: lifecycle.workerId,
    claimGeneration: record.claimGeneration,
    heartbeatAt: lifecycle.heartbeatAt,
  }));
}
