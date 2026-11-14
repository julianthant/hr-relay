// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";

const catalog = buildWorkflowCatalog([], true, servedFixtureSources([]));
let root: Root | undefined;
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

it.each(["normal", "refused", "uncertain"] as const)("keeps add progress, success and refusal in toasts while preserving %s recovery", async outcome => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", `/?sessionsPreview=empty${outcome === "normal" ? "" : `&workerCommandPreview=${outcome}`}`);
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const render = () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(SessionPanel, { catalog, source: "mock", open: true, onOpenChange() {} }))));
  await act(async () => render());
  const panel = host.querySelector('section[aria-label="Session Panel"]'); assert(panel);
  const trigger = panel.querySelector('button[aria-label="Add workers"]'); assert(trigger instanceof HTMLButtonElement);
  await act(async () => { trigger.focus(); trigger.click(); });
  const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Add workers");
  assert(confirm instanceof HTMLButtonElement);
  await act(async () => { confirm.focus(); confirm.click(); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.doesNotMatch(panel.textContent ?? "", /Adding workers|Workers added/);
  assert.equal(document.querySelectorAll('[data-slot="toast-title"]').length, 1);
  assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, "Adding workers…");
  assert.equal(trigger.disabled, true);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  assert.doesNotMatch(panel.textContent ?? "", /Adding workers|Workers added/);
  if (outcome === "normal") {
    assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, "Workers added");
    assert.equal(panel.querySelectorAll("article").length, 1);
    assert.equal(trigger.disabled, false);
    await act(async () => render());
    assert.equal(document.querySelectorAll('[data-slot="toast-title"]').length, 1, "rerender does not repeat confirmed feedback");
  } else {
    if (outcome === "refused") {
      assert.equal(panel.querySelector('[role="alert"]')?.textContent, undefined, "a refusal is a toast, not an inline panel");
      assert.deepEqual([...document.querySelectorAll('[data-slot="toast-title"]')].map(title => title.textContent), ["Couldn't add workers"]);
      assert.match(document.querySelector('[data-slot="toast-description"]')?.textContent ?? "", /Worker control was refused/);
    } else {
      assert.match(panel.querySelector('[role="alert"]')?.textContent ?? "", /Response unavailable/);
      assert.equal(document.querySelector('[data-slot="toast-title"]'), null, "settlement dismisses progress");
    }
    assert.equal(panel.querySelectorAll("article").length, 0);
    assert.equal(trigger.disabled, outcome === "uncertain");
    if (outcome === "uncertain") {
      const check = [...panel.querySelectorAll("button")].find(button => button.textContent === "Check outcome"); assert(check instanceof HTMLButtonElement);
      await act(async () => check.click());
      assert.match(panel.textContent ?? "", /Checking command/);
      assert.equal(trigger.disabled, true);
      await act(async () => vi.advanceTimersByTimeAsync(600));
      assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, "Workers added");
      assert.equal(panel.querySelectorAll("article").length, 1, "check confirms the original addition once");
      assert.equal(trigger.disabled, false);
      assert.doesNotMatch(panel.textContent ?? "", /Workers added|Adding workers/);
    }
  }
});

it("dismisses add progress when the panel unmounts and ignores its late settlement", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?sessionsPreview=empty");
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  let shown = true;
  const render = () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, shown ? createElement(SessionPanel, { catalog, source: "mock", open: true, onOpenChange() {} }) : null)));
  await act(async () => render());
  const trigger = host.querySelector('button[aria-label="Add workers"]'); assert(trigger instanceof HTMLButtonElement);
  await act(async () => trigger.click());
  const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Add workers"); assert(confirm instanceof HTMLButtonElement);
  await act(async () => confirm.click());
  assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, "Adding workers…");
  shown = false; await act(async () => render());
  assert.equal(document.querySelector('[data-slot="toast-title"]'), null);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  assert.equal(document.querySelector('[data-slot="toast-title"]'), null, "late confirmation cannot recreate a toast");
});
