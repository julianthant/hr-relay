import type { AssistantQueries } from "../../../../src/dashboard/client/index.js";
import type { z } from "zod";
import { AssistantAcceptedTurnSchema, AssistantReplyPartsSchema, type AssistantFailureCode, type AssistantM1Request, type AssistantM1RespondEnvelope, type AssistantReplyPartSchema } from "../../../../src/models/dashboard/assistant.js";

/** A reply part as a fixture writes it, before the schema brands its ids and instants. */
export type AssistantReplyPartInput = z.input<typeof AssistantReplyPartSchema>;

/** A scripted reply: text or parts the server answered with, or a refusal before acceptance. */
export type ScriptedReply = Readonly<{ state: "answered"; text?: string; parts?: readonly AssistantReplyPartInput[] }> | Readonly<{ state: "no-reply"; reason: AssistantFailureCode; recorded?: true }>;
type ResultClient = Omit<AssistantQueries, "assistantRespond"> & { assistantRespond(input: AssistantM1Request, signal?: AbortSignal): Promise<ScriptedReply> };

/** The served envelope for one scripted reply: an answer carries its accepted turn and receipt; a refusal before acceptance stores nothing. */
export function scriptedEnvelope(input: AssistantM1Request, reply: ScriptedReply): AssistantM1RespondEnvelope {
  const acceptedTurn = AssistantAcceptedTurnSchema.parse({ conversationId: input.conversationId, messageId: input.messageId, ordinal: 1, acceptedRevision: input.expectedRevision + 1,
    acceptedAt: new Date().toISOString(), profileId: "00000000-0000-4000-8000-0000000000aa", epoch: 1, proposalAnswer: null });
  // A recorded refusal is one the server settled after acceptance and may not be resent.
  if (reply.state === "no-reply") return reply.recorded === true ? { kind: "result", result: { state: "no-reply", reason: reply.reason, canRetry: false, turn: { acceptedTurn, usage: { state: "measured", callCount: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    receipt: { conversationId: input.conversationId, messageId: input.messageId, ordinal: 1, revision: input.expectedRevision + 2, delivery: "refused" } }
    : { kind: "result", result: { state: "no-reply", reason: reply.reason, canRetry: false, turn: null } };
  const parts = reply.parts ?? [{ kind: "text" as const, runs: [{ kind: "plain" as const, text: reply.text ?? "Done" }] }];
  return { kind: "result", result: { state: "answered", reply: { parts: AssistantReplyPartsSchema.parse(parts), acceptedTurn, usage: { state: "measured", callCount: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    receipt: { conversationId: input.conversationId, messageId: input.messageId, ordinal: 1, revision: input.expectedRevision + 2, delivery: "answered" } };
}

/** A synthetic client whose scripted replies are served as envelopes. */
export function resultClient<Client extends ResultClient>(client: Client): Omit<Client, "assistantRespond"> & Pick<AssistantQueries, "assistantRespond"> {
  return { ...client, assistantRespond: async (input, signal) => scriptedEnvelope(input, await client.assistantRespond(input, signal)) };
}
