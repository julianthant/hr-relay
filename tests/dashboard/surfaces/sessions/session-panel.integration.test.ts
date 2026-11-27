// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SessionPanel } from "../../../support/helpers/dashboard/sessions-host.js";
import type { SessionCommandBinding } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../../support/helpers/dashboard/mock-world/fixture-day.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../support/helpers/dashboard/mock-world/fixture-start.js";
import { servedFixtureSources } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { createRowStore } from "../../../../src/dashboard/client/index.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows));
const catalog = buildWorkflowCatalog(served, servedFixtureSources(served));
const client = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async () => { throw new Error("no request is expected"); } });
const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
const executor = new CommandExecutor(() => scope);
const binding = (day: SessionCommandBinding["dayState"]["day"]): SessionCommandBinding => ({ client, executor, scope, day: FIXTURE_DAY_WIRE.day, now: () => FIXTURE_NOW,
  dayState: { rows: createRowStore(), subscribePublications: () => () => {}, request: scope.dayRequest, day, connection: { state: "connecting" }, refresh() {} } });

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const mount = () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const render = (day: SessionCommandBinding["dayState"]["day"]) => act(async () => root?.render(createElement(TooltipProvider, null,
    createElement(ToastProvider, null, createElement(SessionPanel, { catalog, binding: binding(day), open: true, onOpenChange() {} })))));
  return { host, render };
};
const workerButtons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="region"][aria-label="Sessions"] button')];
const addWorkers = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Add workers"]');

it("keeps the worker cards it last read while another day loads, marked by a spinner, with every command disabled", async () => {
  const { host, render } = mount();
  await render({ state: "loaded", value: FIXTURE_DAY_WIRE });
  const cards = host.querySelectorAll("article").length;
  assert.ok(cards > 0, "the fixture day serves worker cards");
  assert.ok(workerButtons(host).some(button => !button.disabled), "a loaded day offers worker commands");
  assert.equal(addWorkers(host)?.disabled, false);
  assert.equal(host.querySelector("[data-sessions-stale]") === null, true);
  await render({ state: "loading" });
  assert.equal(host.querySelectorAll("article").length, cards);
  assert.equal(host.querySelector('[aria-busy="true"]') === null, true, "no skeleton for a day that is still loading");
  const spinner = () => host.querySelector('[data-sessions-stale] [role="status"][aria-label="Refreshing"]')?.parentElement ?? undefined;
  assert.ok(spinner()?.classList.contains("invisible"), "a fast reload shows a named spinner, still hidden");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  assert.equal(spinner()?.classList.contains("invisible"), false, "a slow reload shows the spinner");
  assert.equal(host.textContent?.includes("Updating"), false);
  assert.deepEqual(workerButtons(host).filter(button => !button.disabled).map(button => button.getAttribute("aria-label")), []);
  assert.equal(addWorkers(host)?.disabled, true, "Add workers stays shown and switched off while the day loads");
  assert.equal(addWorkers(host)?.parentElement?.getAttribute("aria-label"), "Sessions are out of date", "the dimmed button says why");
  await render({ state: "loaded", value: FIXTURE_DAY_WIRE });
  assert.equal(host.querySelector("[data-sessions-stale]") === null, true);
  assert.equal(addWorkers(host)?.disabled, false);
});

it("shows the loading placeholder, with Add workers switched off, when a day loads and none was read before", async () => {
  const { host, render } = mount();
  await render({ state: "loading" });
  assert.equal(host.querySelectorAll("article").length, 0);
  assert.equal(host.querySelector('[role="status"][aria-label="Loading sessions"]')?.getAttribute("aria-busy"), "true");
  assert.equal(host.querySelector("[data-sessions-stale]") === null, true);
  assert.equal(addWorkers(host)?.disabled, true);
  assert.equal(addWorkers(host)?.parentElement?.getAttribute("aria-label"), "Sessions are loading");
});
