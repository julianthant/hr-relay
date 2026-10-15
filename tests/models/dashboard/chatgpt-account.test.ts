import assert from "node:assert/strict";
import { it } from "vitest";
import { ChatGptAccountStateSchema, ChatGptAuthorizationUrlSchema, ChatGptSignInCompletionSchema, ChatGptSignInStartResultSchema, ChatGptSignOutResultSchema } from "../../../src/models/dashboard/chatgpt-account.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
const attemptId = "00000000-0000-4000-8000-000000000001";
it("keeps account and lifecycle responses recursively strict and token-free", () => {
  const account = { state: "connected", name: "Synthetic", email: "synthetic@example.com", expiresAt: "2026-10-12T12:00:00.000Z", planUsage: "enabled" };
  assert.equal(ChatGptAccountStateSchema.safeParse(account).success, true);
  for (const token of ["accessToken", "refreshToken", "idToken"]) {
    assert.equal(ChatGptAccountStateSchema.safeParse({ ...account, [token]: "synthetic" }).success, false);
    assert.equal(ChatGptSignInCompletionSchema.safeParse({ state: "completed", attemptId, account: { ...account, [token]: "synthetic" } }).success, false);
  }
  assert.equal(ChatGptSignOutResultSchema.safeParse({ state: "signed-out", remoteRevocation: "unconfirmed" }).success, true);
  assert.equal(ChatGptSignInStartResultSchema.safeParse({ state: "started", attemptId, authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=synthetic", expiresAt: account.expiresAt }).success, true);
});
it("admits only the authorization origin/path and fixed registered error text", () => {
  for (const url of ["https://foreign.example/api/accounts/authorize", "https://auth.openai.com/other", "https://user@auth.openai.com/api/accounts/authorize", "https://auth.openai.com/api/accounts/authorize#token"]) assert.equal(ChatGptAuthorizationUrlSchema.safeParse(url).success, false);
  assert.equal(ChatGptAccountStateSchema.safeParse({ state: "unavailable", code: "CHATGPT_AUTH_INVALID", message: "raw secret" }).success, false);
  assert.equal(ChatGptSignInCompletionSchema.safeParse({ state: "refused", attemptId, code: "CHATGPT_AUTH_INVALID", message: ERROR_CATALOG.CHATGPT_AUTH_INVALID.text }).success, true);
});
