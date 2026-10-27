// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { readRunLogs, useRunWiring } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { CommandExecutor, type CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { RowRevisionSchema } from "../../../src/models/dashboard/primitives.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { ActorIdSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";

function selectionAt(revision: number): LogSelection {
  const row = mockQueueSurface({ id: RUN, workflowId: "separations", title: "Separation 4502", subject: "Separation 4502", draft: initialMockDraft("separations"), approved: true, seeded: true }, "2026-08-03T16:10:00.000Z");
  return { row: { ...row, runId: RunIdSchema.parse(RUN), rowRevision: RowRevisionSchema.parse(revision) }, workflowLabel: "Separations" };
}
const native = (order: number, nodeId = "first") => NativeRunEventWireSchema.parse({ eventId: `10000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
  order, runId: RUN, attempt: 1, traceId: selectionAt(1).row.traceId, nodeId, spanPath: "first/span" });
const logs = () => RunDetailSectionResponseSchema.parse({ section: "logs", payload: NotePageSchema.parse({ runId: RUN,
  rows: [{ kind: "note", native: native(1), logId: NOTE, sequence: 0, note: { native: native(1), noteId: NOTE, runId: RUN, sequence: 0, at: AT, level: "info", message: "Read the document" } }],
  notes: [{ native: native(1), noteId: NOTE, runId: RUN, sequence: 0, at: AT, level: "info", message: "Read the document" }],
  confirmedActions: [], confirmedActionBindings: [], nextCursor: { state: "absent", reason: "end-of-page" } }) });
function detailAt(selected: LogSelection, revision: number, extra: Record<string, unknown> = {}) {
  const row = selected.row;
  return RunDetailWireSchema.parse({ runId: row.runId, rowRevision: revision, panelKind: "run",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: ["first", "identity-approval"].map(nodeId => ({ key: nodeId, label: nodeId, state: "done", members: [{ nodeId, categoryKey: nodeId, label: nodeId, state: "done" }] })), events: [] },
    gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Not complete" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"], ...extra });
}
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

type Harness = { state?: ReturnType<typeof useRunWiring>; outcomes: CommandOutcome[]; refreshed: number; render: (selected: LogSelection) => Promise<void> };
async function harness(client: DashboardClient): Promise<Harness> {
  const h: Harness = { outcomes: [], refreshed: 0, render: async () => undefined };
  const scope = Object.freeze({ actorId: ActorIdSchema.parse("local-operator"), client, authority: {}, dayRequest: {} });
  const dayState = { subscribePublications: () => () => undefined, request: scope.dayRequest, day: { state: "loading" as const }, connection: { state: "connecting" as const }, refresh: () => { h.refreshed++; } };
  const binding = { scope, executor: new CommandExecutor(() => scope), feedback: (outcome: CommandOutcome) => { h.outcomes.push(outcome); },
    authority: { epoch: scope.authority, catalog: [], nowIso: AT, today: "2026-08-03", day: "2026-08-03", dayState, selection: { route: { start: false }, workflowId: "separations" } } } as unknown as DashboardCommandBinding;
  function Probe({ selected }: { selected: LogSelection }) { h.state = useRunWiring(client, selected, binding); return null; }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.render = async selected => { await act(async () => { root?.render(createElement(Probe, { selected })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return h;
}
describe("served Logs read authority", () => {
  it("waits for the selected row to catch up when run detail is a newer revision", async () => {
    let served = 3;
    const client = { artifactUrl: (id: string) => `/artifacts/${id}`, runDetail: async () => detailAt(selectionAt(served), served), runSection: async () => logs() } as unknown as DashboardClient;
    await assert.rejects(() => readRunLogs(client, selectionAt(2), new AbortController().signal), (error: Error) => error.name === "RunLogSelectionBehindError");
    const h = await harness(client);
    await h.render(selectionAt(3));
    assert.equal(h.state?.state, "loaded");
    served = 4;
    await h.render(selectionAt(3));
    assert.equal(h.state?.state, "loading");
    assert.ok(h.state?.snapshot, "the last loaded logs stay visible while the row catches up");
    assert.equal(h.state?.error, undefined);
    assert.equal(h.refreshed, 1);
    await h.render(selectionAt(4));
    assert.equal(h.state?.state, "loaded");
    assert.equal(h.state?.snapshot?.detail.rowRevision, 4);
  });

  it("refuses the join when the row is still behind after one day refresh", async () => {
    const client = { artifactUrl: (id: string) => `/artifacts/${id}`, runDetail: async () => detailAt(selectionAt(4), 4), runSection: async () => logs() } as unknown as DashboardClient;
    const h = await harness(client);
    await h.render(selectionAt(3));
    assert.equal(h.state?.state, "loading");
    assert.equal(h.refreshed, 1);
    await h.render(selectionAt(3));
    assert.equal(h.state?.state, "failed");
    assert.equal(h.state?.error, formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_IDENTITY_REFUSED", {})).text);
    assert.equal(h.refreshed, 1);
  });

  it("still refuses run detail older than the selected row", async () => {
    const client = { artifactUrl: (id: string) => `/artifacts/${id}`, runDetail: async () => detailAt(selectionAt(3), 3), runSection: async () => logs() } as unknown as DashboardClient;
    await assert.rejects(() => readRunLogs(client, selectionAt(4), new AbortController().signal), /RUN_DETAIL_IDENTITY_MISMATCH/);
    const h = await harness(client);
    await h.render(selectionAt(4));
    assert.equal(h.state?.state, "failed");
    assert.equal(h.state?.error, formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_IDENTITY_REFUSED", {})).text);
    assert.equal(h.refreshed, 0);
  });
});
