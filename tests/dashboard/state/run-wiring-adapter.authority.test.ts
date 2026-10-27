// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { gateLogActions, readRunLogs, useRunWiring, type RunWiringConfirm } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { CommandExecutor, type CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import type { PendingCommand } from "../../../src/dashboard/surfaces/shared/actions/actions.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { IdentityGateDetailWireSchema, NativeRunEventWireSchema, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { RowRevisionSchema } from "../../../src/models/dashboard/primitives.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { ActorIdSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";
import { IdentityApprovalResultSchema } from "../../../src/rules/separations/identity-approval.js";
import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../support/helpers/dashboard/identity-ceremony-fixtures.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const CONFIRM = { title: "Approve this identity", body: "Approving binds the rest of this separation to this person.", confirmLabel: "Approve", tone: "neutral" } as const;

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
const fixtures = createIdentityCeremonyFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
function servedGate(packet: typeof fixtures.ONE_CLICK) {
  const gate = fixtures.gateDetail(packet);
  return IdentityGateDetailWireSchema.parse({ ...gate, native: native(50, gate.gateId), actions: [{ ...identityApprovalAction("Approve this person"), confirm: CONFIRM }] });
}

let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

type Harness = { state?: ReturnType<typeof useRunWiring>; outcomes: CommandOutcome[]; refreshed: number; render: (selected: LogSelection) => Promise<void> };
async function harness(client: DashboardClient, confirm?: RunWiringConfirm): Promise<Harness> {
  const h: Harness = { outcomes: [], refreshed: 0, render: async () => undefined };
  const scope = Object.freeze({ actorId: ActorIdSchema.parse("local-operator"), client, authority: {}, dayRequest: {} });
  const dayState = { subscribePublications: () => () => undefined, request: scope.dayRequest, day: { state: "loading" as const }, connection: { state: "connecting" as const }, refresh: () => { h.refreshed++; } };
  const binding = { scope, executor: new CommandExecutor(() => scope), feedback: (outcome: CommandOutcome) => { h.outcomes.push(outcome); },
    authority: { epoch: scope.authority, catalog: [], nowIso: AT, today: "2026-08-03", day: "2026-08-03", dayState, selection: { route: { start: false }, workflowId: "separations" } } } as unknown as DashboardCommandBinding;
  function Probe({ selected }: { selected: LogSelection }) { h.state = useRunWiring(client, selected, binding, confirm); return null; }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.render = async selected => { await act(async () => { root?.render(createElement(Probe, { selected })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return h;
}
function gateClient(gate: ReturnType<typeof servedGate>, selected: LogSelection, sent: CommandRequest[]): DashboardClient {
  const open = detailAt(selected, selected.row.rowRevision, { gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
  return { runDetail: async () => open, artifactUrl: (id: string) => `/artifacts/${id}`,
    runSection: async (_run: string, section: string) => section === "logs" ? logs() : RunDetailSectionResponseSchema.parse({ section: "identity-gate", payload: { state: "available", value: gate } }),
    executeCommand: async (raw: unknown) => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope);
      return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
  } as unknown as DashboardClient;
}

describe("served Logs decision authority", () => {
  it("offers a confirmation-bearing approval and dispatches its exact envelope only after the operator confirms", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const requested: { pending: PendingCommand; onConfirmed: () => void }[] = [];
    const sent: CommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (pending, onConfirmed) => { requested.push({ pending, onConfirmed }); });
    await h.render(selected);
    const approve = gateLogActions(gate)[0];
    assert.ok(approve); assert.ok(h.state?.onDecision);
    await act(async () => h.state?.onDecision?.(gate.gateId, approve, {}));
    assert.equal(sent.length, 0);
    assert.equal(requested.length, 1);
    const pending = requested[0].pending;
    assert.deepEqual(pending.action.confirm, CONFIRM);
    assert.deepEqual(pending.target, { runId: RUN, expectedVersion: 3 });
    assert.equal(pending.subject, "Separation 4502"); assert.equal(pending.traceId, String(selected.row.traceId)); assert.equal(pending.source, "run-detail");
    await act(async () => { requested[0].onConfirmed(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 1);
    const envelope = sent[0];
    assert.equal(envelope.commandId, pending.commandId);
    assert.equal(envelope.family, "gate");
    if (envelope.family === "gate") {
      assert.deepEqual(envelope.target, { runId: RUN, gateId: gate.gateId, expectedVersion: 3 });
      assert.deepEqual(envelope.payload.result.value, { decision: "approved", eid: gate.options[0].eid, chosenFrom: gate.options[0].chosenFrom, evidenceDigest: gate.evidenceDigest });
    }
  });

  it("carries the chosen candidate through confirmation", async () => {
    const gate = servedGate(fixtures.CHOOSE);
    const selected = selectionAt(3);
    const requested: (() => void)[] = [];
    const sent: CommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (_pending, onConfirmed) => { requested.push(onConfirmed); });
    await h.render(selected);
    const approve = gateLogActions(gate)[0];
    assert.ok(approve); assert.equal(approve.input?.kind, "candidate");
    await act(async () => h.state?.onDecision?.(gate.gateId, approve, { candidate: gate.options[1].eid }));
    assert.equal(sent.length, 0);
    await act(async () => { requested[0](); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 1);
    if (sent[0].family === "gate") assert.deepEqual(sent[0].payload.result.value, { decision: "approved", eid: gate.options[1].eid, chosenFrom: gate.options[1].chosenFrom, evidenceDigest: gate.evidenceDigest });
  });

  it("sends nothing when a newer row revision supersedes the confirmed gate", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const requested: (() => void)[] = [];
    const sent: CommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (_pending, onConfirmed) => { requested.push(onConfirmed); });
    await h.render(selected);
    await act(async () => h.state?.onDecision?.(gate.gateId, gateLogActions(gate)[0], {}));
    await h.render(selectionAt(4));
    await act(async () => { requested[0](); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 0);
    assert.deepEqual(h.outcomes.map(outcome => [outcome.kind, outcome.kind === "refused" ? outcome.reason : undefined]), [["refused", "not-attempted"]]);
  });

  it("never dispatches a confirmation-bearing approval without a confirmation port", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const sent: CommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent));
    await h.render(selected);
    assert.ok(h.state?.onDecision); assert.ok(gateLogActions(gate)[0]);
    await act(async () => h.state?.onDecision?.(gate.gateId, gateLogActions(gate)[0], {}));
    assert.equal(sent.length, 0);
  });

  it("keeps typed-EID approval and rejection unavailable", () => {
    const typed = servedGate(fixtures.TYPE_EID);
    assert.deepEqual(gateLogActions(typed), []);
    const oneClick = servedGate(fixtures.ONE_CLICK);
    assert.deepEqual(gateLogActions({ ...oneClick, actions: [{ ...identityApprovalAction("Reject"), key: "resolve-gate-rejected", resolution: "rejected", confirm: CONFIRM }] }), []);
  });

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
