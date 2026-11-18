// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { HubShell } from "../../../../src/dashboard/surfaces/shell/hub-shell.js";
import { AssistantPanel } from "../../../../src/dashboard/surfaces/shell/assistant-panel.js";
import { assistantOpen } from "../../../../src/dashboard/surfaces/shell/assistant-launcher-model.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";
import { MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const CHAT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date().toISOString(), LATER = new Date(Date.now() + 86_400_000).toISOString();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const conversation = (text: string) => ({ id: CHAT, title: "Filed forms", revision: 2, draft: "", composer: "", importTotal: 0, importNotice: null, messages: [
  { id: "22222222-2222-4222-8222-222222222222", ordinal: 1, role: "operator", kind: "turn", text: "Who filed this week?", delivery: "answered", code: null, actionId: null, attachments: [] },
  { id: "33333333-3333-4333-8333-333333333333", ordinal: 2, role: "assistant", kind: "answer", text, delivery: "settled", code: null, actionId: null, attachments: [] }] });

beforeEach(() => { vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver); sessionStorage.clear(); });
afterEach(() => { assistantOpen.set(false); vi.unstubAllGlobals(); });

/** Serves the assistant history reads from `reads`; every other request goes to the fixture BFF. `gate` holds the history read until released. */
function servedShell(reads: { history: unknown; conversation?: unknown }, gate?: Promise<void>) {
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname, get = (init?.method ?? "GET") === "GET";
    if (get && path === "/api/v1/assistant/history") { await gate; return json(reads.history); }
    if (get && reads.conversation !== undefined && path.startsWith("/api/v1/assistant/conversations/")) return json(reads.conversation);
    return app.request(url, init);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = () => act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(HubShell, {
    settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {},
  }))) })));
  return { host, render, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

it("opens an empty New chat panel with a header, empty state and composer when no chat is stored", async () => {
  const shell = servedShell({ history: { chats: [], selectedId: null } });
  try {
    await shell.render(); await act(async () => assistantOpen.set(true)); await settle();
    const panel = shell.host.querySelector("#hub-panel-assistant"); assert.ok(panel, "the panel renders");
    assert.equal(panel.querySelector(".hub-chat-title")?.textContent, "New chat");
    assert.match(panel.textContent ?? "", /How can I help\?/u);
    assert.ok(panel.querySelector('textarea[name="message"]'), "the composer renders");
    assert.ok(panel.querySelector('[aria-label="History"]') && panel.querySelector('[aria-label="Close assistant"]'));
  } finally { await shell.close(); }
});

it("shows skeleton title, model chip and transcript while history loads, never the loading text, then the loaded chat", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const shell = servedShell({ history: { chats: [{ id: CHAT, title: "Filed forms", revision: 2, createdAt: NOW, expiresAt: LATER }], selectedId: CHAT }, conversation: conversation("Done.") }, gate);
  try {
    await shell.render(); await act(async () => assistantOpen.set(true)); await settle();
    const panel = shell.host.querySelector("#hub-panel-assistant"); assert.ok(panel);
    assert.ok(panel.querySelector(".hub-chat-title [data-slot='skeleton']"), "skeleton title");
    assert.ok(panel.querySelector("#hub-model-trigger [data-slot='skeleton']"), "skeleton model chip");
    assert.ok(panel.querySelector('[aria-label="Loading chat"] [data-slot="skeleton"]'), "skeleton transcript");
    assert.doesNotMatch(panel.textContent ?? "", /Loading chat history|Loading ChatGPT account|How can I help\?|Model unavailable/u);
    release(); await settle(); await settle();
    const loaded = shell.host.querySelector("#hub-panel-assistant"); assert.ok(loaded);
    assert.equal(loaded.querySelector(".hub-chat-title")?.textContent, "Filed forms");
    assert.equal(loaded.querySelector("[data-slot='skeleton']"), null);
  } finally { release(); await shell.close(); }
});

it("renders a served reply's bullets and bold as a list and strong text, and leaves mock-only markup literal", async () => {
  const text = "Two people filed:\n- Lin Ortega: filed 04/30\n- Sam Patel: filed 05/02\n**Next steps:** confirm. {{link}} ~~gone~~";
  const shell = servedShell({ history: { chats: [{ id: CHAT, title: "Filed forms", revision: 2, createdAt: NOW, expiresAt: LATER }], selectedId: CHAT }, conversation: conversation(text) });
  try {
    await shell.render(); await act(async () => assistantOpen.set(true)); await settle(); await settle();
    const log = shell.host.querySelector('[role="log"]'); assert.ok(log);
    assert.deepEqual([...log.querySelectorAll("li")].map(item => item.textContent), ["Lin Ortega: filed 04/30", "Sam Patel: filed 05/02"]);
    assert.equal(log.querySelector("strong")?.textContent, "Next steps:");
    assert.doesNotMatch(log.textContent ?? "", /\*\*|^- /mu);
    assert.match(log.textContent ?? "", /\{\{link\}\} ~~gone~~/u);
    assert.equal(log.querySelector("button"), null, "no link buttons in served replies");
  } finally { await shell.close(); }
});

it("shows the typing row with Cancel while a reply is prepared, and Cancel cancels the turn", async () => {
  const actions: unknown[] = [];
  const served = { state: { draft: "", messages: [{ id: "m1", role: "operator" as const, text: "Hello" }], sequence: 1, turn: { state: "waiting" as const } }, canCompose: true, accountAvailable: true,
    accountAction: "settings" as const, accountNotice: "", accountRetry() {}, accountHeading: "", models: undefined, chooseModel() {}, onAction: (action: unknown) => { actions.push(action); }, revision: "",
    confirmRefusal: undefined, forgetSession() {}, authorityKey: "", launcherBottom: 0, stageAttachment: async () => { throw new Error("unused"); }, statusText: "", footnote: "" };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(AssistantPanel, {
      conversationPort: { initial: () => ({ id: "chat", title: "New chat", files: [] }) }, served: served as never })))));
    const row = host.querySelector(".hub-typing"); assert.ok(row, "typing row");
    assert.equal(row.getAttribute("role"), "status");
    assert.equal(row.querySelectorAll(".hub-typing-dots i").length, 3);
    assert.match(row.textContent ?? "", /Preparing a reply…/u);
    assert.ok(row.closest(".hub-assistant-line"), "aligned with the assistant messages");
    const cancel = [...row.querySelectorAll("button")].find(button => button.textContent === "Cancel"); assert.ok(cancel);
    await act(async () => cancel.click());
    assert.deepEqual(actions, [{ type: "cancel" }]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
