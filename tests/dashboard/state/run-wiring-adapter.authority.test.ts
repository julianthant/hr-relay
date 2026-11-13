// @vitest-environment jsdom
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { queueParentFixture } from "../../support/helpers/dashboard/queue-parent-fixture.js";
import { LogSample } from "../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../src/dashboard/state/client-context.js";
import { FIXTURE_PARKED_WRITE } from "../../support/fixtures/dashboard/run-detail/gates-park.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createDashboardClient,type DashboardClient } from "../../../src/dashboard/client/index.js";
import { failureDecision } from "../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { hireReviewDecision, parkedWriteDecision } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { gateDecisionFor } from "../../../src/models/trust/gate-decisions.js";
import { SearchPersonMatchOutputSchema } from "../../../src/models/systems/ucpath/search-person-match.js";
import { projectRunLogs, readRunLogs, useRunWiring, type RunWiringConfirm } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { CommandExecutor, type CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import type { PendingCommand } from "../../../src/dashboard/surfaces/shared/actions/actions.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { RunWorkbookReferenceChoiceWireSchema, FailureDetailWireSchema, ParkedWriteDetailWireSchema, IdentityGateDetailWireSchema, NativeRunEventWireSchema, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../src/models/dashboard/start-plan.js";
import { RowRevisionSchema } from "../../../src/models/dashboard/primitives.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { DashboardCommandRequestSchema, CommandResultSchema, ParkedWriteCheckTargetSchema, type DashboardCommandRequest } from "../../../src/rules/commands/commands.js";
import { ActorIdSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";
import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../support/helpers/dashboard/identity-ceremony-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { FIXTURE_DAY_WIRE } from "../../mocks/helpers/fixture-queue.js";
import { UcpathReadTransactionFindings } from "../../../src/models/systems/ucpath/read-transaction-findings.js";
import { workbookReferenceChoice, workbookReferenceDetail } from "../../support/fixtures/workbook-reference-choice.js";
import { workbookReferenceChoiceId } from "../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const GATE_NODE = "identity-approval";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const CONFIRM = { title: "Approve this identity", body: "Approving binds the rest of this separation to this person.", confirmLabel: "Approve", tone: "neutral" } as const;

for (const outcome of ["applied", "lost", "refused", "mismatch"] as const) it(`retains one batch root Retry through ${outcome} without inventing child authority`, async () => {
  const base = selectionAt(3);
  const selected: LogSelection = { ...base, row: QueueSurfaceWireSchema.parse({ ...base.row, workflowId: "person-lookup", parent: null,
    status: "failed", endedAt: { state: "present", value: AT },
    session: { state: "present", itemScope: "session", sessionId: RunIdSchema.parse(NOTE), origin: { kind: "start-plan", startPlanId: RunIdSchema.parse(NOTE), actorId: ActorIdSchema.parse("local-operator") },
      presentation: { layout: "batch", groupInQueue: true, version: RowRevisionSchema.parse(1), startedAt: AT } },
    actions: [{ key: "retry-batch-member", kind: "command", command: "retry", label: "Retry", icon: "retry", intent: "neutral", expectedVersion: 3, placement: ["banner"] }] }) };
  const source = detailAt(selected, 3);
  const replacementId = RunIdSchema.parse("00000000-0000-4000-8000-000000000004");
  const next = RunDetailWireSchema.parse({ ...source, runId: replacementId, rowRevision: 1,
    header: { ...source.header, runId: replacementId, retryOf: RUN, status: "queued", attempt: source.header.attempt + 1 } });
  const sent: DashboardCommandRequest[] = [];
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const client: DashboardClient = { ...createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("unexpected root retry read"); } }),
    runDetail: async id => id === replacementId ? next : source, runSection: async () => logs(),
    dashboardDay: async () => DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: [selected.row, { ...selected.row, runId: replacementId, attempt: next.header.attempt,
      itemId: outcome === "mismatch" ? replacementId : selected.row.itemId, rowRevision: RowRevisionSchema.parse(1), status: "queued", endedAt: { state: "absent", reason: "queued" }, actions: [] }] }),
    executeCommand: async raw => { const request = DashboardCommandRequestSchema.parse(raw); sent.push(request); await waiting;
      if (outcome === "lost") throw new Error("synthetic lost retry reply");
      return CommandResultSchema.parse(outcome === "refused" ? { state: "rejected", code: "policy-refused", message: "refused", commandId: request.commandId }
        : { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: RUN }, { family: "run", runId: replacementId }] }); },
  };
  const h = await harness(client); await h.render(selected);
  assert.equal(h.state?.onChildRetry, undefined); assert.ok(h.state?.onBatchMemberRetry);
  const retainedRetry = h.state.onBatchMemberRetry;
  h.day = { state: "loading" }; await h.render(selected);
  assert.equal(h.state?.onBatchMemberRetry, undefined);
  await act(async () => retainedRetry()); assert.equal(sent.length, 0);
  h.day = { state: "loaded", value: FIXTURE_DAY_WIRE }; await h.render(selected);
  const retry = retainedRetry;
  await act(async () => { retry(); retry(); });
  assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "pending"); assert.equal(h.state?.onBatchMemberRetry, undefined);
  assert.deepEqual(sent[0].target, { runId: RUN, expectedVersion: 3 });
  await act(async () => release?.());
  assert.equal(h.state?.command?.state, outcome === "applied" ? "settled" : outcome === "refused" ? "refused" : "uncertain", JSON.stringify(h.outcomes));
  assert.equal(h.refreshed, Number(outcome === "applied"));
  if (outcome === "lost") {
    assert.ok(h.state?.replay); await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
    await h.render({ ...selected, row: { ...selected.row, actions: [] } });
    await act(async () => h.state?.replay?.()); assert.equal(sent.length, 3); assert.deepEqual(sent[2], sent[0]);
    await h.render({ ...selected, row: { ...selected.row, rowRevision: RowRevisionSchema.parse(4), actions: [] } });
    await act(async () => h.state?.replay?.()); assert.equal(sent.length, 3);
  }
});

for (const outcome of ["lost", "refused"] as const) it(`disables mounted EC header Retry through stale, pending and ${outcome} authority, including retained callbacks`, async () => {
  const base = selectionAt(3);
  const selected: LogSelection = { ...base, row: QueueSurfaceWireSchema.parse({ ...base.row, workflowId: "emergency-contact-member", status: "failed",
    endedAt: { state: "present", value: AT }, parent: queueParentFixture(NOTE, { visibility: "inline" }), actions: [] }) };
  const source = detailAt(selected, 3, { header: { ...detailAt(selected, 3).header, parentRunId: NOTE }, childRetry: {
    key: "retry-child", label: "Retry", kind: "command", command: "retry", expectedVersion: 3, intent: "neutral", icon: "retry", placement: ["banner"] } });
  const sent: DashboardCommandRequest[] = [];
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const client: DashboardClient = { ...createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("unexpected EC retry read"); } }),
    runDetail: async () => source, runSection: async () => logs(), executeCommand: async raw => {
      const request = DashboardCommandRequestSchema.parse(raw); sent.push(request); await waiting;
      if (outcome === "lost") throw new Error("synthetic EC retry lost reply");
      return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "RUN_CONTINUATION_REFUSED", message: "Synthetic refusal" });
    } };
  const h = await harness(client, undefined, true); await h.render(selected);
  const retry = document.querySelector<HTMLButtonElement>('header button[aria-label="Retry"]'); assert.ok(retry && !retry.disabled);
  const retainedRetry = h.state?.onChildRetry; assert.ok(retainedRetry);
  h.day = { state: "loading" }; await h.render(selected);
  assert.equal(retry.disabled, true); assert.equal(h.state?.onChildRetry, undefined);
  await act(async () => retainedRetry()); assert.equal(sent.length, 0);
  h.day = { state: "loaded", value: FIXTURE_DAY_WIRE }; await h.render(selected);
  assert.equal(retry.disabled, false);
  await act(async () => { retry.click(); retry.click(); });
  assert.equal(sent.length, 1); assert.equal(retry.disabled, true);
  await act(async () => release?.());
  assert.equal(retry.disabled, outcome === "lost");
  const retainedReplay = h.state?.replay;
  h.day = { state: "loading" }; await h.render(selected);
  assert.equal(retry.disabled, true); assert.equal(h.state?.onChildRetry, undefined); assert.equal(h.state?.replay, undefined);
  await act(async () => { retainedRetry(); retainedReplay?.(); }); assert.equal(sent.length, 1);
});

