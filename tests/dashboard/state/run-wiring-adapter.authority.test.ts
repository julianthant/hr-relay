// @vitest-environment jsdom
import { FIXTURE_PARKED_WRITE } from "../../support/fixtures/dashboard/run-detail/gates-park.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { projectRunLogs, failureLogActions, gateLogActions, parkedWriteLogActions, readRunLogs, useRunWiring, type RunWiringConfirm } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { CommandExecutor, type CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import type { PendingCommand } from "../../../src/dashboard/surfaces/shared/actions/actions.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { FailureDetailWireSchema, ParkedWriteDetailWireSchema, IdentityGateDetailWireSchema, NativeRunEventWireSchema, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../src/models/dashboard/start-plan.js";
import { RowRevisionSchema } from "../../../src/models/dashboard/primitives.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { ActorIdSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";
import { IdentityApprovalResultSchema } from "../../../src/rules/separations/identity-approval.js";
import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../support/helpers/dashboard/identity-ceremony-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-queue.js";

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

type Harness = { state?: ReturnType<typeof useRunWiring>; outcomes: CommandOutcome[]; refreshed: number; render: (selected: LogSelection, key?: number) => Promise<void> };
async function harness(client: DashboardClient, confirm?: RunWiringConfirm): Promise<Harness> {
  const h: Harness = { outcomes: [], refreshed: 0, render: async () => undefined };
  const scope = Object.freeze({ actorId: ActorIdSchema.parse("local-operator"), client, authority: {}, dayRequest: {} });
  const dayState = { subscribePublications: () => () => undefined, request: scope.dayRequest, day: { state: "loaded" as const, value: FIXTURE_DAY_WIRE }, connection: { state: "live" as const }, refresh: () => { h.refreshed++; } };
  const binding = { scope, executor: new CommandExecutor(() => scope), feedback: (outcome: CommandOutcome) => { h.outcomes.push(outcome); },
    authority: { epoch: scope.authority, catalog: [], nowIso: AT, today: "2026-08-03", day: "2026-08-03", dayState, selection: { route: { start: false }, workflowId: "separations" } } } as unknown as DashboardCommandBinding;
  function Probe({ selected }: { selected: LogSelection }) { h.state = useRunWiring(client, selected, binding, confirm); return null; }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.render = async (selected, key = 0) => { await act(async () => { root?.render(createElement(Probe, { selected, key })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
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

  it("refuses a retained confirmation callback after its hook owner unmounts", async () => {
    const gate = servedGate(fixtures.ONE_CLICK);
    const selected = selectionAt(3);
    const requested: (() => void)[] = [];
    const sent: CommandRequest[] = [];
    const h = await harness(gateClient(gate, selected, sent), (_pending, onConfirmed) => { requested.push(onConfirmed); });
    await h.render(selected);
    await act(async () => h.state?.onDecision?.(gate.gateId, gateLogActions(gate)[0], {}));
    assert.equal(requested.length, 1);
    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => { requested[0](); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(sent.length, 0);
    assert.deepEqual(h.outcomes.map(outcome => [outcome.kind, outcome.kind === "refused" ? outcome.reason : undefined]), [["refused", "not-attempted"]]);
  });

  it("offers a name-mismatch gate as a pick and never a rejection", () => {
    assert.equal(gateLogActions(servedGate(fixtures.NAME_MISMATCH))[0]?.input?.kind, "candidate");
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

function parkedAt(revision = 3, acceptsTransactionId = true) {
  return ParkedWriteDetailWireSchema.parse({ ...FIXTURE_PARKED_WRITE, acceptsTransactionId, runId: RUN,
    native: native(50), actions: FIXTURE_PARKED_WRITE.actions.map(action => ({ ...action, expectedVersion: revision })) });
}
function parkedClient(selected: LogSelection, sent: CommandRequest[], options: {
  write?: ReturnType<typeof parkedAt>;
  execute?: (request: CommandRequest) => Promise<unknown>;
} = {}) {
  let version = selected.row.rowRevision.valueOf();
  let write = options.write ?? parkedAt(version);
  const client = { artifactUrl: (id: string) => `/artifacts/${id}`,
    runDetail: async () => detailAt(selected, version, { availableSections: ["logs", "parked-write"] }),
    runSection: async (_run: string, section: string) => section === "logs" ? logs()
      : RunDetailSectionResponseSchema.parse({ section: "parked-write", payload: write }),
    executeCommand: async (raw: unknown) => {
      const request = CommandRequestSchema.parse(raw); sent.push(request);
      if (options.execute !== undefined) return options.execute(request);
      version++;
      return CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: RUN }] });
    },
  } as unknown as DashboardClient;
  return { client, setWrite: (next: typeof write, revision = version) => { write = next; version = revision; } };
}

describe("served parked-write Logs decisions", () => {
  for (const [acceptsId, choice, answer, verb, transactionId] of [
    [true, 0, {}, "recheck-write", undefined],
    [true, 1, { outcome: "present", transaction: " T123456 " }, "recheck-write", "T123456"],
    [true, 1, { outcome: "absent" }, "resolve-write-absent", undefined],
    [false, 0, {}, "recheck-write", undefined],
    [false, 1, {}, "resolve-write-absent", undefined],
  ] as const) it(`confirms and dispatches ${verb} (${acceptsId}, ${choice}, ${transactionId})`, async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], confirmations: { pending: PendingCommand; send: () => void }[] = [];
    const write = parkedAt(3, acceptsId);
    const { client } = parkedClient(selected, sent, { write });
    const h = await harness(client, (pending, send) => confirmations.push({ pending, send }));
    await h.render(selected);
    const action = parkedWriteLogActions(write)[choice]; assert.ok(action);
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

  for (const change of ["version", "generation", "intent", "attempt"] as const) it(`refuses confirmation after the parked ${change} changes`, async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], confirmations: (() => void)[] = [];
    const write = parkedAt(); const fixture = parkedClient(selected, sent);
    const h = await harness(fixture.client, (_pending, send) => confirmations.push(send)); await h.render(selected);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, parkedWriteLogActions(write)[0], {}));
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
    const selected = selectionAt(3), sent: CommandRequest[] = [], confirms: (() => void)[] = [];
    const fixture = parkedClient(selected, sent, { execute: () => new Promise(resolve => { release = resolve; }) });
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(), action = parkedWriteLogActions(write)[0];
    await act(async () => h.state?.onDecision?.(write.writeIntentId, action, {}));
    await act(async () => confirms[0]());
    assert.equal(h.state?.command?.state, "pending"); assert.equal(h.state?.onDecision, undefined);
    await act(async () => confirms[0]()); assert.equal(sent.length, 1);
    await act(async () => release?.(CommandResultSchema.parse({ state: result, commandId: sent[0].commandId, message: "No longer parked", ...(result === "rejected" ? { code: "invalid-state" } : { currentVersion: 4 }) })));
    assert.equal(h.state?.command?.state, "refused"); assert.ok(h.state?.command?.feedback); assert.ok(h.state?.onDecision);
    await h.render(selectionAt(3), 1);
    assert.equal(h.state?.command?.state, "refused"); assert.ok(h.state?.command?.feedback); assert.ok(h.state?.onDecision);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, action, {})); assert.equal(confirms.length, 2);
  });

  it("restores uncertainty after remount, replays the exact request and settles on matching readback", async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], confirms: (() => void)[] = [];
    let replay = false;
    const fixture = parkedClient(selected, sent, { execute: async request => {
      if (!replay) throw new Error("reply lost");
      fixture.setWrite(parkedAt(4), 4);
      return CommandResultSchema.parse({ state: "already-applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: RUN }] });
    } });
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, parkedWriteLogActions(write)[0], {}));
    await act(async () => confirms[0]());
    assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.state?.onDecision, undefined);
    await h.render(selectionAt(3), 1);
    assert.equal(h.state?.command?.state, "uncertain"); assert.ok(h.state?.replay);
    replay = true; await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(h.state?.command?.state, "settled"); assert.equal(h.refreshed, 1);
  });

  it("retains an uncertain attempt but refuses to replay it after a new intent generation", async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], confirms: (() => void)[] = [];
    const fixture = parkedClient(selected, sent, { execute: async () => { throw new Error("reply lost"); } });
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, parkedWriteLogActions(write)[0], {}));
    await act(async () => confirms[0]());
    fixture.setWrite(ParkedWriteDetailWireSchema.parse({ ...write, generation: 2, actions: write.actions.map(action => action.kind === "command"
      ? { ...action, writeTarget: { ...action.writeTarget, intentGeneration: 2 } } : action) }));
    await h.render(selectionAt(3));
    await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 1); assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  it("offers the next parked decision after an accepted recheck returns with new authority", async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], confirms: (() => void)[] = [];
    const fixture = parkedClient(selected, sent);
    const h = await harness(fixture.client, (_pending, send) => confirms.push(send)); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, parkedWriteLogActions(write)[0], {}));
    await act(async () => confirms[0]()); assert.equal(h.state?.command?.state, "settled");
    fixture.setWrite(parkedAt(4), 4); await h.render(selectionAt(4));
    assert.ok(h.state?.onDecision); assert.equal(h.state?.command, undefined);
    await act(async () => h.state?.onDecision?.(write.writeIntentId, parkedWriteLogActions(parkedAt(4))[0], {}));
    await act(async () => confirms[1]()); assert.equal(sent.length, 2); assert.notEqual(sent[0].commandId, sent[1].commandId);
  });

  it("sends nothing without the served confirmation port", async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [];
    const h = await harness(parkedClient(selected, sent).client); await h.render(selected);
    const write = parkedAt(); await act(async () => h.state?.onDecision?.(write.writeIntentId, parkedWriteLogActions(write)[0], {}));
    assert.equal(sent.length, 0);
  });
});

