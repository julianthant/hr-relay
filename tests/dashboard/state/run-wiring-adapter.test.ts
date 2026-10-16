// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../src/dashboard/state/client-context.js";
import { readRunLogs, projectRunLogs, useRunWiring, gateLogActions } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { LogSample } from "../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { RunDetailWireSchema, NativeRunEventWireSchema, ConfirmedActionBindingWireSchema, IdentityGateDetailWireSchema, NotePageSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { ConfirmedActionEventSchema } from "../../../src/models/events/confirmed-action.js";
import { appendLogPage } from "../../../src/dashboard/surfaces/run-detail/logs-model.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../src/models/workflow/operation-display-snapshot.js";
import { plan1Leaf } from "../../support/fixtures/plan1-operation-workflows.js";
import { OperationActionObservationWireSchema } from "../../../src/models/dashboard/operation-structure.js";
import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../support/helpers/dashboard/identity-ceremony-fixtures.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../src/rules/separations/identity-approval.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { FIXTURE_RUN_DETAILS, FIXTURE_SECTIONS } from "../../parity/helpers/fixture-detail.js";
import { FIXTURE_START_PICKER_DAY_WIRE } from "../../parity/helpers/fixture-start.js";
import { FIXTURE_IDS } from "../../support/fixtures/dashboard/fixture-queue.js";
import { FIXTURE_PARKED_WRITE } from "../../support/fixtures/dashboard/run-detail/gates-park.js";
import { launchHarness } from "../../support/fixtures/run-launch-fixtures.js";
import { CommandExecutor, type CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import { CommandResultSchema, CommandRequestSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { RowRevisionSchema } from "../../../src/models/dashboard/primitives.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const selection = (runId = RUN): LogSelection => ({ row: { ...mockQueueSurface({ id: runId, workflowId: "person-lookup", title: "Served subject", subject: "Served subject", draft: initialMockDraft("person-lookup"), approved: true, seeded: true }, "2026-08-03"), runId: RunIdSchema.parse(runId) }, workflowLabel: "Person lookup" });
function detail(selected = selection()) {
  const row = selected.row;
  return RunDetailWireSchema.parse({ runId: row.runId, rowRevision: row.rowRevision, panelKind: "run",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: ["first", "identity-approval", "second-gate", "cross-verify"].map(nodeId => ({
      key: nodeId, label: nodeId, state: "done", members: [{ nodeId, categoryKey: nodeId, label: nodeId, state: "done" }],
    })), events: [] }, gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Not complete" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"] });
}
function page(runId = RUN, sequence = 0, cursor?: string) {
  const noteId = sequence === 0 ? NOTE : OTHER;
  const native = nativeOf(runId, sequence + 1);
  const note = { native, noteId, runId, sequence, at: AT, level: "info", message: `Authoritative note ${sequence}` };
  return NotePageSchema.parse({ runId, rows: [{ kind: "note", native, logId: noteId, sequence, note }], notes: [note], confirmedActions: [], confirmedActionBindings: [],
    operationStructure: { state: "observed", runId, definition, observations: sequence === 0 ? [{
      logId: noteId, at: AT, action: "read", targetId: "consume-text", occurrence: { ...action(runId).action, value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } },
    }] : [] },
    nextCursor: cursor === undefined ? { state: "absent", reason: "end-of-page" } : { state: "present", value: cursor } });
}
function nativeOf(runId = RUN, order = 1, nodeId = "first") {
  return NativeRunEventWireSchema.parse({ eventId: `10000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
    order, runId: RunIdSchema.parse(runId), attempt: 1, traceId: selection(runId).row.traceId,
    nodeId, spanPath: "first/span" });
}
function confirmationEvidence(owner: ReturnType<typeof page>, events: readonly ReturnType<typeof action>[]) {
  return { confirmedActions: [...events], confirmedActionBindings: events.map(event => ConfirmedActionBindingWireSchema.parse({ eventId: event.eventId,
    logId: NOTE, native: owner.rows?.[0].native })) };
}
function identityFixtures(...args: Parameters<typeof createIdentityCeremonyFixtures>) {
  const fixture = createIdentityCeremonyFixtures(...args);
  return { ...fixture, gateDetail: (...input: Parameters<typeof fixture.gateDetail>) => {
    const gate = fixture.gateDetail(...input);
    return IdentityGateDetailWireSchema.parse({ ...gate, native: nativeOf(gate.runId, 50, gate.gateId) });
  } };
}
function clientFor(read: (path: string, signal?: AbortSignal | null) => unknown) {
  return createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (input, init) => Response.json(await read(new URL(String(input)).pathname, init?.signal)) });
}
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); }

const definition = freezeWorkflowOperationDisplaySnapshot({ display: plan1Leaf.descriptor.operationDisplay, workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint })!;
function action(runId = RUN) {
  const selected = selection(runId);
  return ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "completed", eventId: "stream/1", workerId: "fixture-worker", workerStreamId: "stream", sequence: 1,
    traceId: selected.row.traceId, stepOccurrence: `${runId}/1/1/1/first`, source: { kind: "headless", system: "service" }, occurredAt: AT, recordedAt: AT,
    action: { runId, attempt: 1, claimGeneration: 1, taskAttempt: 1, definitionFingerprint: definition.definitionFingerprint,
      invocationId: "first-operation", occurrencePath: ["first"], nodeId: "first", taskId: "ocr/extract-form-page", logicalActionId: "consume-text", logicalSessionId: "plan1-local", occurrence: 1, state: "completed" } });
}

describe("served Logs wiring", () => {
  it("reads exact detail and every immutable log cursor, preserving confirmed actions", async () => {
    const cursor = `lc:${"a".repeat(64)}:1`;
    const seen: string[] = [];
    const client = { runDetail: async () => detail(), artifactUrl: (id: string) => `/artifacts/${id}`, runSection: async (_run: string, section: string, token?: string) => {
      seen.push(`${section}:${token ?? "initial"}`);
      const payload = token === undefined ? page(RUN, 0, cursor) : { ...page(RUN, 1), ...confirmationEvidence(page(RUN, 1), [action()]) };
      return RunDetailSectionResponseSchema.parse({ section: "logs", payload });
    } };
    const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
    assert.deepEqual(seen, ["logs:initial", `logs:${cursor}`]);
    assert.deepEqual(snapshot.logs.confirmedActions, [action()]);
    const projection = projectRunLogs(snapshot, client);
    assert.equal(projection.steps.filter(step => step.id === "stream/1").length, 0);
    assert.equal(projection.timeline.find(stage => stage.id === "first")?.stepId, NOTE);
    assert.deepEqual(projection.steps.map(step => step.entries[0].id), [NOTE]);
    assert.equal(projection.steps[0].entries[1].id, "stream/1");
  });
  it("refuses wrong run/revision/attempt and foreign action evidence", async () => {
    for (const changed of [detail(selection(OTHER)), { ...detail(), rowRevision: selection().row.rowRevision + 1 }, { ...detail(), header: { ...detail().header, attempt: 2 } }]) {
      const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : changed);
      await assert.rejects(() => readRunLogs(client, selection(), new AbortController().signal), /IDENTITY_MISMATCH/);
    }
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), confirmedActions: [action(OTHER)] } } : detail());
    await assert.rejects(() => readRunLogs(client, selection(), new AbortController().signal), /ACTION_IDENTITY_MISMATCH/);
  });
  it("refuses a foreign section and distinguishes missing action evidence from valid notes", async () => {
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), runId: OTHER, rows: [], notes: [] } } : detail());
    await assert.rejects(() => client.runSection(RUN, "logs"), /RUN_SECTION_IDENTITY_MISMATCH/);
    const missing = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), confirmedActions: undefined } } : detail());
    const snapshot = await readRunLogs(missing, selection(), new AbortController().signal);
    assert.equal(snapshot.actionEvidence?.state, "unavailable");
    assert.deepEqual(snapshot.actionEvidence?.missingPages, ["initial"]);
    assert.equal(snapshot.logs.notes.length, 1);
  });
  it("retains known events across mixed pages while keeping aggregate action evidence unavailable", async () => {
    const cursor = `lc:${"b".repeat(64)}:1`;
    for (const missingFirst of [true, false]) {
      const initial = { ...page(RUN, 0, cursor), ...confirmationEvidence(page(RUN, 0, cursor), missingFirst ? [] : [action()]), confirmedActions: missingFirst ? undefined : [action()] };
      const next = { ...page(RUN, 1), ...confirmationEvidence(page(RUN, 1), missingFirst ? [action()] : []), confirmedActions: missingFirst ? [action()] : undefined };
      const client = { runDetail: async () => detail(), runSection: async (_run: string, _section: string, token?: string) =>
        RunDetailSectionResponseSchema.parse({ section: "logs", payload: token === undefined ? initial : next }) };
      const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
      assert.equal(snapshot.actionEvidence?.state, "unavailable");
      assert.deepEqual(snapshot.actionEvidence?.events, [action()]);
      assert.deepEqual(snapshot.actionEvidence?.missingPages, [missingFirst ? "initial" : cursor]);
      assert.equal(snapshot.logs.confirmedActions, undefined);
      assert.equal(projectRunLogs(snapshot, { artifactUrl: () => "unused" }).steps.flatMap(step => step.entries).filter(entry => entry.id === action().eventId).length, 1);
    }
    const initial = { ...page(RUN, 0, cursor), ...confirmationEvidence(page(RUN, 0, cursor), [action()]) };
    const repeated = { ...page(RUN, 1), ...confirmationEvidence(page(RUN, 1), [action()]) };
    const client = { runDetail: async () => detail(), runSection: async (_run: string, _section: string, token?: string) =>
      RunDetailSectionResponseSchema.parse({ section: "logs", payload: token === undefined ? initial : repeated }) };
    await assert.rejects(() => readRunLogs(client, selection(), new AbortController().signal), /duplicate/);
  });
  it("retains historical actions and observations within current run authority and refuses future or foreign history", async () => {
    const selected = { ...selection(), row: { ...selection().row, attempt: 2 } };
    const historical = action();
    const observation = OperationActionObservationWireSchema.parse({ logId: NOTE, at: AT, action: "read", targetId: "consume-text", occurrence: { ...historical.action, value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } } });
    const payload = { ...page(), ...confirmationEvidence(page(), [historical]), operationStructure: { state: "observed", runId: RUN, definition, observations: [observation] } };
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload } : detail(selected));
    const snapshot = await readRunLogs(client, selected, new AbortController().signal);
    assert.equal(snapshot.actionEvidence?.events[0].action.attempt, 1);
    assert.equal(snapshot.logs.operationStructure?.state, "observed");
    for (const change of [
      { traceId: "zz-090000-0001" },
      { action: { ...historical.action, attempt: 3 }, stepOccurrence: `${RUN}/3/1/1/first` },
    ]) {
      const bad = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...payload, confirmedActions: [ConfirmedActionEventSchema.parse({ ...historical, ...change })] } } : detail(selected));
      await assert.rejects(() => readRunLogs(bad, selected, new AbortController().signal), /ACTION_IDENTITY_MISMATCH/);
    }
    const futureObservation = OperationActionObservationWireSchema.parse({ ...observation, occurrence: { ...observation.occurrence, attempt: 3 } });
    const future = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...payload, operationStructure: { ...payload.operationStructure, observations: [futureObservation] } } } : detail(selected));
    await assert.rejects(() => readRunLogs(future, selected, new AbortController().signal), /ACTION_IDENTITY_MISMATCH/);
  });
  it("preserves admitted historical span rows while rejecting future attempts and foreign traces", async () => {
    const selected = { ...selection(), row: { ...selection().row, attempt: 2 } };
    const fence = { kind: "transaction-fenced", logId: OTHER, sequence: 1, at: AT, traceId: selected.row.traceId, attempt: 1,
      spanPath: "first/fence", native: { ...nativeOf(RUN, 2), spanPath: "first/fence" }, producer: { nodeId: "first", step: "First", taskId: "ocr/extract-form-page" } };
    const payload = NotePageSchema.parse({ ...page(), rows: [...(page().rows ?? []), fence] });
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload } : detail(selected));
    assert.equal((await readRunLogs(client, selected, new AbortController().signal)).logs.rows?.length, 2);
    for (const change of [{ attempt: 3 }, { traceId: "zz-090000-0001" }]) {
      const bad = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), rows: [...(page().rows ?? []), { ...fence, ...change }] } } : detail(selected));
      await assert.rejects(() => readRunLogs(bad, selected, new AbortController().signal), /ROW_IDENTITY_MISMATCH/);
    }
  });
  it("renders the actual served Run-dialog fixture notes with unavailable optional evidence and no invented history", async () => {
    const row = FIXTURE_START_PICKER_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun); assert.ok(row);
    const client = clientFor(path => {
      const [, , , , runId, section] = path.split("/");
      return section === undefined ? FIXTURE_RUN_DETAILS[runId] : FIXTURE_SECTIONS[runId][section];
    });
    await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: { row, workflowLabel: "Person Lookup" } }) }));
    assert.match(document.body.textContent ?? "", /Searching UCPath directory for Morrow, Bea/);
    assert.match(document.body.textContent ?? "", /Confirmed actions unavailable/);
    assert.match(document.body.textContent ?? "", /Capture availability not supplied/);
    assert.match(document.body.textContent ?? "", /Identity Approval/);
    assert.doesNotMatch(document.body.textContent ?? "", /Identity decision join not supplied/);
    assert.doesNotMatch(document.body.textContent ?? "", /Logs unavailable|Reading the employment record/);
    assert.ok(document.querySelectorAll('section[aria-labelledby]').length > 1);
  });
  it("does not discard or duplicate confirmed actions across cursor pages", () => {
    const cursor = `lc:${"a".repeat(64)}:1`;
    assert.throws(() => appendLogPage({ ...page(RUN, 0, cursor), ...confirmationEvidence(page(RUN, 0, cursor), [action()]) }, cursor, { ...page(RUN, 1), ...confirmationEvidence(page(RUN, 1), [action()]) }), /duplicate/);
    assert.throws(() => appendLogPage(page(RUN, 0, cursor), cursor, page(OTHER, 1)), /cannot append logs/);
  });
  it("attaches captures only to their exact action occurrence and resource", () => {
    const event = action();
    const observation = OperationActionObservationWireSchema.parse({ logId: NOTE, at: AT, action: "read", targetId: "consume-text", occurrence: { ...event.action, value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } } });
    const captureSection = RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: RUN, artifacts: [{
      artifact: { mediaKind: "image", mediaType: "image/png", artifactId: OTHER, sha256: "a".repeat(64), byteLength: 1, sensitivity: "safe", redaction: "not-required", width: 120, height: 80 },
      origins: [{ bundleId: NOTE, originKind: "operator-request", operation: event.action, capturedAt: AT }],
    }] } });
    const snapshot = { detail: detail(), logs: { ...page(), operationStructure: { state: "observed" as const, runId: selection().row.runId, definition, observations: [observation] } }, sections: [captureSection], actionEvidence: { state: "available" as const, events: [], missingPages: [] }, unavailableEvidence: [] };
    const urls: string[] = [];
    const client = { artifactUrl: (id: string) => { urls.push(id); return `/exact/${id}`; } };
    const projection = projectRunLogs(snapshot, client);
    const captures = projection.steps[0].entries.find(entry => entry.kind === "decision");
    assert.equal(captures?.kind, "decision");
    if (captures?.kind === "decision") assert.deepEqual(captures.decision.screenshots?.map(capture => [capture.src, capture.width, capture.height]), [[`/exact/${OTHER}`, 120, 80]]);
    assert.deepEqual(new Set(urls), new Set([OTHER]));
    const mismatch = { ...snapshot, logs: { ...snapshot.logs, operationStructure: { ...snapshot.logs.operationStructure, observations: [{ ...observation, occurrence: OperationActionObservationWireSchema.parse({ ...observation, occurrence: { ...observation.occurrence, occurrence: 2 } }).occurrence }] } } };
    assert.equal(projectRunLogs(mismatch, client).steps[0].entries.length, 1);
  });
  it("exposes supported gate approvals and refuses typed IDs, rejection text and confirmation-copy downgrades", () => {
    const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
    for (const packet of [fixtures.ONE_CLICK, fixtures.CHOOSE, fixtures.TYPE_EID]) {
      const gate = fixtures.gateDetail(packet);
      const approval = identityApprovalAction("Approve");
      const actions = gateLogActions({ ...gate, actions: [approval] });
      if (gate.approvalShape === "type-the-eid") assert.deepEqual(actions, []);
      else if (gate.approvalShape === "choose-a-candidate") assert.equal(actions[0]?.input?.kind, "candidate");
      else assert.equal(actions[0]?.input, undefined);
      assert.deepEqual(gateLogActions({ ...gate, actions: [{ ...approval, resolution: "rejected" }] }), []);
      assert.deepEqual(gateLogActions({ ...gate, actions: [{ ...approval, confirm: { title: "Confirm", body: "Exact confirmation", confirmLabel: "Approve", tone: "neutral" } }] }), []);
    }
  });
  it("retains exact parked UNKNOWN identity with no submission control", async () => {
    let writes = 0;
    const parked = RunDetailSectionResponseSchema.parse({ section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE, native: nativeOf(RUN, 40), runId: RUN } });
    const servedDetail = RunDetailWireSchema.parse({ ...detail(), availableSections: ["logs", "parked-write"] });
    const client: DashboardClient = { ...clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : path.endsWith("/parked-write") ? parked : servedDetail),
      executeCommand: () => { writes++; throw new Error("unknown submit must not be retried"); } };
    const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
    const projection = projectRunLogs(snapshot, client);
    const entry = projection.steps.find(step => step.id === FIXTURE_PARKED_WRITE.writeIntentId)?.entries[0];
    assert.equal(entry?.id, FIXTURE_PARKED_WRITE.writeIntentId); assert.equal(entry?.kind, "decision");
    if (entry?.kind === "decision") { assert.equal(entry.decision.state, "parked"); assert.equal(entry.decision.actions, undefined); assert.match(entry.decision.footer ?? "", /Resolution unavailable/); }
    await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: selection() }) }));
    assert.match(document.body.textContent ?? "", /Write parked/);
    assert.equal(document.querySelector('article[aria-label="Write parked"]')?.querySelectorAll("button").length, 0);
    const jump = [...document.querySelectorAll("button")].find(button => button.textContent === "Resolve");
    assert.ok(jump);
    await act(async () => jump.click());
    assert.equal(writes, 0);
  });
  it("keeps failed-write uncertainty and failure identity separate from retry permission", async () => {
    const original = FIXTURE_FAILURE_SECTIONS[FIXTURE_IDS.failedRun].failure;
    assert.equal(original.section, "failure");
    if (original.section !== "failure" || original.payload.state !== "available") throw new Error("failure fixture unavailable");
    const source = original.payload.value;
    const failure = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: { ...source,
      runId: RUN, native: nativeOf(RUN, 40, source.nodeId), traceId: selection().row.traceId, writeState: "unknown" } } });
    const servedDetail = RunDetailWireSchema.parse({ ...detail(), availableSections: ["logs", "failure"] });
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : path.endsWith("/failure") ? failure : servedDetail);
    const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
    const decision = projectRunLogs(snapshot, client).steps.find(step => step.id === source.failureId)?.entries[0];
    assert.equal(decision?.kind, "decision");
    if (decision?.kind === "decision") { assert.equal(decision.decision.state, "unconfirmed"); assert.equal(decision.decision.actions, undefined); assert.equal(decision.decision.caution, "Write state: unknown"); }
    const foreign = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : path.endsWith("/failure") ? original : servedDetail);
    await assert.rejects(() => readRunLogs(foreign, selection(), new AbortController().signal), /IDENTITY_MISMATCH/);
  });
  it("keeps absent capture capability distinct from a missing or inconsistent resource", async () => {
    const seen: string[] = [];
    const absent = clientFor(path => { seen.push(path); return path.endsWith("/logs") ? { section: "logs", payload: page() } : detail(); });
    await readRunLogs(absent, selection(), new AbortController().signal);
    assert.equal(seen.some(path => path.endsWith("/captures")), false);
    for (const captures of [{ state: "available", artifactCount: 1 }]) {
      const bad = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : { ...detail(), captures });
      await assert.rejects(() => readRunLogs(bad, selection(), new AbortController().signal), /RUN_CAPTURE/);
    }
  });
  it("settles supported candidate approval only after matching readback and replays the same command", async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.CHOOSE);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      let matched = false;
      const sent: CommandRequest[] = [];
      const feedback: CommandOutcome[] = [];
      let refreshed = 0;
      const client: DashboardClient = { ...h.client,
        runDetail: async () => matched ? RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE, nodeId: gate.gateId,
          label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } }) : open,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
          : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope); return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId,
          affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { feedback.push(outcome); },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      let state: ReturnType<typeof useRunWiring> | undefined;
      function Probe() { state = useRunWiring(client, selected, binding); return null; }
      await mount(createElement(Probe));
      const approve = gateLogActions(gate)[0]; assert.ok(approve); assert.ok(state?.onDecision);
      await act(async () => state?.onDecision?.(gate.gateId, approve, { candidate: gate.options[1].eid }));
      assert.equal(sent.length, 1); assert.equal(state?.command?.state, "uncertain"); assert.equal(refreshed, 0);
      assert.equal(feedback[0]?.kind, "uncertain"); assert.equal(state?.onDecision, undefined);
      const envelope = sent[0]; assert.equal(envelope.family, "gate");
      if (envelope.family === "gate") {
        assert.deepEqual(envelope.target, { runId: RUN, gateId: gate.gateId, expectedVersion: 3 });
        assert.deepEqual(envelope.payload.result.value, { decision: "approved", eid: gate.options[1].eid, chosenFrom: gate.options[1].chosenFrom, evidenceDigest: gate.evidenceDigest });
      }
      matched = true; assert.ok(state?.replay);
      await act(async () => state?.replay?.());
      assert.equal(sent.length, 2); assert.deepEqual(sent[1], envelope); assert.equal(feedback.at(-1)?.kind, "confirmed"); assert.equal(refreshed, 1);
    } finally { h.dispose(); }
  });
  it("shows exact one-click target and served basis before approval, then requires matched readback", async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3), title: "Generic run title" } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      const sent: CommandRequest[] = [];
      const outcomes: CommandOutcome[] = [];
      let matched = false, refreshed = 0;
      const client: DashboardClient = { ...h.client, runDetail: async () => matched ? RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE,
        nodeId: gate.gateId, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } }) : open,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
          : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope);
          return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      await mount(createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
        children: createElement(LogSample, { selection: selected }) }) }));
      const block = document.querySelector('article[aria-label="Identity Approval"]'); assert.ok(block);
      const text = block.textContent ?? "";
      for (const target of [gate.options[0].eid, gate.options[0].displayName, gate.options[0].chosenFrom, gate.options[0].origin]) assert.ok(text.includes(target), target);
      for (const comparison of gate.packet.comparisons) for (const basis of [comparison.documentValue, comparison.ucpathValue, comparison.note]) assert.ok(text.includes(basis), basis);
      assert.equal(sent.length, 0); assert.equal(refreshed, 0);
      const review = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Review"); assert.ok(review);
      await act(async () => { review.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
      assert.ok(document.activeElement?.contains(block)); assert.equal(document.activeElement?.getAttribute("tabindex"), "-1");
      assert.equal(sent.length, 0);
      const approve = [...block.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.actions[0].label); assert.ok(approve); assert.equal(approve.disabled, false);
      await act(async () => approve.click());
      assert.equal(sent.length, 1); assert.equal(outcomes.at(-1)?.kind, "uncertain"); assert.equal(refreshed, 0);
      const envelope = sent[0]; assert.equal(envelope.family, "gate");
      if (envelope.family === "gate") assert.deepEqual(envelope.payload.result.value, { decision: "approved", eid: gate.options[0].eid, chosenFrom: gate.options[0].chosenFrom, evidenceDigest: gate.evidenceDigest });
      matched = true;
      const replay = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Replay exact decision"); assert.ok(replay);
      await act(async () => replay.click());
      assert.equal(outcomes.at(-1)?.kind, "confirmed"); assert.equal(refreshed, 1); assert.deepEqual(sent[1], envelope);
    } finally { h.dispose(); }
  });
  for (const transition of ["identical", "command-revision", "run-roundtrip", "keyed-run-roundtrip", "unmounted", "foreign-scope"] as const) it(`isolates pending command ownership and feedback through ${transition} replacement`, async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      const resolved = RunDetailWireSchema.parse({ ...open, rowRevision: 4, availableSections: ["logs"], gate: { state: "resolved", gateId: NOTE, nodeId: gate.gateId,
        label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } });
      let currentDetail = open, refreshed = 0;
      const outcomes: CommandOutcome[] = [], sent: CommandRequest[] = [];
      let release: (() => void) | undefined;
      const client: DashboardClient = { ...h.client, runDetail: async () => currentDetail,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() } : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope); await new Promise<void>(resolve => { release = resolve; });
          return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      const panel = (next: LogSelection, currentBinding = binding) => createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding: currentBinding,
        children: createElement(LogSample, { selection: next, key: transition === "keyed-run-roundtrip" ? next.row.runId : undefined }) }) });
      await mount(panel(selected));
      const approve = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.actions[0].label);
      const first = approve(); assert.ok(first); await act(async () => first.click()); assert.equal(sent.length, 1);
      assert.match(document.body.textContent ?? "", /Pending/);
      const next = { ...selected, row: { ...selected.row, ...(transition === "command-revision" ? { rowRevision: RowRevisionSchema.parse(4) } : {}) } };
      if (transition === "command-revision") currentDetail = resolved;
      if (transition === "run-roundtrip" || transition === "keyed-run-roundtrip") {
        await act(async () => root?.render(panel(selection(OTHER))));
        assert.doesNotMatch(document.body.textContent ?? "", /Pending/);
      }
      const replacementBinding = transition === "foreign-scope" ? { ...binding, scope: { ...scope, actorId: "other-operator", authority: {} } } : binding;
      await act(async () => root?.render(transition === "unmounted" ? null : panel(next, replacementBinding)));
      if (transition === "foreign-scope" || transition === "unmounted") assert.doesNotMatch(document.body.textContent ?? "", /Pending/);
      else assert.match(document.body.textContent ?? "", /Pending/);
      assert.equal(sent.length, 1);
      if (transition === "identical") { const control = approve(); assert.ok(control); assert.equal(control.disabled, true); await act(async () => control.click()); assert.equal(sent.length, 1); }
      currentDetail = transition === "unmounted" ? open : resolved; assert.ok(release); await act(async () => release?.());
      if (transition === "run-roundtrip" || transition === "keyed-run-roundtrip" || transition === "unmounted" || transition === "foreign-scope") {
        assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
        assert.doesNotMatch(document.body.textContent ?? "", /Decision confirmed/);
      } else {
        assert.equal(outcomes.at(-1)?.kind, "confirmed"); assert.equal(outcomes.length, 1); assert.equal(refreshed, 1);
        assert.match(document.body.textContent ?? "", /Decision confirmed/); assert.doesNotMatch(document.body.textContent ?? "", /Pending/);
      }
      assert.equal(sent.length, 1);
      if (transition === "unmounted") {
        await act(async () => root?.render(panel(next)));
        assert.match(document.body.textContent ?? "", /could not be confirmed/);
        const replay = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Replay exact decision"); assert.ok(replay);
        currentDetail = resolved;
        await act(async () => replay.click());
        assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
        await act(async () => release?.());
        assert.equal(outcomes.at(-1)?.kind, "confirmed"); assert.equal(refreshed, 1);
      }
    } finally { h.dispose(); }
  });
  it("keeps a newer run's confirmed feedback and lock when the old command settles late", async () => {
    const h = launchHarness();
    try {
      const selected = [RUN, OTHER].map(runId => ({ ...selection(runId), row: { ...selection(runId).row, rowRevision: RowRevisionSchema.parse(3) } }));
      const gates = [RUN, OTHER].map(runId => {
        const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => runId);
        return fixtures.gateDetail(fixtures.ONE_CLICK);
      });
      const resolved = new Set<string>(), releases = new Map<string, () => void>();
      const sent: CommandRequest[] = [], outcomes: CommandOutcome[] = []; let refreshed = 0;
      const client: DashboardClient = { ...h.client,
        runDetail: async runId => {
          const index = runId === RUN ? 0 : 1, gate = gates[index], isResolved = resolved.has(runId);
          return RunDetailWireSchema.parse({ ...detail(selected[index]), rowRevision: isResolved ? 4 : 3,
            gate: isResolved ? { state: "resolved", gateId: NOTE, nodeId: gate.gateId, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 }
              : { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
        },
        runSection: async (runId, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page(runId) }
          : { section: "identity-gate", payload: { state: "available", value: gates[runId === RUN ? 0 : 1] } }),
        executeCommand: async raw => {
          const envelope = CommandRequestSchema.parse(raw); assert.equal(envelope.family, "gate");
          if (envelope.family !== "gate") throw new Error("gate required");
          sent.push(envelope); await new Promise<void>(resolve => releases.set(envelope.target.runId, resolve));
          return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: envelope.target.runId, gateId: envelope.target.gateId }] });
        },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      const panel = (index: number) => createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
        children: createElement(LogSample, { selection: selected[index] }) }) });
      const approve = () => { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gates[0].actions[0].label); assert.ok(control); return control; };
      await mount(panel(0)); await act(async () => approve().click());
      await act(async () => root?.render(panel(1))); await act(async () => approve().click()); assert.equal(sent.length, 2);
      resolved.add(OTHER); await act(async () => releases.get(OTHER)?.());
      assert.match(document.body.textContent ?? "", /Decision confirmed/); assert.equal(approve().disabled, true);
      resolved.add(RUN); await act(async () => releases.get(RUN)?.());
      assert.match(document.body.textContent ?? "", /Decision confirmed/); assert.equal(approve().disabled, true);
      assert.equal(outcomes.length, 1); assert.equal(outcomes[0].commandId, sent[1].commandId); assert.equal(refreshed, 1); assert.equal(sent.length, 2);
    } finally { h.dispose(); }
  });
  it("retains uncertain feedback and the exact replay envelope through identical row replacement", async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      let matched = false, refreshed = 0; const sent: CommandRequest[] = [];
      const client: DashboardClient = { ...h.client, runDetail: async () => matched ? RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE, nodeId: gate.gateId,
        label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } }) : open,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() } : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope); return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      const panel = (next: LogSelection) => createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
        children: createElement(LogSample, { selection: next }) }) });
      await mount(panel(selected));
      const approve = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.actions[0].label);
      const first = approve(); assert.ok(first); await act(async () => first.click()); assert.equal(sent.length, 1);
      await act(async () => root?.render(panel({ ...selected, row: { ...selected.row } })));
      assert.match(document.body.textContent ?? "", /could not be confirmed/); const blocked = approve(); assert.ok(blocked); assert.equal(blocked.disabled, true);
      assert.equal(sent.length, 1); assert.equal(refreshed, 0);
      const replay = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Replay exact decision"); assert.ok(replay);
      matched = true; await act(async () => replay.click()); assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(refreshed, 1);
    } finally { h.dispose(); }
  });
  for (const outcome of ["uncertain", "refused"] as const) it(`stabilizes restored ${outcome} command and replay inputs until state or scope changes`, async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      let release: (() => void) | undefined; const sent: CommandRequest[] = [];
      const client: DashboardClient = { ...h.client, runDetail: async () => open,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() } : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope);
          if (sent.length > 1) await new Promise<void>(resolve => { release = resolve; });
          return CommandResultSchema.parse(outcome === "refused" || sent.length > 1 ? { state: "rejected", commandId: envelope.commandId, code: "policy-refused", message: "Refused" }
            : { state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
      let current: ReturnType<typeof useRunWiring> | undefined;
      function Probe({ activeBinding }: { activeBinding: DashboardCommandBinding }) { current = useRunWiring(client, selected, activeBinding); return createElement("span", null, current.command?.feedback); }
      await mount(createElement(Probe, { key: "first", activeBinding: binding }));
      await act(async () => current?.onDecision?.(gate.gateId, gateLogActions(gate)[0], {})); assert.equal(sent.length, 1);
      await act(async () => root?.render(createElement(Probe, { key: "restored", activeBinding: binding })));
      const restored = current?.command, replay = current?.replay; assert.ok(restored); assert.equal(restored.state, outcome);
      for (let tick = 0; tick < 2; tick++) await act(async () => root?.render(createElement(Probe, { key: "restored", activeBinding: binding })));
      assert.equal(current?.command, restored); assert.equal(current?.replay, replay); assert.equal(sent.length, 1);
      if (outcome === "uncertain") {
        assert.ok(replay); await act(async () => replay()); assert.equal(current?.command?.state, "pending"); assert.notEqual(current?.command, restored); assert.equal(current?.replay, undefined);
        assert.deepEqual(sent[1], sent[0]); await act(async () => release?.()); assert.equal(current?.command?.state, "refused"); assert.match(document.body.textContent ?? "", /The command was refused/);
      } else assert.equal(replay, undefined);
      const replacement = { ...binding, scope: { ...scope, actorId: "other-operator" } };
      await act(async () => root?.render(createElement(Probe, { key: "restored", activeBinding: replacement })));
      assert.equal(current?.command, undefined); assert.equal(current?.replay, undefined);
    } finally { h.dispose(); }
  });
  it("displays omitted evidence explicitly and never substitutes verified-empty actions", async () => {
    for (const supplied of [false, true]) {
      const logs = { ...page(), rows: [], notes: [], confirmedActions: supplied ? [] : undefined };
      const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: logs } : detail());
      await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: selection() }) }));
      const text = document.body.textContent ?? "";
      if (supplied) { assert.match(text, /No actions yet/); assert.doesNotMatch(text, /Confirmed actions unavailable/); }
      else {
        assert.ok(text.includes(formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_CONFIRMED_ACTIONS_UNAVAILABLE_TITLE", {})).text));
        assert.ok(text.includes(formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_CONFIRMED_ACTION_EVIDENCE_INCOMPLETE", {})).text));
        assert.doesNotMatch(text, /No actions yet/);
      }
      await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    }
  });
  it("retains supplied notes and locks decision controls when gate/capture authority is omitted", async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.CHOOSE);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      for (const omitted of ["node", "capture"] as const) {
        const open = RunDetailWireSchema.parse({ ...detail(selected), captures: omitted === "capture" ? undefined : detail().captures,
          gate: { state: "open", gateId: NOTE, ...(omitted === "node" ? {} : { nodeId: gate.gateId }), label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
        let submissions = 0;
        const client: DashboardClient = { ...h.client, runDetail: async () => open,
          runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: { ...page(), confirmedActions: undefined } }
            : { section: "identity-gate", payload: { state: "available", value: gate } }),
          executeCommand: () => { submissions++; throw new Error("unbound decision"); },
        };
        const scope = { ...h.binding.scope, client };
        const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
        await mount(createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
          children: createElement(LogSample, { selection: selected }) }) }));
        assert.match(document.body.textContent ?? "", /Authoritative note 0/);
        assert.match(document.body.textContent ?? "", omitted === "node" ? /Identity decision join not supplied/ : /Capture availability not supplied/);
        assert.equal(document.querySelector('article[aria-label="Identity Approval"]')?.querySelectorAll("button").length, 0);
        assert.equal(submissions, 0);
        await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
      }
    } finally { h.dispose(); }
  });
  it("keeps refusal feedback and permits only an explicit corrected approval in the mounted Logs panel", async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.CHOOSE);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      const sent: CommandRequest[] = [];
      const client: DashboardClient = { ...h.client, runDetail: async () => open,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
          : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope);
          return CommandResultSchema.parse({ state: "rejected", commandId: envelope.commandId, code: "policy-refused", message: "Current decision refused" }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { throw new Error("refusal must not invent changed authority"); } } } };
      await mount(createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
        children: createElement(LogSample, { selection: selected }) }) }));
      const approve = () => { const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.actions[0].label); assert.ok(node); return node; };
      async function choose(index: number) {
        assert.equal(approve().disabled, false); await act(async () => approve().click());
        const radio = document.querySelectorAll<HTMLInputElement>('input[name="candidate"]')[index]; assert.ok(radio);
        await act(async () => radio.click());
        const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue run"); assert.ok(submit); assert.equal(submit.disabled, false);
        await act(async () => submit.click());
      }
      await choose(0);
      assert.equal(sent.length, 1); assert.match(document.body.textContent ?? "", /The command was refused/); assert.equal(approve().disabled, false);
      await act(async () => {}); assert.equal(sent.length, 1);
      await choose(1);
      assert.equal(sent.length, 2); assert.notEqual(sent[0].commandId, sent[1].commandId);
      for (const [index, envelope] of sent.entries()) {
        assert.equal(envelope.family, "gate");
        if (envelope.family === "gate") assert.deepEqual(envelope.payload.result.value, { decision: "approved", eid: gate.options[index].eid, chosenFrom: gate.options[index].chosenFrom, evidenceDigest: gate.evidenceDigest });
      }
    } finally { h.dispose(); }
  });
  it("releases a confirmed gate lock when the same run reaches its next authoritative gate", async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const firstGate = fixtures.gateDetail(fixtures.ONE_CLICK);
      const secondGate = fixtures.gateDetail(fixtures.ONE_CLICK, { gateId: "second-gate", expectedVersion: 5,
        actions: firstGate.actions.map(action => ({ ...action, expectedVersion: 5 })) });
      const gates = [firstGate, secondGate];
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      let gateIndex = 0, resolved = false, refreshed = 0;
      const sent: CommandRequest[] = [], outcomes: CommandOutcome[] = [];
      const client: DashboardClient = { ...h.client,
        runDetail: async () => { const gate = gates[gateIndex]; return RunDetailWireSchema.parse({ ...detail(selected), rowRevision: gate.expectedVersion + (resolved ? 1 : 0),
          gate: resolved ? { state: "resolved", gateId: NOTE, nodeId: gate.gateId, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: gateIndex * 2 + 2 }
            : { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: gateIndex * 2 + 1 }, availableSections: ["logs", "identity-gate"] }); },
        runSection: async (_run, name) => RunDetailSectionResponseSchema.parse(name === "logs" ? { section: "logs", payload: page() }
          : { section: "identity-gate", payload: { state: "available", value: gates[gateIndex] } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); assert.equal(envelope.family, "gate");
          if (envelope.family !== "gate") throw new Error("gate required"); sent.push(envelope); resolved = true;
          return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: envelope.target.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      const panel = (next: LogSelection) => createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
        children: createElement(LogSample, { selection: next }) }) });
      const approve = () => { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === firstGate.actions[0].label); assert.ok(control); return control; };
      await mount(panel(selected)); await act(async () => approve().click());
      assert.equal(sent.length, 1); assert.equal(outcomes[0].kind, "confirmed"); assert.equal(refreshed, 1); assert.equal(approve().disabled, true);
      gateIndex = 1; resolved = false;
      await act(async () => root?.render(panel({ ...selected, row: { ...selected.row, rowRevision: RowRevisionSchema.parse(5) } })));
      assert.equal(approve().disabled, false); assert.equal(sent.length, 1); assert.doesNotMatch(document.body.textContent ?? "", /Decision confirmed/);
      await act(async () => approve().click());
      assert.equal(sent.length, 2); assert.equal(outcomes[1].kind, "confirmed"); assert.equal(refreshed, 2); assert.notEqual(sent[0].commandId, sent[1].commandId);
      for (const [index, envelope] of sent.entries()) { assert.equal(envelope.family, "gate"); if (envelope.family === "gate") assert.deepEqual(envelope.target,
        { runId: RUN, gateId: gates[index].gateId, expectedVersion: index === 0 ? 3 : 5 }); }
    } finally { h.dispose(); }
  });
  for (const authority of ["current", "new-revision", "new-gate", "foreign-actor", "foreign-authority"] as const) it(`projects keyed pending-to-refused recovery only for ${authority} gate authority`, async () => {
    const h = launchHarness();
    try {
      const fixtures = identityFixtures(AT, "10833507", "10203262", deriveSchemaHash(IdentityApprovalResultSchema, "output"), () => RUN);
      const gate = fixtures.gateDetail(fixtures.CHOOSE);
      const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
      const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: gate.gateId, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      let currentGate = gate, currentDetail = open, release: (() => void) | undefined;
      const sent: CommandRequest[] = [], outcomes: CommandOutcome[] = []; let refreshed = 0;
      const client: DashboardClient = { ...h.client,
        runDetail: async runId => runId === RUN ? currentDetail : detail(selection(runId)),
        runSection: async (runId, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page(runId) }
          : { section: "identity-gate", payload: { state: "available", value: currentGate } }),
        executeCommand: async raw => { const envelope = CommandRequestSchema.parse(raw); sent.push(envelope); await new Promise<void>(resolve => { release = resolve; });
          return CommandResultSchema.parse(sent.length === 1 ? { state: "rejected", commandId: envelope.commandId, code: "policy-refused", message: "Current decision refused" }
            : { state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: gate.gateId }] }); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
      const panel = (next: LogSelection, currentBinding = binding, nowIso = AT) => createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding: currentBinding,
        children: createElement(LogSample, { key: next.row.runId, selection: next, nowIso }) }) });
      const approve = () => { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.actions[0].label); assert.ok(control); return control; };
      async function choose(index: number) {
        assert.equal(approve().disabled, false); await act(async () => approve().click());
        const radio = document.querySelectorAll<HTMLInputElement>('input[name="candidate"]')[index]; assert.ok(radio); await act(async () => radio.click());
        const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue run"); assert.ok(submit); await act(async () => submit.click());
      }
      await mount(panel(selected)); await choose(0); assert.equal(sent.length, 1);
      await act(async () => root?.render(panel(selection(OTHER))));
      await act(async () => root?.render(panel(selected)));
      assert.match(document.body.textContent ?? "", /Pending/); assert.equal(approve().disabled, true);
      await act(async () => release?.()); assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
      const next = { ...selected, row: { ...selected.row, ...(authority === "new-revision" ? { rowRevision: RowRevisionSchema.parse(4) } : {}) } };
      if (authority === "new-revision") { currentGate = fixtures.gateDetail(fixtures.CHOOSE, { expectedVersion: 4, actions: gate.actions.map(action => ({ ...action, expectedVersion: 4 })) }); currentDetail = { ...open, rowRevision: RowRevisionSchema.parse(4) }; }
      if (authority === "new-gate") {
        const section = RunDetailSectionResponseSchema.parse({ section: "identity-gate", payload: { state: "available", value: { ...gate, gateId: "replacement-gate" } } });
        assert.equal(section.section, "identity-gate"); if (section.section !== "identity-gate" || section.payload.state !== "available") throw new Error("gate required");
        currentGate = section.payload.value;
        currentDetail = RunDetailWireSchema.parse({ ...open, gate: { ...open.gate, nodeId: currentGate.gateId, revision: 2 } });
      }
      const nextBinding = authority === "foreign-actor" || authority === "foreign-authority" ? { ...binding, scope: { ...scope,
        ...(authority === "foreign-actor" ? { actorId: "other-operator" } : { authority: {} }) } } : binding;
      await act(async () => root?.render(panel(next, nextBinding, "2026-08-03T12:00:01.000Z")));
      assert.equal(sent.length, 1); assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
      assert.doesNotMatch(document.body.textContent ?? "", /Pending/);
      if (authority !== "current") { assert.doesNotMatch(document.body.textContent ?? "", /The command was refused/); return; }
      assert.match(document.body.textContent ?? "", /The command was refused/); assert.equal(approve().disabled, false);
      await act(async () => root?.render(panel(next, binding, "2026-08-03T12:00:02.000Z"))); assert.equal(sent.length, 1);
      await choose(1); assert.equal(sent.length, 2); assert.notEqual(sent[1].commandId, sent[0].commandId);
      for (const [index, envelope] of sent.entries()) { assert.equal(envelope.family, "gate"); if (envelope.family === "gate") assert.deepEqual(envelope.payload.result.value,
        { decision: "approved", eid: gate.options[index].eid, chosenFrom: gate.options[index].chosenFrom, evidenceDigest: gate.evidenceDigest }); }
      assert.match(document.body.textContent ?? "", /Pending/); assert.doesNotMatch(document.body.textContent ?? "", /The command was refused/); assert.equal(approve().disabled, true);
      await act(async () => root?.render(panel(selection(OTHER)))); await act(async () => root?.render(panel(next)));
      assert.match(document.body.textContent ?? "", /Pending/); assert.doesNotMatch(document.body.textContent ?? "", /The command was refused/);
      currentDetail = RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE, nodeId: gate.gateId, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } });
      await act(async () => release?.()); assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
      await act(async () => root?.render(panel(next, binding, "2026-08-03T12:00:03.000Z")));
      assert.doesNotMatch(document.body.textContent ?? "", /The command was refused|Pending/); assert.equal(sent.length, 2);
    } finally { h.dispose(); }
  });
  it("mounts the served LogSample producer without fictional decision events", async () => {
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : detail());
    await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: selection() }) }));
    assert.match(document.body.textContent ?? "", /Authoritative note 0/);
    assert.doesNotMatch(document.body.textContent ?? "", /Reading the employment record|Termination confirmed|Approve match/);
    assert.doesNotMatch(document.body.textContent ?? "", /cross-source chronology unavailable/);
  });
  for (const source of ["client", "backend"] as const) it(`shows the catalog refusal for ${source} Logs identity failures`, async () => {
    const malformed = { ...page(), rows: page().rows?.map(row => row.kind === "note"
      ? { ...row, native: undefined, note: { ...row.note, native: undefined } } : row),
      notes: page().notes.map(note => ({ ...note, native: undefined })) };
    const client = source === "client" ? clientFor(path => path.endsWith("/logs")
      ? { section: "logs", payload: malformed } : detail()) : createDashboardClient({ baseUrl: "http://fixture.test",
        fetchImpl: async input => new URL(String(input)).pathname.endsWith("/logs")
          ? Response.json({ state: "error", code: "LOGS_IDENTITY_REFUSED", message: "private native mismatch", retryable: false }, { status: 409 })
          : Response.json(detail()) });
    await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: selection() }) }));
    assert.match(document.body.textContent ?? "", /Logs cannot be ordered because their recorded identities are missing or inconsistent/);
    assert.doesNotMatch(document.body.textContent ?? "", /private native mismatch|Authoritative note/);
  });
  it("does not turn a failed served read into a mock or a verified empty result", async () => {
    const client = clientFor(() => { throw new Error("offline"); });
    await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: selection() }) }));
    const text = document.body.textContent ?? "";
    for (const code of ["LOGS_READ_FAILED_TITLE", "LOGS_UNAVAILABLE_TITLE", "DASHBOARD_READ_FAILED"] as const) {
      assert.ok(text.includes(formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text));
    }
    assert.doesNotMatch(text, /offline|unclassified failure/);
    assert.doesNotMatch(document.body.textContent ?? "", /No actions yet/);
    assert.doesNotMatch(document.body.textContent ?? "", /Approve match|Reading the employment record/);
  });
  it("selects preview explicitly for the same failed client and selection without retrying the served read", async () => {
    let reads = 0;
    const client = clientFor(() => { reads++; throw new Error("offline"); });
    const selected = selection();
    const panel = (source?: "mock" | "served") => createElement(DashboardClientProvider, { client,
      children: createElement(LogSample, { selection: selected, source }) });
    await mount(panel());
    assert.ok(reads > 0);
    assert.match(document.body.textContent ?? "", /Could not load logs/);
    assert.doesNotMatch(document.body.textContent ?? "", /Separation request verified/);
    const failedReads = reads;
    await act(async () => root?.render(panel("mock")));
    assert.equal(reads, failedReads);
    assert.match(document.body.textContent ?? "", /Separation request verified/);
    assert.doesNotMatch(document.body.textContent ?? "", /Could not load logs|Logs unavailable|cross-source chronology unavailable/);
    await act(async () => root?.render(panel()));
    assert.ok(reads > failedReads);
    assert.match(document.body.textContent ?? "", /Could not load logs/);
    assert.doesNotMatch(document.body.textContent ?? "", /Separation request verified/);
  });
  for (const replacement of ["day", "epoch", "day-request", "scope"] as const) it(`revokes stale reads after ${replacement} authority replacement`, async () => {
    const h = launchHarness();
    try {
      const pending: { signal?: AbortSignal | null; resolve: (value: unknown) => void }[] = [];
      const client = clientFor((path, signal) => path.endsWith("/logs") ? { section: "logs", payload: page() }
        : new Promise(resolve => pending.push({ signal, resolve })));
      const binding: DashboardCommandBinding = { ...h.binding, scope: { ...h.binding.scope, client },
        authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
      const selected = selection();
      let current: ReturnType<typeof useRunWiring> | undefined;
      function Probe({ activeBinding }: { activeBinding: DashboardCommandBinding }) { current = useRunWiring(client, selected, activeBinding); return null; }
      await mount(createElement(Probe, { activeBinding: binding }));
      const next: DashboardCommandBinding = { ...binding,
        scope: replacement === "scope" ? { ...binding.scope, actorId: "other-operator" } : binding.scope,
        authority: { ...binding.authority, day: replacement === "day" ? "2026-08-04" : binding.authority.day,
          epoch: replacement === "epoch" ? { ...binding.authority.epoch } : binding.authority.epoch,
          dayState: replacement === "day-request" ? { ...binding.authority.dayState, request: {} } : binding.authority.dayState } };
      await act(async () => root?.render(createElement(Probe, { activeBinding: next })));
      assert.equal(pending.length, 2); assert.equal(pending[0].signal?.aborted, true);
      await act(async () => pending[0].resolve(detail())); assert.equal(current?.state, "loading");
      await act(async () => pending[1].resolve(detail())); assert.equal(current?.state, "loaded");
      assert.equal(current?.snapshot?.detail.runId, RUN);
    } finally { h.dispose(); }
  });
  it("revokes both stale A responses across A to B to A and client replacement", async () => {
    const pending: { path: string; signal?: AbortSignal | null; resolve: (value: unknown) => void }[] = [];
    const client = clientFor((path, signal) => new Promise(resolve => pending.push({ path, signal, resolve })));
    let current: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ client: activeClient, selected }: { client: DashboardClient; selected: LogSelection }) { current = useRunWiring(activeClient, selected, undefined); return null; }
    const a = selection(), b = selection(OTHER);
    await mount(createElement(Probe, { client, selected: a }));
    await act(async () => root?.render(createElement(Probe, { client, selected: b })));
    await act(async () => root?.render(createElement(Probe, { client, selected: a })));
    assert.equal(pending.length, 3); assert.equal(pending[0].signal?.aborted, true); assert.equal(pending[1].signal?.aborted, true);
    await act(async () => pending[0].resolve(detail()));
    assert.equal(current?.state, "loading"); assert.equal(pending.length, 3);
    const replacement = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), rows: [], notes: [] } } : detail());
    await act(async () => root?.render(createElement(Probe, { client: replacement, selected: a })));
    assert.equal(current?.state, "loaded"); assert.equal(current?.snapshot?.logs.rows?.length, 0);
    await act(async () => pending[2].resolve(detail()));
    assert.equal(current?.snapshot?.logs.rows?.length, 0); assert.equal(pending[2].signal?.aborted, true);
  });
});
