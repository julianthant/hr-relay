// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest, type CommandResult } from "../../../src/rules/commands/commands.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { FIXTURE_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

async function mount(reply: (request: CommandRequest) => CommandResult) {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const sent: CommandRequest[] = [];
  const client = { ...transport,
    subscribeDay(input: Parameters<typeof transport.subscribeDay>[0]) { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: "live" }); return { select() {}, close() {} }; },
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
  const message = "run 1a000000-0000-4000-8000-000000000001 is already terminal; there is nothing to cancel";
  const f = await mount(request => CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message }));
  try {
    const { row, element } = rowOf("Morrow, Bea");
    await act(async () => { button(element, "Cancel run").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(f.sent.length, 0, "Cancel run asks for confirmation before dispatching");
    await act(async () => { button(document.body, "Cancel the run").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok(request.family === "run" && request.type === "cancel");
    assert.equal(request.target.runId, row.runId);
    const strips = () => [...document.querySelectorAll('[role="alert"]')].filter(node => node.textContent === "Couldn't cancel: the run already finished or changed.");
    assert.equal(strips().length, 1);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click());
    assert.equal(strips().length, 0, "Dismiss hides the strip in place");
    const text = await openNotifications();
    assert.match(text, /Couldn't cancel: the run already finished or changed\./u);
    assert.ok(text.includes("Morrow, Bea · the run already finished or changed"), "the same entry stays in the Priority Inbox, without the internal sentence");
    assert.ok(!text.includes("already terminal"));
    const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]'); assert.ok(bell);
    await act(async () => { bell.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { button(rowOf("Morrow, Bea").element, "Cancel run").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { button(document.body, "Cancel the run").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(f.sent.length, 2);
    assert.equal(strips().length, 1, "a later failure shows a fresh strip");
  } finally { await f.close(); }
});
