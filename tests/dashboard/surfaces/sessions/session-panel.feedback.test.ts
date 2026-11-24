// @vitest-environment jsdom
import { sessionsSampleHarness } from "../../../support/fixtures/dashboard/sessions-sample.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { FIXTURE_START_PICKER_BOOTSTRAP as SERVED_CATALOG_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";
import { launchWorkflows as launchServedWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows as parseServedWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog as buildServedCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
const SERVED_FIXTURE = launchServedWorkflows(parseServedWorkflows(SERVED_CATALOG_BOOTSTRAP.workflows), SERVED_CATALOG_BOOTSTRAP.workbookCompatibility);
const SERVED_CATALOG = buildServedCatalog(SERVED_FIXTURE, servedFixtureSources(SERVED_FIXTURE));

const catalog = SERVED_CATALOG;
let root: Root | undefined;
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

it.each(["normal", "refused", "uncertain"] as const)("keeps add progress, success and refusal in toasts and settles a %s add without the operator", async outcome => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", `/?sessionsPreview=empty${outcome === "normal" ? "" : `&workerCommandPreview=${outcome}`}`);
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const render = () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(SessionPanel, { catalog, harness: sessionsSampleHarness, open: true, onOpenChange() {} }))));
  await act(async () => render());
  const panel = host.querySelector('section[aria-label="Session Panel"]'); assert(panel);
  const trigger = panel.querySelector('button[aria-label="Add workers"]'); assert(trigger instanceof HTMLButtonElement);
  await act(async () => { trigger.focus(); trigger.click(); });
  const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Add workers");
  assert(confirm instanceof HTMLButtonElement);
  await act(async () => { confirm.focus(); confirm.click(); });
  assert.equal(document.querySelector('[role="dialog"]') === null, true);
  assert.doesNotMatch(panel.textContent ?? "", /Adding workers|Workers added/);
  assert.equal(document.querySelectorAll('[data-slot="toast-title"]').length, 1);
  assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, "Adding workers…");
  assert.equal(trigger.disabled, true);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  assert.doesNotMatch(panel.textContent ?? "", /Adding workers|Workers added/);
  if (outcome === "uncertain") await act(async () => vi.advanceTimersByTimeAsync(1500));
  assert.doesNotMatch(panel.textContent ?? "", /Check outcome|uncertain|Response unavailable/, "an unknown outcome is read back, never shown");
  if (outcome === "refused") {
    assert.equal(panel.querySelector('[role="alert"]')?.textContent, undefined, "a refusal is a toast, not an inline panel");
    assert.deepEqual([...document.querySelectorAll('[data-slot="toast-title"]')].map(title => title.textContent?.replace(/:.*$/su, "")), ["Couldn't add workers"]);
    assert.match(document.querySelector('[data-slot="toast-title"]')?.textContent ?? "", /Worker control was refused/);
    assert.equal(panel.querySelectorAll("article").length, 0);
    assert.equal(trigger.disabled, false);
    return;
  }
  assert.equal(panel.querySelector('[role="alert"]') === null, true);
  assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, outcome === "uncertain" ? undefined : "Workers added");
  assert.equal(panel.querySelectorAll("article").length, 1, "the read-back confirms the addition once");
  assert.equal(trigger.disabled, false);
  await act(async () => render());
  assert.equal(document.querySelectorAll('[data-slot="toast-title"]').length, outcome === "uncertain" ? 0 : 1, "rerender does not repeat confirmed feedback");
});

it("dismisses add progress when the panel unmounts and ignores its late settlement", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?sessionsPreview=empty");
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  let shown = true;
  const render = () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, shown ? createElement(SessionPanel, { catalog, harness: sessionsSampleHarness, open: true, onOpenChange() {} }) : null)));
  await act(async () => render());
  const trigger = host.querySelector('button[aria-label="Add workers"]'); assert(trigger instanceof HTMLButtonElement);
  await act(async () => trigger.click());
  const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Add workers"); assert(confirm instanceof HTMLButtonElement);
  await act(async () => confirm.click());
  assert.equal(document.querySelector('[data-slot="toast-title"]')?.textContent, "Adding workers…");
  shown = false; await act(async () => render());
  assert.equal(document.querySelector('[data-slot="toast-title"]') === null, true);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  assert.equal(document.querySelector('[data-slot="toast-title"]') === null, true, "late confirmation cannot recreate a toast");
});