it("dispatches the served child retry once and checks its replacement before refreshing", async () => {
  const selected = selectionAt(3), sent: DashboardCommandRequest[] = [];
  const replacementId = "00000000-0000-4000-8000-000000000004";
  const source = detailAt(selected, 3, { header: { ...detailAt(selected, 3).header, parentRunId: NOTE, status: "failed" },
    childRetry: { key: "retry-child", kind: "command", command: "retry", label: "Retry", expectedVersion: 3,
      icon: "retry", intent: "neutral", placement: ["banner"] } });
  const next = RunDetailWireSchema.parse({ ...source, runId: replacementId, rowRevision: 1, childRetry: undefined,
    header: { ...source.header, runId: replacementId, retryOf: RUN, attempt: source.header.attempt + 1, status: "queued" } });
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const client: DashboardClient = { ...createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("unexpected retry fixture read"); } }),
    runDetail: async (id: string) => id === replacementId ? next : source,
    runSection: async () => logs(),
    executeCommand: async (raw: unknown) => {
      const request = DashboardCommandRequestSchema.parse(raw); sent.push(request); await waiting;
      return CommandResultSchema.parse({ state: "applied", commandId: request.commandId,
        affectedTargets: [{ family: "run", runId: RUN }, { family: "run", runId: replacementId }] });
    },
  };
  const h = await harness(client); await h.render(selected);
  assert.ok(h.state?.onChildRetry);
  const retry = h.state.onChildRetry;
  await act(async () => { retry(); retry(); });
  assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "pending");
  assert.equal(h.state?.onChildRetry, undefined);
  assert.equal(sent[0].type, "retry"); assert.deepEqual(sent[0].target, { runId: RUN, expectedVersion: 3 });
  await act(async () => release?.());
  assert.equal(h.state?.command?.state, "settled"); assert.equal(h.refreshed, 1);
  assert.equal(h.state?.onChildRetry, undefined);
});

it.each(["same-child", "changed-revision", "root-run"] as const)("reconciles a lost child-retry reply only for the retained source (%s)", async sourceState => {
  const selected = selectionAt(3), sent: DashboardCommandRequest[] = [];
  const replacementId = "00000000-0000-4000-8000-000000000004";
  const source = detailAt(selected, 3, { header: { ...detailAt(selected, 3).header, parentRunId: NOTE, status: "failed" },
    childRetry: { key: "retry-child", kind: "command", command: "retry", label: "Retry", expectedVersion: 3,
      icon: "retry", intent: "neutral", placement: ["banner"] } });
  const next = RunDetailWireSchema.parse({ ...source, runId: replacementId, rowRevision: 1, childRetry: undefined,
    header: { ...source.header, runId: replacementId, retryOf: RUN, attempt: source.header.attempt + 1, status: "queued" } });
  let accepted = false;
  const client: DashboardClient = { ...createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("unexpected retry fixture read"); } }),
    runDetail: async (id: string) => id === replacementId ? next : !accepted ? source : RunDetailWireSchema.parse({ ...source, childRetry: undefined,
      rowRevision: sourceState === "changed-revision" ? 4 : 3,
      header: { ...source.header, parentRunId: sourceState === "root-run" ? undefined : NOTE } }),
    runSection: async () => logs(),
    executeCommand: async (raw: unknown) => {
      const request = DashboardCommandRequestSchema.parse(raw); sent.push(request);
      if (!accepted) { accepted = true; throw new Error("accepted retry reply lost"); }
      return CommandResultSchema.parse({ state: "already-applied", commandId: request.commandId,
        affectedTargets: [{ family: "run", runId: RUN }, { family: "run", runId: replacementId }] });
    },
  };
  const h = await harness(client); await h.render(selected);
  assert.ok(h.state?.onChildRetry);
  await act(async () => h.state?.onChildRetry?.());
  assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "uncertain");
  await h.render(sourceState === "changed-revision" ? selectionAt(4) : selected, 1);
  assert.equal(h.state?.snapshot?.detail.childRetry, undefined);
  assert.equal(h.state?.onChildRetry, undefined); assert.ok(h.state?.replay);
  await act(async () => h.state?.replay?.());
  if (sourceState === "same-child") {
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
    assert.equal(h.outcomes.at(-1)?.kind, "confirmed"); assert.equal(h.state?.command, undefined); assert.equal(h.refreshed, 1);
  } else {
    assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.refreshed, 0);
  }
});

it("continues a reference choice inline and retains its exact uncertain command across remount", async () => {
  const selected = selectionAt(3), f = workbookReferenceChoice(3, RUN, selected.row.traceId), sent: DashboardCommandRequest[] = [];
  let replay = false, resolved = false;
  const choice = () => RunWorkbookReferenceChoiceWireSchema.parse({ ...f.choice, native: NativeRunEventWireSchema.parse({ ...f.choice.native, order: resolved ? 11 : 10,
    eventId: resolved ? '10000000-0000-4000-8000-000000000011' : f.choice.native.eventId }),
    ...(resolved ? { resolution: { state: 'resolved' as const, workbookVersion: f.target.workbookVersion, resolvedAt: AT, selected: f.candidates[1] } } : {}) });
  const section = () => RunDetailSectionResponseSchema.parse({ section: 'workbook-writes', payload: { runId: RUN, operations: [], referenceChoices: [choice()] } });
  const client = { artifactUrl: (id: string) => `/artifacts/${id}`,
    runDetail: async () => detailAt(selected, resolved ? 4 : 3, { availableSections: ['logs', 'workbook-writes'],
      timeline: { steps: [...detailAt(selected, 3).timeline.steps!, ...workbookReferenceDetail(choice()).timeline.steps!],
        events: workbookReferenceDetail(choice()).timeline.events.map(event => ({ ...event, at: AT })) },
      gate: { state: resolved ? 'resolved' : 'open', gateId: NOTE, nodeId: f.target.gateId, label: 'Choose roster row',
        ...(resolved ? { resolution: 'approved', resolvedBy: 'local-operator', resolvedAt: AT, revision: 2 } : { openedAt: AT, revision: 1 }) } }),
    runSection: async (_run: string, name: string) => name === 'logs' ? logs() : section(),
    executeCommand: async (raw: unknown) => {
      const request = DashboardCommandRequestSchema.parse(raw); sent.push(request);
      if (!replay) throw new Error('reply lost');
      resolved = true;
      return CommandResultSchema.parse({ state: 'already-applied', commandId: request.commandId,
        affectedTargets: [{ family: 'gate', runId: RUN, gateId: f.target.gateId }, { family: 'run', runId: RUN }] });
    },
  } as unknown as DashboardClient;
  let confirmations = 0;
  const h = await harness(client, () => { confirmations++; }); await h.render(selected);
  const id = workbookReferenceChoiceId(f.choice), action = servedReferenceOption(f);
  await act(async () => h.state?.onDecision?.(id, action, { candidate: 'foreign' })); assert.equal(sent.length, 0);
  await act(async () => h.state?.onDecision?.(id, action, { candidate: `${f.candidates[1].sheetId}/${f.candidates[1].rowId}` }));
  assert.equal(confirmations, 0); assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'resolve-workbook-reference-row');
  assert.deepEqual(sent[0].payload, { sheetId: f.candidates[1].sheetId, rowId: f.candidates[1].rowId });
  assert.equal(h.state?.command?.state, 'uncertain'); assert.equal(h.state?.onDecision, undefined);
  await h.render(selected, 1); assert.equal(h.state?.command?.state, 'uncertain'); assert.ok(h.state?.replay);
  replay = true; await act(async () => h.state?.replay?.());
  assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
  assert.equal(h.state?.command?.state, 'settled'); assert.equal(h.refreshed, 1);
});

