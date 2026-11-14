// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest, type CommandResult } from "../../../src/rules/commands/commands.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../mocks/helpers/workflow-composition.js";
import { FIXTURE_DAY_WIRE } from "../../mocks/helpers/fixture-queue.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

async function mount(reply: (request: CommandRequest) => CommandResult) {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const sent: CommandRequest[] = [];
  const client = { ...transport,
    subscribeDay(input: Parameters<typeof transport.subscribeDay>[0]) { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: "live" }); return { close() {} }; },
    async executeCommand(raw: unknown) { const request = CommandRequestSchema.parse(raw); sent.push(request); return reply(request); },
  };
  window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE.day}`);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION }) })));
  return { host, sent, async close() { await act(async () => root.unmount()); host.remove(); localStorage.clear(); window.history.replaceState(null, "", "/"); } };
}

const button = (scope: ParentNode, name: string) => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.getAttribute("aria-label") === name || candidate.textContent === name);
  assert.ok(found, `missing ${name}`); return found;
};
const rowOf = (title: string) => {
  const row = FIXTURE_DAY_WIRE.queueSurfaces.find(surface => surface.title === title); assert.ok(row, title);
  const element = document.querySelector<HTMLElement>(`[data-demo-row-id="${row.runId}"]`); assert.ok(element, `no row for ${title}`);
  return { row, element };
};
async function openNotifications() {
  const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]'); assert.ok(bell);
  await act(async () => { bell.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  return document.body.textContent ?? "";
}

it("Run next on a served queue row dispatches a bump and a conflict reply publishes the row-changed notice", async () => {
  const message = "This run changed while you were looking at it.";
  const f = await mount(request => CommandResultSchema.parse({ state: "conflict", commandId: request.commandId, currentVersion: 5, message }));
  try {
    const { row, element } = rowOf("EID 10873698");
    await act(async () => { button(element, "Run next").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok(request.family === "run" && request.type === "bump");
    assert.equal(request.target.runId, row.runId);
    const text = await openNotifications();
    assert.match(text, /Run next: row changed/u);
    assert.ok(text.includes(`EID 10873698 · ${message}`), "the notice names the row and carries the server sentence");
  } finally { await f.close(); }
});

it("a confirmed Cancel run on a served queue row that is rejected publishes the Cancel run rejection notice", async () => {
  const message = "The run already finished.";
  const f = await mount(request => CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message }));
  try {
    const { row, element } = rowOf("Morrow, Bea");
    await act(async () => { button(element, "Cancel run").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(f.sent.length, 0, "Cancel run asks for confirmation before dispatching");
    await act(async () => { button(document.body, "Cancel the run").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok(request.family === "run" && request.type === "cancel");
    assert.equal(request.target.runId, row.runId);
    const text = await openNotifications();
    assert.match(text, /Cancel run: rejected/u);
    assert.ok(text.includes(`Morrow, Bea · ${message}`), "the notice names the row and carries the server sentence");
  } finally { await f.close(); }
});
