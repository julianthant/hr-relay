// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it, vi } from "vitest";
import { MOCK_WORKFLOW_COMPOSITION } from "../../../mocks/helpers/workflow-composition.js";
import { DAY, runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { disposeHttpRouteHarness, harness } from "../../../support/helpers/backend/http-route-harness.js";
import { STARTUP_READ_DEADLINE_MS } from "../../../../src/dashboard/app/startup/first-screen.js";
import { ASSISTANT_FAILURES } from "../../../../src/models/dashboard/assistant.js";
import { assistantOpen } from "../../../../src/dashboard/surfaces/shell/assistant-launcher-model.js";

const ASSISTANT_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
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

const servedSessions: typeof MOCK_WORKFLOW_COMPOSITION = workflows => ({ ...MOCK_WORKFLOW_COMPOSITION(workflows), sessionsHarness: undefined });
const sessionsOpen = `&view=${encodeURIComponent(JSON.stringify({ sessions: true }))}`;
for (const [sessions, composition, view] of [["sample", MOCK_WORKFLOW_COMPOSITION, ""], ["served", servedSessions, ""], ["served, expanded", servedSessions, sessionsOpen]] as const)
it(`shows the date recovery, not an endless loader, for a cold link to a future day (${sessions} Sessions)`, async () => {
  const server = dashboardServer();
  const app = await start({}, (url, init) => new URL(url).pathname === "/api/v1/profile/state" ? Response.json(active) : server(url, init), `/?day=2099-01-01${view}`, composition);
  try {
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 10_000, interval: 50 });
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    assert.match(app.firstDashboard(), /Choose a valid date/u);
    const bar = app.host.querySelector('[aria-label="Session actions"]')?.textContent ?? "";
    assert.doesNotMatch(bar, /Loading/u, `the Sessions bar is settled: ${bar}`);
    if (view !== "") assert.match(app.host.querySelector('[aria-label="Sessions"]')?.textContent ?? "", /Sessions unavailable/u);
  } finally { await app.stop(); }
}, 20_000);

const pressJ = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true }));
for (const [path, before, underLoader] of [["the assistant stays closed", () => {}, () => {}], ["Ctrl+J is pressed under the loader", () => {}, pressJ],
  ["the assistant was open at an earlier sign-in", () => assistantOpen.set(true), () => {}]] as const)
it(`shows the dashboard while a startup chat history write is still unanswered, and the write still settles (${path})`, async () => {
  const server = dashboardServer();
  let answer: (response: Response) => void = () => {};
  let release: () => void = () => {};
  const dayHeld = new Promise<void>(resolve => { release = resolve; });
  before();
  const app = await start({}, async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/profile/state") return Response.json(active);
    if (path === "/api/v1/assistant/history" && init?.method === "POST") return new Promise<Response>(resolve => { answer = resolve; });
    if (url.includes("/events/v1?")) await dayHeld;
    return server(url, init);
  });
  const assistant = () => app.host.querySelector<HTMLElement>("#hub-shell-assistant");
  try {
    await vi.waitFor(() => assert.ok(app.host.querySelector("[data-startup-loading]") && assistant(), "the hidden shell is mounted under the loader"), { timeout: 10_000, interval: 50 });
    await act(async () => { underLoader(); });
    assert.equal(assistant()?.hidden, true, "the assistant stays closed under the loader");
    await act(async () => { release(); });
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 10_000, interval: 50 });
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    assert.ok(app.paths.filter(path => path === "/api/v1/assistant/history").length >= 2, "the history read and its create write were sent");
    assert.equal(assistant()?.hidden, true);
    const panelText = () => app.host.querySelector('[aria-label="Assistant panel"]')?.textContent ?? "";
    assert.doesNotMatch(panelText(), /chat history/u, "the write is still pending, not expired as a read failure");
    await act(async () => { answer(new Response("refused", { status: 500 })); });
    await vi.waitFor(() => assert.match(panelText(), /Couldn't load chat history\./u), { timeout: 5_000, interval: 50 });
    await act(async () => { pressJ(); });
    assert.equal(assistant()?.hidden, false, "Ctrl+J opens the assistant once the dashboard shows");
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
  } finally { await app.stop(); release(); act(() => assistantOpen.set(false)); }
}, 20_000);

