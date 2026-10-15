import { ChatGptAccountStateSchema } from "../../../src/models/dashboard/chatgpt-account.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { ChatGptOcrRequestSchema, ChatGptAccountError } from "../../../src/backend/accounts/chatgpt-account-service.js";

it("public account states reject token properties", () => {
  assert.equal(ChatGptAccountStateSchema.safeParse({ state: "signed-out", accessToken: "synthetic" }).success, false);
  assert.equal(ChatGptAccountStateSchema.safeParse({ state: "connected", name: "Synthetic", email: "synthetic@example.com", expiresAt: "2026-10-12T12:00:00.000Z", planUsage: "enabled", refreshToken: "synthetic" }).success, false);
});
it("OCR admits inline image and PDF inputs only", () => {
  for (const input of [{ kind: "image", mediaType: "image/png", base64: "YQ==" }, { kind: "pdf", filename: "synthetic.pdf", base64: "YQ==" }])
    assert.equal(ChatGptOcrRequestSchema.safeParse({ model: "gpt-6.1-sol", instruction: "Read this synthetic form", input }).success, true);
  for (const input of [{ kind: "image", mediaType: "image/svg+xml", base64: "YQ==" }, { kind: "pdf", filename: "../private.pdf", base64: "YQ==" }, { kind: "image", imageUrl: "https://elsewhere.example/image" }])
    assert.equal(ChatGptOcrRequestSchema.safeParse({ model: "gpt-6.1-sol", instruction: "Read", input }).success, false);
});
it("account errors carry fixed safe text", () => {
  assert.equal(new ChatGptAccountError("CHATGPT_AUTH_INVALID").message, "The ChatGPT sign-in response could not be verified.");
  assert.equal(new ChatGptAccountError("CHATGPT_USAGE_LIMIT").code, "CHATGPT_USAGE_LIMIT");
});
