import { Hono } from "hono";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { AssistantRequestSchema, AssistantRespondEnvelopeSchema, ASSISTANT_DEFAULT_MODEL } from "../../../src/models/dashboard/assistant.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { chatGptStatusFixture } from "../../support/helpers/chatgpt-status-fixture.js";
import { ASSISTANT_START_PROPOSAL } from "../../support/fixtures/dashboard/assistant-start.js";
import { startSweepOverlay } from "./sweep-fixtures-server.js";

export async function startAccountSweepServer() {
  const clock = manualClock(new Date("2026-11-17T18:00:00.000Z"));
  let connected = true, reads = 0, decisions = 0;
  const app: DashboardApp = new Hono();
  app.get("/api/v1/settings/chatgpt-account", c => {
    reads++;
    return c.json(chatGptStatusFixture(connected ? { state: "connected", name: "Fixture operator", email: "fixture@example.test",
      expiresAt: "2026-11-17T18:01:00.000Z", planUsage: "enabled" } : { state: "signed-out" }));
  });
  app.get("/api/v1/assistant/models", c => c.json({ models: [{ slug: ASSISTANT_DEFAULT_MODEL, displayName: "Fixture model" }] }));
  app.post("/api/v1/assistant/respond", async c => {
    const request = AssistantRequestSchema.parse(await c.req.json());
    return c.json(AssistantRespondEnvelopeSchema.parse({ kind: "result", result: { state: "action-proposal",
      proposal: { ...ASSISTANT_START_PROPOSAL, chatId: request.conversationId } } }));
  });
  app.post("/api/v1/assistant/action", c => { decisions++; return c.json({ state: "refused", code: "ASSISTANT_ACCOUNT_EXPIRED" }); });
  const server = await startSweepOverlay(app);
  return { ...server, now: clock.now(), reads: () => reads, decisions: () => decisions, loseAccount: () => { connected = false; } };
}
