// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import type { WorkflowExplorerWire } from "../../../src/models/dashboard/explorer.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";
import { useExplorerWiring } from "../../../src/dashboard/state/explorer-wiring-adapter.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const wire = buildWorkflowExplorer(explorerQueryDeps(manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("d".repeat(64))));
const served = wire.workflows.find(workflow => workflow.id === "person-lookup")!;

it("serves the review spec of the workflow at its registered version", async () => {
  const client = { workflowExplorer: async () => wire };
  let seen: ReturnType<typeof useExplorerWiring> | undefined;
  function Probe() { seen = useExplorerWiring(client, served.id, served.version); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    assert.ok(seen?.state.state === "ready");
    assert.deepEqual(seen.state.spec, served.reviewSpec);
  } finally { await act(async () => root.unmount()); }
});

it("invalidates settled and pending requests across workflow and client A -> B -> A", async () => {
  const pending: { resolve: (wire: WorkflowExplorerWire) => void; reject: (error: unknown) => void }[] = [];
  const makeClient = () => ({ workflowExplorer: () => new Promise<WorkflowExplorerWire>((resolve, reject) => pending.push({ resolve, reject })) });
  const a = makeClient(), b = makeClient();
  const seen: ReturnType<typeof useExplorerWiring>[] = [];
  function Probe({ client, id, version }: { client: typeof a; id?: string; version?: number }) { seen.push(useExplorerWiring(client, id, version)); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (client: typeof a, id?: string, version?: number) => { await act(async () => root.render(createElement(Probe, { client, id, version }))); };
  try {
    await render(a); assert.equal(pending.length, 0);
    await render(a, served.id); await act(async () => pending[0].resolve(wire)); assert.equal(seen.at(-1)?.state.state, "ready");
    const start = seen.length;
    await render(b, served.id); assert.ok(seen.slice(start).every(value => value.state.state === "loading"));
    await render(a, "missing-workflow");
    await render(a, served.id);
    assert.equal(pending.length, 3, "a workflow change reads nothing; only the client change did");
    await act(async () => { pending[1].reject(new Error("old client")); pending[2].resolve(wire); });
    assert.equal(seen.at(-1)?.state.state, "ready");
    await render(a, served.id, served.version + 1);
    assert.equal(seen.at(-1)?.state.state, "loading");
    await act(async () => pending[3].resolve(wire)); assert.equal(seen.at(-1)?.state.state, "refused");
  } finally { await act(async () => root.unmount()); }
});

it("maps a failed read to the shared dashboard read catalog text and reads again on retry", async () => {
  const root = createRoot(document.createElement("div"));
  const evidence = new Error("fixture read failed");
  let calls = 0;
  const client = { workflowExplorer: async () => { if (++calls === 1) throw evidence; return wire; } };
  let result: ReturnType<typeof useExplorerWiring> | undefined;
  function Probe() { result = useExplorerWiring(client, served.id); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    const failed = result?.state;
    assert.ok(failed?.state === "refused");
    assert.equal(failed.failure.code, "DASHBOARD_READ_FAILED");
    assert.equal(failed.evidence, evidence);
    assert.equal(formatErrorCatalogFailure(failed.failure).text, "The dashboard could not load this from the local service. Try again.");
    await act(async () => result?.retry());
    assert.equal(calls, 2);
    assert.equal(result?.state.state, "ready");
  } finally { await act(async () => root.unmount()); }
});

it("keeps the retained spec when a refresh fails", async () => {
  let calls = 0;
  const held = Promise.withResolvers<WorkflowExplorerWire>();
  const client = { workflowExplorer: () => ++calls === 1 ? Promise.resolve(wire) : held.promise };
  const seen: ReturnType<typeof useExplorerWiring>[] = [];
  function Probe() { seen.push(useExplorerWiring(client, served.id)); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.render(null)); seen.length = 0;
    await act(async () => root.render(createElement(Probe)));
    assert.equal(calls, 2); assert.ok(seen.every(value => value.state.state === "ready"));
    const evidence = new Error("synthetic refresh rejected");
    await act(async () => held.reject(evidence));
    const failed = seen.at(-1)?.state; assert.ok(failed?.state === "refused");
    assert.deepEqual(failed.previous, served.reviewSpec); assert.equal(failed.evidence, evidence);
  } finally { act(() => root.unmount()); }
});
