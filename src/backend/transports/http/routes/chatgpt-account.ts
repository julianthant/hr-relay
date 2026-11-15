import type { ChatGptOcrTestService } from "../../../accounts/chatgpt-ocr-test.js";
import { randomUUID } from "node:crypto";
import type { Clock } from "../../../../rules/time/clock.js";
import { ChatGptAccountError, type ChatGptAccountService, type ChatGptAuthorization } from "../../../accounts/chatgpt-account-service.js";
import { ChatGptCredentialError } from "../../../storage/configuration/chatgpt-credential-repository.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { ChatGptAccountStatusSchema, ChatGptAttemptIdSchema, ChatGptCancelResultSchema, ChatGptEmptyRequestSchema,
  ChatGptOcrTestResultSchema, ChatGptSignInCompletionSchema, ChatGptSignInRequestSchema, ChatGptSignInStartResultSchema,
  type ChatGptSignInCompletion } from "../../../../models/dashboard/chatgpt-account.js";
import { operatorMutationIngressGuard } from "./operator-mutation-ingress.js";
import type { DashboardApp } from "./api-types.js";
import type { ShellRouteDeps } from "./shell-types.js";
import { wireError } from "./failure-status.js";

export interface ChatGptAccountRouteDeps { readonly debugEvents?: ShellRouteDeps["debugEvents"]; readonly chatGptAccount?: Pick<ChatGptAccountService, "refreshAccount" | "signIn" | "readStatus">; readonly chatGptOcrTest?: ChatGptOcrTestService }
function failure(error: unknown, dispatched = false, unknownCode: ErrorCatalogCode = "CHATGPT_AUTH_UNAVAILABLE") {
  const known = error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError;
  const code: ErrorCatalogCode = known ? error.code : unknownCode;
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

export function registerChatGptAccountRoutes(app: DashboardApp, deps: ChatGptAccountRouteDeps & { readonly clock: Clock }): void {
  // Readback of the last accepted attempt only; whether it is still in flight is the service's to say.
  let latest: { id: string; authorization: ChatGptAuthorization; completion: Promise<ChatGptSignInCompletion>;
    loggingFailure?: { cause: unknown } } | undefined;
  const service = () => {
    if (deps.chatGptAccount === undefined) throw new ChatGptAccountError("CHATGPT_AUTH_UNAVAILABLE");
    return deps.chatGptAccount;
  };
  const attempt = (id: string) => {
    if (!ChatGptAttemptIdSchema.safeParse(id).success || latest?.id !== id) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
    return latest;
  };
  app.get("/api/v1/settings/chatgpt-account", async c => {
    c.header("Cache-Control", "no-store");
    try {
      const status = await service().readStatus(c.req.raw.signal), account = status.account;
      return c.json(ChatGptAccountStatusSchema.parse({ ...status, account: latest?.authorization.signingIn === true
        ? { state: "signing-in", attemptId: latest.id, expiresAt: latest.authorization.expiresAt, authorizationUrl: latest.authorization.authorizationUrl, account } : account }));
    } catch (error) {
      const result = failure(error, true, "CHATGPT_CONNECTION_FAILED");
      return c.json(ChatGptAccountStatusSchema.parse({
        account: { state: "unavailable", code: result.code, message: result.message },
        connection: { state: result.state, checkedAt: deps.clock.now().toISOString(), failureCode: result.code },
        usage: { state: "unavailable", reason: result.code === "CHATGPT_SERVICE_CLOSED" ? "closed" : "unavailable" },
      }));
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
      const current: NonNullable<typeof latest> = { id, authorization, completion: authorization.completion.then(account => ChatGptSignInCompletionSchema.parse({ state: "completed", attemptId: id, account }))
        .catch(error => {
          const result = failure(error, true);
          try {
            deps.debugEvents?.emit({ category: "http", phase: "failed", correlationId: id, area: "chatgpt-sign-in",
              code: result.code, reason: "authorization-failed" });
          } catch (loggingError) { current.loggingFailure = { cause: loggingError }; }
          return ChatGptSignInCompletionSchema.parse({ ...result, attemptId: id });
        }) };
      latest = current;
      return c.json(result);
    } catch (error) { return c.json(ChatGptSignInStartResultSchema.parse(failure(error, dispatched))); }
  });
  app.get("/api/v1/settings/chatgpt-account/sign-in/:attemptId", async c => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("attemptId");
    try {
      const current = attempt(id), completion = await waitForCompletion(current.completion, c.req.raw.signal);
      if (current.loggingFailure !== undefined) return c.json(wireError("LOGGING_UNAVAILABLE", ERROR_CATALOG.LOGGING_UNAVAILABLE.text, false), 500);
      return c.json(ChatGptSignInCompletionSchema.parse(completion.state === "completed" ? { ...completion, account: await service().refreshAccount() } : completion));
    }
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
      if (!current.authorization.signingIn) throw new ChatGptAccountError("CHATGPT_AUTH_INVALID");
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
}
