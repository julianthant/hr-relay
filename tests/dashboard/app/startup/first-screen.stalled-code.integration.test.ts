// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { it, vi } from "vitest";
import { STARTUP_READ_DEADLINE_MS } from "../../../../src/dashboard/app/startup/first-screen.js";
import { active, dashboardServer, start } from "./startup-harness.js";

// The Settings page's code request never answers.
vi.mock("../../../../src/dashboard/surfaces/settings/settings.js", () => new Promise(() => {}));

it("fails a cold Settings link whose page code is still loading at the startup deadline into the Settings notice", async () => {
  const reported: unknown[] = [];
  vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
  const server = dashboardServer();
  const app = await start({}, (url, init) => new URL(url).pathname === "/api/v1/profile/state" ? Response.json(active) : server(url, init), "/?settings=general");
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, STARTUP_READ_DEADLINE_MS - 1_000)); });
    assert.deepEqual(app.frames, ["loading"], "the loader holds while the page code loads");
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 5_000, interval: 50 });
    console.log(`[frames stalled code] ${app.frames.join(" > ")}`);
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    assert.match(app.firstDashboard(), /Couldn't open Settings\./u);
    assert.match(String(reported[0]), /did not load within/u);
  } finally { await app.stop(); vi.unstubAllGlobals(); }
}, STARTUP_READ_DEADLINE_MS + 20_000);

it("leaves a Settings page whose code failed to load with Back", async () => {
  vi.stubGlobal("reportError", () => {});
  const server = dashboardServer();
  const app = await start({}, (url, init) => new URL(url).pathname === "/api/v1/profile/state" ? Response.json(active) : server(url, init));
  try {
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 10_000, interval: 50 });
    await act(async () => app.host.querySelector<HTMLElement>("#settings-gear")?.click());
    assert.match(window.location.search, /settings=/u);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, STARTUP_READ_DEADLINE_MS + 500)); });
    assert.match(app.host.textContent ?? "", /Couldn't open Settings\./u);
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 200)); });
    assert.doesNotMatch(window.location.search, /settings=/u);
    assert.doesNotMatch(app.host.textContent ?? "", /Couldn't open Settings\./u);
  } finally { await app.stop(); vi.unstubAllGlobals(); }
}, STARTUP_READ_DEADLINE_MS + 30_000);
