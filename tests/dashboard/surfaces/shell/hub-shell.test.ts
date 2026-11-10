// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { HubShell } from "../../../../src/dashboard/surfaces/shell/hub-shell.js";
import type { HubChat, HubChatsPort } from "../../../../src/dashboard/surfaces/shell/hub-shell-model.js";
import { MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { ChatGptAccountContext, createPreviewChatGptAccountPort } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { PreflightAssistantContext, createPreviewPreflightAssistantPort } from "../../../../src/dashboard/surfaces/settings/preflight/preflight-assistant-model.js";
import { ASSISTANT_MODEL_COMMAND, AssistantModelPreferenceViewSchema } from "../../../../src/models/dashboard/assistant.js";
import { AssistantModelPreferenceCommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../../src/dashboard/app/dashboard-app-model.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("keeps the served assistant closed until requested and preserves its close and reopen controls", async () => {
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(HubShell, {
      source: "served", settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {}, onRunWorkflow: async () => ({ state: "failed" as const, message: "Unused" }),
    }) })));
    const launcher = host.querySelector<HTMLButtonElement>('[aria-label="Assistant"]'); assert.ok(launcher);
    const panel = host.querySelector<HTMLElement>("#hub-shell-assistant"); assert.ok(panel);
    assert.equal(panel.hidden, true); assert.equal(panel.hasAttribute("inert"), true);
    assert.equal(launcher.getAttribute("aria-expanded"), "false");
    await act(async () => launcher.click());
    assert.equal(panel.hidden, false); assert.equal(launcher.getAttribute("aria-expanded"), "true");
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(panel.hidden, true); assert.equal(document.activeElement, launcher);
    await act(async () => launcher.click());
    assert.equal(panel.hidden, false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("invalidates a shown Preflight result on a confirmed model save, even for the same choice, but not on a read", async () => {
  const { app } = createFixtureBff();
  const served = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const current = await served.assistantModelPreference?.(); assert.ok(current);
  let view = current;
  const client: typeof served = { ...served,
    assistantModelPreference: async () => view,
    executeCommand: async (input: unknown) => {
      const command = AssistantModelPreferenceCommandRequestSchema.parse(input);
      view = AssistantModelPreferenceViewSchema.parse({ ...view, revision: command.target.expectedRevision + 1, preference: command.payload });
      return CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "assistant-model-preference", profileId: command.target.profileId, revision: view.revision }] });
    },
  };
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const effort = current.preference.effort === "low" ? "medium" : "low";
  let invalidations = 0;
  const preflight = { ...createPreviewPreflightAssistantPort(), invalidate: () => { invalidations++; } };
  const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} };
  const commands = { authority: {}, executor: new CommandExecutor(() => scope), scope, feedback: () => {} } as unknown as DashboardCommandBinding;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const send = async (text: string) => {
    const field = host.querySelector<HTMLTextAreaElement>("textarea"); assert.ok(field);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  };
  try {
    await act(async () => root.render(createElement(ChatGptAccountContext.Provider, { value: { ...preview, mode: "live" }, children: createElement(PreflightAssistantContext.Provider, { value: preflight, children: createElement(DashboardClientProvider, { client, children: createElement(HubShell, {
      source: "served", settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {}, commands, onRunWorkflow: async () => ({ state: "failed" as const, message: "Unused" }),
    }) }) }) })));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Assistant"]')?.click());
    await send(ASSISTANT_MODEL_COMMAND);
    assert.equal(invalidations, 0);
    await send(`${ASSISTANT_MODEL_COMMAND} ${current.preference.slug} ${effort}`);
    assert.equal(invalidations, 1);
    await send(`${ASSISTANT_MODEL_COMMAND} ${current.preference.slug} ${effort}`);
    assert.equal(invalidations, 2);
    await send(ASSISTANT_MODEL_COMMAND);
    assert.equal(invalidations, 2);
  } finally { await act(async () => root.unmount()); host.remove(); }
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
  const submit = () => { const found = document.querySelector<HTMLButtonElement>('.hub-modal button[type="submit"]'); assert.ok(found); return found; };
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(HubShell, {
      source: "mock", chatsPort: port, settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {}, onRunWorkflow: async () => ({ state: "failed" as const, message: "Unused" }),
    }) })));
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
