import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AssistantCitationSchema, AssistantSubjectSchema, AssistantFunctionNamespaceSchema, ASSISTANT_FAILURES, type AssistantInferenceResult, type AssistantResult, type AssistantSubject } from "../../../src/models/dashboard/assistant.js";
import type { AssistantServiceOptions, AssistantFunctionSet, AssistantFunctionContext } from "../../../src/backend/assistant/service.js";
import { prepareAssistantProposal } from "../../../src/backend/assistant/proposal.js";

const Answer = z.strictObject({ text: z.string().min(1).max(8000), citations: z.array(AssistantCitationSchema).max(8) });
const Search = z.strictObject({ query: z.string().min(1).max(120) });
const Proposal = z.strictObject({ workflowId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u), intent: z.literal("dry-run") });
export const SyntheticAssistantTurnSchema = z.discriminatedUnion("action", [Answer.extend({ action: z.literal("answer") }),
  Search.extend({ action: z.literal("read-subjects") }), Proposal.extend({ action: z.literal("propose") })]);
export type SyntheticAssistantTurn = z.infer<typeof SyntheticAssistantTurnSchema>;
const subject = z.object(AssistantSubjectSchema.shape);
const complete = (result: AssistantResult) => ({ kind: "complete" as const, result });
const refusal = (code: keyof typeof ASSISTANT_FAILURES) => complete({ state: "refused", code, message: ASSISTANT_FAILURES[code] });

function syntheticAssistantFunctions(selected?: AssistantSubject): readonly AssistantFunctionSet[] { return [{ namespace: "synthetic", description: "Inert synthetic fixture functions; not a production tool registry.", functions: [
  { name: "answer", description: "Finish a synthetic explanation with checked citations.", parameters: Answer,
    async invoke(input) { return complete({ state: "answered", ...Answer.parse(input) }); } },
  { name: "read_subjects", description: "Search only the explicitly supplied synthetic subject fixture.", parameters: Search,
    async invoke(input, signal, context) {
      if (context.subjects === undefined) return refusal("ASSISTANT_SUBJECT_REQUIRED");
      const raw = await context.subjects.search(Search.parse(input).query, signal); context.assertCurrent();
      if (raw.length > 20) return refusal("ASSISTANT_LIMIT");
      const candidates = raw.map(value => subject.parse(value));
      if (new Set(candidates.map(value => value.subjectRef)).size !== candidates.length) return refusal("ASSISTANT_INVALID");
      if (candidates.length > 1) return complete({ state: "resolution-required", candidates });
      return { kind: "continue", output: { candidates } };
    } },
  { name: "propose", description: "Exercise the actual pure planner on an explicitly selected synthetic subject; never execute.", parameters: Proposal,
    async invoke(input, signal, context) {
      if (selected === undefined || context.subjects === undefined || context.planner === undefined) return refusal("ASSISTANT_SUBJECT_REQUIRED");
      const current = subject.parse(await context.subjects.resolve(selected.subjectRef, signal)); context.assertCurrent();
      if (JSON.stringify(current) !== JSON.stringify(selected)) return refusal("ASSISTANT_SUBJECT_REQUIRED");
      let proposal;
      try { proposal = prepareAssistantProposal(context.planner, Proposal.parse(input).workflowId, current); }
      catch { context.assertCurrent(); return refusal("ASSISTANT_PROPOSAL_REFUSED"); }
      context.assertCurrent();
      return complete({ state: "proposal", proposal });
    } },
] }]; }

export async function bindSyntheticAssistantFunctions(context: AssistantFunctionContext, signal: AbortSignal): Promise<readonly AssistantFunctionSet[]> {
  context.assertCurrent();
  if (context.subjects === undefined) throw new Error("synthetic-subject-owner-required");
  const selected = context.request.subjectRef === undefined ? undefined : subject.parse(await context.subjects.resolve(context.request.subjectRef, signal));
  context.assertCurrent();
  if (selected !== undefined && selected.subjectRef !== context.request.subjectRef) throw new Error("synthetic-selection-mismatch");
  return syntheticAssistantFunctions(selected);
}
export const syntheticAssistantTools = syntheticAssistantFunctions().map(set => AssistantFunctionNamespaceSchema.parse({ type: "namespace" as const, name: set.namespace, description: set.description,
  tools: set.functions.map(fn => ({ type: "function" as const, name: fn.name, description: fn.description, strict: true as const, parameters: z.toJSONSchema(fn.parameters) })) }));

export function syntheticAssistantResponse(turn: unknown, model = "gpt-6.1-sol", callId: string = randomUUID()): AssistantInferenceResult {
  const value = z.object({ action: z.string() }).passthrough().parse(turn), { action, ...argumentsValue } = value;
  return { model, responseId: `resp_${callId}`, output: [{ type: "function_call", namespace: "synthetic",
    name: action === "read-subjects" ? "read_subjects" : action, call_id: callId, arguments: JSON.stringify(argumentsValue), status: "completed" }] };
}
export function completedAssistantStream(turn: unknown, model = "gpt-6.1-sol"): string {
  const response = syntheticAssistantResponse(turn, model);
  return `data: ${JSON.stringify({ type: "response.completed", response: { id: response.responseId, model, status: "completed", output: response.output } })}\n\n`;
}

export const projectSyntheticAssistantInput: NonNullable<AssistantServiceOptions["projectInput"]> = () => ({
  input: { intent: "synthetic-protocol-verification" }, citations: [],
});
