// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { IDLE_REFRESH_MS } from "../../../../src/dashboard/surfaces/sessions/session-idle-model.js";
import { useSessionPreviewCommands, type SessionPreviewCommandPort, type SessionPreviewRequest, type SessionPreviewResult } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { SessionsView } from "../../../../src/dashboard/surfaces/sessions/sessions-view.js";
import { createFixtureSessionPort, previewSessionControl, sessionsSample } from "../../../support/fixtures/dashboard/sessions-sample.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { FIXTURE_START_PICKER_BOOTSTRAP as SERVED_CATALOG_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";

const SERVED_FIXTURE = launchWorkflows(parseWorkflows(SERVED_CATALOG_BOOTSTRAP.workflows), SERVED_CATALOG_BOOTSTRAP.workbookCompatibility);
const SERVED_CATALOG = buildWorkflowCatalog(SERVED_FIXTURE, servedFixtureSources(SERVED_FIXTURE));
const READBACK_MS = 2500;

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

async function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, element)));
  return host;
}
// Small steps let React render between timers, as it does in the browser.
const advance = async (ms: number) => { for (let step = 0; step < ms; step += 250) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(250, ms - step)); }); };
const paused = (port: SessionPreviewCommandPort, problems: string[] = []) => {
  const initial = sessionsSample("active");
  const source = { snapshot: initial, scope: {}, actorId: "local-operator", onRefused: (problem: string) => { problems.push(problem); } };
  function Harness() {
    const commands = useSessionPreviewCommands(initial, SERVED_CATALOG, port, source);
    return createElement(SessionsView, { data: commands.data, open: true, onOpenChange: () => undefined, workflows: SERVED_CATALOG.map(flow => ({ id: flow.id, label: flow.label })), onControl: commands.control, onAdd: commands.add, operations: commands.operations });
  }
  return createElement(Harness);
};
const firstPause = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Pause"]');
const confirmedPause = (request: SessionPreviewRequest): SessionPreviewResult => ({ id: request.id, state: "confirmed", data: previewSessionControl(sessionsSample("active"), request.target, "pause") });