const FAILURE = "00000000-0000-4000-8000-000000000004";

function failedAt(selected: LogSelection) {
  return FailureDetailWireSchema.parse({ runId: RUN, traceId: selected.row.traceId, attempt: 1, workflowId: "separations",
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
    } });
}
function failureClient(selected: LogSelection, sent: CommandRequest[], planned: unknown[], execute: (command: CommandRequest) => Promise<unknown>, failed = failedAt(selected)) {
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
    executeCommand: async (input: unknown) => { const request = CommandRequestSchema.parse(input); sent.push(request); return execute(request); },
  } as unknown as DashboardClient;
  return { failed, client };
}

describe("served not-found failure actions", () => {
  it("projects and submits the declared document-number correction through Logs", async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], planned: unknown[] = [], callbacks: (() => void)[] = [];
    const original = failedAt(selected);
    assert.ok(original.recovery);
    const correction = separationsDescriptor.failureCorrections?.find(entry => entry.inputField === "documentNumber");
    assert.ok(correction);
    const failed = FailureDetailWireSchema.parse({ ...original, nodeId: correction.nodeId, taskId: "kuali/search-separation-action",
      code: "DOCUMENT_NOT_IN_ACTION_LIST", native: native(5, correction.nodeId), recovery: { ...original.recovery, correction,
        confirm: { title: correction.actionLabel, confirmLabel: correction.actionLabel, tone: "neutral" },
        request: { ...original.recovery.request, rerunSource: { ...original.recovery.request.rerunSource,
          failureCorrection: { failureId: FAILURE, inputField: correction.inputField } } } } });
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("unused"); }, failed);
    const snapshot = await readRunLogs(fixture.client, selected, new AbortController().signal);
    const decision = projectRunLogs(snapshot, fixture.client).steps.flatMap(step => step.entries).find(entry => entry.kind === "decision");
    assert.ok(decision?.kind === "decision");
    assert.deepEqual(decision.decision.actions?.map(action => action.label), ["Check again", "Enter document number"]);
    const action = failureLogActions(failed)[1];
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
    const selected = selectionAt(3), sent: CommandRequest[] = [], planned: unknown[] = [];
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("unused"); });
    const snapshot = await readRunLogs(fixture.client, selected, new AbortController().signal);
    const decision = projectRunLogs(snapshot, fixture.client).steps.flatMap(step => step.entries).find(entry => entry.kind === "decision");
    assert.ok(decision?.kind === "decision");
    assert.deepEqual(decision.decision.actions?.map(action => action.label), ["Check again", "Enter EID"]);
    assert.equal(decision.decision.footer, undefined);
    assert.deepEqual(failureLogActions(FailureDetailWireSchema.parse({ ...fixture.failed, recovery: undefined })), []);
    assert.equal(FailureDetailWireSchema.safeParse({ ...fixture.failed, code: "another-failure" }).success, false);
    assert.equal(FailureDetailWireSchema.safeParse({ ...fixture.failed, recovery: { ...fixture.failed.recovery, expectedVersion: 4 } }).success, false);
  });

  for (const actionIndex of [0, 1]) it(`confirms, targets and refuses failure action ${actionIndex} through the existing command executor`, async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], planned: unknown[] = [], confirms: PendingCommand[] = [], callbacks: (() => void)[] = [];
    let release: ((value: unknown) => void) | undefined;
    const fixture = failureClient(selected, sent, planned, () => new Promise(resolve => { release = resolve; }));
    const h = await harness(fixture.client, (pending, send) => { confirms.push(pending); callbacks.push(send); }); await h.render(selected);
    const action = failureLogActions(fixture.failed)[actionIndex];
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
    const selected = selectionAt(3), sent: CommandRequest[] = [], planned: unknown[] = [], callbacks: (() => void)[] = [];
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("unused"); });
    const h = await harness(fixture.client, (_pending, send) => callbacks.push(send)); await h.render(selected);
    const action = failureLogActions(fixture.failed)[1];
    await act(async () => h.state?.onDecision?.(FAILURE, action, { text: "bad" }));
    assert.equal(planned.length, 0); assert.equal(callbacks.length, 0);
    await act(async () => { h.state?.onDecision?.(FAILURE, action, { text: "10800001" }); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(callbacks.length, 1);
    await h.render(selectionAt(4));
    await act(async () => callbacks[0]());
    assert.deepEqual(sent, []); assert.equal(h.outcomes.at(-1)?.kind, "refused");
  });

  it("retains an uncertain correction across remount and replays the identical start command", async () => {
    const selected = selectionAt(3), sent: CommandRequest[] = [], planned: unknown[] = [], callbacks: (() => void)[] = [];
    const fixture = failureClient(selected, sent, planned, async () => { throw new Error("reply lost"); });
    const h = await harness(fixture.client, (_pending, send) => callbacks.push(send)); await h.render(selected);
    await act(async () => { h.state?.onDecision?.(FAILURE, failureLogActions(fixture.failed)[1], { text: "10800001" }); await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => callbacks[0]());
    assert.equal(h.state?.command?.state, "uncertain"); assert.equal(h.state?.onDecision, undefined);
    await h.render(selectionAt(3), 1);
    assert.equal(h.state?.command?.state, "uncertain"); assert.ok(h.state?.replay);
    await act(async () => h.state?.replay?.());
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(planned.length, 1);
  });
});
