// @vitest-environment jsdom
import { BrowserSessionIdSchema } from "../../../src/domain/ids.js";
import type { WorkerCardWire } from "../../../src/dashboard/surfaces/session-panel-model.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { SessionPanel } from "../../../src/dashboard/surfaces/session-panel.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell-model.js";
import { DashboardDayWireSchema, WorkerCardWireSchema } from "../../../src/domain/dashboard/projection.js";
import { createWorkerCommandDispatch } from "../../../src/dashboard/app/worker-command-dispatch.js";
import { WorkerBrowserCommandRequestSchema, CommandResultSchema } from "../../../src/domain/commands.js";
import { browserHealthLabel, retainedControlMessage, workerControlRefusal } from "../../../src/dashboard/app/session-control-model.js";
import { FIXTURE_BOOTSTRAP, FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../parity/helpers/fixture-day.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function card(): WorkerCardWire {
  const idle = FIXTURE_DAY_WIRE.workerCards.find((entry) => entry.state === "idle" && entry.browsers.length > 0); assert.ok(idle);
  return DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerCards: [{ ...idle,
    controls: { basis: { state: "present", value: { leaseGeneration: 3, controlRevision: 7 } }, ownership: { state: "owned" } } }] }).workerCards[0];
}
const buttons = () => [...document.querySelectorAll("button")];
const button = (name: string) => { const found = buttons().find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name || name === "Sessions" && b.textContent?.startsWith("Sessions")); assert.ok(found, `missing ${name}`); return found; };
const press = async (name: string) => { await act(async () => button(name).click()); };
it("real controls retain exact identity across transport loss, clock ticks, heartbeat and browser replacement", async () => {
  let current = card(); let lose = true;
  const requests: ReturnType<typeof WorkerBrowserCommandRequestSchema.parse>[] = [];
  const dispatch = createWorkerCommandDispatch({ executeCommand: async (raw) => {
    const request = WorkerBrowserCommandRequestSchema.parse(raw); requests.push(request);
    if (lose) throw new Error("lost acknowledgement");
    return CommandResultSchema.parse({ state: "conflict", commandId: request.commandId, currentVersion: 99, message: "worker-control-basis-mismatch" });
  } }, { actorId: "local-operator", source: "dashboard" });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (now = FIXTURE_NOW) => act(async () => root?.render(createElement(SessionPanel, {
    workerCards: [current], queueSurfaces: [], workerPools: [], workflows: parseWorkflows(FIXTURE_BOOTSTRAP.workflows), counts: [],
    nowIso: now, connection: { state: "live" }, appVersion: "0.1.0", workerCommands: dispatch,
  })));
  await render(); await press("Sessions");
  assert.equal(document.querySelectorAll('[role="group"][aria-label$="browser controls"]').length, current.browsers.length);
  assert.ok(document.querySelector('[role="group"][aria-label^="Worker controls for "]'));
  assert.match(document.body.textContent ?? "", /Run.*Not checked/s);
  await press("Refresh UCPATH"); assert.equal(requests.length, 1);
  assert.match(document.body.textContent ?? "", /Response unavailable/);
  assert.equal(button("Reopen UCPATH").disabled, true);
  const first = requests[0]; assert.ok(first && "workerId" in first.target);
  assert.equal(first.target.controlBasis?.controlRevision, 7);
  current = WorkerCardWireSchema.parse({ ...current, leaseVersion: current.leaseVersion + 20 });
  await render("2026-08-03T20:00:00.000Z"); lose = false;
  await press("Check outcome"); assert.deepEqual(requests[1], requests[0]);
  assert.match(document.body.textContent ?? "", /worker-control-basis-mismatch/);
  const reopen = button("Reopen UCPATH"); reopen.focus();
  const replacement = "eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  current = { ...current, browsers: current.browsers.map((browser) => ({ ...browser, sessionId: BrowserSessionIdSchema.parse(replacement) })) };
  await render(); assert.equal(document.activeElement, reopen, "replacement readback must preserve control focus");
  await press("Reopen UCPATH"); const last = requests.at(-1); assert.ok(last && "browserSessionId" in last.target); assert.equal(last.target.browserSessionId, replacement);
  await press("Pause"); assert.equal(requests.at(-1)?.type, "pause-worker");
  current = { ...current, state: "paused", directive: "pause" }; await render();
  await press("Resume"); assert.equal(requests.at(-1)?.type, "resume-worker");
  await press("Stop"); assert.equal(requests.at(-1)?.type, "stop-worker");
});
it("missing, busy, foreign and retained uncertain evidence never becomes availability or health", () => {
  const owned = card(); const { controls: _controls, ...historical } = owned;
  assert.match(workerControlRefusal(historical) ?? "", /unavailable/);
  assert.equal(browserHealthLabel(owned.browsers[0]), "Not checked");
  assert.match(workerControlRefusal({ ...owned, state: "working" }, true) ?? "", /active/);
  assert.equal(workerControlRefusal({ ...owned, controls: { ...owned.controls!, ownership: { state: "unavailable", reason: "foreign process" } } }), "foreign process");
  for (const state of ["admitted", "ready", "executing", "uncertain", "refused"] as const) {
    const pending = WorkerCardWireSchema.parse({ ...owned, controls: { ...owned.controls!, operation: { commandId: "eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "refresh-browser" as const, state,
      at: FIXTURE_NOW, unresolved: state !== "refused", message: "exact target refused" } } });
    assert.match(retainedControlMessage(pending) ?? "", state === "uncertain" ? /uncertain/ : state === "refused" ? /Refused/ : /pending/);
    if (state !== "refused") assert.match(workerControlRefusal(pending) ?? "", /unresolved/);
  }
});
