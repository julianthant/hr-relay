import { z } from "zod";
import { DeclaredActionOccurrenceSchema } from "../../rules/workflow/task-provenance.js";
import { BrowserSystemIdSchema, IsoInstantSchema, RunSessionIdSchema, TraceIdSchema, WorkerIdSchema } from "../../rules/identity/ids.js";

export const CONFIRMED_ACTION_EVENT_VERSION = 1 as const;

export function confirmedStepOccurrence(action: Readonly<{
  runId: string; attempt: number; claimGeneration: number; taskAttempt: number; occurrencePath: readonly string[];
}>): string {
  return `${action.runId}/${String(action.attempt)}/${String(action.claimGeneration)}/${String(action.taskAttempt)}/${action.occurrencePath.join("/")}`;
}

export const DeclaredStepResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ version: z.literal(CONFIRMED_ACTION_EVENT_VERSION), state: z.literal("selected"), stepOccurrence: z.string().min(1),
    caseId: z.string().min(1), label: z.string().min(1), source: DeclaredActionOccurrenceSchema }),
  z.strictObject({ version: z.literal(CONFIRMED_ACTION_EVENT_VERSION), state: z.literal("unavailable"), stepOccurrence: z.string().min(1) }),
  z.strictObject({ version: z.literal(CONFIRMED_ACTION_EVENT_VERSION), state: z.literal("ambiguous"), stepOccurrence: z.string().min(1) }),
  z.strictObject({ version: z.literal(CONFIRMED_ACTION_EVENT_VERSION), state: z.literal("no-match"), stepOccurrence: z.string().min(1) }),
]).superRefine((result, context) => {
  if (result.state === "selected" && result.stepOccurrence !== confirmedStepOccurrence(result.source)) {
    context.addIssue({ code: "custom", path: ["stepOccurrence"], message: "selected result step differs from confirming action" });
  }
});
export type DeclaredStepResult = z.infer<typeof DeclaredStepResultSchema>;

const EventBaseSchema = z.strictObject({
  version: z.literal(CONFIRMED_ACTION_EVENT_VERSION),
  eventId: z.string().min(1),
  workerId: WorkerIdSchema,
  workerStreamId: z.string().min(1),
  sequence: z.number().int().positive(),
  runSessionId: RunSessionIdSchema.optional(),
  traceId: TraceIdSchema,
  stepOccurrence: z.string().min(1),
  action: DeclaredActionOccurrenceSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("browser"), system: BrowserSystemIdSchema }),
    z.strictObject({ kind: z.literal("headless"), system: z.enum(["service", "workflow"]) }),
  ]),
  occurredAt: IsoInstantSchema,
  recordedAt: IsoInstantSchema,
});

