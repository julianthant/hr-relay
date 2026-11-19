import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { createServedChatGptAccountPort } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { chatGptStatusFixture } from "../../../../support/helpers/chatgpt-status-fixture.js";

it("publishes the connected account when the BFF check takes more than ten seconds", async () => {
  const status = chatGptStatusFixture({ state: "connected", name: "Synthetic", email: "synthetic@example.com",
    expiresAt: "2026-10-12T13:00:00.000Z", planUsage: "enabled" });
  const response = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1", fetchImpl: (url, init) => {
    assert.equal(url, "http://127.0.0.1/api/v1/settings/chatgpt-account");
    signal = init?.signal;
    return response.promise;
  } });
  const port = createServedChatGptAccountPort(client, { nowMs: () => Date.parse("2026-10-12T12:00:00.000Z") });
  vi.useFakeTimers();
  try {
    const reading = port.refresh();
    await vi.advanceTimersByTimeAsync(12_000);
    assert.equal(port.getSnapshot().state, "loading");
    assert.equal(signal?.aborted, false);
    response.resolve(Response.json(status));
    await reading;
    assert.deepEqual(port.getSnapshot(), status.account);
    assert.deepEqual(port.getResource(), { state: "loaded", account: status.account });
  } finally {
    response.resolve(Response.json(status));
    port.dispose();
    vi.useRealTimers();
  }
});
