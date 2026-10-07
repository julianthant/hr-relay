import { BrowserSystemIdSchema, IsoInstantSchema, TraceIdSchema } from "../../rules/identity/ids.js";
import type { BrowserAction } from "../systems/browser-shared/action-notes.js";
import type { ConfirmedActionPublisher } from "./confirmed-action-publisher.js";
import type { ConfirmedActionDelivery } from "./confirmed-action-publisher.js";
import type { WorkflowOperationDisplaySnapshot } from "../../models/workflow/operation-display-snapshot.js";
import { registeredUiEffect } from "./semantic-ui-effect.js";

export type DurableCommitProof = Readonly<{ writeIntentId: string; confirmedAt: string; proofDigest: string }>;

/** Called only after the sequencer's beat-⑦ hook and exact checkpoint readback. */
export function publishConfirmedSubmit(input: Readonly<{
  publisher: ConfirmedActionPublisher;
  snapshot: WorkflowOperationDisplaySnapshot;
  system: string;
  commitTaskId: string;
  verifierTaskId?: string;
  commits: readonly BrowserAction[];
  verifiers: readonly BrowserAction[];
  durable?: DurableCommitProof;
  checkpointNodeId: string;
  checkpointProofDigest: string;
  verifiedProofDigest?: string;
  traceId: string;
  runSessionId?: string;
}>): ConfirmedActionDelivery | "proof-unavailable" {
  const system = BrowserSystemIdSchema.parse(input.system);
  const frozenCommit = input.snapshot.invocations.filter(invocation => invocation.taskId === input.commitTaskId
    && invocation.entryId === input.checkpointNodeId && invocation.contractRole === "commit");
  const frozenVerifier = input.snapshot.invocations.filter(invocation => invocation.taskId === input.verifierTaskId
    && invocation.entryId === input.checkpointNodeId && invocation.contractRole === "verify");
  if (frozenCommit.length !== 1 || frozenVerifier.length !== 1
    || frozenCommit[0].operation.system !== system || frozenVerifier[0].operation.system !== system) {
    input.publisher.reportProofUnavailable();
    return "proof-unavailable";
  }
  const actions = (invocation: typeof frozenCommit[number]): readonly typeof invocation.operation.actions[number][] => {
    const visit = (items: readonly typeof invocation.operation.actions[number][]): typeof invocation.operation.actions[number][] =>
      items.flatMap(item => [item, ...visit(item.children ?? [])]);
    return visit(invocation.operation.actions);
  };
  const externalActions = actions(frozenCommit[0]).filter(action => action.kind === "click"
    && registeredUiEffect(system, action.target ?? action.id) === "external-commit");
  const savedActions = actions(frozenVerifier[0]).filter(action => action.kind === "verify");
  if (externalActions.length !== 1 || savedActions.length !== 1) {
    input.publisher.reportProofUnavailable();
    return "proof-unavailable";
  }
  const commits = input.commits.filter(note => note.operation?.taskId === input.commitTaskId
    && note.operation.state === "completed" && note.kind === "clicked"
    && note.operation?.invocationId === frozenCommit[0].id
    && note.operation?.occurrencePath.join("/") === frozenCommit[0].occurrencePath.join("/")
    && externalActions[0].id === note.operation?.logicalActionId
    && (externalActions[0].target ?? externalActions[0].id) === note.targetId
    && registeredUiEffect(system, note.targetId) === "external-commit");
  const verifiers = input.verifiers.filter(note => note.operation?.taskId === input.verifierTaskId
    && note.operation?.state === "completed" && note.kind === "verified"
    && note.operation?.invocationId === frozenVerifier[0].id
    && note.operation?.occurrencePath.join("/") === frozenVerifier[0].occurrencePath.join("/")
    && savedActions[0].id === note.operation?.logicalActionId
    && (savedActions[0].target ?? savedActions[0].id) === note.targetId);
  const commit = commits.length === 1 ? commits[0] : undefined;
  const verifier = verifiers.length === 1 ? verifiers[0] : undefined;
  const action = commit?.operation;
  const proofAction = verifier?.operation;
  const durable = input.durable;
  if (durable === undefined || action === undefined || proofAction === undefined
    || action.physicalSessionId === undefined || action.physicalSessionId !== proofAction.physicalSessionId
    || action.runId !== proofAction.runId || action.attempt !== proofAction.attempt
    || action.claimGeneration !== proofAction.claimGeneration || action.nodeId !== proofAction.nodeId
    || (verifier !== undefined && commit !== undefined && Date.parse(verifier.at) < Date.parse(commit.at))
    || durable.proofDigest !== input.checkpointProofDigest
    || input.verifiedProofDigest !== durable.proofDigest) {
    input.publisher.reportProofUnavailable();
    return "proof-unavailable";
  }
  if (commit === undefined || verifier === undefined) throw new Error("confirmed-submit-internal-proof-narrowing");
  return input.publisher.publish({
    version: 1, kind: "fact", meaning: "submit", purpose: "saved-effect", disposition: "committed",
    traceId: TraceIdSchema.parse(input.traceId),
    ...(input.runSessionId === undefined ? {} : { runSessionId: input.runSessionId }),
    stepOccurrence: `${action.runId}/${String(action.attempt)}/${String(action.claimGeneration)}/${action.nodeId}/transaction`,
    action, source: { kind: "browser", system },
    occurredAt: IsoInstantSchema.parse(commit.at), confirmedAt: IsoInstantSchema.parse(durable.confirmedAt),
    durableProof: { writeIntentId: durable.writeIntentId, checkpointNodeId: input.checkpointNodeId,
      proofDigest: durable.proofDigest },
    proof: { verifier: proofAction, verdict: "matched", observationDigest: durable.proofDigest },
  });
}
