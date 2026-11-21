// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import type { SessionCommandBinding } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../../mocks/helpers/fixture-day.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
const catalog = buildWorkflowCatalog(served, servedFixtureSources(served));
const client = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async () => { throw new Error("no request is expected"); } });
const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
const executor = new CommandExecutor(() => scope);
const binding = (day: SessionCommandBinding["dayState"]["day"]): SessionCommandBinding => ({ client, executor, scope, day: FIXTURE_DAY_WIRE.day, nowIso: FIXTURE_NOW,
  dayState: { subscribePublications: () => () => {}, request: scope.dayRequest, day, connection: { state: "connecting" }, refresh() {} } });

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

it("keeps the worker cards it last read while another day loads, with no loading state in the bar", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const render = (day: SessionCommandBinding["dayState"]["day"]) => act(async () => root?.render(createElement(TooltipProvider, null,
    createElement(ToastProvider, null, createElement(SessionPanel, { catalog, binding: binding(day), open: true, onOpenChange() {} })))));
  await render({ state: "loaded", value: FIXTURE_DAY_WIRE });
  const cards = host.querySelectorAll("article").length;
  assert.ok(cards > 0, "the fixture day serves worker cards");
  const summary = host.textContent;
  await render({ state: "loading" });
  assert.equal(host.querySelectorAll("article").length, cards);
  assert.equal(host.querySelector('[aria-busy="true"]'), null, "no skeleton for a day that is still loading");
  assert.equal(host.textContent, summary);
});
