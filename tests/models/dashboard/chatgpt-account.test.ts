import assert from "node:assert/strict";
import { it } from "vitest";
import { ChatGptConnectionRequestSchema, ChatGptConnectionResultSchema, ChatGptAccountStateSchema, ChatGptAuthorizationUrlSchema, ChatGptSignInCompletionSchema, ChatGptSignInStartResultSchema, ChatGptSignOutResultSchema } from "../../../src/models/dashboard/chatgpt-account.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
const attemptId = "00000000-0000-4000-8000-000000000001";
it("requires exact check identity and time with one strict connection outcome and fixed failure text", () => {
  const completed = { state: "completed", checkId: attemptId, checkedAt: "2026-10-12T12:00:00.000Z" };
  assert.equal(ChatGptConnectionRequestSchema.safeParse({ checkId: attemptId }).success, true);
  assert.equal(ChatGptConnectionRequestSchema.safeParse({ checkId: "invalid" }).success, false);
  assert.equal(ChatGptConnectionResultSchema.safeParse(completed).success, true);
  for (const extra of [{ checks: [] }, { model: "private" }, { accessToken: "private" }, { checkedAt: "invalid" }, { checkId: undefined }])
    assert.equal(ChatGptConnectionResultSchema.safeParse({ ...completed, ...extra }).success, false);
  const refused = { ...completed, state: "refused", code: "CHATGPT_CONNECTION_FAILED", message: ERROR_CATALOG.CHATGPT_CONNECTION_FAILED.text };
  assert.equal(ChatGptConnectionResultSchema.safeParse(refused).success, true);
  assert.equal(ChatGptConnectionResultSchema.safeParse({ ...refused, message: "private provider failure" }).success, false);
});
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
