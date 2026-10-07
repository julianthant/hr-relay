import type { Clock } from "../../rules/time/clock.js";
import { IsoInstantSchema, TraceIdSchema, type BrowserSystemId } from "../../rules/identity/ids.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../rules/validation/canonical-json.js";
import type { DeclaredActionOccurrence } from "../../rules/workflow/task-provenance.js";
import type { BrowserAction } from "../systems/browser-shared/action-notes.js";
import { currentBrowserActionSessionId, runDeclaredAction } from "../systems/browser-shared/action-notes.js";
import type { ConfirmedActionPublisher } from "./confirmed-action-publisher.js";
import type { ConfirmedActionRef, ConfirmedTaskActions, ConfirmedVerification } from "../../workflow-kit/task.js";
import type { WorkflowOperationDisplaySnapshot } from "../../models/workflow/operation-display-snapshot.js";
import { selectDeclaredStepResult, type ConfirmedOutcomeEvidence } from "./declared-step-result.js";
import { z } from "zod";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { confirmedStepOccurrence } from "../../models/events/confirmed-action.js";

const OutcomeObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("value"), value: JsonValueSchema }),
  z.strictObject({ state: z.literal("empty") }),
  z.strictObject({ state: z.literal("unavailable") }),
]);

type Source = Readonly<{ kind: "browser"; system: BrowserSystemId }> | Readonly<{ kind: "headless"; system: "service" | "workflow" }>;