describe("worker controls", () => {
  it("blocks repeat worker commands until acknowledgment and preserves peer state", async () => {
    let resolve!: (result: SessionPreviewResult) => void;
    const requests: SessionPreviewRequest[] = [];
    const host = await mount(paused({ send: request => { requests.push(request); return new Promise(done => { resolve = done; }); }, check: async request => confirmedPause(request) }));
    const first = firstPause(host); assert(first);
    await act(async () => { first.click(); first.click(); });
    assert.equal(requests.length, 1); assert(first.disabled);
    assert.match(host.textContent ?? "", /Pause requested/); assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
    await act(async () => resolve(confirmedPause(requests[0])));
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1); assert.equal(host.querySelectorAll('button[aria-label="Pause"]').length, 1);
  });

  it("reads a lost reply back by itself: the new state shows with no message and no resend", async () => {
    vi.useFakeTimers();
    const sent: SessionPreviewRequest[] = [], checked: SessionPreviewRequest[] = [], problems: string[] = [];
    const host = await mount(paused({ send: async request => { sent.push(request); throw new Error("Pause response unavailable"); }, check: async request => { checked.push(request); return confirmedPause(request); } }, problems));
    await act(async () => firstPause(host)?.click());
    assert(firstPause(host)?.disabled, "the control stays locked while its result is read back");
    await act(async () => firstPause(host)?.click());
    await advance(READBACK_MS);
    assert.equal(sent.length, 1, "nothing is resent"); assert.deepEqual(checked, sent);
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1);
    assert.doesNotMatch(host.textContent ?? "", /uncertain|Check outcome|unavailable/u);
    assert.equal(host.querySelector('[role="alert"]'), null); assert.deepEqual(problems, []);
  });

  it("settles a foreign or malformed reply from the read-back", async () => {
    vi.useFakeTimers();
    const checked: SessionPreviewRequest[] = [];
    for (const reply of [(_: SessionPreviewRequest): SessionPreviewResult => ({ id: "foreign", state: "confirmed" }),
      (request: SessionPreviewRequest) => { const raw: SessionPreviewResult = { id: request.id, state: "refused", message: "private malformed response" }; Reflect.set(raw, "message", 42); return raw; }]) {
      const host = await mount(paused({ send: async request => reply(request), check: async request => { checked.push(request); return confirmedPause(request); } }));
      await act(async () => firstPause(host)?.click());
      await advance(READBACK_MS);
      assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1);
      assert.doesNotMatch(host.textContent ?? "", /did not match|private malformed|Check outcome/u);
      await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    }
    assert.equal(checked.length, 2);
  });

  it("ends an unconfirmed control with the old state, one short toast and the control enabled", async () => {
    vi.useFakeTimers();
    const sent: SessionPreviewRequest[] = [], problems: string[] = [], abandoned: SessionPreviewRequest[] = [];
    const host = await mount(paused({ send: async request => { sent.push(request); return { id: request.id, state: "uncertain", message: "Lost response" }; },
      check: async request => ({ id: request.id, state: "uncertain", message: "No served effect yet" }), abandon: async request => { abandoned.push(request); } }, problems));
    await act(async () => firstPause(host)?.click());
    await advance(READBACK_MS);
    assert.deepEqual(problems, ["Couldn't pause this worker."]);
    assert.deepEqual(abandoned, sent, "the unproved command's lock is freed");
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
    assert.equal(firstPause(host)?.disabled, false, "the control works again without a reload");
    assert.doesNotMatch(host.textContent ?? "", /Lost response|No served effect|Check outcome/u);
    assert.equal(host.querySelector('[role="alert"]'), null);
    await act(async () => firstPause(host)?.click());
    assert.equal(sent.length, 2, "a new press sends a new command");
  });

  it("keeps a refusal the send returned and leaves the state unchanged", async () => {
    const host = await mount(paused({ send: async request => ({ id: request.id, state: "refused", message: "Busy elsewhere" }), check: async request => ({ id: request.id, state: "uncertain", message: "Unknown" }) }));
    await act(async () => firstPause(host)?.click());
    assert.match(host.textContent ?? "", /Busy elsewhere/u); assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
  });

  it("drops a pending control when the scope changes during its read-back", async () => {
    vi.useFakeTimers();
    const initial = sessionsSample("active"); assert(initial.state === "ready");
    const target = initial.workers[0].id;
    let scope = {}; let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
    const port: SessionPreviewCommandPort = { send: async request => ({ id: request.id, state: "uncertain", message: "Lost" }), check: async request => confirmedPause(request) };
    function Harness() { commands = useSessionPreviewCommands(initial, SERVED_CATALOG, port, { snapshot: initial, scope, actorId: "local-operator" }); return null; }
    await mount(createElement(Harness));
    await act(async () => commands!.control(target, "pause"));
    assert.equal(commands!.operations[target]?.state, "pending");
    scope = {}; await act(async () => root?.render(createElement(Harness)));
    assert.equal(commands!.operations[target], undefined, "the scope change clears the control at once, before its read-back ends");
    await advance(READBACK_MS);
    assert.equal(commands!.operations[target], undefined, "nothing pending survives a scope change");
    assert.deepEqual(commands!.data, initial);
  });

  it("clears a control whose reply is still outstanding when the day, sign-in or workflow changes", async () => {
    const initial = sessionsSample("active"); assert(initial.state === "ready");
    const target = initial.workers[0].id;
    let scope = {}; let commands: ReturnType<typeof useSessionPreviewCommands> | undefined; const problems: string[] = [];
    const port: SessionPreviewCommandPort = { send: () => new Promise<SessionPreviewResult>(() => undefined), check: async request => confirmedPause(request) };
    function Harness() { commands = useSessionPreviewCommands(initial, SERVED_CATALOG, port, { snapshot: initial, scope, actorId: "local-operator", onRefused: problem => { problems.push(problem); } }); return null; }
    await mount(createElement(Harness));
    await act(async () => commands!.control(target, "pause"));
    assert.equal(commands!.operations[target]?.state, "pending");
    scope = {}; await act(async () => root?.render(createElement(Harness)));
    assert.equal(commands!.operations[target], undefined);
    assert.deepEqual(problems, []);
  });

  it("the fixture port separates the lost response from the original command's read-back", async () => {
    vi.useFakeTimers(); const port = createFixtureSessionPort(sessionsSample("active"), SERVED_CATALOG, "uncertain");
    const request: SessionPreviewRequest = { id: "exact-one", target: "sample-worker-1", action: "pause" };
    const sent = port.send(request); await vi.advanceTimersByTimeAsync(600); assert.equal((await sent).state, "uncertain");
    const read = port.check(request); await vi.advanceTimersByTimeAsync(600); assert.equal((await read).state, "confirmed");
  });
});

it("runs idle refresh with the panel collapsed, reads a lost acknowledgment back, and stops on unmount", async () => {
  vi.useFakeTimers();
  const requests: SessionPreviewRequest[] = [], checks: SessionPreviewRequest[] = [];
  const port: SessionPreviewCommandPort = { send: async request => { requests.push(request); return { id: request.id, state: "uncertain", message: "Lost acknowledgment" }; }, check: async request => { checks.push(request); return { id: request.id, state: "confirmed" }; } };
  let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
  function Harness() { commands = useSessionPreviewCommands(sessionsSample("active"), [], port); return null; }
  await mount(createElement(Harness));
  await advance(IDLE_REFRESH_MS);
  assert.equal(requests.length, 1);
  await advance(READBACK_MS);
  assert.deepEqual(checks, requests, "the lost acknowledgment is read back, not resent");
  assert.notEqual(commands?.operations["sample-worker-4"]?.state, "pending");
  await advance(IDLE_REFRESH_MS); assert.equal(requests.length, 2);
  await act(async () => root?.unmount()); root = undefined;
  await vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS); assert.equal(requests.length, 2);
});
