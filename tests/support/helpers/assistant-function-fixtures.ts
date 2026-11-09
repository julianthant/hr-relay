import { randomUUID } from "node:crypto";
import { completedResponseStream } from "./chatgpt-response-stream.js";
import { z } from "zod";
import { AssistantFunctionNamespaceSchema, type AssistantInferenceResult } from "../../../src/models/dashboard/assistant.js";

/** Inert synthetic function declarations for account transport tests; not a production tool registry. */
const Answer = z.strictObject({ text: z.string().min(1).max(8000), citations: z.array(z.string()).max(8) });
const Search = z.strictObject({ query: z.string().min(1).max(120) });
const SYNTHETIC_FUNCTIONS = [
  { name: "answer", description: "Finish a synthetic explanation.", parameters: Answer },
  { name: "read_subjects", description: "Search a synthetic subject fixture.", parameters: Search },
] as const;
export const syntheticAssistantTools = [AssistantFunctionNamespaceSchema.parse({ type: "namespace" as const, name: "synthetic", description: "Inert synthetic fixture functions; not a production tool registry.",
  tools: SYNTHETIC_FUNCTIONS.map(fn => ({ type: "function" as const, name: fn.name, description: fn.description, strict: true as const, parameters: z.toJSONSchema(fn.parameters) })) })];

/** One function call in `namespace` (default the synthetic one); `action` names the function. */
export function syntheticAssistantResponse(turn: unknown, model = "gpt-6.1-sol", callId: string = randomUUID(), namespace = "synthetic"): AssistantInferenceResult {
  const value = z.object({ action: z.string() }).passthrough().parse(turn), { action, ...argumentsValue } = value;
  return { model, usage: { state: "unavailable", reason: "missing" }, responseId: `resp_${callId}`, output: [{ type: "function_call", id: `item_${callId}`, namespace,
    name: action === "read-subjects" ? "read_subjects" : action, call_id: callId, arguments: JSON.stringify(argumentsValue), status: "completed" }] };
}
export function completedAssistantStream(turn: unknown, model = "gpt-6.1-sol", namespace = "synthetic"): string {
  const response = syntheticAssistantResponse(turn, model, randomUUID(), namespace);
  return completedResponseStream(response.output, model, response.responseId);
}
/** A completed single assistant message. */
export function assistantMessageStream(text: string, model = "gpt-6.1-sol"): string {
  return completedResponseStream([{ type: "message", id: `msg_${randomUUID()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text }] }], model);
}
