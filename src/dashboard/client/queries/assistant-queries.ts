import { AssistantModelCatalogSchema, type AssistantModelCatalog, AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView, AssistantM1RequestSchema, AssistantM1RespondEnvelopeSchema, type AssistantM1RespondEnvelope, AssistantHistoryWireSchema, type AssistantHistoryWire,
  AssistantM1ConversationWireSchema, type AssistantM1ConversationWire, AssistantHistoryOperationSchema, type AssistantHistoryOperation, AssistantHistoryResultSchema, type AssistantHistoryResult, type AssistantM1Request,
  AssistantStageResultSchema, type AssistantStageResult, AssistantActivityWireSchema, type AssistantActivityWire } from "../../../models/dashboard/assistant.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";

export interface AssistantQueries {
  assistantModels?(signal?: AbortSignal): Promise<AssistantModelCatalog>;
  assistantModelPreference?(signal?: AbortSignal): Promise<AssistantModelPreferenceView>;
  assistantRespond(input: AssistantM1Request, signal?: AbortSignal): Promise<AssistantM1RespondEnvelope>;
  assistantHistory?(signal?: AbortSignal): Promise<AssistantHistoryWire>;
  /** Today's recorded assistant activity. */
  assistantActivity?(signal?: AbortSignal): Promise<AssistantActivityWire>;
  assistantConversation?(conversationId: string, signal?: AbortSignal): Promise<AssistantM1ConversationWire>;
  assistantHistoryWrite?(input: AssistantHistoryOperation, signal?: AbortSignal): Promise<AssistantHistoryResult>;
  /** Uploads one file's raw bytes to stage it under the chat; nothing reaches the model until a send names its ID. */
  assistantStageAttachment?(conversationId: string, file: Readonly<{ name: string; mediaType: string; bytes: Uint8Array }>, signal?: AbortSignal): Promise<AssistantStageResult>;
}
export function createAssistantQueries(transport: DashboardTransport): AssistantQueries {
  return Object.freeze({
    async assistantModels(signal?: AbortSignal) {
      return parseOrThrow(AssistantModelCatalogSchema, 'assistant-models', await transport.requestJson("/api/v1/assistant/models", signal === undefined ? {} : { signal }));
    },
    async assistantModelPreference(signal?: AbortSignal) {
      return parseOrThrow(AssistantModelPreferenceViewSchema, 'model-preference', await transport.requestJson("/api/v1/assistant/model-preference", signal === undefined ? {} : { signal }));
    },
    async assistantRespond(input: AssistantM1Request, signal?: AbortSignal) {
      const path = "/api/v1/assistant/respond";
      const envelope = parseOrThrow(AssistantM1RespondEnvelopeSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantM1RequestSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
      const receipt = envelope.receipt;
      if (receipt !== undefined && (receipt.conversationId !== input.conversationId || receipt.messageId !== input.messageId)) throw new Error("assistant-receipt-mismatch");
      return envelope;
    },
    async assistantHistory(signal?: AbortSignal) {
      return parseOrThrow(AssistantHistoryWireSchema, "assistant-history", await transport.requestJson("/api/v1/assistant/history", signal === undefined ? {} : { signal }));
    },
    async assistantActivity(signal?: AbortSignal) {
      return parseOrThrow(AssistantActivityWireSchema, "assistant-activity", await transport.requestJson("/api/v1/assistant/activity", signal === undefined ? {} : { signal }));
    },
    async assistantConversation(conversationId: string, signal?: AbortSignal) {
      const view = parseOrThrow(AssistantM1ConversationWireSchema, "assistant-conversation", await transport.requestJson(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}`,
        signal === undefined ? {} : { signal }));
      if (view.id !== conversationId) throw new Error("assistant-conversation-mismatch");
      return view;
    },
    async assistantStageAttachment(conversationId: string, file: Readonly<{ name: string; mediaType: string; bytes: Uint8Array }>, signal?: AbortSignal) {
      const path = `/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/attachments`;
      const response = await transport.requestJsonResponse(path, {
        method: "POST", headers: { "content-type": file.mediaType, "x-relay-file-name": encodeURIComponent(file.name) }, body: new Uint8Array(file.bytes).buffer,
        ...(signal === undefined ? {} : { signal }),
      });
      const result = parseOrThrow(AssistantStageResultSchema, `POST ${path}`, response.body);
      if (result.state === "staged" && (result.attachment.name !== file.name || result.attachment.byteLength !== file.bytes.byteLength)) throw new Error("assistant-attachment-mismatch");
      return result;
    },
    async assistantHistoryWrite(input: AssistantHistoryOperation, signal?: AbortSignal) {
      const path = "/api/v1/assistant/history";
      return parseOrThrow(AssistantHistoryResultSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantHistoryOperationSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
    },
  });
}
