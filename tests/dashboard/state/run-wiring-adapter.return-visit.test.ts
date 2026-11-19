// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { useRunWiring, type RunWiringState } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { mockQueueSurface } from "../../mocks/workflows/workflow-queue-model.js";
import { initialMockDraft } from "../../mocks/workflows/workflow-mock-model.js";
import { NotePageSchema, NativeRunEventWireSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const selection: LogSelection = { row: { ...mockQueueSurface({ id: RUN, workflowId: "person-lookup", title: "Served subject", subject: "Served subject", draft: initialMockDraft("person-lookup"), approved: true, seeded: true }, "2026-08-03T16:10:00.000Z"), runId: RunIdSchema.parse(RUN) }, workflowLabel: "Person lookup" };
const detail = (terminal: boolean) => {
  const row = selection.row;
  const wire = RunDetailWireSchema.parse({ runId: row.runId, rowRevision: row.rowRevision, panelKind: "run",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: [{ key: "first", label: "first", state: "done", members: [{ nodeId: "first", categoryKey: "first", label: "first", state: "done" }] }], events: [] },
    gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Not complete" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"] });
  return terminal ? { ...wire, outcome: { state: "terminal" as const, result: "done-with-warnings" as const, completedAt: AT } } : wire;
};
const logs = () => {
  const native = NativeRunEventWireSchema.parse({ eventId: "10000000-0000-4000-8000-000000000001", order: 1, runId: RUN, attempt: selection.row.attempt, traceId: selection.row.traceId, nodeId: "first", spanPath: "first/span" });
  const note = { native, noteId: NOTE, runId: RUN, sequence: 0, at: AT, level: "info", message: "Authoritative note" };
  return RunDetailSectionResponseSchema.parse({ section: "logs", payload: NotePageSchema.parse({ runId: RUN, rows: [{ kind: "note", native, logId: NOTE, sequence: 0, note }], notes: [note], nextCursor: { state: "absent", reason: "end-of-page" } }) });
};
function clientFor(terminal: boolean, hold?: Promise<void>) {
  const reads = { detail: 0 };
  const client = { runDetail: async () => { reads.detail += 1; await hold; return detail(terminal); }, artifactUrl: (id: string) => `/artifacts/${id}`, runSection: async () => logs() } as unknown as DashboardClient;
  return { client, reads };
}
let root: Root | undefined;
let seen: RunWiringState | undefined;
function Probe({ client }: Readonly<{ client: DashboardClient }>) { seen = useRunWiring(client, selection, undefined); return null; }
async function visit(client: DashboardClient) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe, { client })));
}
async function leave() { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); seen = undefined; });
afterEach(async () => { await leave(); vi.unstubAllGlobals(); });

describe("Logs return visit", () => {
  it("renders the kept value on the first frame, marked stale, before the read settles", async () => {
    let release!: () => void;
    const { client, reads } = clientFor(false);
    await visit(client);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    await leave();
    const held = new Promise<void>(resolve => { release = resolve; });
    // Same client identity keeps its value: re-read through the first client with a held detail.
    (client as unknown as { runDetail: () => Promise<unknown> }).runDetail = async () => { reads.detail += 1; await held; return detail(false); };
    await act(async () => { await visit(client); });
    assert.equal(seen?.state, "loading");
    assert.ok(seen?.snapshot, "the kept snapshot shows while the fresh read runs");
    release();
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    assert.equal(reads.detail, 2);
  });
  it("reads a finished run's logs once", async () => {
    const { client, reads } = clientFor(true);
    await visit(client);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    await leave();
    await visit(client);
    assert.equal(seen?.state, "loaded");
    assert.ok(seen?.snapshot);
    assert.equal(reads.detail, 1);
  });
});
