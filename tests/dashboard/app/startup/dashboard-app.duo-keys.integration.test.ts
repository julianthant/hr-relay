// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { STARTUP_READ_DEADLINE_MS } from "../../../../src/dashboard/app/startup/first-screen.js";
import { active, dashboardServer, never, start } from "./startup-harness.js";

const DUO_KEYS_PATH = "/api/v1/profile/account/duo-keys";

it("reveals a cold Account page with its Duo keys unavailable when the read exceeds the startup deadline", async () => {
  const app = await start({
    "/api/v1/profile/state": () => Response.json(active),
    [DUO_KEYS_PATH]: never,
  }, dashboardServer(), "/?settings=account");
  try {
    await vi.waitFor(() => assert.ok(app.host.querySelector('[aria-label="Loading Duo security keys"]')), { timeout: 5_000 });
    assert.ok(app.paths.includes(DUO_KEYS_PATH), "the Duo key request reached the stalled endpoint");
    assert.deepEqual(app.frames, ["loading"]);
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: STARTUP_READ_DEADLINE_MS + 2_000, interval: 50 });
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    assert.match(app.firstDashboard(), /Duo keys unavailable/u);
  } finally { await app.stop(); }
}, STARTUP_READ_DEADLINE_MS + 25_000);
