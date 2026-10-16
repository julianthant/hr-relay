import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { vi } from "vitest";
// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { readFileSync as readFileSync_m0 } from "node:fs";
import { resolve as resolve_m0 } from "node:path";
import { act as act_m0,createElement as createElement_m0 } from "react";
import { createRoot as createRoot_m0 } from "react-dom/client";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { useSessionPreviewCommands as useSessionPreviewCommands_m0,type SessionPreviewCommandPort as SessionPreviewCommandPort_m0,type SessionPreviewRequest as SessionPreviewRequest_m0 } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { sessionsSample as sessionsSample_m0 } from "../../../../src/dashboard/surfaces/sessions/sessions-fixture.js";
// @vitest-environment jsdom
import assert_m1 from 'node:assert/strict';
import { act as act_m1,createElement as createElement_m1 } from 'react';
import { createRoot as createRoot_m1,type Root as Root_m1 } from 'react-dom/client';
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from 'vitest';
import { useSessionPreviewCommands as useSessionPreviewCommands_m1,type SessionPreviewCommandPort as SessionPreviewCommandPort_m1,type SessionPreviewRequest as SessionPreviewRequest_m1,type SessionPreviewResult as SessionPreviewResult_m1 } from '../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js';
import { createFixtureSessionPort, previewSessionControl, sessionsSample as sessionsSample_m1 } from '../../../../src/dashboard/surfaces/sessions/sessions-fixture.js';
import { SessionsView as SessionsView_m1 } from '../../../../src/dashboard/surfaces/sessions/sessions-view.js';
import { buildWorkflowCatalog as buildWorkflowCatalog_m1 } from '../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js';
// @vitest-environment jsdom
import assert_m2 from 'node:assert/strict';
import { act as act_m2,createElement as createElement_m2 } from 'react';
import { createRoot as createRoot_m2 } from 'react-dom/client';
import { it as it_m2 } from 'vitest';
import { IDLE_REFRESH_MS as IDLE_REFRESH_MS_m2 } from '../../../../src/dashboard/surfaces/sessions/session-idle-model.js';
import { useSessionPreviewCommands as useSessionPreviewCommands_m2,type SessionPreviewCommandPort as SessionPreviewCommandPort_m2,type SessionPreviewRequest as SessionPreviewRequest_m2 } from '../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js';
import { sessionsSample as sessionsSample_m2 } from '../../../../src/dashboard/surfaces/sessions/sessions-fixture.js';


