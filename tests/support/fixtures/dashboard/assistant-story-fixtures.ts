/** Assistant fixtures for the state gallery: a client that answers each kind of reply, decision and attachment the panel meets, and the
 * ChatGPT account the panel reads. Browser-safe. */
import type { AssistantQueries } from "../../../../src/dashboard/client/index.js";
import type { ChatGptAccountPort, ChatGptAccountSnapshot } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { AssistantActionProposal, AssistantActionResult, AssistantFailureCode, AssistantResult, AssistantStageResult } from "../../../../src/models/dashboard/assistant.js";
import { ASSISTANT_FAILURES } from "../../../../src/models/dashboard/assistant.js";
import { ASSISTANT_PAUSE_PROPOSAL, ASSISTANT_RERUN_PROPOSAL, ASSISTANT_SEPARATIONS_MULTI_PROPOSAL, ASSISTANT_START_MULTI_PROPOSAL, ASSISTANT_START_PROPOSAL } from "./assistant-start.js";

export const ASSISTANT_STORY_PROMPT = "Look up Avery Sample in Person Lookup.";
export type AssistantProposalKind = "start" | "start-many" | "rerun" | "pause" | "separations-many";
const PROPOSALS: Readonly<Record<AssistantProposalKind, AssistantActionProposal>> = {
  start: ASSISTANT_START_PROPOSAL, "start-many": ASSISTANT_START_MULTI_PROPOSAL, rerun: ASSISTANT_RERUN_PROPOSAL, pause: ASSISTANT_PAUSE_PROPOSAL, "separations-many": ASSISTANT_SEPARATIONS_MULTI_PROPOSAL,
};

/** What the next message comes back as. `never` is a reply still being prepared; `lost` is a reply that never arrived. */
export type AssistantReplyScript = "answer" | "answer-long" | "never" | "lost" | { readonly proposal: AssistantProposalKind } | { readonly refused: AssistantFailureCode };
/** What Confirm or Cancel comes back as. */
export type AssistantDecisionScript = "applied" | "cancelled" | "unknown" | "never" | "lost" | { readonly refused: AssistantFailureCode };
export type AssistantStageScript = "staged" | "lost" | { readonly refused: AssistantFailureCode };

export interface AssistantStoryClientOptions {
  readonly reply?: AssistantReplyScript;
  readonly decision?: AssistantDecisionScript;
  readonly stage?: AssistantStageScript;
}

const ANSWER = "Avery Sample is in UCPath as an active employee.\n- Employee ID 10101010\n- Department: **Housing**";
const LONG = `${ANSWER}\n${"Each of these records was read from the live UCPath page. ".repeat(6)}`;
const never = <Value,>(): Promise<Value> => new Promise<Value>(() => undefined);

export function assistantStoryClient(options: AssistantStoryClientOptions = {}): AssistantQueries {
  const { reply = "answer", decision = "applied", stage = "staged" } = options;
  const respond = async (): Promise<AssistantResult> => {
    if (reply === "never") return never();
    if (reply === "lost") throw new TypeError("Failed to fetch");
    if (reply === "answer" || reply === "answer-long") return { state: "answered", text: reply === "answer" ? ANSWER : LONG };
    if ("refused" in reply) return { state: "refused", code: reply.refused, message: ASSISTANT_FAILURES[reply.refused] };
    return { state: "action-proposal", proposal: PROPOSALS[reply.proposal] };
  };
  return {
    assistantRespond: async () => ({ kind: "result", result: await respond() }),
    assistantDecide: async (input): Promise<AssistantActionResult> => {
      if (decision === "never") return never();
      if (decision === "lost") throw new TypeError("Failed to fetch");
      if (decision === "unknown") return { state: "unknown", actionId: input.actionId };
      if (typeof decision === "object") return { state: "refused", code: decision.refused };
      return { state: input.decision === "confirm" ? "applied" : "cancelled", actionId: input.actionId };
    },
    assistantStageAttachment: async (_chat, file): Promise<AssistantStageResult> => {
      if (stage === "lost") throw new TypeError("Failed to fetch");
      if (typeof stage === "object") return { state: "refused", code: stage.refused };
      return { state: "staged", attachment: { id: "00000000-0000-4000-8000-0000000000a1", mediaType: "application/pdf", name: file.name, byteLength: file.bytes.byteLength, expiresAt: "2099-01-01T00:00:00.000Z" } };
    },
  };
}

const noop = () => undefined;
/** A live ChatGPT account port frozen on one snapshot. `retryable` gives it a refresh, which the panel offers as Retry when the account could not be read. */
export function assistantAccountPort(snapshot: ChatGptAccountSnapshot, retryable = false): ChatGptAccountPort {
  return { mode: "live", getSnapshot: () => snapshot, subscribe: () => noop, signIn: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), signOut: () => Promise.resolve(undefined),
    ...(retryable ? { refresh: () => Promise.resolve() } : {}) };
}
