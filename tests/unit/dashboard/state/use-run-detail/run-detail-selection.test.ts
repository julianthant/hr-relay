// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import type { RunDetailWire } from "../../../../../src/models/dashboard/run-detail.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { useRunDetail } from "../../../../../src/dashboard/state/use-run-detail.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const A = "e1b8ae3e-0000-4000-8000-000000000001";
const B = "21ed4aa0-0000-4000-8000-000000000002";
const wire = (runId: string) => ({ runId }) as unknown as RunDetailWire;

const host = document.createElement("div");
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
});

it("isolates A → B → A, the selected day and late responses while retaining a confirmed same-run refresh", async () => {
  const pending: { runId: string; resolve: (value: RunDetailWire) => void; reject: (reason: Error) => void }[] = [];
  let client = { runDetail: (runId: string) => new Promise<RunDetailWire>((resolve, reject) => pending.push({ runId, resolve, reject })) } as DashboardClient;
  let observed: ReturnType<typeof useRunDetail> | undefined;
  const rendered: { runId: string; day: string; state: string }[] = [];
  const current = (): ReturnType<typeof useRunDetail> => {
    if (observed === undefined) throw new Error("run detail did not render");
    return observed;
  };
  function Probe({ runId, day, nonce }: { runId: string; day: string; nonce: number }) {
    observed = useRunDetail(runId, nonce, undefined, day);
    rendered.push({ runId, day, state: observed.state });
    return null;
  }
  const render = async (runId: string, day: string, nonce = 0) => {
    const start = rendered.length;
    await act(async () => {
      root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe, { runId, day, nonce }) }));
    });
    return rendered.slice(start);
  };
  await render(A, "2026-10-01");
  assert.equal(current().state, "loading");
  await act(async () => pending[0].resolve(wire(A)));
  assert.equal(current().state, "loaded");

  await render(A, "2026-10-01", 1);
  assert.equal(current().state, "loaded", "same-run revision follow keeps its last confirmed detail");
  const firstB = await render(B, "2026-10-01");
  assert.equal(firstB[0]?.state, "loading", "old A cannot appear before B's effect");
  assert.equal(current().state, "loading");
  const returnA = await render(A, "2026-10-01");
  assert.equal(returnA[0]?.state, "loading", "old A cannot appear before return-A's effect");
  assert.equal(current().state, "loading", "returning to A must not expose its old selection");
  await act(async () => { pending[1].resolve(wire(A)); pending[2].reject(new Error("late old-selection failure")); });
  assert.equal(current().state, "loading", "revoked responses cannot settle the current selection");
  await act(async () => pending[3].resolve(wire(A)));
  assert.equal(current().state, "loaded");

  const nextDay = await render(A, "2026-10-02");
  assert.equal(nextDay[0]?.state, "loading", "old day cannot appear before effects");
  assert.equal(current().state, "loading", "day identity invalidates same-run detail");
  await act(async () => pending[4].resolve(wire(B)));
  assert.equal(current().state, "failed", "mismatched served run identity fails loud");

  client = { runDetail: (runId: string) => new Promise<RunDetailWire>((resolve, reject) => pending.push({ runId, resolve, reject })) } as DashboardClient;
  const nextClient = await render(A, "2026-10-02");
  assert.equal(nextClient[0]?.state, "loading", "replacement client has a new selection incarnation");
  await act(async () => pending[5].resolve(wire(A)));
  assert.equal(current().state, "loaded");
});
