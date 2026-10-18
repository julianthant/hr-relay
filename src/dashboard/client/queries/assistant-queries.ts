import { AssistantRequestSchema, AssistantResultSchema, type AssistantRequest, type AssistantResult } from "../../../models/dashboard/assistant.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";

export interface AssistantQueries {
  assistantRespond(input: AssistantRequest, signal?: AbortSignal): Promise<AssistantResult>;
}
export function createAssistantQueries(transport: DashboardTransport): AssistantQueries {
  return Object.freeze({
    async assistantRespond(input: AssistantRequest, signal?: AbortSignal) {
      const path = "/api/v1/assistant/respond";
      return parseOrThrow(AssistantResultSchema, `POST ${path}`, await transport.requestJson(path, {
        method: "POST", body: JSON.stringify(AssistantRequestSchema.parse(input)), ...(signal === undefined ? {} : { signal }),
      }));
    },
  });
}
