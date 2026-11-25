// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ApplicationLifecycleSchema } from "../../../src/models/dashboard/application-lifecycle.js";
import { BulkRunCommandRequestSchema, CommandRequestSchema, type BulkRunCommandRequest, type BulkRunCommandResponse, type CommandRequest, type CommandResult } from "../../../src/rules/commands/commands.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { FIXTURE_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { pickedRunWorld } from "../../support/helpers/dashboard/picked-dashboard.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const PAUSED_AT = "2026-08-03T00:00:00.000Z";

async function mount(pause: "running" | "pause-pending" | "paused" | "one-paused" = "running", day: typeof FIXTURE_DAY_WIRE = FIXTURE_DAY_WIRE,
  bulkReply: () => Promise<BulkRunCommandResponse> = () => new Promise<never>(() => undefined)) {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  let lifecycle = ApplicationLifecycleSchema.parse({ runtimeGeneration: 17, state: "ready", pause: pause === "one-paused" ? "running" : pause, update: "installer-unavailable",
    targets: [{ runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, expectedVersion: 7 },
      { runId: "00000000-0000-4000-8000-000000000099", expectedVersion: 11 }].map((target, index) => pause !== "paused" && !(pause === "one-paused" && index === 0) ? target : { ...target,
        pause: { state: "paused", requestedAt: PAUSED_AT, pausedAt: PAUSED_AT, commandId: "00000000-0000-4000-8000-0000000000aa" } }) });
  const reply = Promise.withResolvers<CommandResult>();
  const sent: Array<CommandRequest | BulkRunCommandRequest> = [];
  const client = { ...transport, applicationLifecycle: async () => lifecycle,
    subscribeDay(input: Parameters<typeof transport.subscribeDay>[0]) {
      input.onDay(day); input.onState({ state: "live" }); return { select() {}, close() {} };
    },
    async executeBulkCommand(raw: unknown) { sent.push(BulkRunCommandRequestSchema.parse(raw)); return bulkReply(); },
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

it("keyboard quit confirms without a run list and retains an uncertain request without a second dispatch", async () => {
  const f = await mount();
  try {
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", metaKey: true, cancelable: true })));
    assert.equal(f.sent.length, 0);
    const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
    assert.equal(dialog.querySelector("ul, table") === null, true);
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
    assert.equal(document.querySelector('[role="dialog"]') === null, true);
    assert.equal(f.sent.length, 1);
  } finally { await f.close(); }
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

it("paused runs offer Resume all above the queue, and it sends one resume for exactly those runs", async () => {
  const running = await mount();
  try { assert.doesNotMatch(running.host.textContent ?? "", /runs? paused/u); } finally { await running.close(); }
  const f = await mount("paused");
  try {
    assert.match(f.host.textContent ?? "", /2 runs paused ·/u);
    await act(async () => f.button("Resume all").click());
    assert.equal(f.sent.length, 1);
    const request = f.sent[0]; assert.ok("targets" in request && request.type === "resume");
    assert.deepEqual(request.targets, f.lifecycle.targets.map(({ runId, expectedVersion }) => ({ runId, expectedVersion })));
  } finally { await f.close(); }
});

it("with paused and unpaused runs, the strip counts and resumes only the paused ones", async () => {
  const f = await mount("one-paused");
  try {
    assert.match(f.host.textContent ?? "", /1 run paused ·/u);
    await act(async () => f.button("Resume all").click());
    const request = f.sent[0]; assert.ok("targets" in request && request.type === "resume");
    assert.deepEqual(request.targets, [{ runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, expectedVersion: 7 }]);
  } finally { await f.close(); }
});

it("quit stays disabled while a pause is pending", async () => {
  const f = await mount("pause-pending");
  try {
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", metaKey: true, cancelable: true })));
    assert.equal(f.button("Pause all and quit").disabled, true);
  } finally { await f.close(); }
});

it("clearing one batch's result notice leaves a later batch's failure listed", async () => {
  const f = await mount("paused", FIXTURE_DAY_WIRE, async () => ({ state: "refused", code: "policy-refused", message: "Relay is pausing work to quit." }));
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const toggleBell = async () => {
    const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert.ok(bell);
    await act(async () => bell.click()); await settle();
  };
  const results = () => [...document.querySelectorAll<HTMLElement>("li.notice-row")].filter(row => row.querySelector(".notice-title")?.textContent === "Resume: nothing was sent");
  try {
    await act(async () => f.button("Resume all").click()); await settle();
    await toggleBell();
    assert.equal(results().length, 1);
    const first = results()[0].dataset.id;
    await act(async () => results()[0].querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click()); await settle();
    assert.equal(results().length, 0);
    await toggleBell();
    await act(async () => f.button("Resume all").click()); await settle();
    assert.equal(f.sent.length, 2);
    await toggleBell();
    assert.equal(results().length, 1, "another batch's failure is its own notice");
    assert.notEqual(results()[0].dataset.id, first);
  } finally { await f.close(); }
});
