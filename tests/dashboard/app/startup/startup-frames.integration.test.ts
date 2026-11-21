// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it, vi } from "vitest";
import { MOCK_WORKFLOW_COMPOSITION } from "../../../mocks/helpers/workflow-composition.js";
import { DAY, runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { disposeHttpRouteHarness, harness } from "../../../support/helpers/backend/http-route-harness.js";
import { STARTUP_READ_DEADLINE_MS } from "../../../../src/dashboard/app/startup/first-screen.js";
import { active, dashboardServer, delayed, never, READ_DELAY_MS, start } from "./startup-harness.js";

afterEach(disposeHttpRouteHarness);

/** The served Analytics report, read from the backend routes over a seeded run, not the composition's local sample. */
const servedAnalytics: typeof MOCK_WORKFLOW_COMPOSITION = workflows => ({ ...MOCK_WORKFLOW_COMPOSITION(workflows), useActivityReport: undefined });

/** A remembered session with every read, the session read included, delayed 2.5 s. */
async function delayedStart(at: string) {
  const backend = await harness();
  backend.database.authority.runs.enqueue(runRecordOf({ seed: 12, enqueuedAt: `${DAY}T12:00:00.000Z`, displayName: "Startup person" }));
  const server = dashboardServer();
  return start({}, delayed((url, init) => {
    const path = new URL(url).pathname;
    return path === "/api/v1/profile/state" ? Response.json(active) : path.startsWith("/api/v1/reports/activity") ? backend.app.request(url, init) : server(url, init);
  }), at, servedAnalytics);
}

for (const [page, at, loaded] of [["the queue", "/", "Start run"], ["a Settings URL", "/?settings=general", "Prevent sleep while running"],
  ["an Analytics URL", `/?activity=${DAY}..${DAY}`, "1 still open"]] as const) {
  it(`goes from the loader straight to the complete dashboard on ${page} when every read takes 2.5 s`, async () => {
    const app = await delayedStart(at);
    try {
      await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 40_000, interval: 50 });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, READ_DELAY_MS * 2)); });
      console.log(`[frames ${at}] ${app.frames.join(" > ")}`);
      assert.deepEqual(app.frames, ["loading", "dashboard"]);
      assert.ok(app.firstDashboard().includes(loaded), `the first revealed frame lacks "${loaded}": ${app.firstDashboard().slice(0, 600)}`);
      assert.doesNotMatch(app.firstDashboard(), /Couldn't load/u);
    } finally { await app.stop(); }
  }, 60_000);
}

it("fails reads still pending at the startup deadline into their notices, then shows the dashboard with no skeleton", async () => {
  const server = dashboardServer();
  const app = await start({}, (url, init) => {
    const path = new URL(url).pathname;
    return path === "/api/v1/profile/state" ? Response.json(active) : url.includes("/events/v1?") || path === "/api/v1/assistant/model-preference" ? never() : server(url, init);
  });
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, STARTUP_READ_DEADLINE_MS - 1_000)); });
    assert.deepEqual(app.frames, ["loading"], "the loader holds while reads are pending");
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 5_000, interval: 50 });
    console.log(`[frames deadline] ${app.frames.join(" > ")}`);
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    const notices = [...app.host.querySelectorAll('.dashboard-shell [role="alert"]')].map(notice => notice.textContent);
    assert.ok(notices.some(text => /chat history/u.test(text ?? "")), `the assistant shows its notice: ${notices.join(" | ")}`);
    assert.ok(notices.length >= 2, `the queue shows its notice too: ${notices.join(" | ")}`);
  } finally { await app.stop(); }
}, STARTUP_READ_DEADLINE_MS + 20_000);

it("opens Start run from a cold link only once the dashboard shows, with focus inside it", async () => {
  const app = await delayedStart("/?start=1");
  const dialogs: number[] = [];
  const watcher = new MutationObserver(() => { if (app.host.querySelector("[data-startup-loading]")) dialogs.push(document.querySelectorAll('[role="dialog"]').length); });
  watcher.observe(document.body, { childList: true, subtree: true });
  try {
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 40_000, interval: 50 });
    watcher.disconnect();
    assert.ok(dialogs.length > 0 && dialogs.every(count => count === 0), "no dialog while the loader is up");
    await vi.waitFor(() => assert.ok(document.querySelector('[role="dialog"]')?.contains(document.activeElement), "focus is inside Start run"), { timeout: 10_000, interval: 50 });
  } finally { watcher.disconnect(); await app.stop(); }
}, 60_000);
