import { chatGptStatusFixture } from "../../chatgpt-status-fixture.js";
import { Hono } from "hono";
import { ChatGptAccountStateSchema,ChatGptSignInStartSchema,type ChatGptAccountState } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT, AssistantModelPreferenceViewSchema } from "../../../../../src/models/dashboard/assistant.js";
import type * as FixtureSettingsTypes from "../../../fixtures/dashboard/fixture-settings.js";
import { assistantHistoryServer } from "../assistant-history-server.js";


const FIXTURE_ASSISTANT_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

export function createFixtureSettingsRoutesSetup({ FIXTURE_EDITABLE_SETTINGS, FIXTURE_SETTINGS_FACTS }: {
  FIXTURE_EDITABLE_SETTINGS: typeof FixtureSettingsTypes.FIXTURE_EDITABLE_SETTINGS;
  FIXTURE_SETTINGS_FACTS: typeof FixtureSettingsTypes.FIXTURE_SETTINGS_FACTS;
}) {
  function registerFixtureSettingsRoutes({ app }: { app: Hono }): void {
    app.get("/api/v1/assistant/model-preference", c => c.json(AssistantModelPreferenceViewSchema.parse({
      profileId: FIXTURE_ASSISTANT_PROFILE_ID, epoch: 1, revision: 0,
      preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT },
    })));
    const history = assistantHistoryServer(FIXTURE_ASSISTANT_PROFILE_ID);
    app.get("/api/v1/assistant/history", async c => c.json(await history.client.assistantHistory()));
    app.get("/api/v1/assistant/conversations/:conversationId", async c => {
      try { return c.json(await history.client.assistantConversation(c.req.param("conversationId"))); }
      catch { return c.json({ error: { code: "ASSISTANT_CONVERSATION_STALE", message: "stale", retryable: false } }, 404); }
    });
    app.post("/api/v1/assistant/history", async c => c.json(await history.client.assistantHistoryWrite(await c.req.json())));
    let account: ChatGptAccountState = { state: "signed-out" };
    const attemptId = "00000000-0000-4000-8000-000000000088";
    app.get("/api/v1/settings/chatgpt-account", c => c.json(chatGptStatusFixture(account)));
    app.post("/api/v1/settings/chatgpt-account/sign-in", c => {
      account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", expiresAt: "2099-10-12T12:00:00.000Z", planUsage: "enabled" });
      return c.json(ChatGptSignInStartSchema.parse({ state: "started", attemptId,
        authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=fixture", expiresAt: "2099-10-12T12:00:00.000Z" }));
    });
    app.get("/api/v1/settings/chatgpt-account/sign-in/:attemptId", c => c.json({ state: "completed", attemptId, account }));
    app.post("/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel", c => c.json({ state: "cancelled", attemptId }));



    app.get("/api/v1/settings/facts", (c) => c.json(FIXTURE_SETTINGS_FACTS as unknown));

    app.get("/api/v1/settings/editable", (c) => c.json(FIXTURE_EDITABLE_SETTINGS as unknown));
  }

  return { registerFixtureSettingsRoutes };
}
