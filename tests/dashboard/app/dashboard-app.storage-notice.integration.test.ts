// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { PRODUCT_WORKFLOW_COMPOSITION, workflowComposition, type WorkflowSourcePolicy } from "../../../src/dashboard/app/workflow-sources.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Reflect.set(globalThis, "requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
Reflect.set(globalThis, "cancelAnimationFrame", clearTimeout);
Element.prototype.scrollIntoView = () => {};
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("the storage notice points at Notifications, which the rail offers, and not at a Settings section", async () => {
  const sources: Record<string, "mock"> = {};
  for (const id of Object.keys(PRODUCT_WORKFLOW_COMPOSITION.sources)) sources[id] = "mock";
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const client = { ...transport, bootstrap: async () => ({ ...await transport.bootstrap(), storage: { authority: "unavailable" as const } }) };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: () => workflowComposition(Object.freeze(sources) as WorkflowSourcePolicy) }) })); await new Promise(resolve => setTimeout(resolve, 30)); });
  const text = host.textContent ?? "";
  assert.match(text, /storage is unavailable/iu);
  assert.doesNotMatch(text, /Open Settings to check storage/u);
  assert.match(text, /Notifications/u);
  assert.ok(host.querySelector('button[aria-label^="Notifications"]'), "the bell the notice names exists");
});
