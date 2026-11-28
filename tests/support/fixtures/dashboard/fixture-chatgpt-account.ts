import { ChatGptAccountStatusSchema } from "../../../../src/models/dashboard/chatgpt-account.js";

const unchecked = { state: "unchecked", checkedAt: null, failureCode: null };

export const FIXTURE_CHATGPT_OCR_AVAILABLE = ChatGptAccountStatusSchema.parse({
  account: { state: "connected", name: "Fixture Operator", email: "fixture@example.test", expiresAt: "2026-11-01T00:00:00Z", planUsage: "enabled" },
  connection: { state: "completed", checkedAt: "2026-10-12T12:00:00Z", failureCode: null }, usage: { state: "available", resetAt: null },
  ocrModelAvailable: true,
});

export const FIXTURE_CHATGPT_OCR_SIGNED_OUT = ChatGptAccountStatusSchema.parse({
  account: { state: "signed-out" }, connection: unchecked, usage: { state: "unavailable", reason: "signed-out" },
});
