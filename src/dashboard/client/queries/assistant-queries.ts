import { AssistantPermissionViewSchema, type AssistantPermissionView, AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView, AssistantRequestSchema, AssistantRespondEnvelopeSchema, type AssistantRespondEnvelope, AssistantHistoryViewSchema, type AssistantHistoryView,
  AssistantConversationViewSchema, type AssistantConversationView, AssistantHistoryOperationSchema, type AssistantHistoryOperation, AssistantHistoryResultSchema, type AssistantHistoryResult, AssistantActionDecisionSchema, AssistantActionResultSchema, type AssistantActionDecision, type AssistantActionResult, type AssistantRequest } from "../../../models/dashboard/assistant.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";

export interface AssistantQueries {
  assistantPermission?(signal?: AbortSignal): Promise<AssistantPermissionView>;
  assistantModelPreference?(signal?: AbortSignal): Promise<AssistantModelPreferenceView>;
  assistantDecide?(input: AssistantActionDecision, signal?: AbortSignal): Promise<AssistantActionResult>;
  assistantRespond(input: AssistantRequest, signal?: AbortSignal): Promise<AssistantRespondEnvelope>;
  assistantHistory?(signal?: AbortSignal): Promise<AssistantHistoryView>;
  assistantConversation?(conversationId: string, signal?: AbortSignal): Promise<AssistantConversationView>;
  assistantHistoryWrite?(input: AssistantHistoryOperation, signal?: AbortSignal): Promise<AssistantHistoryResult>;
}
export function createAssistantQueries(transport: DashboardTransport): AssistantQueries {
  return Object.freeze({
    async assistantPermission(signal?: AbortSignal) {
      return parseOrThrow(AssistantPermissionViewSchema, "assistant-permission", await transport.requestJson("/api/v1/assistant/permission", signal === undefined ? {} : { signal }));
    },
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
      const envelope = parseOrThrow(AssistantRespondEnvelopeSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantRequestSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
      const receipt = envelope.receipt;
      if (receipt !== undefined && (receipt.conversationId !== input.conversationId || receipt.messageId !== input.messageId)) throw new Error("assistant-receipt-mismatch");
      return envelope;
    },
    async assistantHistory(signal?: AbortSignal) {
      return parseOrThrow(AssistantHistoryViewSchema, "assistant-history", await transport.requestJson("/api/v1/assistant/history", signal === undefined ? {} : { signal }));
    },
    async assistantConversation(conversationId: string, signal?: AbortSignal) {
      const view = parseOrThrow(AssistantConversationViewSchema, "assistant-conversation", await transport.requestJson(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}`,
        signal === undefined ? {} : { signal }));
      if (view.id !== conversationId) throw new Error("assistant-conversation-mismatch");
      return view;
    },
    async assistantHistoryWrite(input: AssistantHistoryOperation, signal?: AbortSignal) {
      const path = "/api/v1/assistant/history";
      return parseOrThrow(AssistantHistoryResultSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantHistoryOperationSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
    },
  });
}
