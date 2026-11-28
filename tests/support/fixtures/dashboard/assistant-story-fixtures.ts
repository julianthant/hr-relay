/** Assistant fixtures for the state gallery: a client that answers each kind of reply and attachment the panel meets, and the
 * ChatGPT account the panel reads. Browser-safe. */
import type { AssistantQueries } from "../../../../src/dashboard/client/index.js";
import type { HubChat, HubChatsPort } from "../../../../src/dashboard/surfaces/shell/hub-shell-model.js";
import type { ChatGptAccountPort, ChatGptAccountSnapshot } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { z } from "zod";
import type { AssistantFailureCode, AssistantInlineSchema, AssistantStageResult } from "../../../../src/models/dashboard/assistant.js";
import { scriptedEnvelope, type AssistantReplyPartInput as AssistantReplyPart, type ScriptedReply } from "../../helpers/dashboard/assistant-served-client.js";

export const ASSISTANT_STORY_PROMPT = "Look up Avery Sample in Person Lookup.";

/** What the next message comes back as. `never` is a reply still being prepared; `lost` is a reply that never arrived. */
export type AssistantReplyScript = "answer" | "answer-long" | "proposal" | "proposal-many" | "answered-yes" | "spreadsheet-edit" | "settings-edit" | "undo-edit" | "full-access-dry-run" | "never" | "lost" | { readonly refused: AssistantFailureCode };
export type AssistantStageScript = "staged" | "lost" | { readonly refused: AssistantFailureCode };

export interface AssistantStoryClientOptions {
  readonly reply?: AssistantReplyScript;
  readonly stage?: AssistantStageScript;
}

const ID = "00000000-0000-4000-8000-0000000000c1";
type AssistantInline = z.input<typeof AssistantInlineSchema>;
const plain = (text: string): AssistantInline => ({ kind: "plain", text });
const say = (...runs: AssistantInline[]): AssistantReplyPart => ({ kind: "text", runs });
const value = (text: string): AssistantInline => ({ kind: "value", value: text });
const ANSWER: AssistantReplyPart[] = [say(value("Avery Sample"), plain(" is in UCPath as an active employee.")),
  { kind: "bullets", items: [[plain("Employee ID "), value("10101010")], [plain("Department: "), { kind: "bold", text: "Housing" }]] }];
const LONG: AssistantReplyPart[] = [...ANSWER, say(plain("Each of these records was read from the live UCPath page. ".repeat(6).trim()))];
const proposal = (rows: AssistantInline[][]): AssistantReplyPart[] => [say(plain("Dry run, saves nothing. "), { kind: "bold", text: "Start Person Lookup" }),
  { kind: "bullets", items: rows }, say(plain("Runs in a hidden browser, screenshots on.")), say(plain("Stops before the commit.")),
  say(plain(rows.length === 1 ? "Reply yes to file it, or tell me what to change." : `Reply yes to save all ${String(rows.length)}, or tell me which to skip or change.`))];
const person = (name: string, employeeId: string): AssistantInline[] => [value(name), plain(" · EID "), value(employeeId)];
const ANSWERED_YES: AssistantReplyPart[] = [say(plain("Started Person Lookup for "), value("Sample, Avery"), plain(".")),
  { kind: "session", runId: ID, label: "Checking UCPath…", meta: "Person Lookup · Sample, Avery" },
  { kind: "answered", attribution: { kind: "assistant", requestedBy: "local-operator", profileId: ID, conversationId: ID, acceptedMessageId: ID, binding: { kind: "proposal", proposalId: ID, rowId: ID } }, at: "2026-11-26T09:31:00.000Z" }];
const edit = (label: string, previous: string, next: string): AssistantReplyPart => ({ kind: "text", editId: ID,
  runs: [plain(label), { kind: "value", previous, value: next }, plain(".")] });
const REPLIES: Readonly<Record<Exclude<AssistantReplyScript, "never" | "lost" | { readonly refused: AssistantFailureCode }>, readonly AssistantReplyPart[]>> = {
  "spreadsheet-edit": [edit("Renamed the spreadsheet to ", "Spring tracker", "Summer tracker")],
  "settings-edit": [edit("Changed Headless browser to ", "On", "Off")],
  "undo-edit": [edit("Changed Separations tracker, worksheet 1, row 2, column 1 back: ", "04/24/2031", "04/23/2031")],
  answer: ANSWER, "answer-long": LONG, proposal: proposal([person("Sample, Avery", "10101010")]),
  "proposal-many": proposal([person("Sample, Avery", "10101010"), person("Vega, Morgan", "20202020"), person("Rivera, Alex", "30303030")]), "answered-yes": ANSWERED_YES,
  "full-access-dry-run": [say(plain("Started the Separations dry run.")), { kind: "session", runId: ID, label: "Separations dry run", meta: "queued" }],
};
const never = <Value,>(): Promise<Value> => new Promise<Value>(() => undefined);

export function assistantStoryClient(options: AssistantStoryClientOptions = {}): AssistantQueries {
  const { reply = "answer", stage = "staged" } = options;
  const respond = async (): Promise<ScriptedReply> => {
    if (reply === "never") return never();
    if (reply === "lost") throw new TypeError("Failed to fetch");
    if (typeof reply === "object") return { state: "no-reply", reason: reply.refused };
    return { state: "answered", parts: REPLIES[reply] };
  };
  return {
    assistantRespond: async input => scriptedEnvelope(input, reply === "full-access-dry-run" && input.approvalMode !== "full-access"
      ? { state: "no-reply", reason: "ASSISTANT_PROPOSAL_REFUSED" } : await respond()),
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

/** The chats the history list shows, one in each group. */
export const ASSISTANT_STORY_CHATS: readonly HubChat[] = [
  { id: "chat-1", title: "Look up Avery Sample", minutes: 12, group: "Today" },
  { id: "chat-2", title: "Rerun the Person Lookup batch", minutes: 1620, group: "Yesterday" },
  { id: "chat-3", title: "Pause the separations run", minutes: 8640, group: "Earlier" },
];
/** A chat list frozen on `chats`; no story edits it. */
export function assistantChatsPort(chats: readonly HubChat[]): HubChatsPort {
  const refused = (): Promise<never> => Promise.reject(new Error("The story chat list does not change."));
  return { source: "local", read: () => chats, rename: refused, remove: refused, create: refused };
}
