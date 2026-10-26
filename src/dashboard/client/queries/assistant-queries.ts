import { AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView, AssistantRequestSchema, AssistantResultSchema, AssistantActionDecisionSchema, AssistantActionResultSchema, type AssistantActionDecision, type AssistantActionResult, type AssistantRequest, type AssistantResult } from "../../../models/dashboard/assistant.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";

export interface AssistantQueries {
  assistantModelPreference?(signal?: AbortSignal): Promise<AssistantModelPreferenceView>;
  assistantDecide?(input: AssistantActionDecision, signal?: AbortSignal): Promise<AssistantActionResult>;
  assistantRespond(input: AssistantRequest, signal?: AbortSignal): Promise<AssistantResult>;
}
export function createAssistantQueries(transport: DashboardTransport): AssistantQueries {
  return Object.freeze({
    async assistantModelPreference(signal?: AbortSignal) {
      return parseOrThrow(AssistantModelPreferenceViewSchema, 'model-preference', await transport.requestJson("/api/v1/assistant/model-preference", signal === undefined ? {} : { signal }));
    },
    async assistantDecide(input: AssistantActionDecision, signal?: AbortSignal) {
      const path = "/api/v1/assistant/action";
      const result = parseOrThrow(AssistantActionResultSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantActionDecisionSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
      if ("actionId" in result && result.actionId !== input.actionId) throw new Error("assistant-action-response-mismatch");
      return result;
    },
    async assistantRespond(input: AssistantRequest, signal?: AbortSignal) {
      const path = "/api/v1/assistant/respond";
      return parseOrThrow(AssistantResultSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantRequestSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
    },
  });
}