function selectionAt(revision: number): LogSelection {
  const row = mockQueueSurface({ id: RUN, workflowId: "separations", title: "Separation 4502", subject: "Separation 4502", draft: initialMockDraft("separations"), approved: true, seeded: true }, "2026-08-03T16:10:00.000Z");
  return { row: { ...row, runId: RunIdSchema.parse(RUN), rowRevision: RowRevisionSchema.parse(revision) }, workflowLabel: "Separations" };
}
const native = (order: number, nodeId = "first") => NativeRunEventWireSchema.parse({ eventId: `10000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
  order, runId: RUN, attempt: 1, traceId: selectionAt(1).row.traceId, nodeId, spanPath: "first/span" });
const logs = () => RunDetailSectionResponseSchema.parse({ section: "logs", payload: NotePageSchema.parse({ runId: RUN,
  rows: [{ kind: "note", native: native(1), logId: NOTE, sequence: 0, note: { native: native(1), noteId: NOTE, runId: RUN, sequence: 0, at: AT, level: "info", message: "Read the document" } }],
  notes: [{ native: native(1), noteId: NOTE, runId: RUN, sequence: 0, at: AT, level: "info", message: "Read the document" }],
  nextCursor: { state: "absent", reason: "end-of-page" } }) });
function detailAt(selected: LogSelection, revision: number, extra: Record<string, unknown> = {}) {
  const row = selected.row;
  return RunDetailWireSchema.parse({ runId: row.runId, rowRevision: revision, panelKind: "run",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: ["first", "identity-approval"].map(nodeId => ({ key: nodeId, label: nodeId, state: "done", members: [{ nodeId, categoryKey: nodeId, label: nodeId, state: "done" }] })), events: [] },
    gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Not complete" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"], ...extra });
}
const fixtures = createIdentityCeremonyFixtures(AT, "10833507", "10203262", () => RUN);
function servedGate(packet: typeof fixtures.ONE_CLICK) {
  const gate = fixtures.gateDetail(packet);
  return IdentityGateDetailWireSchema.parse({ ...gate, order: 50, actions: [{ ...identityApprovalAction("Approve this person"), confirm: CONFIRM }] });
}

let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

type Harness = { day?: DashboardCommandBinding["authority"]["dayState"]["day"]; state?: ReturnType<typeof useRunWiring>; outcomes: CommandOutcome[]; refreshed: number; render: (selected: LogSelection, key?: number) => Promise<void> };
async function harness(client: DashboardClient, confirm?: RunWiringConfirm, renderLogs = false): Promise<Harness> {
  const h: Harness = { outcomes: [], refreshed: 0, render: async () => undefined };
  const scope = Object.freeze({ actorId: ActorIdSchema.parse("local-operator"), client, authority: {}, dayRequest: {} });
  const dayState = { subscribePublications: () => () => undefined, request: scope.dayRequest, day: { state: "loaded" as const, value: FIXTURE_DAY_WIRE }, connection: { state: "live" as const }, refresh: () => { h.refreshed++; } };
  const binding = { scope, executor: new CommandExecutor(() => scope), feedback: (outcome: CommandOutcome) => { h.outcomes.push(outcome); },
    authority: { epoch: scope.authority, catalog: [], nowIso: AT, today: "2026-08-03", day: "2026-08-03", dayState, selection: { route: { start: false }, workflowId: "separations" } } } as unknown as DashboardCommandBinding;
  function Probe({ selected }: { selected: LogSelection }) {
    const currentBinding = h.day === undefined ? binding : { ...binding, authority: { ...binding.authority, dayState: { ...binding.authority.dayState, day: h.day } } };
    h.state = useRunWiring(client, selected, currentBinding, confirm);
    return renderLogs ? createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding: currentBinding,
      children: createElement(LogSample, { selection: selected }) }) }) : null;
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.render = async (selected, key = 0) => { await act(async () => { root?.render(createElement(Probe, { selected, key })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return h;
}
function gateClient(gate: ReturnType<typeof servedGate>, selected: LogSelection, sent: DashboardCommandRequest[]): DashboardClient {
  const open = detailAt(selected, selected.row.rowRevision, { gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
  return { runDetail: async () => open, artifactUrl: (id: string) => `/artifacts/${id}`,
    runSection: async (_run: string, section: string) => section === "logs" ? logs() : RunDetailSectionResponseSchema.parse({ section: "identity-gate", payload: { state: "available", value: gate } }),
    executeCommand: async (raw: unknown) => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope);
      return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
  } as unknown as DashboardClient;
}

describe("served Logs decision authority", () => {
  it("offers a confirmation-bearing approval and dispatches its exact envelope only after the operator confirms", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const requested: { pending: PendingCommand; onConfirmed: () => void }[] = [];
    const sent: DashboardCommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (pending, onConfirmed) => { requested.push({ pending, onConfirmed }); });
    await h.render(selected);
    const approve = gate.decision!.options[0];
    assert.ok(approve); assert.ok(h.state?.onDecision);
    await act(async () => h.state?.onDecision?.(gate.gateRef, approve, {}));
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
      assert.deepEqual(envelope.target, { runId: RUN, gateId: GATE_NODE, expectedVersion: 3 });
      assert.deepEqual(envelope.payload, { decision: "approved", gateRef: gate.gateRef, optionRef: gate.options[0].ref });
    }
  });

  it("answers a served hire-review arm with answer-gate-arm only after the operator confirms, carrying the picked row", async () => {
    const dropped = ["10000001", "10000002"].map(emplId => ({ emplId, name: emplId === "10000002" ? "Person, Fixture" : "Other, Person" }));
    const match = SearchPersonMatchOutputSchema.parse({ hits: dropped, confirmed: [], dropped: dropped.map(hit => ({ ...hit, reason: "Last name does not match" })) });
    const names = { firstName: "Fixture", middleName: "", lastName: "Person", preferredFirstName: "", preferredMiddleName: "", preferredLastName: "", ssn: null };
    const decision = hireReviewDecision("new-hire", match, names, gateDecisionFor("onboarding", "hire-review").arms, "hire-review", 3);
    assert.ok(decision !== undefined);
    const selected = selectionAt(3);
    const open = detailAt(selected, 3, { gate: { state: "open", gateId: NOTE, nodeId: "hire-review", label: "Review the hire", openedAt: AT, revision: 1, decision } });
    const [existing, newHire] = decision.options;
    assert.ok(existing && newHire);
    async function answer(option: NonNullable<typeof existing>, picked: { candidate?: string }) {
      await act(async () => root?.unmount()); root = undefined;
      const sent: DashboardCommandRequest[] = [], requested: { pending: PendingCommand; onConfirmed: () => void }[] = [];
      const client = { runDetail: async () => open, artifactUrl: (id: string) => `/artifacts/${id}`, runSection: async () => logs(),
        executeCommand: async (raw: unknown) => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope);
          return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: "hire-review" }] }); },
      } as unknown as DashboardClient;
      const h = await harness(client, (pending, onConfirmed) => { requested.push({ pending, onConfirmed }); });
      await h.render(selected);
      await act(async () => h.state?.onDecision?.(NOTE, option, picked));
      assert.equal(sent.length, 0, "nothing is sent before the confirmation");
      if (requested.length === 0) return undefined;
      assert.deepEqual(requested[0].pending.action.confirm, option.confirm);
      await act(async () => { requested[0].onConfirmed(); await new Promise(resolve => setTimeout(resolve, 0)); });
      assert.equal(sent.length, 1);
      const [envelope] = sent;
      assert.ok(envelope?.family === "gate" && envelope.type === "answer-gate-arm");
      assert.deepEqual(envelope.target, { runId: RUN, gateId: "hire-review", expectedVersion: 3 });
      return envelope.payload;
    }
    assert.equal(await answer(existing, {}), undefined, "Use existing employee needs a picked row");
    assert.deepEqual(await answer(newHire, {}), { arm: "new-hire" });
    assert.deepEqual(await answer(existing, { candidate: "10000002" }), { arm: "existing-person", rowId: "10000002" });
  });

  it("carries the chosen candidate through confirmation", async () => {
    const gate = servedGate(fixtures.CHOOSE);
    const selected = selectionAt(3);
    const requested: (() => void)[] = [];
    const sent: DashboardCommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (_pending, onConfirmed) => { requested.push(onConfirmed); });
    await h.render(selected);
    const approve = gate.decision!.options[0];
    assert.ok(approve); assert.equal(approve.input?.kind, "candidate");
    await act(async () => h.state?.onDecision?.(gate.gateRef, approve, { candidate: gate.options[1].ref }));
    assert.equal(sent.length, 0);
    await act(async () => { requested[0](); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 1);
    if (sent[0].family === "gate") assert.deepEqual(sent[0].payload, { decision: "approved", gateRef: gate.gateRef, optionRef: gate.options[1].ref });
  });

  it("sends nothing when a newer row revision supersedes the confirmed gate", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const requested: (() => void)[] = [];
    const sent: DashboardCommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (_pending, onConfirmed) => { requested.push(onConfirmed); });
    await h.render(selected);
    await act(async () => h.state?.onDecision?.(gate.gateRef, gate.decision!.options[0], {}));
    await h.render(selectionAt(4));
    await act(async () => { requested[0](); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 0);
    assert.deepEqual(h.outcomes.map(outcome => [outcome.kind, outcome.kind === "refused" ? outcome.reason : undefined]), [["refused", "not-attempted"]]);
  });

  it("never dispatches a confirmation-bearing approval without a confirmation port", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const sent: DashboardCommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent));
    await h.render(selected);
    assert.ok(h.state?.onDecision); assert.ok(gate.decision!.options[0]);
    await act(async () => h.state?.onDecision?.(gate.gateRef, gate.decision!.options[0], {}));
    assert.equal(sent.length, 0);
  });

  it("refuses a retained confirmation callback after its hook owner unmounts", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const requested: (() => void)[] = [];
    const sent: DashboardCommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (_pending, onConfirmed) => { requested.push(onConfirmed); });
    await h.render(selected);
    await act(async () => h.state?.onDecision?.(gate.gateRef, gate.decision!.options[0], {}));
    assert.equal(requested.length, 1);
    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => { requested[0](); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 0);
    assert.deepEqual(h.outcomes.map(outcome => [outcome.kind, outcome.kind === "refused" ? outcome.reason : undefined]), [["refused", "not-attempted"]]);
  });

  it("offers a name-mismatch gate as a pick and never a rejection", () => {
    const pick = servedGate(fixtures.NAME_MISMATCH).decision;
    assert.equal(pick?.type, "pick-person"); assert.equal(pick.options[0]?.input?.kind, "candidate");
    assert.deepEqual(pick.options.filter(option => option.id === "reject"), []);
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

function withParkedDecision(write: ReturnType<typeof ParkedWriteDetailWireSchema.parse>) {
  return ParkedWriteDetailWireSchema.parse({ ...write, decision: parkedWriteDecision({ taskId: write.taskId, parkedCode: write.parkedCode, readBack: false, acceptsTransactionId: write.acceptsTransactionId }, write.actions) });
}
/** Saved with a transaction number: the parked answer that re-reads the write. */
const SAVED = { text: "T123456" } as const;
const savedOf = (write: ReturnType<typeof parkedAt>) => { const option = write.decision?.options.find(({ id }) => id === "saved"); assert.ok(option); return option; };
function parkedAt(revision = 3, acceptsTransactionId = true) {
  return withParkedDecision(ParkedWriteDetailWireSchema.parse({ ...FIXTURE_PARKED_WRITE, acceptsTransactionId, runId: RUN,
    native: native(50), actions: FIXTURE_PARKED_WRITE.actions.map(action => ({ ...action, expectedVersion: revision })) }));
}
function withFailureDecision(failure: ReturnType<typeof FailureDetailWireSchema.parse>) {
  return FailureDetailWireSchema.parse({ ...failure, decision: failureDecision(failure) });
}
const failureOption = (failure: ReturnType<typeof FailureDetailWireSchema.parse>, id: string) => {
  const option = failure.decision?.options.find(candidate => candidate.id === id); assert.ok(option, id); return option;
};
function servedReferenceOption(f: ReturnType<typeof workbookReferenceChoice>) {
  assert.ok(f.choice.resolution.state === "available" && f.choice.resolution.decision?.options[0]); return f.choice.resolution.decision.options[0];
}
function parkedClient(selected: LogSelection, sent: DashboardCommandRequest[], options: {
  write?: ReturnType<typeof parkedAt>;
  execute?: (request: DashboardCommandRequest) => Promise<unknown>;
} = {}) {
  let version = selected.row.rowRevision.valueOf();
  let write = withParkedDecision(options.write ?? parkedAt(version));
  const client = { artifactUrl: (id: string) => `/artifacts/${id}`,
    runDetail: async () => detailAt(selected, version, { availableSections: ["logs", "parked-write"] }),
    runSection: async (_run: string, section: string) => section === "logs" ? logs()
      : RunDetailSectionResponseSchema.parse({ section: "parked-write", payload: write }),
    executeCommand: async (raw: unknown) => {
      const request = DashboardCommandRequestSchema.parse(raw); sent.push(request);
      if (options.execute !== undefined) return options.execute(request);
      if (request.family === "worker-browser" && request.type === "check-parked-write") {
        write = ParkedWriteDetailWireSchema.parse({ ...write, lastCheck: { commandId: request.commandId, requestedBy: request.requestedBy,
          target: request.target, observedAt: AT, held: true, state: "unknown", code: "PARKED_CHECK_UNKNOWN", provenance: "not-observed", evidenceDigest: "a".repeat(64) } });
        return CommandResultSchema.parse({ state: "applied", commandId: request.commandId,
          affectedTargets: [{ family: "run", runId: RUN }, { family: "worker-browser", workerId: request.target.workerId }] });
      }
      version++;
      return CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: RUN }] });
    },
  } as unknown as DashboardClient;
  return { client, setWrite: (next: typeof write, revision = version) => { write = withParkedDecision(next); version = revision; } };
}

describe("served parked-write Logs decisions", () => {
  function findingsWrite() {
    const write = parkedAt();
    const recheck = write.actions.find(action => action.kind === "command" && action.command === "recheck-write");
    assert.ok(recheck?.kind === "command" && recheck.writeTarget !== undefined);
    const target = ParkedWriteCheckTargetSchema.parse({ installationId: RUN, profileId: NOTE, workerId: "separations-worker-1", expectedVersion: 2,
      lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000",
      workflowId: "separations", itemId: NOTE, runId: RUN, runVersion: 3, runAttempt: 1, traceId: write.native?.traceId, nodeId: write.native?.nodeId,
      writeIntentId: write.writeIntentId, intentVersion: 2, intentGeneration: write.generation,
      writeAttemptId: recheck.writeTarget.writeAttemptId, bindingProofDigest: recheck.writeTarget.bindingProofDigest,
      occurrenceKeyDigest: recheck.writeTarget.occurrenceKeyDigest });
    return ParkedWriteDetailWireSchema.parse({ ...write, taskId: "ucpath/create-termination", check: { state: "available", target },
      actions: [...write.actions, { ...recheck, key: "check-parked-write", command: "check-parked-write", checkTarget: target }],
      ucpathFindings: { state: "found", findings: UcpathReadTransactionFindings.example,
        selectorVerification: "pending-live-verification", authoritative: false, matches: [] } });
  }

  it("projects retained findings at the exact parked Logs step", async () => {
    const selected = selectionAt(3), write = findingsWrite();
    const fixture = parkedClient(selected, [], { write });
    const snapshot = await readRunLogs(fixture.client, selected, new AbortController().signal);
    const projection = projectRunLogs(snapshot, fixture.client);
    assert.ok(projection.steps.some(step => step.id === write.writeIntentId));
    assert.deepEqual(projection.ucpathFindings, { stepId: write.writeIntentId, attemptLabel: "Attempt 1",
      presentation: { state: "found", complete: true, authoritative: false, rows: [] } });
  });

  for (const transactionNumber of [undefined, "T123456"]) it(`confirms the findings recheck with its original targets (${transactionNumber})`, async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [];
    const write = findingsWrite(), fixture = parkedClient(selected, sent, { write });
    const h = await harness(fixture.client, (_pending, send) => confirmations.push(send)); await h.render(selected);
    await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again", ...(transactionNumber === undefined ? {} : { transactionNumber }) }));
    assert.equal(sent.length, 0); assert.equal(confirmations.length, 1);
    await act(async () => confirmations[0]());
    assert.equal(sent.length, 1);
    const request = sent[0];
    if (transactionNumber === undefined) {
      assert.ok(request.family === "worker-browser" && request.type === "check-parked-write");
      assert.ok(write.check?.state === "available"); assert.deepEqual(request.target, write.check.target);
      return;
    }
    assert.ok(request.family === "run" && request.type === "recheck-write");
    const action = write.actions.find(action => action.kind === "command" && action.command === "recheck-write");
    assert.ok(action?.kind === "command" && action.writeTarget !== undefined);
    const { occurrenceKeyDigest, ...target } = action.writeTarget;
    assert.deepEqual(request.target, { runId: RUN, expectedVersion: 3, ...target });
    assert.deepEqual(request.payload, { occurrenceKeyDigest, ...(transactionNumber === undefined ? {} : { transactionId: transactionNumber }) });
  });

  it("refuses findings submitted/absent decisions and invalid typed IDs while selector authority is pending", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [];
    const h = await harness(parkedClient(selected, sent, { write: findingsWrite() }).client, (_pending, send) => confirmations.push(send));
    await h.render(selected);
    await act(async () => h.state?.onUcpathDecision?.({ kind: "submitted", transactionNumber: "T123456" }));
    await act(async () => h.state?.onUcpathDecision?.({ kind: "not-submitted" }));
    await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again", transactionNumber: "invalid" }));
    assert.equal(confirmations.length, 0); assert.equal(sent.length, 0);
  });

  it("disables table commands without an admitted idle-worker check", async () => {
    const selected = selectionAt(3), write = findingsWrite();
    const unavailable = ParkedWriteDetailWireSchema.parse({ ...write, check: { state: "unavailable", code: "PARKED_CHECK_UNAVAILABLE" },
      actions: write.actions.filter(action => action.kind !== "command" || action.command !== "check-parked-write") });
    const h = await harness(parkedClient(selected, [], { write: unavailable }).client); await h.render(selected);
    assert.equal(h.state?.onUcpathDecision, undefined);
  });

  it("refuses a held confirmation after its worker lifetime changes", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [], write = findingsWrite();
    const fixture = parkedClient(selected, sent, { write }), h = await harness(fixture.client, (_pending, send) => confirmations.push(send));
    await h.render(selected); await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again" }));
    assert.ok(write.check?.state === "available");
    const target = { ...write.check.target, lifetimeId: "bbbbbbbb-0002-4000-8000-000200000000" };
    fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, check: { state: "available", target },
      actions: write.actions.map(action => action.kind === "command" && action.command === "check-parked-write" ? { ...action, checkTarget: target } : action) }));
    await h.render(selectionAt(3)); await act(async () => confirmations[0]());
    assert.equal(sent.length, 0); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  it("allows another held check after a settled result serves a new worker target", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [], write = findingsWrite();
    const fixture = parkedClient(selected, sent, { write }), h = await harness(fixture.client, (_pending, send) => confirmations.push(send));
    await h.render(selected); await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again" }));
    await act(async () => confirmations[0]()); assert.equal(h.state?.command?.state, "settled");
    assert.ok(write.check?.state === "available");
    const target = { ...write.check.target, expectedVersion: 3, lifetimeId: "bbbbbbbb-0002-4000-8000-000200000000" };
    fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, check: { state: "available", target },
      actions: write.actions.map(action => action.kind === "command" && action.command === "check-parked-write" ? { ...action, checkTarget: target } : action) }));
    await h.render(selectionAt(3)); assert.ok(h.state?.onUcpathDecision);
    await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again" }));
    assert.equal(confirmations.length, 2); await act(async () => confirmations[1]());
    assert.equal(sent.length, 2); assert.notEqual(sent[0].commandId, sent[1].commandId);
    assert.ok(sent[1].family === "worker-browser" && sent[1].type === "check-parked-write");
    assert.equal(sent[1].target.lifetimeId, "bbbbbbbb-0002-4000-8000-000200000000");
  });

  for (const changed of [false, true]) it(`restores an uncertain held check and replays only its original occurrence (${changed})`, async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [], write = findingsWrite();
    let replay = false;
    const fixture = parkedClient(selected, sent, { write, execute: async request => {
      assert.ok(request.family === "worker-browser" && request.type === "check-parked-write");
      if (!replay) throw new Error("reply lost");
      fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, lastCheck: { commandId: request.commandId, requestedBy: request.requestedBy,
        target: request.target, observedAt: AT, held: true, state: "unknown", code: "PARKED_CHECK_UNKNOWN", provenance: "not-observed", evidenceDigest: "a".repeat(64) } }));
      return CommandResultSchema.parse({ state: "already-applied", commandId: request.commandId,
        affectedTargets: [{ family: "run", runId: RUN }, { family: "worker-browser", workerId: request.target.workerId }] });
    } });
    const h = await harness(fixture.client, (_pending, send) => confirmations.push(send)); await h.render(selected);
    await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again" })); await act(async () => confirmations[0]());
    assert.equal(h.state?.command?.state, "uncertain");
    fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, generation: changed ? 2 : 1,
      check: { state: "unavailable", code: "PARKED_CHECK_UNAVAILABLE" },
      actions: write.actions.filter(action => action.kind !== "command" || action.command !== "check-parked-write")
        .map(action => action.kind === "command" ? { ...action, writeTarget: { ...action.writeTarget, intentGeneration: changed ? 2 : 1 } } : action) }));
    await h.render(selected, 1); assert.equal(h.state?.command?.state, "uncertain");
    replay = true; await act(async () => h.state?.replay?.());
    assert.equal(sent.length, changed ? 1 : 2);
    if (changed) assert.equal(h.outcomes.at(-1)?.kind, "refused");
    else { assert.deepEqual(sent[1], sent[0]); assert.equal(h.state?.command?.state, "settled"); }
  });

  it("refuses the findings confirmation after the original write target changes", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [];
    const write = findingsWrite(), fixture = parkedClient(selected, sent, { write });
    const h = await harness(fixture.client, (_pending, send) => confirmations.push(send)); await h.render(selected);
    await act(async () => h.state?.onUcpathDecision?.({ kind: "check-again", transactionNumber: "T123456" }));
    const checkTarget = write.check?.state === "available" ? { ...write.check.target, intentGeneration: 2 } : undefined;
    fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, generation: 2,
      check: { state: "available", target: checkTarget }, actions: write.actions.map(action => action.kind === "command"
      ? { ...action, writeTarget: { ...action.writeTarget, intentGeneration: 2 }, ...(action.checkTarget === undefined ? {} : { checkTarget }) } : action) }));
    await h.render(selectionAt(3)); await act(async () => confirmations[0]());
    assert.equal(sent.length, 0); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  for (const [acceptsId, choice, answer, verb, transactionId] of [
    [true, "saved", { text: " T123456 " }, "recheck-write", "T123456"],
    [true, "not-saved", {}, "resolve-write-absent", undefined],
    [false, "saved", {}, "recheck-write", undefined],
    [false, "not-saved", {}, "resolve-write-absent", undefined],
  ] as const) it(`confirms and dispatches ${verb} (${acceptsId}, ${choice}, ${transactionId})`, async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: { pending: PendingCommand; send: () => void }[] = [];
    const write = parkedAt(3, acceptsId);
    const { client } = parkedClient(selected, sent, { write });
    const h = await harness(client, (pending, send) => confirmations.push({ pending, send }));
    await h.render(selected);
    const action = write.decision!.options.find(({ id }) => id === choice); assert.ok(action);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, action, answer));
    assert.equal(sent.length, 0); assert.equal(confirmations.length, 1);
    const expected = write.actions.find(action => action.kind === "command" && action.command === verb); assert.ok(expected?.kind === "command");
    assert.deepEqual(confirmations[0].pending.action, expected);
    await act(async () => confirmations[0].send());
    assert.equal(sent.length, 1);
    const request = sent[0]; assert.ok(request.family === "run" && (request.type === "recheck-write" || request.type === "resolve-write-absent"));
    const { occurrenceKeyDigest, ...writeTarget } = expected.writeTarget!;
    assert.deepEqual(request.target, { runId: RUN, expectedVersion: 3, ...writeTarget });
    assert.deepEqual(request.payload, { occurrenceKeyDigest, ...(transactionId === undefined ? {} : { transactionId }) });
    assert.equal(h.state?.command?.state, "settled"); assert.equal(h.refreshed, 1);
  });

  it("sends nothing for Saved without its transaction number when the system issues one", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [];
    const write = parkedAt(3, true);
    const h = await harness(parkedClient(selected, sent, { write }).client, (_pending, send) => confirmations.push(send)); await h.render(selected);
    const saved = write.decision!.options.find(({ id }) => id === "saved"); assert.ok(saved);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, saved, {}));
    await act(async () => h.state?.onDecision?.(write.writeIntentId, saved, { text: "123456" }));
    assert.equal(confirmations.length, 0); assert.equal(sent.length, 0);
  });

  for (const change of ["version", "generation", "intent", "attempt"] as const) it(`refuses confirmation after the parked ${change} changes`, async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirmations: (() => void)[] = [];
    const write = parkedAt(); const fixture = parkedClient(selected, sent);
    const h = await harness(fixture.client, (_pending, send) => confirmations.push(send)); await h.render(selected);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, write.decision!.options.find(({ id }) => id === "not-saved")!, {}));
    const next = { ...write, ...(change === "generation" ? { generation: 2 } : {}),
      ...(change === "intent" ? { writeIntentId: NOTE } : {}),
      actions: write.actions.map(action => action.kind !== "command" ? action : { ...action, expectedVersion: change === "version" ? 4 : 3,
        writeTarget: { ...action.writeTarget, ...(change === "generation" ? { intentGeneration: 2 } : {}),
          ...(change === "intent" ? { writeIntentId: NOTE } : {}), ...(change === "attempt" ? { writeAttemptId: NOTE } : {}) } }) };
    fixture.setWrite(ParkedWriteDetailWireSchema.parse(next), change === "version" ? 4 : 3);
    await h.render(selectionAt(change === "version" ? 4 : 3));
    await act(async () => confirmations[0]());
    assert.equal(sent.length, 0); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  for (const result of ["rejected", "conflict"] as const) it(`retains pending and ${result} feedback and allows a new confirmed decision after refusal`, async () => {
    let release: ((value: unknown) => void) | undefined;
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirms: (() => void)[] = [];
    const fixture = parkedClient(selected, sent, { execute: () => new Promise(resolve => { release = resolve; }) });
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(), action = savedOf(write);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, action, SAVED));
    await act(async () => confirms[0]());
    assert.equal(h.state?.command?.state, "pending"); assert.equal(h.state?.onDecision, undefined);
    await act(async () => confirms[0]()); assert.equal(sent.length, 1);
    await act(async () => release?.(CommandResultSchema.parse({ state: result, commandId: sent[0].commandId, message: "No longer parked", ...(result === "rejected" ? { code: "invalid-state" } : { currentVersion: 4 }) })));
    assert.equal(h.state?.command?.state, "refused"); assert.ok(h.state?.command?.feedback); assert.ok(h.state?.onDecision);
    await h.render(selectionAt(3), 1);
    assert.equal(h.state?.command?.state, "refused"); assert.ok(h.state?.command?.feedback); assert.ok(h.state?.onDecision);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, action, SAVED)); assert.equal(confirms.length, 2);
  });

  it("restores uncertainty after remount, replays the exact request and settles on matching readback", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirms: (() => void)[] = [];
    let replay = false;
    const fixture = parkedClient(selected, sent, { execute: async request => {
      if (!replay) throw new Error("reply lost");
      fixture.setWrite(parkedAt(4), 4);
      return CommandResultSchema.parse({ state: "already-applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: RUN }] });
    } });
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, savedOf(write), SAVED));
    await act(async () => confirms[0]());
    assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.state?.onDecision, undefined);
    await h.render(selectionAt(3), 1);
    assert.equal(h.state?.command?.state, "uncertain"); assert.ok(h.state?.replay);
    replay = true; await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(h.state?.command?.state, "settled"); assert.equal(h.refreshed, 1);
  });

  it("retains an uncertain attempt but refuses to replay it after a new intent generation", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirms: (() => void)[] = [];
    const fixture = parkedClient(selected, sent, { execute: async () => { throw new Error("reply lost"); } });
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, savedOf(write), SAVED));
    await act(async () => confirms[0]());
    fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, generation: 2, actions: write.actions.map(action => action.kind === "command"
      ? { ...action, writeTarget: { ...action.writeTarget, intentGeneration: 2 } } : action) }));
    await h.render(selectionAt(3));
    await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  it("offers the next parked decision after an accepted recheck returns with new authority", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], confirms: (() => void)[] = [];
    const fixture = parkedClient(selected, sent);
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, savedOf(write), SAVED));
    await act(async () => confirms[0]()); assert.equal(h.state?.command?.state, "settled");
    fixture.setWrite(parkedAt(4), 4); await h.render(selectionAt(4));
    assert.ok(h.state?.onDecision); assert.equal(h.state?.command, undefined);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, savedOf(parkedAt(4)), SAVED));
    await act(async () => confirms[1]()); assert.equal(sent.length, 2); assert.notEqual(sent[0].commandId, sent[1].commandId);
  });

  it("sends nothing without the served confirmation port", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [];
    const h = await harness(parkedClient(selected, sent).client); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, savedOf(write), SAVED));
    assert.equal(sent.length, 0);
  });
});

const FAILURE = "00000000-0000-4000-8000-000000000004";

function failedAt(selected: LogSelection) {
  return withFailureDecision(FailureDetailWireSchema.parse({ runId: RUN, traceId: selected.row.traceId, attempt: 1, workflowId: "separations",
    failureId: FAILURE, nodeId: "job-summary", taskId: "ucpath/read-job-summary", fingerprint: "a".repeat(64), code: "EMPLOYEE_NOT_FOUND",
    summary: "Employee absent", transient: false, writeState: "not-attempted", subject: { state: "absent", reason: "No subject" },
    causeChain: [{ code: "EMPLOYEE_NOT_FOUND", summary: "Employee absent", role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: "Enter an EID" }], sameFingerprintSeen: 1,
    diagnosticBundle: { state: "absent", reason: "None" }, occurredAt: AT, native: native(5, "job-summary"), recovery: {
      correction: { nodeId: "job-summary", code: "employee-not-found", inputField: "operatorEmployeeId", label: "Employee ID", actionLabel: "Enter EID", pattern: "^10\\d{6}$" },
      expectedVersion: 3, retry: { kind: "command", command: "retry", key: "check-again", label: "Check again", intent: "neutral", placement: ["banner"], expectedVersion: 3,
        confirm: { title: "Check again", confirmLabel: "Check again", tone: "neutral" } },
      confirm: { title: "Enter EID", confirmLabel: "Enter EID", tone: "neutral" },
      request: { workflowId: "separations", dryRun: true, browserMode: "headless", captureBrowserScreenshots: false, submissions: [{}], selectedStepKeys: ["identity-check", "job-summary"],
        rerunSource: { runId: RUN, expectedVersion: 3, intent: "rerun", selectedStepKeys: ["identity-check", "job-summary"], failureCorrection: { failureId: FAILURE, inputField: "operatorEmployeeId" } } },
    } }));
}
function failureClient(selected: LogSelection, sent: DashboardCommandRequest[], planned: unknown[], execute: (command: DashboardCommandRequest) => Promise<unknown>, failed = failedAt(selected)) {
  const client = { artifactUrl: (id: string) => `/artifacts/${id}`,
    runDetail: async () => {
      const detail = detailAt(selected, selected.row.rowRevision, { availableSections: ["logs", "failure"] });
      assert.ok(detail.timeline.steps);
      return { ...detail, timeline: { ...detail.timeline, steps: [...detail.timeline.steps,
        { key: failed.nodeId, label: "Failed step", state: "failed" as const, members: [{ nodeId: failed.nodeId, categoryKey: failed.nodeId, label: "Failed step", state: "failed" as const }] }] } };
    },
    runSection: async (_run: string, section: string) => section === "logs" ? logs()
      : RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: failed } }),
    submitStartPlan: async (input: unknown) => {
      const request = StartPlanRequestSchema.parse(input); planned.push(request);
      return StartPlanWireSchema.parse({ wireVersion: 1, startPlanId: FAILURE, workflowId: "separations", expectedVersion: 1,
        expiresAt: "2026-08-03T13:00:00.000Z", dryRun: request.dryRun, browserMode: request.browserMode, captureBrowserScreenshots: request.captureBrowserScreenshots,
        priority: "interactive", plannedBy: "local-operator", configSnapshotId: FAILURE, rerun: { source: request.rerunSource, warnings: [], warningDigest: "a".repeat(64) },
        fingerprints: Object.fromEntries(["descriptorFingerprint", "configFingerprint", "ingressSchemaHash", "canonicalInputSchemaHash", "inputFingerprint"].map(key => [key, "a".repeat(64)])),
        planned: [{ logicalKey: RUN, title: "Separation 4502", matchKey: "4502" }], refused: [] });
    },
    executeCommand: async (input: unknown) => { const request = DashboardCommandRequestSchema.parse(input); sent.push(request); return execute(request); },
  } as unknown as DashboardClient;
  return { failed, client };
}

describe("served not-found failure actions", () => {
  it("projects and submits the declared document-number correction through Logs", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], planned: unknown[] = [], callbacks: (() => void)[] = [];
    const original = failedAt(selected);
    assert.ok(original.recovery);
    const correction = separationsDescriptor.failureCorrections?.find(entry => entry.inputField === "documentNumber");
    assert.ok(correction);
    const failed = withFailureDecision(FailureDetailWireSchema.parse({ ...original, nodeId: correction.nodeId, taskId: "kuali/search-separation-action",
      code: "DOCUMENT_NOT_IN_ACTION_LIST", native: native(5, correction.nodeId), recovery: { ...original.recovery, correction,
        confirm: { title: correction.actionLabel, confirmLabel: correction.actionLabel, tone: "neutral" },
        request: { ...original.recovery.request, rerunSource: { ...original.recovery.request.rerunSource,
          failureCorrection: { failureId: FAILURE, inputField: correction.inputField } } } } }));
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("unused"); }, failed);
    const snapshot = await readRunLogs(fixture.client, selected, new AbortController().signal);
    const decision = projectRunLogs(snapshot, fixture.client).steps.flatMap(step => step.entries).find(entry => entry.kind === "decision");
    assert.ok(decision?.kind === "decision");
    assert.deepEqual(decision.decision.served?.options.map(option => option.label), ["Enter document number", "Check again"]);
    const action = failureOption(failed, "retry-with-value");
    assert.equal(action.input?.kind, "text");
    const h = await harness(fixture.client, (_pending, send) => callbacks.push(send)); await h.render(selected);
    await act(async () => { h.state?.onDecision?.(FAILURE, action, { text: "4502" }); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 0);
    assert.equal(callbacks.length, 1);
    const request = StartPlanRequestSchema.parse(planned[0]);
    assert.deepEqual(request.submissions, [{ documentNumber: "4502" }]);
    assert.deepEqual(request.rerunSource?.failureCorrection, { failureId: FAILURE, inputField: "documentNumber" });
  });

  it("projects only served actions and rejects a contradictory failure join", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], planned: unknown[] = [];
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("unused"); });
    const snapshot = await readRunLogs(fixture.client, selected, new AbortController().signal);
    const decision = projectRunLogs(snapshot, fixture.client).steps.flatMap(step => step.entries).find(entry => entry.kind === "decision");
    assert.ok(decision?.kind === "decision");
    assert.deepEqual(decision.decision.served?.options.map(option => option.label), ["Enter EID", "Check again"]);
    assert.equal(decision.decision.footer, "No changes were made.");
    assert.equal(failureDecision(FailureDetailWireSchema.parse({ ...fixture.failed, recovery: undefined, decision: undefined })).type, "failed-retryable");
    assert.equal(FailureDetailWireSchema.safeParse({ ...fixture.failed, code: "another-failure" }).success, false);
    assert.equal(FailureDetailWireSchema.safeParse({ ...fixture.failed, recovery: { ...fixture.failed.recovery, expectedVersion: 4 } }).success, false);
  });

  for (const actionIndex of [0, 1]) it(`confirms, targets and refuses failure action ${actionIndex} through the existing command executor`, async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], planned: unknown[] = [], confirms: PendingCommand[] = [], callbacks: (() => void)[] = [];
    let release: ((value: unknown) => void) | undefined;
    const fixture = failureClient(selected, sent, planned, () => new Promise(resolve => { release = resolve; }));
    const h = await harness(fixture.client, (pending, send) => { confirms.push(pending); callbacks.push(send); }); await h.render(selected);
    const action = failureOption(fixture.failed, actionIndex === 0 ? "check-again" : "retry-with-value");
    await act(async () => { h.state?.onDecision?.(FAILURE, action, { text: "10800001" }); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 0); assert.equal(confirms.length, 1);
    assert.deepEqual(confirms[0].target, { runId: RUN, expectedVersion: 3 });
    assert.equal(confirms[0].action.confirm?.confirmLabel, action.label);
    if (actionIndex === 1) assert.deepEqual(StartPlanRequestSchema.parse(planned[0]).submissions, [{ operatorEmployeeId: "10800001" }]);
    else assert.deepEqual(planned, []);
    await act(async () => callbacks[0]());
    assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "pending"); assert.equal(h.state?.onDecision, undefined);
    assert.equal(sent[0].type, actionIndex === 0 ? "retry" : "start-run");
    await act(async () => release?.(CommandResultSchema.parse({ state: "rejected", commandId: sent[0].commandId, code: "invalid-state", message: "Source changed" })));
    assert.equal(h.state?.command?.state, "refused"); assert.ok(h.state?.onDecision); assert.ok(h.state?.command?.feedback);
  });

  it("refuses invalid EIDs and stale confirmation before dispatch", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], planned: unknown[] = [], callbacks: (() => void)[] = [];
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("unused"); });
    const h = await harness(fixture.client, (_pending, send) => callbacks.push(send)); await h.render(selected);
    const action = failureOption(fixture.failed, "retry-with-value");
    await act(async () => h.state?.onDecision?.(FAILURE, action, { text: "bad" }));
    assert.equal(planned.length, 0); assert.equal(callbacks.length, 0);
    await act(async () => { h.state?.onDecision?.(FAILURE, action, { text: "10800001" }); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(callbacks.length, 1);
    await h.render(selectionAt(4));
    await act(async () => callbacks[0]());
    assert.deepEqual(sent, []); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  it("retains an uncertain correction across remount and replays the identical start command", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [], planned: unknown[] = [], callbacks: (() => void)[] = [];
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("reply lost"); });
    const h = await harness(fixture.client, (_pending, send) => callbacks.push(send)); await h.render(selected);
    await act(async () => { h.state?.onDecision?.(FAILURE, failureOption(fixture.failed, "retry-with-value"), { text: "10800001" }); await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => callbacks[0]());
    assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.state?.onDecision, undefined);
    await h.render(selectionAt(3), 1);
    assert.equal(h.state?.command?.state, "uncertain"); assert.ok(h.state?.replay);
    await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(planned.length, 1);
  });
});

describe("failure resolution from the decision card", () => {
  function committedAt(selected: LogSelection) {
    const { recovery: _recovery, decision: _decision, ...failed } = failedAt(selected);
    return withFailureDecision(FailureDetailWireSchema.parse({ ...failed, writeState: "committed",
      resolution: { capability: { state: "available" }, capture: { failureId: FAILURE, runId: RUN, resolution: { status: "unresolved", version: 2 } } } }));
  }
  const applied = async (request: DashboardCommandRequest) => CommandResultSchema.parse({ state: "applied", commandId: request.commandId,
    affectedTargets: [{ family: "failure-resolution", runId: RUN, failureId: FAILURE }] });

  for (const [choice, answer, payload] of [
    ["mark-as-failed", {}, { action: "resolve" }],
    ["add-note", { text: " Checked T00042871 in UCPath " }, { action: "resolve", note: "Checked T00042871 in UCPath" }],
  ] as const) it(`closes the failure with ${choice} and nothing else`, async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [];
    const fixture = failureClient(selected, sent, [], applied, committedAt(selected));
    const h = await harness(fixture.client); await h.render(selected);
    await act(async () => h.state?.onDecision?.(FAILURE, failureOption(fixture.failed, choice), answer));
    assert.equal(sent.length, 1);
    const request = sent[0];
    assert.ok(request.family === "failure-resolution" && request.type === "annotate-failure");
    assert.deepEqual(request.target, { runId: RUN, failureId: FAILURE, expectedVersion: 2 });
    assert.deepEqual(request.payload, payload);
    assert.equal(request.source, "run-detail");
  });

  it("sends no note without its text, and nothing for a failure option the server no longer serves", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [];
    const fixture = failureClient(selected, sent, [], applied, committedAt(selected));
    const h = await harness(fixture.client); await h.render(selected);
    await act(async () => h.state?.onDecision?.(FAILURE, failureOption(fixture.failed, "add-note"), { text: "  " }));
    await act(async () => h.state?.onDecision?.(FAILURE, { ...failureOption(fixture.failed, "mark-as-failed"), id: "retry" }, {}));
    assert.equal(sent.length, 0);
  });

  it("serves nothing after the failure is resolved, and a stale Mark as failed sends no second resolve", async () => {
    const selected = selectionAt(3), sent: DashboardCommandRequest[] = [];
    const unresolved = failureClient(selected, sent, [], applied, committedAt(selected));
    const first = await harness(unresolved.client); await first.render(selected);
    const stale = failureOption(unresolved.failed, "mark-as-failed");
    await act(async () => first.state?.onDecision?.(FAILURE, stale, {}));
    assert.equal(sent.length, 1);
    const { decision: _decision, ...open } = committedAt(selected);
    const resolved = withFailureDecision(FailureDetailWireSchema.parse({ ...open, resolution: { capability: { state: "available" },
      capture: { failureId: FAILURE, runId: RUN, resolution: { status: "resolved", version: 3, by: "local-operator", at: "2026-08-03T12:00:00.000Z" } } } }));
    assert.deepEqual(resolved.decision?.options, []);
    const refreshed = failureClient(selected, sent, [], applied, resolved);
    const second = await harness(refreshed.client); await second.render(selected);
    await act(async () => second.state?.onDecision?.(FAILURE, stale, {}));
    assert.equal(sent.length, 1);
  });
});
