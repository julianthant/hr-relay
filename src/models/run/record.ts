import { WorkerClaimLifetimeSchema } from "./worker.js";
import { ProtectedInputBindingsSchema, valueFreeProtectedInput } from "../write-safety/protected-input.js";
/** The durable run record: lifecycle as one discriminated union, with the claim generation as the ownership fence. */
import { z } from "zod";
import { RunCompletionSchema } from "./completion.js";
import { DiagnosticSafetyVersionSchema } from "../trust/failure.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { RunDisplayNameSchema } from "./display-name.js";
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
  RunSessionIdSchema,
} from "../../rules/identity/ids.js";
import { AppVersionSchema } from "../dashboard/primitives.js";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { VerdictKeySchema } from "../workflow/presentation.js";
import { RunEnvelopeSchema } from "./envelope.js";

/** The outcome union; `cancelled`, `discarded`, `interrupted` and `superseded` are first-class outcomes. */
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
  workerLifetime: WorkerClaimLifetimeSchema.optional(),
  workerId: WorkerIdSchema,
  claimedAt: IsoInstantSchema,
  heartbeatAt: IsoInstantSchema,
} as const;

export const RunLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("queued"),
    /** Retry backoff rides here; a worker never sleeps holding a run (ref execution-and-sessions ). */
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
    /** The node execution resumes at once the gate resolves (ref workflow-model ). */
    resumeAt: NodeIdSchema,
    /** A source subscription is bound to retained run authority at the park boundary. */
    sourceBinding: z.strictObject({
      kind: z.enum(["workflow", "external"]),
      sourceId: z.string().min(1),
      correlationKey: z.string().min(1),
      correlationDigest: FingerprintSchema,
      eventSchemaHash: FingerprintSchema,
      resultSchemaHash: FingerprintSchema,
      attempt: PositiveIntSchema,
      parkedVersion: PositiveIntSchema,
    }).optional(),
  }),
  z.strictObject({
    state: z.literal("parked-write"),
    writeIntentId: WriteIntentIdSchema,
    intentGeneration: PositiveIntSchema,
    parkedAt: IsoInstantSchema,
    /** Ref write-safety park codes; there is no generic Done/Retry from here. */
    code: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]),
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("terminal"),
    outcome: RunOutcomeSchema,
    endedAt: IsoInstantSchema,
    failureId: FailureIdSchema.optional(),
    /** Display-safe summary; never the only failure evidence (ref dashboard-surfaces ). */
    errorSummary: z.string().min(1).optional(),
    diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
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

/** The state machine as data; everything absent is illegal, and a terminal row reopens only through an `interrupted` outcome being requeued. */
const LEGAL_RUN_TRANSITIONS: ReadonlyMap<RunState, readonly RunState[]> = new Map([
  // Every non-terminal state may also update in place; `terminal` deliberately has no
  // self-edge: a settled outcome is settled.
  ["queued", ["queued", "claimed", "terminal"]],
  ["claimed", ["claimed", "validating", "queued", "terminal"]],
  ["validating", ["validating", "running", "queued", "terminal"]],
  ["running", ["running", "parked-gate", "parked-write", "queued", "terminal"]],
  // A gate or write resolution re-enqueues; the fresh claim reacquires sessions
  // (ref workflow-model ). A parked run holds no worker, so it can never resume in place.
  ["parked-gate", ["parked-gate", "queued", "terminal"]],
  ["parked-write", ["parked-write", "queued", "terminal"]],
  ["terminal", ["queued"]],
]);

/** `undefined` when the transition is legal, otherwise the reason it is not. */
export function runTransitionViolation(from: RunLifecycle, to: RunLifecycle): string | undefined {
  // Lifecycle equality is not itself a lifecycle edge. Callers separately
  // authorize in-place mutations such as rename or archive revision advance.
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

/** The raw submission, the parsed canonical value and both schema hashes, stored separately; Edit Data can patch neither. */
export const RunInputStorageSchema = z.strictObject({
  raw: JsonValueSchema,
  /** Parsed through the workflow's canonical-input schema, bound to its hash. */
  parsed: SchemaBoundCanonicalValueSchema.extend({protectedBindings:ProtectedInputBindingsSchema}).superRefine((parsed, context) => {
    try { valueFreeProtectedInput(parsed.value, parsed.protectedBindings); }
    catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) }); }
  }),
  ingressSchemaHash: FingerprintSchema,
});
export type RunInputStorage = z.infer<typeof RunInputStorageSchema>;


const RunRecordBaseSchema = z.strictObject({
  envelope: RunEnvelopeSchema,
  input: RunInputStorageSchema,
  lifecycle: RunLifecycleSchema,
    /* Monotonic across the row's whole life — 0 before the first claim, +1 on every claim — persisting through parks and requeues so a zombie worker fails its next write. */
  claimGeneration: NonNegativeIntSchema,
    /** Operator intent; a claimed worker alone settles the cancellation. */
  cancelRequested: z.literal(true).optional(),
    /** Operator-assigned label over a stable id; never identity. */
  displayName: RunDisplayNameSchema.optional(),
    /* The app build this run was enqueued under, stamped once and never rewritten; optional because it is read forward, never back-filled. */
  appVersion: AppVersionSchema.optional(),
    /* This run's ordinal within its workflow — the queue footer's `#N`, assigned once at enqueue and never rewritten; optional because it is read forward. */
  runNumber: PositiveIntSchema.optional(),
    /* The dashboard-started GROUP this run belongs to, stamped at the fan-out transaction and never rewritten; optional because it is read forward. */
  sessionId: RunSessionIdSchema.optional(),
  /** Optimistic-concurrency token every command target carries. */
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "run record updatedAt precedes createdAt" });
  }
    // The anchor is the record's VERSION, not its attempt: version 1 is exactly "as enqueued".
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
export const RunRecordSchema = RunRecordBaseSchema.safeExtend({
  completion: RunCompletionSchema.optional(),
}).superRefine((run, context) => {
  const completion = run.completion;
  const settled = run.lifecycle.state === "terminal" && ["done", "failed"].includes(run.lifecycle.outcome);
  if (settled !== (completion !== undefined)) {
    context.addIssue({ code: "custom", path: ["completion"], message: "done/failed requires completion; other states cannot carry it" });
    return;
  }
  if (completion === undefined) return;
  if (run.version < completion.expectedVersion + 1 || Number(run.claimGeneration) !== Number(completion.claim.claimGeneration)
    || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== completion.kind
    || run.lifecycle.endedAt !== completion.authorizedAt
    || (run.version === completion.expectedVersion + 1 && run.updatedAt !== completion.authorizedAt)
    || (completion.kind === "failed" && run.lifecycle.failureId !== completion.failureId)) {
    context.addIssue({ code: "custom", path: ["completion"], message: "completion does not bind the exact terminal consequence" });
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

/** No claim is explicit absence; callers must branch. */
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
