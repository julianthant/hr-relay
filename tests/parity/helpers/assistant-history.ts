import type { Page } from "@playwright/test";

export const PARITY_CHAT_ID = "00000000-0000-4000-8000-00000000000a";

/** Serves one empty chat; the fixture BFF has no assistant history routes. */
export async function serveAssistantHistory(page: Page): Promise<void> {
  const chat = { id: PARITY_CHAT_ID, title: "New chat", revision: 1, createdAt: "2026-10-19T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
  await page.route("**/api/v1/assistant/history", route => route.fulfill({ json: route.request().method() === "GET"
    ? { chats: [chat], selectedId: PARITY_CHAT_ID } : { state: "saved", conversationId: PARITY_CHAT_ID, revision: 1 } }));
  await page.route(`**/api/v1/assistant/conversations/${PARITY_CHAT_ID}`, route => route.fulfill({ json: { id: PARITY_CHAT_ID, title: "New chat", revision: 1,
    draft: "", composer: "", importTotal: 0, importNotice: null, messages: [] } }));
}
