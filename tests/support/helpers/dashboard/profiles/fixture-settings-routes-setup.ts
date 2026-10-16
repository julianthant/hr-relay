import { ChatGptSignInStartSchema, ChatGptAccountStateSchema, type ChatGptAccountState } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { Hono } from "hono";
import type * as FixtureSettingsTypes from "../../../fixtures/dashboard/fixture-settings.js";


export function createFixtureSettingsRoutesSetup({ FIXTURE_EDITABLE_SETTINGS, FIXTURE_SETTINGS_FACTS, FIXTURE_STORAGE_RELOCATION }: {
  FIXTURE_EDITABLE_SETTINGS: typeof FixtureSettingsTypes.FIXTURE_EDITABLE_SETTINGS;
  FIXTURE_SETTINGS_FACTS: typeof FixtureSettingsTypes.FIXTURE_SETTINGS_FACTS;
  FIXTURE_STORAGE_RELOCATION: typeof FixtureSettingsTypes.FIXTURE_STORAGE_RELOCATION;
}) {
  function registerFixtureSettingsRoutes({ app }: { app: Hono }): void {
    let account: ChatGptAccountState = { state: "signed-out" };
    const attemptId = "00000000-0000-4000-8000-000000000088";
    app.get("/api/v1/settings/chatgpt-account", c => c.json(account));
    app.post("/api/v1/settings/chatgpt-account/sign-in", c => {
      account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", expiresAt: "2099-10-12T12:00:00.000Z", planUsage: "enabled" });
      return c.json(ChatGptSignInStartSchema.parse({ state: "started", attemptId,
        authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=fixture", expiresAt: "2099-10-12T12:00:00.000Z" }));
    });
    app.get("/api/v1/settings/chatgpt-account/sign-in/:attemptId", c => c.json({ state: "completed", attemptId, account }));
    app.post("/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel", c => c.json({ state: "cancelled", attemptId }));
    app.post("/api/v1/settings/chatgpt-account/sign-out", c => { account = { state: "signed-out" }; return c.json({ state: "signed-out", remoteRevocation: "not-needed" }); });



    app.get("/api/v1/settings/facts", (c) => c.json(FIXTURE_SETTINGS_FACTS as unknown));

    app.get("/api/v1/settings/editable", (c) => c.json(FIXTURE_EDITABLE_SETTINGS as unknown));
    app.get("/api/v1/settings/storage-relocation", (c) => c.json(FIXTURE_STORAGE_RELOCATION));
  }

  return { registerFixtureSettingsRoutes };
}
