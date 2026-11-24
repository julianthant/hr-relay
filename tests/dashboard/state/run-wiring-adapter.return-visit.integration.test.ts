// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { KEPT_RUN_LOGS_LIMIT, useRunWiring } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { dropKeptResults } from "../../../src/dashboard/state/async-resource.js";
import { mockQueueSurface } from "../../support/fixtures/dashboard/workflow-mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../support/fixtures/dashboard/workflow-mocks/workflow-mock-model.js";
import { NotePageSchema, NativeRunEventWireSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const selection: LogSelection = { row: { ...mockQueueSurface({ id: RUN, workflowId: "person-lookup", title: "Served subject", subject: "Served subject", draft: initialMockDraft("person-lookup"), approved: true, seeded: true }, "2026-08-03T16:10:00.000Z"), runId: RunIdSchema.parse(RUN) }, workflowLabel: "Person lookup" };
const selectionOf = (runId: string): LogSelection => ({ ...selection, row: { ...selection.row, runId: RunIdSchema.parse(runId) } });
const runIdOf = (index: number) => `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
const detail = (terminal: boolean, selected: LogSelection = selection, sections: readonly string[] = ["logs"]) => {
  const row = selected.row;
  const wire = RunDetailWireSchema.parse({ runId: row.runId, rowRevision: row.rowRevision, panelKind: "run",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: [{ key: "first", label: "first", state: "done", members: [{ nodeId: "first", categoryKey: "first", label: "first", state: "done" }] }], events: [] },
    gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Not complete" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: sections });
  return terminal ? { ...wire, outcome: { state: "terminal" as const, result: "done-with-warnings" as const, completedAt: AT } } : wire;
};
const logs = (runId: string = RUN) => {
  const native = NativeRunEventWireSchema.parse({ eventId: "10000000-0000-4000-8000-000000000001", order: 1, runId, attempt: selection.row.attempt, traceId: selection.row.traceId, nodeId: "first", spanPath: "first/span" });
  const note = { native, noteId: NOTE, runId, sequence: 0, at: AT, level: "info", message: "Authoritative note" };
  return RunDetailSectionResponseSchema.parse({ section: "logs", payload: NotePageSchema.parse({ runId, rows: [{ kind: "note", native, logId: NOTE, sequence: 0, note }], notes: [note], nextCursor: { state: "absent", reason: "end-of-page" } }) });
};
function clientFor(terminal: boolean, hold?: Promise<void>, sections: readonly string[] = ["logs"]) {
  const reads: { detail: number; hold: Promise<void> | undefined } = { detail: 0, hold };
  const client = { runDetail: async (runId: string) => { reads.detail += 1; await reads.hold; return detail(terminal, selectionOf(runId), sections); }, artifactUrl: (id: string) => `/artifacts/${id}`,
    runSection: async (runId: string, section: string) => section === "failure" ? RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "missing", reason: "No failure annotation" } }) : logs(runId) } as unknown as DashboardClient;
  return { client, reads };
}
let root: Root | undefined;
let seen: ReturnType<typeof useRunWiring> | undefined;
const bindingOf = (epoch: object, actorId: string, request: object = {}, stream?: object): DashboardCommandBinding => ({ scope: { actorId }, executor: { retainedAttempts: () => [] }, authority: { epoch, day: "2026-08-03", nowIso: AT,
  dayState: { request, ...(stream === undefined ? {} : { stream }), refresh: () => undefined, day: { state: "loaded" } } } }) as unknown as DashboardCommandBinding;
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
  it("shows a finished run's kept logs at once, display only, and reads it again", async () => {
    const { client, reads } = clientFor(true);
    const binding = bindingOf({}, "operator-a");
    await visit(client, selection, binding);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    assert.ok(seen?.onDecision, "fresh logs answer decisions");
    await leave();
    let release!: () => void;
    reads.hold = new Promise<void>(resolve => { release = resolve; });
    await visit(client, selection, binding);
    assert.equal(seen?.state, "loading", "a kept finished run is never loaded");
    assert.ok(seen?.snapshot, "its kept logs show on the first frame");
    assert.equal(seen?.onDecision, undefined, "no gate answer or Start reads a kept snapshot");
    assert.equal(seen?.onUcpathDecision, undefined, "no parked write reads a kept snapshot");
    assert.equal(seen?.onChildRetry, undefined);
    assert.equal(seen?.onBatchMemberRetry, undefined);
    await vi.waitFor(() => assert.equal(reads.detail, 2, "the return visit reads the run again"));
    release();
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    assert.ok(seen?.onDecision, "decisions open once the fresh logs land");
  });
  it("answers a re-served row of a finished run from this visit's fresh read, with no second read", async () => {
    const { client, reads } = clientFor(true);
    const binding = bindingOf({}, "operator-a");
    await visit(client, selection, binding);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    const before = reads.detail;
    await act(async () => root?.render(createElement(Probe, { client, run: { ...selection, row: { ...selection.row } }, binding })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(seen?.state, "loaded");
    assert.ok(seen?.onDecision);
    assert.equal(reads.detail, before, "a day frame that re-serves the same finished row reads nothing");
  });
  it("reads a finished run again after its day stream resets, never answering from the pre-reset read", async () => {
    const { client, reads } = clientFor(true);
    const epoch = {};
    const dayRequest = {};
    await visit(client, selection, bindingOf(epoch, "operator-a", dayRequest, {}));
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    let release!: () => void;
    reads.hold = new Promise<void>(resolve => { release = resolve; });
    await act(async () => root?.render(createElement(Probe, { client, run: { ...selection, row: { ...selection.row } }, binding: bindingOf(epoch, "operator-a", dayRequest, {}) })));
    assert.equal(seen?.state, "loading", "a reset stream's row is not answered by the read before the reset");
    assert.equal(seen?.onDecision, undefined);
    await vi.waitFor(() => assert.equal(reads.detail, 2, "the reset reads the run again"));
    release();
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
  });
  it("shows no snapshot read before a day stream reset while the replacement read is held, or after it is refused", async () => {
    const { client, reads } = clientFor(false);
    const epoch = {};
    const dayRequest = {};
    await visit(client, selection, bindingOf(epoch, "operator-a", dayRequest, {}));
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    let refuse!: (cause: Error) => void;
    reads.hold = new Promise<void>((_, reject) => { refuse = reject; });
    dropKeptResults(client);
    await act(async () => root?.render(createElement(Probe, { client, run: { ...selection, row: { ...selection.row } }, binding: bindingOf(epoch, "operator-a", dayRequest, {}) })));
    assert.equal(seen?.state, "loading");
    assert.equal(seen?.snapshot, undefined, "the pre-reset logs are gone, not shown as a kept copy");
    await vi.waitFor(() => assert.equal(reads.detail, 2));
    await act(async () => { refuse(new Error("replacement read refused")); });
    await vi.waitFor(() => assert.equal(seen?.state, "failed"));
    assert.equal(seen?.snapshot, undefined, "a refused replacement read does not bring back the pre-reset logs");
  });
  it("reads a finished run with decision sections again when a day frame re-serves its row", async () => {
    const { client, reads } = clientFor(true, undefined, ["logs", "failure"]);
    const binding = bindingOf({}, "operator-a");
    await visit(client, selection, binding);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    assert.ok(seen?.snapshot?.sections.some(section => section.section === "failure"));
    let release!: () => void;
    reads.hold = new Promise<void>(resolve => { release = resolve; });
    await act(async () => root?.render(createElement(Probe, { client, run: { ...selection, row: { ...selection.row } }, binding })));
    assert.equal(seen?.state, "loading", "a failure annotation can change without the run revision");
    await vi.waitFor(() => assert.equal(reads.detail, 2));
    release();
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
  });
  it("shows nothing kept after the sign-in authority changes, and reads again", async () => {
    const { client, reads } = clientFor(true);
    const first = bindingOf({}, "operator-a");
    await visit(client, selection, first);
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    await leave();
    let release!: () => void;
    reads.hold = new Promise<void>(resolve => { release = resolve; });
    await visit(client, selection, bindingOf({}, "operator-a"));
    assert.equal(seen?.state, "loading", "a new epoch keeps nothing");
    assert.equal(seen?.snapshot, undefined);
    assert.equal(reads.detail, 2, "and a read starts");
    release();
    await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
    await leave();
    reads.hold = new Promise<void>(() => undefined);
    await visit(client, selection, bindingOf((first.authority as { epoch: object }).epoch, "operator-b"));
    assert.equal(seen?.snapshot, undefined, "another actor keeps nothing");
    assert.equal(reads.detail, 3);
  });
  it("keeps the most recent runs only", async () => {
    const { client, reads } = clientFor(true);
    const epoch = {};
    const binding = bindingOf(epoch, "operator-a");
    for (let index = 0; index <= KEPT_RUN_LOGS_LIMIT; index += 1) {
      await visit(client, selectionOf(runIdOf(index)), binding);
      await vi.waitFor(() => assert.equal(seen?.state, "loaded"));
      await leave();
    }
    reads.hold = new Promise<void>(() => undefined);
    await visit(client, selectionOf(runIdOf(KEPT_RUN_LOGS_LIMIT)), binding);
    assert.ok(seen?.snapshot, "the newest run is still kept");
    await leave();
    await visit(client, selectionOf(runIdOf(0)), binding);
    assert.equal(seen?.snapshot, undefined, "the 21st visit evicted the oldest");
  });
});
