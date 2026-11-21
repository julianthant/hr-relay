// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { AssistantLauncher } from "../../../../src/dashboard/surfaces/shell/assistant-launcher.js";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { HubShell } from "../../../../src/dashboard/surfaces/shell/hub-shell.js";
import { assistantOpen } from "../../../../src/dashboard/surfaces/shell/assistant-launcher-model.js";
import type { HubChat, HubChatsPort } from "../../../../src/dashboard/surfaces/shell/hub-shell-model.js";
import { MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";
import { AssistantModelPreferenceViewSchema } from "../../../../src/models/dashboard/assistant.js";
import { AssistantModelPreferenceCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
import type { CommandOutcome } from "../../../../src/dashboard/app/commands/command-executor.js";
import { ChatGptAccountContext, type ChatGptAccountPort } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { AssistantSettings } from "../../../../src/dashboard/surfaces/settings/general/hub-preferences.js";
import { DashboardClientProvider, useDashboardCommandBinding } from "../../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The Ask control lives in the Sessions bar, outside HubShell. */
const withAsk = (shell: ReturnType<typeof createElement>) => createElement(TooltipProvider, null, createElement(ToastProvider, null, shell, createElement(AssistantLauncher)));

it("keeps the served assistant closed until requested and preserves its close and reopen controls", async () => {
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: withAsk(createElement(HubShell, {
      settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {},
    })) })));
    let launcher = host.querySelector<HTMLButtonElement>('[aria-label="Assistant"]'); assert.ok(launcher);
    let panel = host.querySelector<HTMLElement>("#hub-shell-assistant"); assert.ok(panel);
    assert.equal(panel.hidden, true); assert.equal(panel.hasAttribute("inert"), true);
    assert.equal(launcher.getAttribute("aria-expanded"), "false");
    await act(async () => launcher.click());
    // The first open reads the history, which replaces the shell body.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    launcher = host.querySelector<HTMLButtonElement>('[aria-label="Assistant"]'); assert.ok(launcher);
    panel = host.querySelector<HTMLElement>("#hub-shell-assistant"); assert.ok(panel);
    assert.equal(panel.hidden, false); assert.equal(launcher.getAttribute("aria-expanded"), "true");
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(panel.hidden, true); assert.equal(document.activeElement, launcher);
    await act(async () => launcher.click());
    assert.equal(panel.hidden, false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("reads no assistant data while closed and reads its history and model preference once when it first opens", async () => {
  const { app } = createFixtureBff();
  const paths: string[] = [];
  assistantOpen.set(false);
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => { paths.push(new URL(url).pathname); return app.request(url, init); } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: withAsk(createElement(HubShell, {
      settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {},
    })) })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.deepEqual(paths.filter(path => path.startsWith("/api/v1/assistant/")), []);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Assistant"]')?.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(paths.filter(path => path === "/api/v1/assistant/model-preference").length, 1);
    assert.ok(paths.includes("/api/v1/assistant/history"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("saves the served Settings preference before the first assistant history read", async () => {
  const { app } = createFixtureBff();
  const chat = crypto.randomUUID();
  const seeded = await app.request("/api/v1/assistant/history", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "create", conversationId: chat, title: "Seeded chat" }) });
  assert.equal(seeded.status, 200);
  let view = AssistantModelPreferenceViewSchema.parse(await (await app.request("/api/v1/assistant/model-preference")).json());
  const appliedReply = Promise.withResolvers<void>();
  const paths: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/api/v1/assistant/model-preference") return Response.json(view);
    if (path === "/api/v1/assistant/models") return Response.json({ models: [{ slug: view.preference.slug, displayName: "Test model" }] });
    if (path === "/api/v1/commands" && init?.method === "POST") {
      assert.ok(typeof init.body === "string");
      const command = AssistantModelPreferenceCommandRequestSchema.parse(JSON.parse(init.body));
      assert.deepEqual(command.target, { profileId: view.profileId, epoch: view.epoch, expectedRevision: view.revision });
      view = { ...view, revision: view.revision + 1, preference: command.payload };
      const response = Response.json({ state: "applied", commandId: command.commandId,
        affectedTargets: [{ family: command.family, profileId: view.profileId, revision: view.revision }] });
      await appliedReply.promise;
      return response;
    }
    return app.request(url, init);
  } });
  const snapshot = { state: "connected", name: "Operator", email: "operator@example.com", planUsage: "enabled" } as const;
  const account: ChatGptAccountPort = { mode: "live", getSnapshot: () => snapshot, subscribe: () => () => {},
    signIn: async () => {}, cancelSignIn: async () => {}, signOut: async () => undefined };
  function Shell({ settingsOpen }: { settingsOpen: boolean }) {
    const commands = useDashboardCommandBinding();
    assert.ok(commands);
    return withAsk(createElement("div", null, createElement(HubShell, { commands, authority: commands.scope.authority,
      settingsOpen, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {} }), settingsOpen && createElement(AssistantSettings)));
  }
  const feedback: string[] = [];
  const recordFeedback = (outcome: CommandOutcome) => { feedback.push(outcome.kind); };
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  const render = (settingsOpen: boolean) => act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(ChatGptAccountContext.Provider, { value: account }, createElement(FixtureCommandBinding, {
      actorId: LOCAL_OPERATOR_ACTOR_ID, feedback: recordFeedback, children: createElement(Shell, { settingsOpen }),
    })) })));
  const initiallyOpen = assistantOpen.get();
  assistantOpen.set(false);
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  try {
    await render(false);
    assert.deepEqual(paths, []);
    await render(true);
    assert.deepEqual([...paths].sort(), ["/api/v1/assistant/model-preference", "/api/v1/assistant/models"]);
    const model = host.querySelector<HTMLButtonElement>('button[aria-label="Model"]');
    const effort = host.querySelector<HTMLButtonElement>('button[aria-label="Effort"]');
    assert.ok(model && !model.disabled && effort && !effort.disabled);
    assert.equal(model.dataset.value, view.preference.slug);
    assert.equal(effort.dataset.value, "medium");
    await act(async () => effort.click());
    const option = document.querySelector<HTMLElement>('[role="option"][data-value="high"]');
    assert.ok(option);
    await act(async () => option.click());
    assert.equal(paths.filter(path => path === "/api/v1/commands").length, 1);
    assert.equal(view.preference.effort, "high");
    assert.deepEqual(feedback, []);
    await render(false);
    await act(async () => appliedReply.resolve());
    assert.deepEqual(feedback, ["confirmed"]);
    await render(true);
    const reopenedEffort = host.querySelector<HTMLButtonElement>('button[aria-label="Effort"]');
    assert.ok(reopenedEffort && !reopenedEffort.disabled);
    assert.equal(reopenedEffort.dataset.value, "high");
    await act(async () => reopenedEffort.click());
    const medium = document.querySelector<HTMLElement>('[role="option"][data-value="medium"]');
    assert.ok(medium);
    await act(async () => medium.click());
    assert.equal(paths.filter(path => path === "/api/v1/commands").length, 2);
    assert.deepEqual(feedback, ["confirmed", "confirmed"]);
    assert.equal(view.preference.effort, "medium");
    assert.equal(reopenedEffort.dataset.value, "medium");
    await render(false);
    const historyPaths = () => paths.filter(path => path === "/api/v1/assistant/history" || path.startsWith("/api/v1/assistant/conversations/"));
    assert.deepEqual(historyPaths(), []);
    await act(async () => assistantOpen.set(true));
    assert.deepEqual(historyPaths(), ["/api/v1/assistant/history", `/api/v1/assistant/conversations/${chat}`]);
    assert.equal(host.querySelector(".hub-chat-title")?.textContent, "Seeded chat");
  } finally {
    appliedReply.resolve();
    await act(async () => root.unmount());
    assistantOpen.set(initiallyOpen);
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("announces rename and delete only after the chat port acknowledges them and keeps the chat and its session on a failure", async () => {
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  let chats: readonly HubChat[] = [{ id: "kept", title: "Kept chat", minutes: 0, group: "Today" }, { id: "other", title: "Other chat", minutes: 0, group: "Today" }];
  const held: { settle: () => void; fail: (error: Error) => void; done: Promise<void> }[] = [];
  const hold = (apply: () => void) => {
    const deferred = Promise.withResolvers<void>();
    held.push({ settle: () => { apply(); deferred.resolve(); }, fail: deferred.reject, done: deferred.promise.catch(() => {}) });
    return deferred.promise;
  };
  const port: HubChatsPort = { source: "local", read: () => chats, async create() { throw new Error("unused"); },
    rename: (id, title) => hold(() => { chats = chats.map(chat => chat.id === id ? { ...chat, title } : chat); }),
    remove: id => hold(() => { chats = chats.filter(chat => chat.id !== id); }) };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const status = () => host.querySelector('span.sr-only[role="status"]')?.textContent ?? "";
  const button = (label: string) => { const found = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); assert.ok(found, label); return found; };
  const submit = () => { const found = document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]'); assert.ok(found); return found; };
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: withAsk(createElement(HubShell, {
      chatsPort: port, settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {},
    })) })));
    await act(async () => button("History").click());
    await act(async () => button("Delete chat Kept chat").click());
    await act(async () => submit().click());
    assert.equal(status(), "", "no success before the acknowledgment");
    assert.equal(submit().disabled, true);
    await act(async () => { held[0]?.fail(new Error("Chat history could not be saved.")); await held[0]?.done; });
    assert.equal(status(), ""); assert.ok(host.querySelector('[aria-label="Delete chat Kept chat"]'), "the chat stays listed");
    assert.equal(host.querySelector('[role="alert"]')?.textContent, "Chat history could not be saved.");
    await act(async () => button("Rename chat Kept chat").click());
    const field = document.querySelector<HTMLInputElement>('[aria-label="Chat title"]'); assert.ok(field);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "Renamed chat"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => submit().click());
    assert.equal(status(), "");
    await act(async () => { held[1]?.settle(); await held[1]?.done; });
    assert.equal(status(), "Chat renamed."); assert.ok(host.querySelector('[aria-label="Rename chat Renamed chat"]'));
    await act(async () => button("Delete chat Other chat").click());
    await act(async () => submit().click());
    await act(async () => { held[2]?.settle(); await held[2]?.done; });
    assert.equal(status(), "Chat deleted."); assert.equal(host.querySelector('[aria-label="Delete chat Other chat"]'), null);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("announces rename and delete only after the chat port acknowledges them and keeps the chat and its session on a failure", async () => {
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  let chats: readonly HubChat[] = [{ id: "kept", title: "Kept chat", minutes: 0, group: "Today" }, { id: "other", title: "Other chat", minutes: 0, group: "Today" }];
  const held: { settle: () => void; fail: (error: Error) => void; done: Promise<void> }[] = [];
  const hold = (apply: () => void) => {
    const deferred = Promise.withResolvers<void>();
    held.push({ settle: () => { apply(); deferred.resolve(); }, fail: deferred.reject, done: deferred.promise.catch(() => {}) });
    return deferred.promise;
  };
  const port: HubChatsPort = { source: "local", read: () => chats, async create() { throw new Error("unused"); },
    rename: (id, title) => hold(() => { chats = chats.map(chat => chat.id === id ? { ...chat, title } : chat); }),
    remove: id => hold(() => { chats = chats.filter(chat => chat.id !== id); }) };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const status = () => host.querySelector('span.sr-only[role="status"]')?.textContent ?? "";
  const button = (label: string) => { const found = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); assert.ok(found, label); return found; };
  const submit = () => { const found = document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]'); assert.ok(found); return found; };
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: withAsk(createElement(HubShell, {
      chatsPort: port, settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {},
    })) })));
    await act(async () => button("History").click());
    await act(async () => button("Delete chat Kept chat").click());
    await act(async () => submit().click());
    assert.equal(status(), "", "no success before the acknowledgment");
    assert.equal(submit().disabled, true);
    await act(async () => { held[0]?.fail(new Error("Chat history could not be saved.")); await held[0]?.done; });
    assert.equal(status(), ""); assert.ok(host.querySelector('[aria-label="Delete chat Kept chat"]'), "the chat stays listed");
    assert.equal(host.querySelector('[role="alert"]')?.textContent, "Chat history could not be saved.");
    await act(async () => button("Rename chat Kept chat").click());
    const field = document.querySelector<HTMLInputElement>('[aria-label="Chat title"]'); assert.ok(field);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "Renamed chat"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => submit().click());
    assert.equal(status(), "");
    await act(async () => { held[1]?.settle(); await held[1]?.done; });
    assert.equal(status(), "Chat renamed."); assert.ok(host.querySelector('[aria-label="Rename chat Renamed chat"]'));
    await act(async () => button("Delete chat Other chat").click());
    await act(async () => submit().click());
    await act(async () => { held[2]?.settle(); await held[2]?.done; });
    assert.equal(status(), "Chat deleted."); assert.equal(host.querySelector('[aria-label="Delete chat Other chat"]'), null);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