it("opens Search from a cold link or its shortcut only once the dashboard shows", async () => {
  const app = await delayedStart(`/?view=${encodeURIComponent(JSON.stringify({ search: true }))}`);
  const dialogs: number[] = [];
  const watcher = new MutationObserver(() => { if (app.host.querySelector("[data-startup-loading]")) dialogs.push(document.querySelectorAll('[role="dialog"]').length); });
  watcher.observe(document.body, { childList: true, subtree: true });
  try {
    await vi.waitFor(() => assert.ok(app.host.querySelector("[data-startup-loading]") && app.host.querySelector(".rail-search"), "the hidden shell is mounted under the loader"), { timeout: 20_000, interval: 50 });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })); });
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 0, "the shortcut opens nothing under the loader");
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 40_000, interval: 50 });
    watcher.disconnect();
    assert.ok(dialogs.length > 0 && dialogs.every(count => count === 0), "no dialog while the loader is up");
    await vi.waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      assert.match(dialog?.textContent ?? "", /Search Relay/u);
      assert.ok(dialog?.contains(document.activeElement), "focus is inside Search");
    }, { timeout: 10_000, interval: 50 });
  } finally { watcher.disconnect(); await app.stop(); }
}, 60_000);

it("ends a bootstrap read that never answers in the Reload notice", async () => {
  const server = dashboardServer();
  const app = await start({}, (url, init) => {
    const path = new URL(url).pathname;
    return path === "/api/v1/profile/state" ? Response.json(active) : path === "/api/v1/bootstrap" ? never() : server(url, init);
  });
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, STARTUP_READ_DEADLINE_MS - 1_000)); });
    assert.deepEqual(app.frames, ["loading"], "the loader holds while bootstrap is pending");
    await vi.waitFor(() => assert.match(app.host.textContent ?? "", /Couldn't start Relay\./u), { timeout: 5_000, interval: 50 });
    assert.equal(app.host.querySelector("[data-startup-loading]"), null);
    assert.ok(app.host.querySelector('button')?.textContent?.includes("Reload"));
  } finally { await app.stop(); }
}, STARTUP_READ_DEADLINE_MS + 20_000);

it("shows the unsaved chat history notice, not a skeleton, when an old history import is refused", async () => {
  const chat = "00000000-0000-4000-8000-0000000000c1";
  sessionStorage.setItem(`relay-assistant-history:${ASSISTANT_PROFILE_ID}`, JSON.stringify({ format: 1, profileId: ASSISTANT_PROFILE_ID,
    chats: [{ id: chat, title: "Old chat", minutes: 0, group: "Today" }], transcripts: {} }));
  const server = dashboardServer();
  const app = await start({}, (url, init) => {
    const path = new URL(url).pathname;
    return path === "/api/v1/profile/state" ? Response.json(active)
      : path === "/api/v1/assistant/history" && init?.method === "POST" ? new Response("refused", { status: 500 }) : server(url, init);
  });
  try {
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 10_000, interval: 50 });
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    const panel = app.host.querySelector('[aria-label="Relay assistant"]');
    assert.ok(panel?.textContent?.includes(ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED), panel?.textContent ?? "no panel");
    assert.equal(panel?.querySelector<HTMLButtonElement>('button[title="Rename chat"]')?.disabled, true);
  } finally { await app.stop(); sessionStorage.clear(); }
}, 20_000);

it("opens Add workers from a cold link only once the dashboard shows, with focus inside it", async () => {
  const app = await delayedStart(`/?view=${encodeURIComponent(JSON.stringify({ addWorkers: true }))}`);
  const dialogs: number[] = [];
  const watcher = new MutationObserver(() => { if (app.host.querySelector("[data-startup-loading]")) dialogs.push(document.querySelectorAll('[role="dialog"]').length); });
  watcher.observe(document.body, { childList: true, subtree: true });
  try {
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 40_000, interval: 50 });
    watcher.disconnect();
    assert.ok(dialogs.length > 0 && dialogs.every(count => count === 0), "no dialog while the loader is up");
    await vi.waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      assert.match(dialog?.textContent ?? "", /Add workers/u);
      assert.ok(dialog?.contains(document.activeElement), "focus is inside Add workers");
    }, { timeout: 10_000, interval: 50 });
  } finally { watcher.disconnect(); await app.stop(); }
}, 60_000);

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