export function createConfirmedTaskActions(input: Readonly<{
  publisher: ConfirmedActionPublisher;
  snapshot: WorkflowOperationDisplaySnapshot;
  clock: Clock;
  source: Source;
  runSessionId?: string;
  runId: string;
  traceId: string;
  attempt: number;
  claimGeneration: number;
  taskAttempt: number;
  nodeId: string;
  taskId: string;
  contractRole: WorkflowOperationDisplaySnapshot["invocations"][number]["contractRole"];
  /** Exact semantic UI effect from the registered system registry. */
  effectFor: (targetId: string) => "observe" | "navigate" | "prepare" | "external-commit" | undefined;
}>): Readonly<{ actions: ConfirmedTaskActions; observe: (action: BrowserAction) => void }> {
  const recent = new Map<string, DeclaredActionOccurrence>();
  const confirmedEvidence: ConfirmedOutcomeEvidence[] = [];
  const invocation = input.snapshot.invocations.find(candidate => candidate.entryId === input.nodeId
    && candidate.taskId === input.taskId && candidate.contractRole === input.contractRole);
  if (invocation === undefined) throw new Error("confirmed-action-frozen-invocation-missing");
  type FrozenAction = typeof invocation.operation.actions[number];
  const flatten = (actions: readonly FrozenAction[]): FrozenAction[] => actions.flatMap(action => [action, ...flatten(action.children ?? [])]);
  const declared = flatten(invocation.operation.actions);
  const frozen = (action: ConfirmedActionRef) => {
    const matches = declared.filter(candidate => candidate.id === action.id && (candidate.target ?? candidate.id) === action.targetId);
    if (matches.length !== 1) throw new Error("confirmed-action-frozen-identity-mismatch");
    return matches[0];
  };
  const checkLink = (action: ConfirmedActionRef, verification: ConfirmedVerification): void => {
    const operation = frozen(action);
    const verifier = frozen(verification.action);
    if (verifier.kind !== "verify" || operation.confirmationActionId !== verifier.id) throw new Error("confirmed-action-frozen-verifier-mismatch");
  };
  const common = (action: DeclaredActionOccurrence, occurredAt: string) => ({
    version: 1 as const,
    ...(input.runSessionId === undefined ? {} : { runSessionId: input.runSessionId }),
    stepOccurrence: confirmedStepOccurrence(action),
    action,
    traceId: TraceIdSchema.parse(input.traceId),
    source: input.source,
    occurredAt,
  });
  const exact = (action: DeclaredActionOccurrence): void => {
    if (action.runId !== input.runId || action.definitionFingerprint !== input.snapshot.definitionFingerprint
      || action.logicalSessionId !== invocation.operation.session.id || action.attempt !== input.attempt
      || action.claimGeneration !== input.claimGeneration || action.taskAttempt !== input.taskAttempt
      || action.nodeId !== input.nodeId || action.taskId !== input.taskId
      || action.invocationId !== invocation.id || action.occurrencePath.join("/") !== invocation.occurrencePath.join("/")) {
      throw new Error("confirmed-action-foreign-attempt");
    }
    if (input.source.kind === "browser") {
      const active = currentBrowserActionSessionId();
      if (active === undefined || action.physicalSessionId !== active) throw new Error("confirmed-action-foreign-session");
    }
  };
  const latest = (ref: ConfirmedActionRef): DeclaredActionOccurrence => {
    const action = recent.get(ref.id);
    if (action === undefined) throw new Error(`confirmed-action-${ref.id}-unavailable`);
    exact(action);
    return action;
  };
  const observe = (note: BrowserAction): void => {
    const action = note.operation;
    if (action === undefined || action.state === undefined) return;
    exact(action);
    recent.set(action.logicalActionId, action);
    if (action.state === "confirmed") return;
    input.publisher.publish({
      ...common(action, note.at), kind: "trace", state: action.state,
      ...(action.reason === undefined ? {} : { reason: action.reason }),
    });
  };
  const verified = async (verification: ConfirmedVerification): Promise<Readonly<{ action: DeclaredActionOccurrence; observed: JsonValue; at: string }>> => {
    frozen(verification.action);
    if (verification.purpose !== "read-validation") throw new Error("confirmed-verification-purpose-mismatch");
    if (input.source.kind === "browser" && currentBrowserActionSessionId() === undefined) throw new Error("confirmed-action-session-unavailable");
    let observed: JsonValue | undefined;
    await runDeclaredAction({ ...verification.action, kind: "verified" }, async () => {
      observed = JsonValueSchema.parse(await verification.observe());
      if (!verification.matches(observed)) throw new Error("confirmed-action-verifier-false");
    });
    const action = latest(verification.action);
    if (action.state !== "completed" || observed === undefined) throw new Error("confirmed-action-verification-unavailable");
    return { action, observed, at: input.clock.now().toISOString() };
  };
  const confirmed = async <T>(kind: "read" | "typed" | "clicked" | "pressed", action: ConfirmedActionRef,
    perform: () => Promise<T>, verification: ConfirmedVerification, consumed?: (value: T) => JsonValue): Promise<Readonly<{
      result: T; action: DeclaredActionOccurrence; proof: { action: DeclaredActionOccurrence; observed: JsonValue; at: string }; occurredAt: string;
    }>> => {
    const required = kind === "read" ? "read-validation" : kind === "typed" ? "readback" : "interaction-effect";
    if (verification.purpose !== required) throw new Error("confirmed-action-purpose-mismatch");
    checkLink(action, verification);
    if (input.source.kind === "browser" && currentBrowserActionSessionId() === undefined) throw new Error("confirmed-action-session-unavailable");
    let observed: JsonValue | undefined;
    let occurredAt: string | undefined;
    const result = await runDeclaredAction({ ...action, kind }, async () => {
      const value = await perform();
      occurredAt = input.clock.now().toISOString();
      return value;
    }, consumed, { ...verification.action, verify: async () => {
      observed = JsonValueSchema.parse(await verification.observe());
      return verification.matches(observed);
    } });
    const bound = latest(action);
    const verifier = latest(verification.action);
    if (bound.state !== "confirmed" || bound.confirmation?.verificationActionId !== verifier.logicalActionId
      || bound.confirmation.verificationOccurrence !== verifier.occurrence || verifier.state !== "completed"
      || observed === undefined || occurredAt === undefined) throw new Error("confirmed-action-proof-unavailable");
    return { result, action: bound, proof: { action: verifier, observed, at: bound.confirmation.verifiedAt }, occurredAt };
  };
  const fact = (meaning: "read" | "fill" | "interaction" | "verification", action: DeclaredActionOccurrence,
    proof: Readonly<{ action: DeclaredActionOccurrence; observed: JsonValue; at: string }>, purpose: ConfirmedVerification["purpose"], occurredAt: string): void => {
    exact(action);
    exact(proof.action);
    if (action.physicalSessionId !== proof.action.physicalSessionId
      || action.attempt !== proof.action.attempt || action.taskAttempt !== proof.action.taskAttempt
      || action.occurrencePath.join("/") !== proof.action.occurrencePath.join("/")) {
      throw new Error("confirmed-action-verifier-identity-mismatch");
    }
    input.publisher.publish({
      ...common(action, occurredAt), kind: "fact", meaning, purpose,
      proof: { verifier: proof.action, verdict: "matched",
        observationDigest: sha256Hex(`hrauto:confirmed-observation:v1\0${canonicalJsonStringify(proof.observed)}`) },
      confirmedAt: IsoInstantSchema.parse(proof.at),
    });
    // Outcome references name frozen workflow sources, not invocation input bindings.
  };
  const interaction = async (kind: "clicked" | "pressed", action: ConfirmedActionRef,
    perform: () => Promise<unknown>, verification: ConfirmedVerification): Promise<void> => {
    const effect = input.effectFor(action.targetId);
    if (effect === undefined || effect === "external-commit") throw new Error("confirmed-action-external-or-undeclared-effect");
    const evidence = await confirmed(kind, action, perform, verification);
    fact("interaction", evidence.action, evidence.proof, verification.purpose, evidence.occurredAt);
  };
  return {
    observe,
    actions: {
      async read(action, perform, verification) {
        const evidence = await confirmed("read", action, perform, verification, result => JsonValueSchema.parse(result));
        fact("read", evidence.action, evidence.proof, verification.purpose, evidence.occurredAt);
        return evidence.result;
      },
      async fill(action, expected, perform, readback) {
        const value = JsonValueSchema.parse(expected);
        if (readback.purpose !== "readback") throw new Error("confirmed-action-fill-purpose-mismatch");
        const evidence = await confirmed("typed", action, perform, { ...readback,
          matches: observed => readback.matches(observed) && canonicalJsonStringify(value) === canonicalJsonStringify(observed),
        }, () => value);
        fact("fill", evidence.action, evidence.proof, "readback", evidence.occurredAt);
      },
      click: (action, perform, verification) => interaction("clicked", action, perform, verification),
      keypress: (action, perform, verification) => interaction("pressed", action, perform, verification),
      async verify(verification) {
        const proof = await verified(verification);
        fact("verification", proof.action, proof, verification.purpose, proof.at);
        return proof.observed;
      },
      async confirmOutcome(reference, verification) {
        if (!invocation.outcomes.some(candidate => canonicalJsonStringify(candidate.when.value) === canonicalJsonStringify(reference))) {
          throw new Error("confirmed-outcome-reference-not-frozen");
        }
        let observedOutcome: z.infer<typeof OutcomeObservationSchema> | undefined;
        const proof = await verified({ action: verification.action, purpose: verification.purpose,
          observe: async () => {
            const parsed = OutcomeObservationSchema.safeParse(await verification.observe());
            if (!parsed.success || parsed.data.state === "unavailable") throw new Error("confirmed-outcome-unavailable");
            observedOutcome = parsed.data;
            return parsed.data;
          },
          matches: observed => verification.matches(OutcomeObservationSchema.parse(observed)),
        });
        if (observedOutcome === undefined || observedOutcome.state === "unavailable") throw new Error("confirmed-outcome-unavailable");
        fact("verification", proof.action, proof, verification.purpose, proof.at);
        confirmedEvidence.push({ reference, action: proof.action, state: "confirmed",
          present: observedOutcome.state === "value",
          ...(observedOutcome.state === "value" ? { value: observedOutcome.value } : {}),
        });
        return observedOutcome;
      },
      result() {
        if (input.contractRole !== "task") throw new Error("confirmed-result-task-role-required");
        const evidence = input.source.kind === "browser"
          ? confirmedEvidence.filter(fact => fact.action.physicalSessionId === currentBrowserActionSessionId()
            && currentBrowserActionSessionId() !== undefined)
          : confirmedEvidence;
        const result = selectDeclaredStepResult({ snapshot: input.snapshot, entryId: input.nodeId, taskId: input.taskId,
          invocationId: invocation.id, runId: input.runId, attempt: input.attempt,
          claimGeneration: input.claimGeneration, taskAttempt: input.taskAttempt, evidence });
        return result;
      },
    },
  };
}
