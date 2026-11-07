import { ChatGptAccountViewSchema, ChatGptAttemptIdSchema, ChatGptCancelResultSchema, ChatGptEmptyRequestSchema,
  ChatGptOcrTestResultSchema, ChatGptSignInCompletionSchema, ChatGptSignInRequestSchema, ChatGptSignInStartResultSchema, ChatGptSignOutResultSchema,
  type ChatGptSignInRequest } from "../../../models/dashboard/chatgpt-account.js";
import type { z } from "zod";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";
import { schemaError } from "../errors.js";

export interface ChatGptAccountQueries {
  chatGptAccount(): Promise<z.infer<typeof ChatGptAccountViewSchema>>;
  startChatGptSignIn(input: ChatGptSignInRequest): Promise<z.infer<typeof ChatGptSignInStartResultSchema>>;
  completeChatGptSignIn(attemptId: string, signal?: AbortSignal): Promise<z.infer<typeof ChatGptSignInCompletionSchema>>;
  cancelChatGptSignIn(attemptId: string, signal?: AbortSignal): Promise<z.infer<typeof ChatGptCancelResultSchema>>;
  testChatGptOcr(signal?: AbortSignal): Promise<z.infer<typeof ChatGptOcrTestResultSchema>>;
  signOutChatGpt(): Promise<z.infer<typeof ChatGptSignOutResultSchema>>;
}
export function createChatGptAccountQueries(transport: DashboardTransport): ChatGptAccountQueries {
  return Object.freeze({
    async chatGptAccount() { return parseOrThrow(ChatGptAccountViewSchema, "GET /api/v1/settings/chatgpt-account", await transport.requestJson("/api/v1/settings/chatgpt-account")); },
    async startChatGptSignIn(input: ChatGptSignInRequest) {
      const path = "/api/v1/settings/chatgpt-account/sign-in";
      return parseOrThrow(ChatGptSignInStartResultSchema, `POST ${path}`, await transport.requestJson(path,
        { method: "POST", body: JSON.stringify(ChatGptSignInRequestSchema.parse(input)) }));
    },
    async completeChatGptSignIn(attemptId: string, signal?: AbortSignal) {
      const path = `/api/v1/settings/chatgpt-account/sign-in/${ChatGptAttemptIdSchema.parse(attemptId)}`;
      const result = parseOrThrow(ChatGptSignInCompletionSchema, `GET ${path}`, await transport.requestJson(path, signal === undefined ? undefined : { signal }));
      if (result.attemptId !== attemptId) throw schemaError(`GET ${path}`, "account attempt differs from request");
      return result;
    },
    async cancelChatGptSignIn(attemptId: string, signal?: AbortSignal) {
      const path = `/api/v1/settings/chatgpt-account/sign-in/${ChatGptAttemptIdSchema.parse(attemptId)}/cancel`;
      const result = parseOrThrow(ChatGptCancelResultSchema, `POST ${path}`, await transport.requestJson(path,
        { method: "POST", body: JSON.stringify(ChatGptEmptyRequestSchema.parse({})), ...(signal === undefined ? {} : { signal }) }));
      if (result.state === "cancelled" && result.attemptId !== attemptId) throw schemaError(`POST ${path}`, "account attempt differs from request");
      return result;
    },
    async testChatGptOcr(signal?: AbortSignal) {
      const path = "/api/v1/settings/chatgpt-account/test-ocr";
      return parseOrThrow(ChatGptOcrTestResultSchema, `POST ${path}`, await transport.requestJson(path,
        { method: "POST", body: JSON.stringify(ChatGptEmptyRequestSchema.parse({})), ...(signal === undefined ? {} : { signal }) }));
    },
    async signOutChatGpt() {
      const path = "/api/v1/settings/chatgpt-account/sign-out";
      return parseOrThrow(ChatGptSignOutResultSchema, `POST ${path}`, await transport.requestJson(path,
        { method: "POST", body: JSON.stringify(ChatGptEmptyRequestSchema.parse({})) }));
    },
  });
}
