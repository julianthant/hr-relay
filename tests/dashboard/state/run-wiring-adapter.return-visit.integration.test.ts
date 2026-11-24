// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createRowStore, type DashboardClient, type RowStoreWriter } from "../../../src/dashboard/client/index.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { dropKeptResults } from "../../../src/dashboard/state/async-resource.js";
import { KEPT_RUN_LOGS_LIMIT, useRunWiring, type RunWiringState } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { mockQueueSurface } from "../../mocks/workflows/workflow-queue-model.js";
import { initialMockDraft } from "../../mocks/workflows/workflow-mock-model.js";
import { NotePageSchema, NativeRunEventWireSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { serveRunPanel } from "../../support/helpers/dashboard/serve-run-panel.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const selection: LogSelection = { row: { ...mockQueueSurface({ id: RUN, workflowId: "person-lookup", title: "Served subject", subject: "Served subject", draft: initialMockDraft("person-lookup"), approved: true, seeded: true }, "2026-08-03T16:10:00.000Z"), runId: RunIdSchema.parse(RUN) }, workflowLabel: "Person lookup" };
const selectionOf = (runId: string): LogSelection => ({ ...selection, row: { ...selection.row, runId: RunIdSchema.parse(runId) } });
const runIdOf = (index: number) => `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
const detail = (terminal: boolean, selected: LogSelection = selection) => {
  const row = selected.row;
  const wire = RunDetailWireSchema.parse({ runId: row.runId, rowRevision: row.rowRevision, panelKind: "run",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: [{ key: "first", label: "first", state: "done", members: [{ nodeId: "first", categoryKey: "first", label: "first", state: "done" }] }], events: [] },
    gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Not complete" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"] });
  return terminal ? { ...wire, outcome: { state: "terminal" as const, result: "done-with-warnings" as const, completedAt: AT } } : wire;
};
const logs = (runId: string = RUN) => {
  const native = NativeRunEventWireSchema.parse({ eventId: "10000000-0000-4000-8000-000000000001", order: 1, runId, attempt: selection.row.attempt, traceId: selection.row.traceId, nodeId: "first", spanPath: "first/span" });
  const note = { native, noteId: NOTE, runId, sequence: 0, at: AT, level: "info", message: "Authoritative note" };
  return RunDetailSectionResponseSchema.parse({ section: "logs", payload: NotePageSchema.parse({ runId, rows: [{ kind: "note", native, logId: NOTE, sequence: 0, note }], notes: [note], nextCursor: { state: "absent", reason: "end-of-page" } }) });
};
function clientFor(terminal: boolean, hold?: Promise<void>) {
  const reads: { detail: number; hold: Promise<void> | undefined } = { detail: 0, hold };
  const client = { runDetail: async (runId: string) => { reads.detail += 1; await reads.hold; return detail(terminal, selectionOf(runId)); }, artifactUrl: (id: string) => `/artifacts/${id}`, runSection: async (runId: string) => logs(runId) } as unknown as DashboardClient;
  return { client, reads };
}
let root: Root | undefined;
let seen: ReturnType<typeof useRunWiring> | undefined;
const stores = new WeakMap<DashboardCommandBinding, RowStoreWriter>();
const bindingOf = (epoch: object, actorId: string): DashboardCommandBinding => {
  const rows = createRowStore();
  const binding = ({ scope: { actorId }, executor: { retainedAttempts: () => [] }, authority: { epoch, day: "2026-08-03", nowIso: AT,
  dayState: { rows, request: {}, refresh: () => undefined, day: { state: "loaded" } } } }) as unknown as DashboardCommandBinding;
  stores.set(binding, rows);
  return binding;
};
const serve = (binding: DashboardCommandBinding, client: DashboardClient, runId: string) => {
  const rows = stores.get(binding);
  if (rows === undefined) throw new Error("binding without a row store");
  return serveRunPanel(rows, client, runId);
};
/** A visit of `run` whose stream has delivered its panel. */
async function visitServed(client: DashboardClient, run: LogSelection, binding: DashboardCommandBinding) {
  await visit(client, run, binding);
  await act(async () => serve(binding, client, run.row.runId));
}
function Probe({ client, run = selection, binding }: Readonly<{ client: DashboardClient; run?: LogSelection; binding?: DashboardCommandBinding }>) { seen = useRunWiring(client, run, binding); return null; }
async function visit(client: DashboardClient, run: LogSelection = selection, binding?: DashboardCommandBinding) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe, { client, run, ...(binding === undefined ? {} : { binding }) })));
}
async function leave() { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); seen = undefined; });
afterEach(async () => { await leave(); vi.unstubAllGlobals(); });

describe("Logs return visit", () => {
  it("renders the kept value on the first frame, marked stale, before the stream's panel arrives", async () => {
    const { client, reads } = clientFor(false);
    const epoch = {};
    await visitServed(client, selection, bindingOf(epoch, "operator-a"));
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    await leave();
    const fresh = bindingOf(epoch, "operator-a");
    await visit(client, selection, fresh);
    assert.equal(seen?.state, "loading");
    assert.ok(seen?.snapshot, "the kept snapshot shows while the stream's panel is awaited");
    await act(async () => serve(fresh, client, RUN));
    assert.equal(seen?.state, "loaded");
    assert.equal(reads.detail, 2, "only the two panels built for the stream read the run");
  });
  it("shows a finished run's kept logs at once, display only, until the stream delivers its panel", async () => {
    const { client, reads } = clientFor(true);
    const epoch = {};
    await visitServed(client, selection, bindingOf(epoch, "operator-a"));
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    assert.ok(seen?.onDecision, "the streamed panel answers decisions");
    await leave();
    const fresh = bindingOf(epoch, "operator-a");
    await visit(client, selection, fresh);
    assert.equal(seen?.state, "loading", "a kept finished run is never loaded");
    assert.ok(seen?.snapshot, "its kept logs show on the first frame");
    assert.equal(seen?.onDecision, undefined, "no gate answer or Start reads a kept snapshot");
    assert.equal(seen?.onUcpathDecision, undefined);
    assert.equal(seen?.onChildRetry, undefined);
    assert.equal(seen?.onBatchMemberRetry, undefined);
    assert.equal(reads.detail, 1, "the visit reads nothing");
    await act(async () => serve(fresh, client, RUN));
    assert.equal(seen?.state, "loaded");
    assert.ok(seen?.onDecision, "decisions open once the stream's panel lands");
  });
  it("drops the panel and every kept copy when the stream resets, so no decision runs until a fresh panel arrives", async () => {
    const { client } = clientFor(false);
    const binding = bindingOf({}, "operator-a");
    await visitServed(client, selection, binding);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    assert.ok(seen?.onDecision);
    await act(async () => { stores.get(binding)?.reset(); dropKeptResults(client); });
    assert.equal(seen?.state, "loading");
    assert.equal(seen?.snapshot, undefined, "the pre-reset logs are gone, not shown as a kept copy");
    assert.equal(seen?.onDecision, undefined, "decisions stay off with no panel");
    await act(async () => serve(binding, client, RUN));
    assert.equal(seen?.state, "loaded");
    assert.ok(seen?.onDecision, "a fresh panel turns them back on");
  });
  it("shows nothing kept after the sign-in authority changes, until the stream delivers", async () => {
    const { client, reads } = clientFor(true);
    const first = bindingOf({}, "operator-a");
    await visitServed(client, selection, first);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    await leave();
    const renewed = bindingOf({}, "operator-a");
    await visit(client, selection, renewed);
    assert.equal(seen?.state, "loading", "a new epoch keeps nothing");
    assert.equal(seen?.snapshot, undefined);
    await act(async () => serve(renewed, client, RUN));
    assert.equal(seen?.state, "loaded");
    await leave();
    await visit(client, selection, bindingOf((first.authority as { epoch: object }).epoch, "operator-b"));
    assert.equal(seen?.state, "loading");
    assert.equal(seen?.snapshot, undefined, "another actor keeps nothing");
    assert.equal(reads.detail, 2, "the two panels built for the stream are the only reads");
  });
  it("keeps the most recent runs only", async () => {
    const { client, reads } = clientFor(true);
    const epoch = {};
    for (let index = 0; index <= KEPT_RUN_LOGS_LIMIT; index += 1) {
      await visitServed(client, selectionOf(runIdOf(index)), bindingOf(epoch, "operator-a"));
      await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
      await leave();
    }
    const before = reads.detail;
    await visit(client, selectionOf(runIdOf(KEPT_RUN_LOGS_LIMIT)), bindingOf(epoch, "operator-a"));
    assert.ok(seen?.snapshot, "the newest run is still kept");
    await leave();
    await visit(client, selectionOf(runIdOf(0)), bindingOf(epoch, "operator-a"));
    assert.equal(seen?.state, "loading", "the 21st visit evicted the oldest");
    assert.equal(seen?.snapshot, undefined);
    assert.equal(reads.detail, before, "no visit sends a read");
  });
});
