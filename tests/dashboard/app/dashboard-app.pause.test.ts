// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ApplicationLifecycleSchema } from "../../../src/models/dashboard/application-lifecycle.js";
import { BulkRunCommandRequestSchema, CommandRequestSchema, type BulkRunCommandRequest, type CommandRequest, type CommandResult } from "../../../src/rules/commands/commands.js";
import { lifecycleCommandId } from "../../../src/rules/commands/lifecycle-command-id.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../mocks/helpers/workflow-composition.js";
import { FIXTURE_DAY_WIRE } from "../../mocks/helpers/fixture-queue.js";
import { pickedRunWorld } from "../../support/helpers/dashboard/picked-dashboard.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

async function mount(pause: "running" | "pause-pending" | "paused" = "running", day: typeof FIXTURE_DAY_WIRE = FIXTURE_DAY_WIRE) {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  let lifecycle = ApplicationLifecycleSchema.parse({ runtimeGeneration: 17, state: "ready", pause, update: "installer-unavailable",
    targets: [{ runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, expectedVersion: 7 },
      { runId: "00000000-0000-4000-8000-000000000099", expectedVersion: 11 }] });
  const reply = Promise.withResolvers<CommandResult>();
  const sent: Array<CommandRequest | BulkRunCommandRequest> = [];
  const client = { ...transport, applicationLifecycle: async () => lifecycle,
    subscribeDay(input: Parameters<typeof transport.subscribeDay>[0]) {
      input.onDay(day); input.onState({ state: "live" }); return { close() {} };
    },
    async executeBulkCommand(raw: unknown) { sent.push(BulkRunCommandRequestSchema.parse(raw)); return new Promise<never>(() => undefined); },
    async executeCommand(raw: unknown) { sent.push(CommandRequestSchema.parse(raw)); return reply.promise; },
  };
  window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE.day}`);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION }) })));
  const button = (name: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === name || button.textContent === name);
    assert.ok(button, `missing ${name}`); return button;
  };
  return { host, sent, reply, button,
    get lifecycle() { return lifecycle; },
    set lifecycle(value) { lifecycle = value; },
    async close() { await act(async () => root.unmount()); host.remove(); localStorage.clear(); window.history.replaceState(null, "", "/"); },
  };
}

it("Pause all sends exact global membership once, including runs outside the selected day", async () => {
  const f = await mount();
  try {
    await act(async () => { f.button("Pause all runs").click(); f.button("Pause all runs").click(); });
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok(request.family === "application");
    assert.equal(request.type, "pause-all");
    assert.deepEqual(request.target, { runtimeGeneration: 17 });
    assert.deepEqual(request.payload.targets, f.lifecycle.targets);
    assert.equal(request.source, "dashboard");
    assert.equal(f.button("Pause all runs").disabled, true);
    f.lifecycle = ApplicationLifecycleSchema.parse({ ...f.lifecycle, pause: "paused", targets: f.lifecycle.targets.map(target => ({ ...target,
      expectedVersion: target.expectedVersion + 1, pauseUnavailable: false, pause: { state: "paused", requestedAt: request.requestedAt, pausedAt: request.requestedAt,
        commandId: lifecycleCommandId("application-pause", { commandId: request.commandId, runId: target.runId }) } })) });
    await act(async () => { f.reply.resolve({ state: "applied", commandId: request.commandId,
      affectedTargets: [{ family: "application", runtimeGeneration: request.target.runtimeGeneration }] }); });
    assert.equal(f.button("Resume all runs").disabled, false);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await f.close(); }
});

it("keyboard quit confirms without a run list and retains an uncertain request without a second dispatch", async () => {
  const f = await mount();
  try {
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", metaKey: true, cancelable: true })));
    assert.equal(f.sent.length, 0);
    const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
    assert.equal(dialog.querySelector("ul, table"), null);
    assert.ok(!dialog.textContent?.includes(f.lifecycle.targets[0].runId));
    await act(async () => f.button("Keep working").click());
    assert.equal(f.sent.length, 0);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true, cancelable: true })));
    await act(async () => f.button("Pause all and quit").click());
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok(request.family === "application" && request.type === "pause-all-and-quit");
    assert.equal(request.payload.confirmed, true);
    assert.match(f.host.textContent ?? "", /Relay quits after runs pause/);
    await act(async () => f.reply.reject(new Error("lost response")));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", metaKey: true, cancelable: true })));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(f.button("Pause all runs").disabled, true);
    assert.equal(f.sent.length, 1);
  } finally { await f.close(); }
});

it("Pause all and Resume all follow the served application pause value", async () => {
  const pending = await mount("pause-pending");
  try {
    assert.equal(pending.button("Pause all runs").disabled, true);
    assert.match(pending.host.textContent ?? "", /pause/iu);
  } finally { await pending.close(); }
  const paused = await mount("paused");
  try {
    assert.equal(paused.button("Resume all runs").disabled, false);
    await act(async () => paused.button("Resume all runs").click());
    assert.equal(paused.sent.length, 1);
    assert.equal(paused.sent[0].type, "resume");
  } finally { await paused.close(); }
});

it("a pause-pending run shows an enabled Resume from the served command and pressing it sends resume", async () => {
  const world = pickedRunWorld("pausing");
  const f = await mount("pause-pending", world.day);
  try {
    const resume = f.button("Resume");
    assert.equal(resume.disabled, false);
    await act(async () => resume.click());
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok(request.family === "run" && !("targets" in request));
    assert.equal(request.type, "resume");
    assert.equal(request.target.runId, world.row.runId);
    assert.equal(request.target.expectedVersion, world.row.rowRevision);
  } finally { await f.close(); }
});