{


function sliceBetween(source: string, openMarker: string, closeMarker: string, label: string): string {
  const opens = source.indexOf(openMarker);
  if (opens === -1) {
    throw new Error(`${label}: dashboard-app.tsx no longer contains the opening landmark ${JSON.stringify(openMarker)}`);
  }
  const closes = source.indexOf(closeMarker, opens);
  if (closes === -1) {
    throw new Error(`${label}: dashboard-app.tsx no longer contains the closing landmark ${JSON.stringify(closeMarker)}`);
  }
  return source.slice(opens, closes);
}

function stopWorkerRejectionArm(): string {
  const source = readFileSync_m0(resolve_m0(import.meta.dirname, "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.ts"), "utf8");
  return sliceBetween(source, "const perform = useCallback(", "const keepAlive = useIdleSessionRefresh(", "session control");
}

describe_m0("Session Panel Stop's rejection arm", () => {
  it_m0("retains uncertainty instead of claiming Nothing was recorded from a post-dispatch throw", () => {
    const arm = stopWorkerRejectionArm();
    assert_m0.match(arm, /port\.send\(request\)/u);
    assert_m0.match(arm, /catch \(cause\) \{ diagnostic = cause; result = \{ id: request\.id, state: 'uncertain', message: commandFeedback\('COMMAND_OUTCOME_UNCERTAIN'\)/u);
    assert_m0.match(arm, /retain\(\{ request, state: result\.state,/u);
    assert_m0.doesNotMatch(arm, /Nothing was recorded/u);
  });

  it_m0("keeps a rejected Stop unknown, blocks resubmission, and checks the same command", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const sent: SessionPreviewRequest_m0[] = [], checked: SessionPreviewRequest_m0[] = [];
    const port: SessionPreviewCommandPort_m0 = {
      send: async request => { sent.push(request); throw new Error("Stop response unavailable"); },
      check: async request => { checked.push(request); return { id: request.id, state: "confirmed", data: previewSessionControl(sessionsSample_m0("active"), request.target, "stop") }; },
    };
    const initial = sessionsSample_m0("active"), catalog: never[] = [];
    assert_m0.equal(initial.state, "ready");
    if (initial.state !== "ready") throw new Error("expected active workers");
    const worker = initial.workers.find(entry => entry.state === "running");
    assert_m0.ok(worker);
    let commands: ReturnType<typeof useSessionPreviewCommands_m0> | undefined;
    function Harness() { commands = useSessionPreviewCommands_m0(initial, catalog, port); return null; }
    const host = document.createElement("div"), root = createRoot_m0(host);
    try {
      await act_m0(async () => root.render(createElement_m0(Harness)));
      assert_m0.ok(commands);
      await act_m0(async () => commands!.control(worker.id, "stop"));
      const operation = commands.operations[worker.id];
      assert_m0.equal(sent.length, 1);
      assert_m0.equal(operation.state, "uncertain");
      assert_m0.equal(operation.message, ERROR_CATALOG.COMMAND_OUTCOME_UNCERTAIN.text);
      assert_m0.ok(operation.diagnostic instanceof Error);
      assert_m0.equal(operation.diagnostic.message, "Stop response unavailable");
      assert_m0.doesNotMatch(operation.message, /Nothing was recorded/u);
      assert_m0.deepEqual(commands.data, initial);
      await act_m0(async () => commands!.control(worker.id, "stop"));
      assert_m0.equal(sent.length, 1);
      await act_m0(async () => commands!.check(worker.id));
      assert_m0.deepEqual(checked, sent);
      assert_m0.equal(commands.operations[worker.id].state, "confirmed");
      assert_m0.equal(commands.data.state, "ready");
      if (commands.data.state !== "ready") throw new Error("expected workers after readback");
      assert_m0.equal(commands.data.workers.find(entry => entry.id === worker.id)?.state, "idle");
    } finally {
      await act_m0(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
}

{


Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root_m1 | undefined;
const _afterEachFixture0 = async () => { await act_m1(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); };
async function mount(element: ReturnType<typeof createElement_m1>) { const host = document.createElement('div'); document.body.append(host); root = createRoot_m1(host); await act_m1(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert_m1(found, name); return found; };
const press = async (name: string) => act_m1(async () => button(name).click());
function SessionsHarness({ port }: { port: SessionPreviewCommandPort_m1 }) {
  const catalog = buildWorkflowCatalog_m1([], true, previewFixtureSources([]));
  const commands = useSessionPreviewCommands_m1(sessionsSample_m1('active'), catalog, port);
  return createElement_m1(SessionsView_m1, { data: commands.data, open: true, onOpenChange: () => undefined, workflows: catalog.map(flow => ({ id: flow.id, label: flow.label })), onControl: commands.control, onAdd: commands.add, operations: commands.operations, onCheck: commands.check });
}
describe_m1('mounted frontend reliability contracts', () => {
afterEach_m1(_afterEachFixture0);

  it_m1('blocks repeat worker commands until acknowledgment and preserves peer state', async () => {
    let resolve!: (result: SessionPreviewResult_m1) => void;
    const requests: SessionPreviewRequest_m1[] = [];
    const port = { send: (request: SessionPreviewRequest_m1) => { requests.push(request); return new Promise<SessionPreviewResult_m1>(done => { resolve = done; }); }, check: async (request: SessionPreviewRequest_m1) => ({ id: request.id, state: 'confirmed' as const }) };
    const host = await mount(createElement_m1(SessionsHarness, { port }));
    const first = [...host.querySelectorAll('button[aria-label="Pause"]')][0] as HTMLButtonElement;
    await act_m1(async () => { first.click(); first.click(); });
    assert_m1.equal(requests.length, 1); assert_m1(first.disabled);
    assert_m1.match(host.textContent ?? '', /Pause requested/); assert_m1.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
    await act_m1(async () => resolve({ id: requests[0].id, state: 'confirmed', data: previewSessionControl(sessionsSample_m1('active'), requests[0].target, 'pause') }));
    assert_m1.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1); assert_m1.equal(host.querySelectorAll('button[aria-label="Pause"]').length, 1);
  });
  it_m1('keeps refused state unchanged and checks an uncertain exact command without resubmitting', async () => {
    const sent: SessionPreviewRequest_m1[] = [], checked: SessionPreviewRequest_m1[] = [];
    const port: SessionPreviewCommandPort_m1 = { send: async request => { sent.push(request); return { id: request.id, state: 'uncertain', message: 'Lost response' }; }, check: async request => { checked.push(request); return { id: request.id, state: 'confirmed', data: previewSessionControl(sessionsSample_m1('active'), request.target, 'pause') }; } };
    const host = await mount(createElement_m1(SessionsHarness, { port }));
    await act_m1(async () => (host.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click());
    assert_m1.match(host.textContent ?? '', /Lost response/);
    await press('Check outcome'); assert_m1.equal(sent.length, 1); assert_m1.equal(checked[0], sent[0]);
    assert_m1.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1);
    const refusal: SessionPreviewCommandPort_m1 = { send: async request => ({ id: request.id, state: 'refused', message: 'Busy elsewhere' }), check: async request => ({ id: request.id, state: 'uncertain', message: 'Unknown' }) };
    await act_m1(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    const refused = await mount(createElement_m1(SessionsHarness, { port: refusal }));
    await act_m1(async () => (refused.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click());
    assert_m1.match(refused.textContent ?? '', /Busy elsewhere/); assert_m1.equal(refused.querySelectorAll('button[aria-label="Resume"]').length, 0);
  });
  it_m1('the fictional port separates uncertain response from original command readback', async () => {
    vi.useFakeTimers(); const port = createFixtureSessionPort(sessionsSample_m1('active'), buildWorkflowCatalog_m1([], true, previewFixtureSources([])), 'uncertain');
    const request: SessionPreviewRequest_m1 = { id: 'exact-one', target: 'sample-worker-1', action: 'pause' };
    const sent = port.send(request); await vi.advanceTimersByTimeAsync(600); assert_m1.equal((await sent).state, 'uncertain');
    const read = port.check(request); await vi.advanceTimersByTimeAsync(600); assert_m1.equal((await read).state, 'confirmed');
  });
  it_m1('refuses foreign worker acknowledgment and retains the original recovery identity', async () => {
    const sent: SessionPreviewRequest_m1[] = [], checked: SessionPreviewRequest_m1[] = [];
    const port: SessionPreviewCommandPort_m1 = { send: async request => { sent.push(request); return { id: 'foreign', state: 'confirmed' }; }, check: async request => { checked.push(request); return { id: request.id, state: 'confirmed', data: previewSessionControl(sessionsSample_m1('active'), request.target, 'pause') }; } };
    const host = await mount(createElement_m1(SessionsHarness, { port }));
    await act_m1(async () => (host.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click());
    assert_m1.match(host.textContent ?? '', /The command response did not match the requested command/);
    assert_m1.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
    assert_m1((host.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).disabled);
    await press('Check outcome'); assert_m1.equal(checked[0], sent[0]); assert_m1.equal(sent.length, 1);
    assert_m1.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1);
  });
});
}

{


const _afterEachFixture0 = () => { vi.useRealTimers(); vi.unstubAllGlobals(); };
it_m2('runs with the panel collapsed, retains an uncertain request for readback, and stops on unmount', async () => {
try {


  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requests: SessionPreviewRequest_m2[] = [], checks: SessionPreviewRequest_m2[] = [];
  const port: SessionPreviewCommandPort_m2 = { send: async request => { requests.push(request); return { id: request.id, state: 'uncertain', message: 'Lost acknowledgment' }; }, check: async request => { checks.push(request); return { id: request.id, state: 'confirmed' }; } };
  let commands: ReturnType<typeof useSessionPreviewCommands_m2> | undefined;
  const catalog: never[] = [];
  function Harness() { commands = useSessionPreviewCommands_m2(sessionsSample_m2('active'), catalog, port); return null; }
  const host = document.createElement('div'), root = createRoot_m2(host);
  try {
    await act_m2(async () => root.render(createElement_m2(Harness)));
    await act_m2(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS_m2));
    assert_m2.equal(requests.length, 1); assert_m2.equal(commands?.operations['sample-worker-4'].state, 'uncertain');
    await act_m2(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS_m2)); assert_m2.equal(requests.length, 1);
    await act_m2(async () => commands?.check('sample-worker-4')); assert_m2.deepEqual(checks, requests);
    await act_m2(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS_m2)); assert_m2.equal(requests.length, 2);
  } finally { await act_m2(async () => root.unmount()); }
  await vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS_m2); assert_m2.equal(requests.length, 2);

} finally {
_afterEachFixture0();
}
});
}

it_m2('maps malformed and replaced-context responses to fixed catalog text while retaining originals', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial = sessionsSample_m2('active'); assert_m2(initial.state === 'ready');
  const target = initial.workers[0].id; const catalog = buildWorkflowCatalog_m1([], true, previewFixtureSources([]));
  let scope = {}; let resolve!: (result: SessionPreviewResult_m1) => void; let reject!: (cause: Error) => void;
  let raw: SessionPreviewResult_m1 | undefined;
  let commands: ReturnType<typeof useSessionPreviewCommands_m2> | undefined;
  const port: SessionPreviewCommandPort_m2 = { send: request => { raw = { id: request.id, state: 'refused', message: 'private malformed response' }; Reflect.set(raw, 'message', 42); return Promise.resolve(raw); }, check: request => new Promise((done, fail) => { raw = { id: request.id, state: 'confirmed' }; resolve = done; reject = fail; }) };
  function Harness() { commands = useSessionPreviewCommands_m2(initial, catalog, port, { snapshot: initial, scope, actorId: 'local-operator' }); return null; }
  const host = document.createElement('div'); const root = createRoot_m2(host);
  try {
    await act_m2(async () => root.render(createElement_m2(Harness)));
    await act_m2(async () => commands!.control(target, 'pause'));
    assert_m2.equal(commands!.operations[target].message, ERROR_CATALOG.COMMAND_READBACK_MISMATCH.text);
    assert_m2.equal(commands!.operations[target].diagnostic, raw);
    await act_m2(async () => commands!.check(target));
    const response = raw!; scope = {};
    await act_m2(async () => root.render(createElement_m2(Harness)));
    await act_m2(async () => resolve(response));
    assert_m2.equal(commands!.operations[target].state, 'uncertain');
    assert_m2.equal(commands!.operations[target].message, ERROR_CATALOG.DASHBOARD_AUTHORITY_REPLACED.text);
    assert_m2.equal(commands!.operations[target].diagnostic, response);
    assert_m2.deepEqual(commands!.data, initial);
    await act_m2(async () => commands!.check(target));
    scope = {}; await act_m2(async () => root.render(createElement_m2(Harness)));
    const cause = new Error('private transport failure');
    await act_m2(async () => reject(cause));
    assert_m2.equal(commands!.operations[target].message, ERROR_CATALOG.DASHBOARD_AUTHORITY_REPLACED.text);
    assert_m2.equal(commands!.operations[target].diagnostic, cause, 'context replacement preserves the original transport cause');
  } finally { await act_m2(async () => root.unmount()); vi.unstubAllGlobals(); }
});
