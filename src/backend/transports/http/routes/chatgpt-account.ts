import type { ChatGptOcrTestService } from "../../../accounts/chatgpt-ocr-test.js";
import { randomUUID } from "node:crypto";
import { ChatGptAccountError, type ChatGptAccountService, type ChatGptAuthorization } from "../../../accounts/chatgpt-account-service.js";
import { ChatGptCredentialError } from "../../../storage/configuration/credential-store.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { ChatGptAccountViewSchema, ChatGptAttemptIdSchema, ChatGptCancelResultSchema, ChatGptEmptyRequestSchema,
  ChatGptOcrTestResultSchema, ChatGptSignInCompletionSchema, ChatGptSignInRequestSchema, ChatGptSignInStartResultSchema, ChatGptSignOutResultSchema,
  type ChatGptSignInCompletion } from "../../../../models/dashboard/chatgpt-account.js";
import { operatorMutationIngressGuard } from "./operator-mutation-ingress.js";
import type { DashboardApp } from "./api-types.js";

export interface ChatGptAccountRouteDeps { readonly chatGptAccount?: Pick<ChatGptAccountService, "readAccount" | "signIn" | "signOut">; readonly chatGptOcrTest?: ChatGptOcrTestService }
function failure(error: unknown, dispatched = false) {
  const known = error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError;
  const code: ErrorCatalogCode = known ? error.code : "CHATGPT_AUTH_UNAVAILABLE";
  return { state: code === "CHATGPT_CREDENTIAL_UNCERTAIN" || code === "CHATGPT_RESOURCE_CLOSURE_UNPROVED" || !known && dispatched ? "uncertain" as const : "refused" as const, code, message: ERROR_CATALOG[code].text };
}

async function waitForCompletion(completion: Promise<ChatGptSignInCompletion>, signal: AbortSignal): Promise<ChatGptSignInCompletion> {
  signal.throwIfAborted();
  let abort = (): void => undefined;
  const cancelled = new Promise<void>(resolve => { abort = () => resolve(); })
    .then(() => { signal.throwIfAborted(); return completion; });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    const result = await Promise.race([completion, cancelled]);
    signal.throwIfAborted();
    return result;
  }
  finally { signal.removeEventListener("abort", abort); }
}

export function registerChatGptAccountRoutes(app: DashboardApp, deps: ChatGptAccountRouteDeps): void {
  let latest: { id: string; authorization: ChatGptAuthorization; pending: boolean; completion: Promise<ChatGptSignInCompletion> } | undefined;
  const service = () => {
    if (deps.chatGptAccount === undefined) throw new ChatGptAccountError("CHATGPT_AUTH_UNAVAILABLE");
    return deps.chatGptAccount;
  };
  const attempt = (id: string) => {
    if (!ChatGptAttemptIdSchema.safeParse(id).success || latest?.id !== id) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
    return latest;
  };
  app.get("/api/v1/settings/chatgpt-account", c => {
    c.header("Cache-Control", "no-store");
    try {
      const account = service().readAccount();
      return c.json(ChatGptAccountViewSchema.parse(latest?.pending === true
        ? { state: "signing-in", attemptId: latest.id, expiresAt: latest.authorization.expiresAt, authorizationUrl: latest.authorization.authorizationUrl, account } : account));
    } catch (error) {
      const result = failure(error);
      return c.json(ChatGptAccountViewSchema.parse({ state: "unavailable", code: result.code, message: result.message }));
    }
  });
  app.post("/api/v1/settings/chatgpt-account/sign-in", async c => {
    c.header("Cache-Control", "no-store");
    let dispatched = false;
    try {
      const parsed = ChatGptSignInRequestSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
      const accountService = service();
      dispatched = true;
      const authorization = await accountService.signIn(parsed.data), id = randomUUID();
      const parsedResult = ChatGptSignInStartResultSchema.safeParse({ state: "started", attemptId: id, authorizationUrl: authorization.authorizationUrl, expiresAt: authorization.expiresAt });
      if (!parsedResult.success) { await authorization.cancel(); throw new ChatGptAccountError("CHATGPT_AUTH_INVALID"); }
      const result = parsedResult.data;
      const current: NonNullable<typeof latest> = { id, authorization, pending: true, completion: authorization.completion.then(account => ChatGptSignInCompletionSchema.parse({ state: "completed", attemptId: id, account }))
        .catch(error => ChatGptSignInCompletionSchema.parse({ ...failure(error, true), attemptId: id }))
        .finally(() => { current.pending = false; }) };
      latest = current;
      return c.json(result);
    } catch (error) { return c.json(ChatGptSignInStartResultSchema.parse(failure(error, dispatched))); }
  });
  app.get("/api/v1/settings/chatgpt-account/sign-in/:attemptId", async c => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("attemptId");
    try { return c.json(await waitForCompletion(attempt(id).completion, c.req.raw.signal)); }
    catch (error) {
      return c.json(failure(error), 400);
    }
  });
  app.post("/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel", async c => {
    c.header("Cache-Control", "no-store");
    let dispatched = false;
    try {
      if (!ChatGptEmptyRequestSchema.safeParse(await c.req.json()).success) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
      const current = attempt(c.req.param("attemptId"));
      if (!current.pending) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
      dispatched = true;
      await current.authorization.cancel();
      return c.json(ChatGptCancelResultSchema.parse({ state: "cancelled", attemptId: current.id }));
    } catch (error) { return c.json(ChatGptCancelResultSchema.parse(failure(error, dispatched))); }
  });
  app.use("/api/v1/settings/chatgpt-account/test-ocr", operatorMutationIngressGuard);
  app.post("/api/v1/settings/chatgpt-account/test-ocr", async c => {
    c.header("Cache-Control", "no-store");
    try {
      if (!ChatGptEmptyRequestSchema.safeParse(await c.req.json()).success) throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
      if (deps.chatGptOcrTest === undefined) throw new ChatGptAccountError("CHATGPT_AUTH_UNAVAILABLE");
      return c.json(ChatGptOcrTestResultSchema.parse(await deps.chatGptOcrTest.testOcr(c.req.raw.signal)));
    } catch (error) { return c.json(ChatGptOcrTestResultSchema.parse(failure(error))); }
  });
  app.post("/api/v1/settings/chatgpt-account/sign-out", async c => {
    c.header("Cache-Control", "no-store");
    let dispatched = false;
    try {
      if (!ChatGptEmptyRequestSchema.safeParse(await c.req.json()).success) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
      const accountService = service();
      dispatched = true;
      return c.json(ChatGptSignOutResultSchema.parse(await accountService.signOut()));
    } catch (error) { return c.json(ChatGptSignOutResultSchema.parse(failure(error, dispatched))); }
  });
}
