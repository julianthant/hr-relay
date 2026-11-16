import { ChatGptAccountStatusSchema, ChatGptAccountViewSchema } from "../../../src/models/dashboard/chatgpt-account.js";

export function chatGptStatusFixture(value: unknown) {
  const account = ChatGptAccountViewSchema.parse(value);
  const state = account.state === "signing-in" ? account.account : account;
  const available = state.state === "connected" && state.planUsage === "enabled";
  return ChatGptAccountStatusSchema.parse({ account,
    connection: available ? { state: "completed", checkedAt: "2026-10-12T12:00:00.000Z", failureCode: null }
      : { state: "refused", checkedAt: "2026-10-12T12:00:00.000Z", failureCode: "CHATGPT_ACCOUNT_EXPIRED" },
    usage: available ? { state: "available", resetAt: null }
      : state.state === "connected" && state.planUsage === "limit-reached" ? { state: "limit-reached", resetAt: null }
        : { state: "unavailable", reason: account.state === "signing-in" ? "pending" : state.state === "connected" ? "disabled" : state.state },
  });
}
