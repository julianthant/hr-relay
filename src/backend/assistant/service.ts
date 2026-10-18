import { z } from "zod";
import { ASSISTANT_FAILURES, AssistantRequestSchema, AssistantSubjectSchema, AssistantTurnSchema,
  type AssistantFailureCode, type AssistantResult, type AssistantSubject, type AssistantInferenceRequest } from "../../models/dashboard/assistant.js";
import { ChatGptAccountError } from "../accounts/chatgpt-account-service.js";
import type { Clock } from "../../rules/time/clock.js";
import { AssistantContextError, type AssistantContext } from "./context.js";
import { prepareAssistantProposal, type AssistantPlanner } from "./proposal.js";

export interface AssistantSubjectBroker {
  search(query: string, signal: AbortSignal): Promise<readonly unknown[]>;
  resolve(subjectRef: string, signal: AbortSignal): Promise<unknown>;
}
export interface AssistantModelPolicy {
  readonly model: string;
  readonly eligible: true;
  readonly consented: true;
  readonly billing: "chatgpt-plan";
  readonly verifiedUntil: string;
}
export interface AssistantServiceOptions {
  readonly account: { inferAssistant(input: AssistantInferenceRequest, signal: AbortSignal): Promise<unknown> };
  readonly context: AssistantContext;
  readonly runtime: () => Readonly<{ repositoryId: string; revision: string }>;
  readonly modelPolicy: AssistantModelPolicy | undefined;
  readonly clock: Clock;
  readonly subjects: AssistantSubjectBroker;
  readonly planner: AssistantPlanner;
}
const SubjectProjectionSchema = z.object(AssistantSubjectSchema.shape);
const PolicySchema = z.strictObject({ model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u), eligible: z.literal(true), consented: z.literal(true),
  billing: z.literal("chatgpt-plan"), verifiedUntil: z.string().datetime() });
const refused = (code: AssistantFailureCode): AssistantResult => ({ state: "refused", code, message: ASSISTANT_FAILURES[code] });
function projectSubject(input: unknown): AssistantSubject { return SubjectProjectionSchema.parse(input); }

export function createAssistantService(options: AssistantServiceOptions) {
  // Policy is installed by trusted composition, never by a request or model.
  const policy = PolicySchema.safeParse(options.modelPolicy);
  return Object.freeze({
    async respond(input: unknown, signal: AbortSignal): Promise<AssistantResult> {
      let stage: "inference" | "broker" | "planner" = "inference";
      try {
        const request = AssistantRequestSchema.safeParse(input);
        if (!request.success) return refused("ASSISTANT_INVALID");
        if (signal.aborted) return refused("ASSISTANT_CANCELLED");
        if (!policy.success || Date.parse(policy.data.verifiedUntil) <= options.clock.nowMs()) return refused("ASSISTANT_MODEL_UNVERIFIED");
        options.context.assertRuntime(options.runtime());
        const history: unknown[] = [];
        let selected: AssistantSubject | undefined;
        if (request.data.subjectRef !== undefined) {
          stage = "broker";
          selected = projectSubject(await options.subjects.resolve(request.data.subjectRef, signal));
          if (selected.subjectRef !== request.data.subjectRef) return refused("ASSISTANT_SUBJECT_REQUIRED");
        }
        const repeated = new Set<string>();
        for (let step = 0; step < 4; step++) {
          if (signal.aborted) return refused("ASSISTANT_CANCELLED");
          options.context.assertRuntime(options.runtime());
          if (Date.parse(policy.data.verifiedUntil) <= options.clock.nowMs()) return refused("ASSISTANT_MODEL_UNVERIFIED");
          const payload = JSON.stringify({ protocolVersion: 1, message: request.data.message, selectedSubject: selected,
            reference: options.context.reference, history });
          if (payload.length > 80_000) return refused("ASSISTANT_LIMIT");
          stage = "inference";
          const turn = AssistantTurnSchema.parse(await options.account.inferAssistant({ model: policy.data.model, input: payload }, signal));
          if (signal.aborted) return refused("ASSISTANT_CANCELLED");
          options.context.assertRuntime(options.runtime());
          if (Date.parse(policy.data.verifiedUntil) <= options.clock.nowMs()) return refused("ASSISTANT_MODEL_UNVERIFIED");
          if (turn.action === "answer") return { state: "answered", text: turn.text, citations: turn.citations.map(citation => options.context.citation(citation)) };
          if (turn.action === "propose") {
            if (selected === undefined) return refused("ASSISTANT_SUBJECT_REQUIRED");
            stage = "broker";
            const current = projectSubject(await options.subjects.resolve(selected.subjectRef, signal));
            if (JSON.stringify(current) !== JSON.stringify(selected)) return refused("ASSISTANT_SUBJECT_REQUIRED");
            if (signal.aborted) return refused("ASSISTANT_CANCELLED");
            options.context.assertRuntime(options.runtime());
            if (Date.parse(policy.data.verifiedUntil) <= options.clock.nowMs()) return refused("ASSISTANT_MODEL_UNVERIFIED");
            stage = "planner";
            const proposal = prepareAssistantProposal(options.planner, turn.workflowId, current);
            return { state: "proposal", proposal };
          }
          const key = JSON.stringify(turn);
          if (repeated.has(key)) return refused("ASSISTANT_LIMIT");
          repeated.add(key);
          stage = "broker";
          const raw = await options.subjects.search(turn.query, signal);
          if (signal.aborted) return refused("ASSISTANT_CANCELLED");
          options.context.assertRuntime(options.runtime());
          if (Date.parse(policy.data.verifiedUntil) <= options.clock.nowMs()) return refused("ASSISTANT_MODEL_UNVERIFIED");
          if (raw.length > 20) return refused("ASSISTANT_LIMIT");
          const candidates = raw.map(projectSubject);
          if (new Set(candidates.map(subject => subject.subjectRef)).size !== candidates.length) return refused("ASSISTANT_INVALID");
          if (candidates.length > 1) return { state: "resolution-required", candidates };
          history.push({ request: turn, result: { candidates } });
        }
        return refused("ASSISTANT_LIMIT");
      } catch (error) {
        if (signal.aborted) return refused("ASSISTANT_CANCELLED");
        if (error instanceof ChatGptAccountError) {
          if (error.code === "CHATGPT_USAGE_LIMIT") return refused("ASSISTANT_USAGE_LIMIT");
          if (error.code === "CHATGPT_PLAN_DISABLED") return refused("ASSISTANT_PLAN_DISABLED");
          if (error.code === "CHATGPT_ACCOUNT_EXPIRED") return refused("ASSISTANT_ACCOUNT_EXPIRED");
          if (error.code === "CHATGPT_OCR_CANCELLED") return refused("ASSISTANT_CANCELLED");
        }
        if (error instanceof AssistantContextError) return refused(error.code);
        if (stage === "planner") return refused("ASSISTANT_PROPOSAL_REFUSED");
        if (error instanceof z.ZodError) return refused("ASSISTANT_INVALID");
        return refused("ASSISTANT_UNAVAILABLE");
      }
    },
  });
}
export type AssistantService = ReturnType<typeof createAssistantService>;