export const ConfirmedActionEventSchema = z.discriminatedUnion("kind", [
  EventBaseSchema.extend({
    kind: z.literal("trace"),
    state: z.enum(["started", "completed", "failed", "not-run"]),
    reason: z.string().min(1).optional(),
  }).superRefine((event, context) => {
    if (event.action.state !== event.state) context.addIssue({ code: "custom", path: ["state"], message: "trace state differs from action occurrence" });
    const action = event.action;
    if ((event.source.kind === "browser") !== (action.physicalSessionId !== undefined)) context.addIssue({ code: "custom", path: ["source"], message: "trace source/session mismatch" });
    const step = confirmedStepOccurrence(action);
    if (event.stepOccurrence !== step) context.addIssue({ code: "custom", path: ["stepOccurrence"], message: "trace step occurrence mismatch" });
  }),
  EventBaseSchema.extend({
    kind: z.literal("fact"),
    meaning: z.enum(["read", "fill", "interaction", "verification", "submit"]),
    purpose: z.enum(["read-validation", "readback", "interaction-effect", "saved-effect"]),
    proof: z.strictObject({ verifier: DeclaredActionOccurrenceSchema, verdict: z.literal("matched"),
      observationDigest: z.string().regex(/^[a-f0-9]{64}$/u) }),
    confirmedAt: IsoInstantSchema,
    disposition: z.literal("committed").optional(),
    durableProof: z.strictObject({ writeIntentId: z.string().min(1), checkpointNodeId: z.string().min(1), proofDigest: z.string().regex(/^[a-f0-9]{64}$/u) }).optional(),
  }).superRefine((event, context) => {
    const expectedPurpose = event.meaning === "read" || event.meaning === "verification" ? "read-validation"
      : event.meaning === "fill" ? "readback" : event.meaning === "interaction" ? "interaction-effect" : "saved-effect";
    if (event.purpose !== expectedPurpose) context.addIssue({ code: "custom", path: ["purpose"], message: "fact purpose mismatch" });
    if (event.meaning === "submit") {
      if (event.purpose !== "saved-effect" || event.disposition !== "committed" || event.durableProof === undefined) context.addIssue({ code: "custom", message: "submit requires saved effect and durable committed proof" });
    } else if (event.disposition !== undefined || event.durableProof !== undefined || event.purpose === "saved-effect") context.addIssue({ code: "custom", message: "only submit may carry durable write proof" });
    const action = event.action;
    const verifier = event.proof.verifier;
    if ((event.source.kind === "browser") !== (action.physicalSessionId !== undefined)) context.addIssue({ code: "custom", path: ["source"], message: "fact source/session mismatch" });
    const step = event.meaning === "submit"
      ? `${action.runId}/${String(action.attempt)}/${String(action.claimGeneration)}/${action.nodeId}/transaction`
      : confirmedStepOccurrence(action);
    if (event.stepOccurrence !== step) context.addIssue({ code: "custom", path: ["stepOccurrence"], message: "fact step occurrence mismatch" });
    if (verifier.state !== "completed") context.addIssue({ code: "custom", path: ["proof", "verifier"], message: "verifier did not complete" });
    if (action.runId !== verifier.runId || action.definitionFingerprint !== verifier.definitionFingerprint
      || action.logicalSessionId !== verifier.logicalSessionId
      || JSON.stringify(action.childInvocation) !== JSON.stringify(verifier.childInvocation)
      || action.attempt !== verifier.attempt
      || action.claimGeneration !== verifier.claimGeneration || action.nodeId !== verifier.nodeId
      || action.physicalSessionId !== verifier.physicalSessionId) context.addIssue({ code: "custom", message: "fact verifier identity mismatch" });
    if (event.meaning === "submit" && action.state !== "completed") context.addIssue({ code: "custom", path: ["action"], message: "submit gesture did not complete" });
    if (event.meaning === "verification" && (action.state !== "completed" || action.logicalActionId !== verifier.logicalActionId
      || action.occurrence !== verifier.occurrence || action.taskAttempt !== verifier.taskAttempt
      || action.invocationId !== verifier.invocationId)) context.addIssue({ code: "custom", path: ["action"], message: "verification action differs from proof" });
    if (event.meaning !== "submit" && (action.taskAttempt !== verifier.taskAttempt
      || action.occurrencePath.join("/") !== verifier.occurrencePath.join("/")
      || action.taskId !== verifier.taskId || action.invocationId !== verifier.invocationId)) context.addIssue({ code: "custom", message: "fact verifier invocation mismatch" });
    if (event.meaning !== "verification" && event.meaning !== "submit"
      && (action.state !== "confirmed" || action.confirmation?.verificationActionId !== verifier.logicalActionId
        || action.confirmation.verificationOccurrence !== verifier.occurrence
        || action.confirmation.verifiedAt !== event.confirmedAt)) context.addIssue({ code: "custom", message: "fact lacks frozen exact confirmation" });
  }),
]);
export type ConfirmedActionEvent = z.infer<typeof ConfirmedActionEventSchema>;
