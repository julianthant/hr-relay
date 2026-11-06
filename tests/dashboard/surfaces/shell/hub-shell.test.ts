// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { HubShell } from "../../../../src/dashboard/surfaces/shell/hub-shell.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { ChatGptAccountContext, createPreviewChatGptAccountPort } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { PreflightAssistantContext, createPreviewPreflightAssistantPort } from "../../../../src/dashboard/surfaces/settings/preflight/preflight-assistant-model.js";
import { ASSISTANT_MODEL_COMMAND } from "../../../../src/models/dashboard/assistant.js";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("keeps the served assistant closed until requested and preserves its close and reopen controls", async () => {
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(HubShell, {
      source: "served", settingsOpen: false, onLogout() {}, onRunWorkflow: async () => ({ state: "failed" as const, message: "Unused" }),
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

it("invalidates a shown Preflight result when the served model preference is published", async () => {
  const { app } = createFixtureBff();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  let invalidations = 0;
  const preflight = { ...createPreviewPreflightAssistantPort(), invalidate: () => { invalidations++; } };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(ChatGptAccountContext.Provider, { value: { ...preview, mode: "live" }, children: createElement(PreflightAssistantContext.Provider, { value: preflight, children: createElement(DashboardClientProvider, { client, children: createElement(HubShell, {
      source: "served", settingsOpen: false, onLogout() {}, onRunWorkflow: async () => ({ state: "failed" as const, message: "Unused" }),
    }) }) }) })));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Assistant"]')?.click());
    const field = host.querySelector<HTMLTextAreaElement>("textarea"); assert.ok(field);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, ASSISTANT_MODEL_COMMAND); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(invalidations > 0, true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
