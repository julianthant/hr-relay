// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../src/dashboard/state/client-context.js";
import { readRunLogs, projectRunLogs, useRunWiring, ROW_REVISION_WAIT_MS } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { LogSample } from "../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { LogPreview } from "../../support/fixtures/dashboard/log-preview/log-preview.js";
import { mockQueueSurface } from "../../support/fixtures/dashboard/workflow-mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../support/fixtures/dashboard/workflow-mocks/workflow-mock-model.js";
import { RunDetailWireSchema, NativeRunEventWireSchema, IdentityGateDetailWireSchema, NotePageSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { appendLogPage } from "../../../src/dashboard/surfaces/run-detail/logs-model.js";
import { createIdentityCeremonyFixtures } from "../../support/helpers/dashboard/identity-ceremony-fixtures.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { FIXTURE_RUN_DETAILS, FIXTURE_SECTIONS } from "../../support/helpers/dashboard/mock-world/fixture-detail.js";
import { FIXTURE_START_PICKER_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-start.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../support/fixtures/dashboard/fixture-queue.js";
import { FIXTURE_PARKED_WRITE } from "../../support/fixtures/dashboard/run-detail/gates-park.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { queueParentFixture } from "../../support/helpers/dashboard/queue-parent-fixture.js";
import { serverLocalDay } from "../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { CommandExecutor, type CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import { CommandResultSchema, DashboardCommandRequestSchema, type DashboardCommandRequest } from "../../../src/rules/commands/commands.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { RowRevisionSchema, WireErrorSchema } from "../../../src/models/dashboard/primitives.js";
import { RunIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { projectDecision, rowActionOption } from "../../../src/backend/runs/decisions/project-decision.js";
import { verifyShellCommandEffect } from "../../../src/dashboard/app/commands/command-dispatch.js";
import { createRowStore, type RowStore, type RowStoreWriter } from "../../../src/dashboard/client/index.js";
import type { RunPanel } from "../../../src/models/dashboard/subscription.js";
import { serveRunPanel } from "../../support/helpers/dashboard/serve-run-panel.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const GATE_NODE = "identity-approval";
const NOTE = "00000000-0000-4000-8000-000000000003";
const AT = "2026-08-03T12:00:00.000Z";
const selection = (runId = RUN): LogSelection => ({ row: { ...mockQueueSurface({ id: runId, workflowId: "person-lookup", title: "Served subject", subject: "Served subject", draft: initialMockDraft("person-lookup"), approved: true, seeded: true }, "2026-08-03T16:10:00.000Z"), runId: RunIdSchema.parse(runId) }, workflowLabel: "Person lookup" });
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
  return NotePageSchema.parse({ runId, rows: [{ kind: "note", native, logId: noteId, sequence, note }], notes: [note],
    nextCursor: cursor === undefined ? { state: "absent", reason: "end-of-page" } : { state: "present", value: cursor } });
}
function nativeOf(runId = RUN, order = 1, nodeId = "first") {
  return NativeRunEventWireSchema.parse({ eventId: `10000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
    order, runId: RunIdSchema.parse(runId), attempt: 1, traceId: selection(runId).row.traceId,
    nodeId, spanPath: "first/span" });
}
function identityFixtures(...args: Parameters<typeof createIdentityCeremonyFixtures>) {
  const fixture = createIdentityCeremonyFixtures(...args);
  return { ...fixture, gateDetail: (...input: Parameters<typeof fixture.gateDetail>) => {
    const gate = fixture.gateDetail(...input);
    return IdentityGateDetailWireSchema.parse({ ...gate, order: 50 });
  } };
}
function clientFor(read: (path: string, signal?: AbortSignal | null) => unknown) {
  return createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (input, init) => Response.json(await read(new URL(String(input)).pathname, init?.signal)) });
}
/** The writers behind the stores the fixtures hand out, so a test can stream a panel into the store a binding reads. */
const writers = new WeakMap<RowStore, RowStoreWriter>();
function openStore(): RowStoreWriter { const writer = createRowStore(); writers.set(writer, writer); return writer; }
function serveRows(rows: RowStore, client: Parameters<typeof serveRunPanel>[1], runId: string, panel?: RunPanel) {
  const writer = writers.get(rows); assert.ok(writer, "the binding's row store was not made by the fixture");
  return serveRunPanel(writer, client, runId, panel);
}
function commandBindingFixture() {
  const client = clientFor(() => { throw new Error("unprovided Logs fixture read"); });
  const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, serverClock: { ...FIXTURE_BOOTSTRAP.serverClock, now: NOW, zone: "America/Los_Angeles" } });
  const epoch = Object.freeze({ client, bootstrap });
  const day = serverLocalDay(bootstrap.serverClock);
  const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day });
  const request = Object.freeze({ client, day, epoch, revision: 0 });
  const scope = Object.freeze({ actorId: "local-operator", client, authority: epoch, dayRequest: request });
  const binding: DashboardCommandBinding = { scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
    authority: { epoch, catalog: [], now: () => bootstrap.serverClock.now, today: day, day,
      dayState: { rows: openStore(), subscribePublications: () => { throw new Error("fixture publications are not served"); }, request,
        day: { state: "loaded", value: dayWire }, connection: { state: "connecting" }, refresh: () => undefined },
      selection: { route: { start: false }, workflowId: "launch-proof" } } };
  return { client, binding };
}
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });
// LogActionButton's Tooltip needs the app's provider; the bare renders here have none.
const TipClient = (props: ComponentProps<typeof DashboardClientProvider>) => createElement(TooltipProvider, null, createElement(DashboardClientProvider, props));
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); }


describe("served Logs wiring", () => {
  it("keeps child Retry in its own header and locks it to the exact pending or uncertain command", async () => {
    const h = commandBindingFixture();
    let selected: LogSelection = { ...selection(), row: QueueSurfaceWireSchema.parse({ ...selection().row,
      parent: queueParentFixture(OTHER), status: "failed", endedAt: { state: "present", value: AT },
      actions: [{ kind: "command", key: "retry", command: "retry", label: "Retry child", icon: "retry", intent: "neutral", placement: ["footer"], expectedVersion: selection().row.rowRevision }] }) };
    const sent: DashboardCommandRequest[] = [];
    let release: (() => void) | undefined;
    const client: DashboardClient = { ...h.client, runDetail: async () => detail(selected),
      runSection: async () => RunDetailSectionResponseSchema.parse({ section: "logs", payload: page() }),
      executeCommand: async raw => {
        sent.push(DashboardCommandRequestSchema.parse(raw));
        if (sent.length === 1) await new Promise<void>(resolve => { release = resolve; });
        throw new Error("Synthetic lost response");
      } };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope),
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    let pending: Promise<CommandOutcome> | undefined;
    const render = () => createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: selected, onAction: (action, target) => {
        assert.equal(action.kind, "command");
        assert.deepEqual(target, { runId: selected.row.runId, expectedVersion: selected.row.rowRevision });
        pending = binding.executor.execute(DashboardCommandRequestSchema.parse({ family: "run", type: "retry", commandId: NOTE,
          requestedAt: AT, requestedBy: scope.actorId, source: "run-detail", target }), { scope, readback: async () => ({ state: "mismatch", evidence: "Synthetic unconfirmed readback" }) });
      } }) }) });
    await mount(render());
    const retry = document.querySelector<HTMLButtonElement>('header button[aria-label="Retry child"]'); assert.ok(retry);
    assert.equal(retry.disabled, false);
    await act(async () => retry.click());
    assert.equal(sent.length, 1);
    await act(async () => root?.render(render()));
    assert.equal(retry.disabled, true);
    assert.match(document.querySelector("header")?.textContent ?? "", /Pending/u);
    await act(async () => { assert.ok(release); release(); await pending; root?.render(render()); });
    const replay = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(button => button.textContent === "Replay exact decision"); assert.ok(replay);
    assert.equal(retry.disabled, true);
    await act(async () => replay.click());
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
    selected = { ...selected, row: { ...selected.row, actions: [] } };
    await act(async () => root?.render(render()));
    assert.equal(document.querySelector('header button[aria-label="Retry child"]') === null, true);
    await act(async () => replay.click());
    assert.equal(sent.length, 2);
  });
  it("reads exact detail and every immutable log cursor", async () => {
    const cursor = `lc:${"a".repeat(64)}:1`;
    const seen: string[] = [];
    const client = { runDetail: async () => detail(), artifactUrl: (id: string) => `/artifacts/${id}`, runSection: async (_run: string, section: string, token?: string) => {
      seen.push(`${section}:${token ?? "initial"}`);
      const payload = token === undefined ? page(RUN, 0, cursor) : page(RUN, 1);
      return RunDetailSectionResponseSchema.parse({ section: "logs", payload });
    } };
    const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
    assert.deepEqual(seen, ["logs:initial", `logs:${cursor}`]);
    assert.deepEqual(snapshot.logs.notes.map(note => note.noteId), [NOTE, OTHER]);
    const projection = projectRunLogs(snapshot, client);
    assert.equal(projection.timeline.find(stage => stage.id === "first")?.stepId, NOTE);
    assert.deepEqual(projection.steps.map(step => step.entries[0].id), [NOTE]);
  });
  it("requests the first log page together with the run detail", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const client = { runDetail: async () => { order.push("detail"); await held; return detail(); }, artifactUrl: (id: string) => `/artifacts/${id}`,
      runSection: async () => { order.push("logs"); return RunDetailSectionResponseSchema.parse({ section: "logs", payload: page() }); } };
    const read = readRunLogs(client, selection(), new AbortController().signal);
    assert.deepEqual(order, ["logs", "detail"]);
    release();
    await read;
  });
  it("refuses wrong run/revision/attempt", async () => {
    for (const changed of [detail(selection(OTHER)), { ...detail(), header: { ...detail().header, attempt: 2 } }]) {
      const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : changed);
      await assert.rejects(() => readRunLogs(client, selection(), new AbortController().signal), /IDENTITY_MISMATCH/);
    }
    const ahead = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : { ...detail(), rowRevision: selection().row.rowRevision + 1 });
    await assert.rejects(() => readRunLogs(ahead, selection(), new AbortController().signal), /RUN_DETAIL_REVISION_AHEAD/);
  });
  it("refuses a foreign section and reads valid notes", async () => {
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), runId: OTHER, rows: [], notes: [] } } : detail());
    await assert.rejects(() => client.runSection(RUN, "logs"), /RUN_SECTION_IDENTITY_MISMATCH/);
    const valid = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : detail());
    assert.equal((await readRunLogs(valid, selection(), new AbortController().signal)).logs.notes.length, 1);
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
    const h = commandBindingFixture();
    await serveRows(h.binding.authority.dayState.rows, client, row.runId);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: h.binding,
      children: createElement(LogSample, { selection: { row, workflowLabel: "Person Lookup" } }) }) }));
    assert.match(document.body.textContent ?? "", /Searching UCPath directory for Morrow, Bea/);
    assert.doesNotMatch(document.body.textContent ?? "", /Capture availability not supplied/);
    assert.match(document.body.textContent ?? "", /Identity Approval/);
    assert.doesNotMatch(document.body.textContent ?? "", /Identity decision join not supplied/);
    assert.doesNotMatch(document.body.textContent ?? "", /Logs unavailable|Reading the employment record/);
    assert.ok(document.querySelectorAll('section[aria-labelledby]').length > 1);
  });
  it("refuses to append another run's cursor page", () => {
    const cursor = `lc:${"a".repeat(64)}:1`;
    assert.throws(() => appendLogPage(page(RUN, 0, cursor), cursor, page(OTHER, 1)), /cannot append logs/);
  });
  it("serves gate approvals as a pick or a confirm and offers no rejection the gate did not serve", () => {
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    for (const packet of [fixtures.ONE_CLICK, fixtures.CHOOSE, fixtures.NAME_MISMATCH]) {
      const gate = fixtures.gateDetail(packet);
      const option = gate.decision?.options[0];
      if (gate.approvalShape === "choose-a-candidate") assert.equal(option?.input?.kind, "candidate");
      else assert.equal(option?.input, undefined);
      assert.equal(gate.decision?.options.some(candidate => candidate.id === "reject"), false);
    }
  });
  it("sends a paused run's Resume and every card's Cancel run through the queue row's own descriptors", async () => {
    const h = commandBindingFixture();
    const selected = selection();
    const rowActions = [
      { kind: "command", key: "resume", label: "Resume", command: "resume", icon: "resume", intent: "primary", placement: ["footer"], expectedVersion: selected.row.rowRevision },
      { kind: "command", key: "cancel", label: "Cancel run", command: "cancel", icon: "cancel", intent: "danger", placement: ["footer"], expectedVersion: selected.row.rowRevision },
    ] as const;
    const withActions = { ...selected, row: { ...selected.row, actions: rowActions } } as unknown as LogSelection;
    const served = RunDetailWireSchema.parse({ ...detail(withActions), availableSections: ["logs"], decision: projectDecision("paused", [...rowActionOption("resume", "resume", rowActions), ...rowActionOption("cancel-run", "cancel", rowActions)]) });
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : served);
    const sent: string[] = [];
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: h.binding,
      children: createElement(LogSample, { selection: withActions, onAction: action => { sent.push(action.key); } }) }) }));
    const button = (label: string) => { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label); assert.ok(found, label); return found; };
    await act(async () => button("Resume").click());
    await act(async () => button("Cancel run").click());
    assert.deepEqual(sent, ["resume", "cancel"]);
  });
  it("draws the Duo card after the recorded steps", async () => {
    const h = commandBindingFixture();
    const selected = { ...selection(), row: QueueSurfaceWireSchema.parse({ ...selection().row, status: "awaiting-approval",
      endedAt: { state: "absent", reason: "still running" }, operatorWait: { state: "present", kind: "duo", system: "ucpath", since: AT } }) };
    const served = RunDetailWireSchema.parse({ ...detail(selected), availableSections: ["logs"] });
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : served);
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: h.binding,
      children: createElement(LogSample, { selection: selected }) }) }));
    const text = document.body.textContent ?? "";
    assert.ok(text.indexOf("Authoritative note 0") >= 0);
    assert.ok(text.indexOf("Approving Duo for") > text.indexOf("Authoritative note 0"), text);
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
    if (entry?.kind === "decision") { assert.equal(entry.decision.state, "parked"); assert.deepEqual(entry.decision.served?.options.map(option => option.label), ["Saved", "Not saved, write it again"]); assert.equal(entry.decision.footer, undefined); }
    const h = commandBindingFixture();
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: h.binding,
      children: createElement(LogSample, { selection: selection() }) }) }));
    assert.match(document.body.textContent ?? "", /Did the write save\?/);
    assert.equal(document.querySelector('form[aria-label="Did the write save?"]')?.querySelectorAll("button").length, 2);
    const jump = [...document.querySelectorAll("button")].find(button => button.textContent === "Resolve");
    assert.ok(jump);
    await act(async () => jump.click());
    assert.equal(writes, 0);
  });
  it("retains held-probe evidence alongside the declared parked-write recovery actions", async () => {
    const native = nativeOf(RUN, 40);
    const target = { workerId: "person-lookup-worker-1", workflowId: selection().row.workflowId, expectedVersion: 2,
      lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000",
      installationId: OTHER, profileId: NOTE, itemId: OTHER, runId: RUN, runVersion: selection().row.rowRevision,
      runAttempt: FIXTURE_PARKED_WRITE.runAttempt, traceId: native.traceId, nodeId: native.nodeId, writeIntentId: FIXTURE_PARKED_WRITE.writeIntentId,
      intentVersion: 1, intentGeneration: FIXTURE_PARKED_WRITE.generation, writeAttemptId: NOTE, bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) };
    const lastCheck = { commandId: NOTE, requestedBy: "local-operator", target, observedAt: AT, held: true, provenance: "system-probe",
      state: "ambiguous", code: "PARKED_CHECK_OCCURRENCE_UNPROVED", probeTaskId: "ucpath/match-existing-termination", evidenceDigest: "c".repeat(64) };
    const parked = RunDetailSectionResponseSchema.parse({ section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE, runId: RUN, native,
      check: { state: "available", target }, lastCheck } });
    const servedDetail = RunDetailWireSchema.parse({ ...detail(), availableSections: ["logs", "parked-write"] });
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : path.endsWith("/parked-write") ? parked : servedDetail);
    const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
    const entry = projectRunLogs(snapshot, client).steps.find(step => step.id === FIXTURE_PARKED_WRITE.writeIntentId)?.entries[0];
    assert.equal(entry?.kind, "decision");
    if (entry?.kind !== "decision") throw new Error("parked decision absent");
    assert.equal(entry.decision.state, "parked");
    assert.deepEqual(entry.decision.served?.options.map(option => [option.label, option.input?.kind]), [["Saved", "text"], ["Not saved, write it again", undefined]]);
    assert.equal(entry.decision.message, formatErrorCatalogFailure(createErrorCatalogFailure("PARKED_CHECK_OCCURRENCE_UNPROVED", {})).text);
    assert.equal(entry.decision.footer, undefined);
    const request = DashboardCommandRequestSchema.parse({ commandId: NOTE, requestedBy: "local-operator", requestedAt: AT, source: "run-detail",
      family: "worker-browser", type: "check-parked-write", target });
    const reply = CommandResultSchema.parse({ state: "applied", commandId: request.commandId,
      affectedTargets: [{ family: "worker-browser", workerId: target.workerId }, { family: "run", runId: RUN }] });
    assert.equal((await verifyShellCommandEffect(client, "2026-08-03", request, reply)).state, "matched");
    assert.equal((await verifyShellCommandEffect(client, "2026-08-03", DashboardCommandRequestSchema.parse({ ...request, commandId: OTHER }), reply)).state, "mismatch");
    const foreignProfile = DashboardCommandRequestSchema.parse({ ...request, target: { ...target, profileId: RUN } });
    assert.equal((await verifyShellCommandEffect(client, "2026-08-03", foreignProfile, reply)).state, "mismatch");
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE, runId: RUN, native,
      check: { state: "available", target: { ...target, writeAttemptId: "invalid" } } } }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE, runId: RUN, native,
      check: { state: "available", target: { ...target, runAttempt: target.runAttempt + 1 } } } }).success, false);
  });
  it("accepts the held-check command only after its exact readback settles", async () => {
    const h = commandBindingFixture();
    const selected = { ...selection(), row: { ...selection().row, workflowId: WorkflowIdSchema.parse("separations") } };
    const native = nativeOf(RUN, 40);
    const target = { workerId: "separations-worker-1", workflowId: selected.row.workflowId, expectedVersion: 2,
      lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000",
      installationId: OTHER, profileId: NOTE, itemId: OTHER, runId: RUN, runVersion: selected.row.rowRevision,
      runAttempt: FIXTURE_PARKED_WRITE.runAttempt, traceId: native.traceId, nodeId: native.nodeId, writeIntentId: FIXTURE_PARKED_WRITE.writeIntentId,
      intentVersion: 1, intentGeneration: FIXTURE_PARKED_WRITE.generation, writeAttemptId: NOTE, bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) };
    const servedDetail = RunDetailWireSchema.parse({ ...detail(selected), availableSections: ["logs", "parked-write"] });
    const sent: DashboardCommandRequest[] = [];
    let lastCheck: unknown, release!: () => void;
    const client: DashboardClient = { ...h.client, runDetail: async () => servedDetail,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section, payload: page() }
        : { section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE, runId: RUN, native, check: { state: "available", target },
          ...(lastCheck === undefined ? {} : { lastCheck }) } }),
      executeCommand: async raw => {
        const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope);
        await new Promise<void>(resolve => { release = resolve; });
        lastCheck = { commandId: envelope.commandId, requestedBy: envelope.requestedBy, target, observedAt: AT, held: true,
          provenance: "system-probe", state: "ambiguous", code: "PARKED_CHECK_OCCURRENCE_UNPROVED",
          probeTaskId: "ucpath/match-existing-termination", evidenceDigest: "c".repeat(64) };
        return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId,
          affectedTargets: [{ family: "worker-browser", workerId: target.workerId }, { family: "run", runId: RUN }] });
      } };
    const request = DashboardCommandRequestSchema.parse({ commandId: NOTE, requestedBy: h.binding.scope.actorId, requestedAt: AT,
      source: "run-detail", family: "worker-browser", type: "check-parked-write", target });
    let settled = false;
    const pending = client.executeCommand(request).then(async reply => {
      const readback = await verifyShellCommandEffect(client, "2026-08-03", request, reply);
      settled = true;
      return readback;
    });
    assert.equal(sent.length, 1);
    assert.equal(settled, false);
    release();
    assert.equal((await pending).state, "matched");
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].target, target);
  });
  it("keeps failed-write uncertainty and failure identity separate from retry permission", async () => {
    const original = FIXTURE_FAILURE_SECTIONS[FIXTURE_IDS.failedRun].failure;
    assert.equal(original.section, "failure");
    if (original.section !== "failure" || original.payload.state !== "available") throw new Error("failure fixture unavailable");
    const source = original.payload.value;
    // An unknown write serves no retry, so its decision offers none (failureDecision drops it the same way).
    const unretryableDecision = source.decision === undefined ? undefined
      : { ...source.decision, options: source.decision.options.filter(option => option.send.via !== "action" || option.send.actionKey !== source.retry?.key) };
    const failure = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: { ...source, retry: undefined, decision: unretryableDecision,
      runId: RUN, native: nativeOf(RUN, 40, source.nodeId), traceId: selection().row.traceId, writeState: "unknown" } } });
    const servedDetail = RunDetailWireSchema.parse({ ...detail(), availableSections: ["logs", "failure"] });
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : path.endsWith("/failure") ? failure : servedDetail);
    const snapshot = await readRunLogs(client, selection(), new AbortController().signal);
    const decision = projectRunLogs(snapshot, client).steps.find(step => step.id === source.failureId)?.entries[0];
    assert.equal(decision?.kind, "decision");
    if (decision?.kind === "decision") { assert.equal(decision.decision.state, "unconfirmed"); assert.deepEqual(decision.decision.served?.options.filter(option => /retry/iu.test(option.label)), []); assert.equal(decision.decision.caution, "The result is unknown. Check the system before continuing."); }
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
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.CHOOSE);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    let matched = false;
    const sent: DashboardCommandRequest[] = [];
    const feedback: CommandOutcome[] = [];
    let refreshed = 0;
    const client: DashboardClient = { ...h.client,
      runDetail: async () => matched ? RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE, nodeId: GATE_NODE,
        label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } }) : open,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
        : { section: "identity-gate", payload: { state: "available", value: gate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope); return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId,
        affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { feedback.push(outcome); },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    let state: ReturnType<typeof useRunWiring> | undefined;
    function Probe() { state = useRunWiring(client, selected, binding); return null; }
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(createElement(Probe));
    const approve = gate.decision!.options[0]; assert.ok(approve); assert.ok(state?.onDecision);
    await act(async () => state?.onDecision?.(gate.gateRef, approve, { candidate: gate.options[1].ref }));
    assert.equal(sent.length, 1); assert.equal(state?.command?.state, "uncertain"); assert.equal(refreshed, 0);
    assert.equal(feedback[0]?.kind, "uncertain"); assert.equal(state?.onDecision, undefined);
    const envelope = sent[0]; assert.equal(envelope.family, "gate");
    if (envelope.family === "gate") {
      assert.deepEqual(envelope.target, { runId: RUN, gateId: GATE_NODE, expectedVersion: 3 });
      assert.deepEqual(envelope.payload, { decision: "approved", gateRef: gate.gateRef, optionRef: gate.options[1].ref });
    }
    matched = true; assert.ok(state?.replay);
    vi.useFakeTimers();
    try {
      await act(async () => state?.replay?.());
      assert.equal(sent.length, 2); assert.deepEqual(sent[1], envelope); assert.equal(feedback.at(-1)?.kind, "confirmed"); assert.equal(refreshed, 0);
      // The row never arrives: the day is reopened once the wait ends, not before.
      await act(async () => { vi.advanceTimersByTime(ROW_REVISION_WAIT_MS - 1); }); assert.equal(refreshed, 0);
      await act(async () => { vi.advanceTimersByTime(1); }); assert.equal(refreshed, 1);
    } finally { vi.useRealTimers(); }
  });
  it("shows exact one-click target and served basis before approval, then requires matched readback", async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3), title: "Generic run title" } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    const sent: DashboardCommandRequest[] = [];
    const outcomes: CommandOutcome[] = [];
    let matched = false, refreshed = 0;
    const client: DashboardClient = { ...h.client, runDetail: async () => matched ? RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE,
      nodeId: GATE_NODE, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } }) : open,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
        : { section: "identity-gate", payload: { state: "available", value: gate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope);
        return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: selected }) }) }));
    const block = document.querySelector('form[aria-label="Is this the right person?"]'); assert.ok(block);
    const text = block.textContent ?? "";
    for (const target of [gate.options[0].maskedEid, gate.options[0].displayName, gate.options[0].origin]) assert.ok(text.includes(target), target);
    assert.ok(text.includes(gate.reason), gate.reason);
    for (const comparison of gate.comparisons) for (const basis of [comparison.label, comparison.request, comparison.ucpath]) assert.ok(text.includes(basis), basis);
    assert.doesNotMatch(text, /\d{8}/u);
    assert.equal(sent.length, 0); assert.equal(refreshed, 0);
    const review = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Review"); assert.ok(review);
    await act(async () => { review.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.ok(document.activeElement?.contains(block)); assert.equal(document.activeElement?.getAttribute("tabindex"), "-1");
    assert.equal(sent.length, 0);
    const approve = [...block.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.decision!.options[0].label); assert.ok(approve); assert.equal(approve.disabled, false);
    await act(async () => approve.click());
    assert.equal(sent.length, 1); assert.equal(outcomes.at(-1)?.kind, "uncertain"); assert.equal(refreshed, 0);
    const envelope = sent[0]; assert.equal(envelope.family, "gate");
    if (envelope.family === "gate") assert.deepEqual(envelope.payload, { decision: "approved", gateRef: gate.gateRef, optionRef: gate.options[0].ref });
    matched = true;
    const replay = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Replay exact decision"); assert.ok(replay);
    vi.useFakeTimers();
    try {
      await act(async () => replay.click());
      assert.equal(outcomes.at(-1)?.kind, "confirmed"); assert.equal(refreshed, 0); assert.deepEqual(sent[1], envelope);
      // A replacement authority takes the editor before the row arrives: the settled command's timeout reopens nothing for it.
      const replacement: DashboardCommandBinding = { ...binding, scope: { ...scope } };
      await act(async () => root?.render(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: replacement,
        children: createElement(LogSample, { selection: selected }) }) })));
      await act(async () => { vi.advanceTimersByTime(ROW_REVISION_WAIT_MS * 2); });
      assert.equal(refreshed, 0);
    } finally { vi.useRealTimers(); }
  });
  for (const transition of ["identical", "command-revision", "run-roundtrip", "keyed-run-roundtrip", "unmounted", "foreign-scope"] as const) it(`isolates pending command ownership and feedback through ${transition} replacement`, async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    const resolved = RunDetailWireSchema.parse({ ...open, rowRevision: 4, availableSections: ["logs"], gate: { state: "resolved", gateId: NOTE, nodeId: GATE_NODE,
      label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } });
    let currentDetail = open, refreshed = 0;
    const outcomes: CommandOutcome[] = [], sent: DashboardCommandRequest[] = [];
    let release: (() => void) | undefined;
    const client: DashboardClient = { ...h.client, runDetail: async () => currentDetail,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() } : { section: "identity-gate", payload: { state: "available", value: gate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope); await new Promise<void>(resolve => { release = resolve; });
        return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    const panel = (next: LogSelection, currentBinding = binding) => createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: currentBinding,
      children: createElement(LogSample, { selection: next, key: transition === "keyed-run-roundtrip" ? next.row.runId : undefined }) }) });
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(panel(selected));
    const approve = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.decision!.options[0].label);
    const first = approve(); assert.ok(first); await act(async () => first.click()); assert.equal(sent.length, 1);
    assert.match(document.body.textContent ?? "", /Pending/);
    const next = { ...selected, row: { ...selected.row, ...(transition === "command-revision" ? { rowRevision: RowRevisionSchema.parse(4) } : {}) } };
    if (transition === "command-revision") currentDetail = resolved;
    if (transition === "run-roundtrip" || transition === "keyed-run-roundtrip") {
      await serveRows(binding.authority.dayState.rows, client, OTHER);
      await act(async () => root?.render(panel(selection(OTHER))));
      assert.doesNotMatch(document.body.textContent ?? "", /Pending/);
    }
    await serveRows(binding.authority.dayState.rows, client, RUN);
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
      assert.equal(outcomes.at(-1)?.kind, "confirmed"); assert.equal(outcomes.length, 1); assert.equal(refreshed, 0);
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
      assert.equal(outcomes.at(-1)?.kind, "confirmed"); assert.equal(refreshed, 0);
    }
  });
  it("keeps a newer run's confirmed feedback and lock when the old command settles late", async () => {
    const h = commandBindingFixture();
    const selected = [RUN, OTHER].map(runId => ({ ...selection(runId), row: { ...selection(runId).row, rowRevision: RowRevisionSchema.parse(3) } }));
    const gates = [RUN, OTHER].map(runId => {
      const fixtures = identityFixtures(AT, "10833507", "10203262", () => runId);
      return fixtures.gateDetail(fixtures.ONE_CLICK);
    });
    const resolved = new Set<string>(), releases = new Map<string, () => void>();
    const sent: DashboardCommandRequest[] = [], outcomes: CommandOutcome[] = []; let refreshed = 0;
    const client: DashboardClient = { ...h.client,
      runDetail: async runId => {
        const index = runId === RUN ? 0 : 1, gate = gates[index], isResolved = resolved.has(runId);
        return RunDetailWireSchema.parse({ ...detail(selected[index]), rowRevision: isResolved ? 4 : 3,
          gate: isResolved ? { state: "resolved", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 }
            : { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      },
      runSection: async (runId, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page(runId) }
        : { section: "identity-gate", payload: { state: "available", value: gates[runId === RUN ? 0 : 1] } }),
      executeCommand: async raw => {
        const envelope = DashboardCommandRequestSchema.parse(raw); assert.equal(envelope.family, "gate");
        if (envelope.family !== "gate") throw new Error("gate required");
        sent.push(envelope); await new Promise<void>(resolve => releases.set(envelope.target.runId, resolve));
        return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: envelope.target.runId, gateId: envelope.target.gateId }] });
      },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    const panel = (index: number) => createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: selected[index] }) }) });
    const approve = () => { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gates[0].decision!.options[0].label); assert.ok(control); return control; };
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(panel(0)); await act(async () => approve().click());
    await serveRows(binding.authority.dayState.rows, client, OTHER);
    await act(async () => root?.render(panel(1))); await act(async () => approve().click()); assert.equal(sent.length, 2);
    resolved.add(OTHER); await act(async () => releases.get(OTHER)?.());
    assert.match(document.body.textContent ?? "", /Decision confirmed/); assert.equal(approve().disabled, true);
    resolved.add(RUN); await act(async () => releases.get(RUN)?.());
    assert.match(document.body.textContent ?? "", /Decision confirmed/); assert.equal(approve().disabled, true);
    assert.equal(outcomes.length, 1); assert.equal(outcomes[0].commandId, sent[1].commandId); assert.equal(refreshed, 0); assert.equal(sent.length, 2);
  });
  it("retains uncertain feedback and the exact replay envelope through identical row replacement", async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    let matched = false, refreshed = 0; const sent: DashboardCommandRequest[] = [];
    const client: DashboardClient = { ...h.client, runDetail: async () => matched ? RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE, nodeId: GATE_NODE,
      label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } }) : open,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() } : { section: "identity-gate", payload: { state: "available", value: gate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope); return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    const panel = (next: LogSelection) => createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: next }) }) });
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(panel(selected));
    const approve = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.decision!.options[0].label);
    const first = approve(); assert.ok(first); await act(async () => first.click()); assert.equal(sent.length, 1);
    await act(async () => root?.render(panel({ ...selected, row: { ...selected.row } })));
    assert.match(document.body.textContent ?? "", /could not be confirmed/); const blocked = approve(); assert.ok(blocked); assert.equal(blocked.disabled, true);
    assert.equal(sent.length, 1); assert.equal(refreshed, 0);
    const replay = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Replay exact decision"); assert.ok(replay);
    matched = true; await act(async () => replay.click()); assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(refreshed, 0);
  });
  for (const outcome of ["uncertain", "refused"] as const) it(`stabilizes restored ${outcome} command and replay inputs until state or scope changes`, async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.ONE_CLICK);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    let release: (() => void) | undefined; const sent: DashboardCommandRequest[] = [];
    const client: DashboardClient = { ...h.client, runDetail: async () => open,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() } : { section: "identity-gate", payload: { state: "available", value: gate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope);
        if (sent.length > 1) await new Promise<void>(resolve => { release = resolve; });
        return CommandResultSchema.parse(outcome === "refused" || sent.length > 1 ? { state: "rejected", commandId: envelope.commandId, code: "policy-refused", message: "Refused" }
          : { state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
    let current: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ activeBinding }: { activeBinding: DashboardCommandBinding }) { current = useRunWiring(client, selected, activeBinding); return createElement("span", null, current.command?.feedback); }
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(createElement(Probe, { key: "first", activeBinding: binding }));
    await act(async () => current?.onDecision?.(gate.gateRef, gate.decision!.options[0], {})); assert.equal(sent.length, 1);
    await act(async () => root?.render(createElement(Probe, { key: "restored", activeBinding: binding })));
    const restored = current?.command, replay = current?.replay; assert.ok(restored); assert.equal(restored.state, outcome);
    for (let tick = 0; tick < 2; tick++) await act(async () => root?.render(createElement(Probe, { key: "restored", activeBinding: binding })));
    assert.equal(current?.command, restored); assert.equal(current?.replay, replay); assert.equal(sent.length, 1);
    if (outcome === "uncertain") {
      assert.ok(replay); await act(async () => replay()); assert.equal(current?.command?.state, "pending"); assert.notEqual(current?.command, restored); assert.equal(current?.replay, undefined);
      assert.deepEqual(sent[1], sent[0]); await act(async () => release?.()); assert.equal(current?.command?.state, "refused"); assert.match(document.body.textContent ?? "", /That was refused/);
    } else assert.equal(replay, undefined);
    const replacement = { ...binding, scope: { ...scope, actorId: "other-operator" } };
    await act(async () => root?.render(createElement(Probe, { key: "restored", activeBinding: replacement })));
    assert.equal(current?.command, undefined); assert.equal(current?.replay, undefined);
  });
  it("shows an empty log as no actions", async () => {
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: { ...page(), rows: [], notes: [] } } : detail());
    const h = commandBindingFixture();
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: h.binding,
      children: createElement(LogSample, { selection: selection() }) }) }));
    assert.match(document.body.textContent ?? "", /No actions yet/);
  });
  it("retains supplied notes and locks decision controls when gate/capture authority is omitted", async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.CHOOSE);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    for (const omitted of ["node", "capture"] as const) {
      const open = RunDetailWireSchema.parse({ ...detail(selected), captures: omitted === "capture" ? undefined : detail().captures,
        gate: { state: "open", gateId: NOTE, ...(omitted === "node" ? {} : { nodeId: GATE_NODE }), label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
      let submissions = 0;
      const client: DashboardClient = { ...h.client, runDetail: async () => open,
        runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
          : { section: "identity-gate", payload: { state: "available", value: gate } }),
        executeCommand: () => { submissions++; throw new Error("unbound decision"); },
      };
      const scope = { ...h.binding.scope, client };
      const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
      await serveRows(binding.authority.dayState.rows, client, RUN);
      await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
        children: createElement(LogSample, { selection: selected }) }) }));
      assert.match(document.body.textContent ?? "", /Authoritative note 0/);
      if (omitted === "node") assert.match(document.body.textContent ?? "", /Identity decision join not supplied/);
      assert.equal(document.querySelector('form[aria-label="Identity Approval"]')?.querySelectorAll("button").length, 0);
      assert.equal(submissions, 0);
      await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    }
  });
  it("keeps refusal feedback and permits only an explicit corrected approval in the mounted Logs panel", async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.CHOOSE);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    const sent: DashboardCommandRequest[] = [];
    const client: DashboardClient = { ...h.client, runDetail: async () => open,
      runSection: async (_run, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page() }
        : { section: "identity-gate", payload: { state: "available", value: gate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope);
        return CommandResultSchema.parse({ state: "rejected", commandId: envelope.commandId, code: "policy-refused", message: "Current decision refused" }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { throw new Error("refusal must not invent changed authority"); } } } };
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: selected }) }) }));
    const approve = () => { const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.decision!.options[0].label); assert.ok(node); return node; };
    async function choose(index: number) {
      const radio = document.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]; assert.ok(radio); await act(async () => radio.click());
      assert.equal(approve().disabled, false); await act(async () => approve().click());
    }
    await choose(0);
    assert.equal(sent.length, 1); assert.match(document.body.textContent ?? "", /That was refused/); assert.equal(approve().disabled, false);
    await act(async () => {}); assert.equal(sent.length, 1);
    await choose(1);
    assert.equal(sent.length, 2); assert.notEqual(sent[0].commandId, sent[1].commandId);
    for (const [index, envelope] of sent.entries()) {
      assert.equal(envelope.family, "gate");
      if (envelope.family === "gate") assert.deepEqual(envelope.payload, { decision: "approved", gateRef: gate.gateRef, optionRef: gate.options[index].ref });
    }
  });
  it("releases a confirmed gate lock when the same run reaches its next authoritative gate", async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const firstGate = fixtures.gateDetail(fixtures.ONE_CLICK);
    const secondGate = fixtures.gateDetail(fixtures.ONE_CLICK, { gateRef: "00000000-0000-4000-8000-0000000000a2", expectedVersion: 5,
      actions: firstGate.actions.map(action => ({ ...action, expectedVersion: 5 })) });
    const gates = [firstGate, secondGate], nodes = [GATE_NODE, "second-gate"];
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    let gateIndex = 0, resolved = false, refreshed = 0;
    const sent: DashboardCommandRequest[] = [], outcomes: CommandOutcome[] = [];
    const client: DashboardClient = { ...h.client,
      runDetail: async () => { const gate = gates[gateIndex]; return RunDetailWireSchema.parse({ ...detail(selected), rowRevision: gate.expectedVersion + (resolved ? 1 : 0),
        gate: resolved ? { state: "resolved", gateId: NOTE, nodeId: nodes[gateIndex], label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: gateIndex * 2 + 2 }
          : { state: "open", gateId: NOTE, nodeId: nodes[gateIndex], label: gate.label, openedAt: AT, revision: gateIndex * 2 + 1 }, availableSections: ["logs", "identity-gate"] }); },
      runSection: async (_run, name) => RunDetailSectionResponseSchema.parse(name === "logs" ? { section: "logs", payload: page() }
        : { section: "identity-gate", payload: { state: "available", value: gates[gateIndex] } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); assert.equal(envelope.family, "gate");
        if (envelope.family !== "gate") throw new Error("gate required"); sent.push(envelope); resolved = true;
        return CommandResultSchema.parse({ state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: envelope.target.gateId }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    const panel = (next: LogSelection) => createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: next }) }) });
    const approve = () => { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === firstGate.decision!.options[0].label); assert.ok(control); return control; };
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await mount(panel(selected)); await act(async () => approve().click());
    assert.equal(sent.length, 1); assert.equal(outcomes[0].kind, "confirmed"); assert.equal(refreshed, 0); assert.equal(approve().disabled, true);
    gateIndex = 1; resolved = false;
    await serveRows(binding.authority.dayState.rows, client, RUN);
    await act(async () => root?.render(panel({ ...selected, row: { ...selected.row, rowRevision: RowRevisionSchema.parse(5) } })));
    assert.equal(approve().disabled, false); assert.equal(sent.length, 1); assert.doesNotMatch(document.body.textContent ?? "", /Decision confirmed/);
    await act(async () => approve().click());
    assert.equal(sent.length, 2); assert.equal(outcomes[1].kind, "confirmed"); assert.equal(refreshed, 0); assert.notEqual(sent[0].commandId, sent[1].commandId);
    for (const [index, envelope] of sent.entries()) { assert.equal(envelope.family, "gate"); if (envelope.family === "gate") assert.deepEqual(envelope.target,
      { runId: RUN, gateId: nodes[index], expectedVersion: index === 0 ? 3 : 5 }); }
  });
  for (const authority of ["current", "new-revision", "new-gate", "foreign-actor", "foreign-authority"] as const) it(`projects keyed pending-to-refused recovery only for ${authority} gate authority`, async () => {
    const h = commandBindingFixture();
    const fixtures = identityFixtures(AT, "10833507", "10203262", () => RUN);
    const gate = fixtures.gateDetail(fixtures.CHOOSE);
    const selected = { ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(3) } };
    const open = RunDetailWireSchema.parse({ ...detail(selected), gate: { state: "open", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, openedAt: AT, revision: 1 }, availableSections: ["logs", "identity-gate"] });
    let currentGate = gate, currentDetail = open, release: (() => void) | undefined;
    const sent: DashboardCommandRequest[] = [], outcomes: CommandOutcome[] = []; let refreshed = 0;
    const client: DashboardClient = { ...h.client,
      runDetail: async runId => runId === RUN ? currentDetail : detail(selection(runId)),
      runSection: async (runId, section) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: page(runId) }
        : { section: "identity-gate", payload: { state: "available", value: currentGate } }),
      executeCommand: async raw => { const envelope = DashboardCommandRequestSchema.parse(raw); sent.push(envelope); await new Promise<void>(resolve => { release = resolve; });
        return CommandResultSchema.parse(sent.length === 1 ? { state: "rejected", commandId: envelope.commandId, code: "policy-refused", message: "Current decision refused" }
          : { state: "applied", commandId: envelope.commandId, affectedTargets: [{ family: "gate", runId: RUN, gateId: GATE_NODE }] }); },
    };
    const scope = { ...h.binding.scope, client };
    const binding: DashboardCommandBinding = { ...h.binding, scope, executor: new CommandExecutor(() => scope), feedback: outcome => { outcomes.push(outcome); },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client }, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    const panel = (next: LogSelection, currentBinding = binding) => createElement(TipClient, { client, children: createElement(DashboardCommandBindingProvider, { binding: currentBinding,
      children: createElement(LogSample, { key: next.row.runId, selection: next }) }) });
    const approve = () => { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === gate.decision!.options[0].label); assert.ok(control); return control; };
    async function choose(index: number) {
      const radio = document.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]; assert.ok(radio); await act(async () => radio.click());
      assert.equal(approve().disabled, false); await act(async () => approve().click());
    }
    const serve = (runId: string) => serveRows(binding.authority.dayState.rows, client, runId);
    await serve(RUN);
    await mount(panel(selected)); await choose(0); assert.equal(sent.length, 1);
    await serve(OTHER); await act(async () => root?.render(panel(selection(OTHER))));
    await serve(RUN); await act(async () => root?.render(panel(selected)));
    assert.match(document.body.textContent ?? "", /Pending/); assert.equal(approve().disabled, true);
    await act(async () => release?.()); assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
    const next = { ...selected, row: { ...selected.row, ...(authority === "new-revision" ? { rowRevision: RowRevisionSchema.parse(4) } : {}) } };
    if (authority === "new-revision") { currentGate = fixtures.gateDetail(fixtures.CHOOSE, { expectedVersion: 4, actions: gate.actions.map(action => ({ ...action, expectedVersion: 4 })) }); currentDetail = { ...open, rowRevision: RowRevisionSchema.parse(4) }; }
    if (authority === "new-gate") {
      const section = RunDetailSectionResponseSchema.parse({ section: "identity-gate", payload: { state: "available", value: { ...gate, gateRef: "00000000-0000-4000-8000-0000000000a3" } } });
      assert.equal(section.section, "identity-gate"); if (section.section !== "identity-gate" || section.payload.state !== "available") throw new Error("gate required");
      currentGate = section.payload.value;
      currentDetail = RunDetailWireSchema.parse({ ...open, gate: { ...open.gate, nodeId: "second-gate", revision: 2 } });
    }
    await serve(RUN);
    const nextBinding = authority === "foreign-actor" || authority === "foreign-authority" ? { ...binding, scope: { ...scope,
      ...(authority === "foreign-actor" ? { actorId: "other-operator" } : { authority: {} }) } } : binding;
    await act(async () => root?.render(panel(next, nextBinding)));
    assert.equal(sent.length, 1); assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
    assert.doesNotMatch(document.body.textContent ?? "", /Pending/);
    if (authority !== "current") { assert.doesNotMatch(document.body.textContent ?? "", /That was refused/); return; }
    assert.match(document.body.textContent ?? "", /That was refused/);
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="radio"]')[0]?.click()); assert.equal(approve().disabled, false);
    await act(async () => root?.render(panel(next, binding))); assert.equal(sent.length, 1);
    await choose(1); assert.equal(sent.length, 2); assert.notEqual(sent[1].commandId, sent[0].commandId);
    for (const [index, envelope] of sent.entries()) { assert.equal(envelope.family, "gate"); if (envelope.family === "gate") assert.deepEqual(envelope.payload,
      { decision: "approved", gateRef: gate.gateRef, optionRef: gate.options[index].ref }); }
    assert.match(document.body.textContent ?? "", /Pending/); assert.doesNotMatch(document.body.textContent ?? "", /That was refused/); assert.equal(approve().disabled, true);
    await serve(OTHER); await act(async () => root?.render(panel(selection(OTHER)))); await serve(RUN); await act(async () => root?.render(panel(next)));
    assert.match(document.body.textContent ?? "", /Pending/); assert.doesNotMatch(document.body.textContent ?? "", /That was refused/);
    currentDetail = RunDetailWireSchema.parse({ ...open, rowRevision: 4, gate: { state: "resolved", gateId: NOTE, nodeId: GATE_NODE, label: gate.label, resolution: "approved", resolvedBy: "local-operator", resolvedAt: AT, revision: 2 } });
    await act(async () => release?.()); assert.equal(outcomes.length, 0); assert.equal(refreshed, 0);
    await act(async () => root?.render(panel(next, binding)));
    assert.doesNotMatch(document.body.textContent ?? "", /That was refused|Pending/); assert.equal(sent.length, 2);
  });
  const bound = (client: DashboardClient, binding: DashboardCommandBinding, selected: LogSelection) => createElement(TipClient, { client,
    children: createElement(DashboardCommandBindingProvider, { binding, children: createElement(LogSample, { selection: selected }) }) });
  const refused = (code: string, retryable: boolean) => ({ state: "refused" as const, error: WireErrorSchema.parse({ state: "error", code, message: "private native mismatch", retryable }) });
  const unreadable = () => { const reads: string[] = []; return { reads, client: clientFor(path => { reads.push(path); throw new Error("the panel is streamed; no read is made"); }) }; };
  it("mounts the served LogSample producer without fictional decision events", async () => {
    const h = commandBindingFixture();
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : detail());
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    await mount(bound(client, h.binding, selection()));
    assert.match(document.body.textContent ?? "", /Authoritative note 0/);
    assert.doesNotMatch(document.body.textContent ?? "", /Reading the employment record|Termination confirmed|Approve match/);
    assert.doesNotMatch(document.body.textContent ?? "", /cross-source chronology unavailable/);
  });
  it("shows the catalog refusal for client Logs identity failures", async () => {
    const h = commandBindingFixture();
    const malformed = { ...page(), rows: page().rows?.map(row => row.kind === "note"
      ? { ...row, native: undefined, note: { ...row.note, native: undefined } } : row),
      notes: page().notes.map(note => ({ ...note, native: undefined })) };
    const client = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: malformed } : detail());
    await serveRows(h.binding.authority.dayState.rows, client, RUN);
    await mount(bound(client, h.binding, selection()));
    assert.match(document.body.textContent ?? "", /These logs don't match this run\./u);
    assert.equal([...document.querySelectorAll("button")].some(button => button.textContent === "Retry"), false);
    assert.doesNotMatch(document.body.textContent ?? "", /private native mismatch|Authoritative note/);
  });
  it("shows the catalog refusal for a backend Logs identity failure streamed as a refused panel", async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    await serveRows(h.binding.authority.dayState.rows, client, RUN, refused("LOGS_IDENTITY_REFUSED", false));
    await mount(bound(client, h.binding, selection()));
    assert.match(document.body.textContent ?? "", /These logs don't match this run\./u);
    assert.equal([...document.querySelectorAll("button")].some(button => button.textContent === "Retry"), false);
    assert.doesNotMatch(document.body.textContent ?? "", /private native mismatch|Authoritative note/);
    assert.deepEqual(reads, []);
  });
  it("takes the panel from the store under StrictMode without any client read", async () => {
    const h = commandBindingFixture();
    const served = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : detail());
    await serveRows(h.binding.authority.dayState.rows, served, RUN);
    const { client, reads } = unreadable();
    await mount(createElement(StrictMode, null, bound(client, h.binding, selection())));
    assert.match(document.body.textContent ?? "", /Authoritative note 0/);
    assert.deepEqual(reads, []);
  });
  it("stays loading, never failed or empty, while the store holds no panel for the run", async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    await mount(bound(client, h.binding, selection()));
    const text = document.body.textContent ?? "";
    assert.doesNotMatch(text, /Couldn't load logs|No actions yet|Approve match|Reading the employment record/);
    let current: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ activeBinding }: { activeBinding: DashboardCommandBinding | undefined }) { current = useRunWiring(client, selection(), activeBinding); return null; }
    await act(async () => root?.render(createElement(Probe, { activeBinding: h.binding })));
    assert.equal(current?.state, "loading"); assert.equal(current?.snapshot, undefined);
    await act(async () => root?.render(createElement(Probe, { activeBinding: undefined })));
    assert.equal(current?.state, "loading"); assert.deepEqual(reads, []);
  });
  it("shows a retryable refused panel as a failed read without turning it into a mock or a verified empty result", async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    await serveRows(h.binding.authority.dayState.rows, client, RUN, refused("DASHBOARD_READ_FAILED", true));
    await mount(bound(client, h.binding, selection()));
    const text = document.body.textContent ?? "";
    assert.ok(text.includes("Couldn't load logs."));
    assert.doesNotMatch(text, /private native mismatch|unclassified failure/);
    assert.doesNotMatch(text, /No actions yet|Approve match|Reading the employment record/);
    assert.deepEqual(reads, []);
  });
  it("mounts the harness preview beside a refused panel without any client read", async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    await serveRows(h.binding.authority.dayState.rows, client, RUN, refused("DASHBOARD_READ_FAILED", true));
    const selected = selection();
    const panel = (preview?: true) => createElement(TipClient, { client,
      children: createElement(DashboardCommandBindingProvider, { binding: h.binding, children: createElement(preview ? LogPreview : LogSample, { selection: selected }) }) });
    await mount(panel());
    assert.match(document.body.textContent ?? "", /Couldn't load logs\./);
    assert.doesNotMatch(document.body.textContent ?? "", /Separation request verified/);
    await act(async () => root?.render(panel(true)));
    assert.match(document.body.textContent ?? "", /Separation request verified/);
    assert.doesNotMatch(document.body.textContent ?? "", /Could not load logs|Couldn't load logs|cross-source chronology unavailable/);
    await act(async () => root?.render(panel()));
    assert.match(document.body.textContent ?? "", /Couldn't load logs\./);
    assert.doesNotMatch(document.body.textContent ?? "", /Separation request verified/);
    assert.deepEqual(reads, []);
  });
  for (const replacement of ["day", "epoch", "day-request", "scope"] as const) it(`follows the replacing authority's store after ${replacement} authority replacement`, async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    const served = clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : detail());
    const binding: DashboardCommandBinding = { ...h.binding, scope: { ...h.binding.scope, client },
      authority: { ...h.binding.authority, epoch: { ...h.binding.authority.epoch, client } } };
    await serveRows(binding.authority.dayState.rows, served, RUN);
    const selected = selection();
    let current: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ activeBinding }: { activeBinding: DashboardCommandBinding }) { current = useRunWiring(client, selected, activeBinding); return null; }
    await mount(createElement(Probe, { activeBinding: binding }));
    assert.equal(current?.state, "loaded");
    // The replacing authority streams its own panels; nothing the old store held is shown under it.
    const rows = openStore();
    const next: DashboardCommandBinding = { ...binding,
      scope: replacement === "scope" ? { ...binding.scope, actorId: "other-operator" } : binding.scope,
      authority: { ...binding.authority, day: replacement === "day" ? "2026-08-04" : binding.authority.day,
        epoch: replacement === "epoch" ? { ...binding.authority.epoch } : binding.authority.epoch,
        dayState: { ...binding.authority.dayState, rows, ...(replacement === "day-request" ? { request: {} } : {}) } } };
    await act(async () => root?.render(createElement(Probe, { activeBinding: next })));
    // A new day or day request under the same sign-in keeps the loaded logs it already held; a new sign-in or actor keeps none.
    if (replacement === "epoch" || replacement === "scope") { assert.equal(current?.state, "loading"); assert.equal(current?.snapshot, undefined); }
    await serveRows(rows, served, RUN);
    assert.equal(current?.state, "loaded"); assert.equal(current?.snapshot?.detail.runId, RUN);
    assert.deepEqual(reads, []);
  });
  it("shows only the selected run's panel across A to B to A, and a newer streamed panel replaces the old one", async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    const rows = h.binding.authority.dayState.rows;
    const serving = (empty: boolean) => clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: empty ? { ...page(), rows: [], notes: [] } : page() } : detail());
    let current: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ selected }: { selected: LogSelection }) { current = useRunWiring(client, selected, h.binding); return null; }
    const a = selection(), b = selection(OTHER);
    const shownRows = () => current?.snapshot?.logs.rows?.length;
    await serveRows(rows, serving(false), RUN);
    await mount(createElement(Probe, { selected: a }));
    assert.equal(current?.state, "loaded"); assert.equal(shownRows(), 1);
    await act(async () => root?.render(createElement(Probe, { selected: b })));
    assert.equal(current?.state, "loading"); assert.equal(current?.snapshot, undefined);
    await act(async () => root?.render(createElement(Probe, { selected: a })));
    assert.equal(current?.state, "loaded"); assert.equal(shownRows(), 1);
    await serveRows(rows, serving(true), RUN);
    assert.equal(current?.state, "loaded"); assert.equal(shownRows(), 0);
    assert.deepEqual(reads, []);
  });
  it("shows a panel read after the row and refreshes nothing, but keeps a panel behind the row loading", async () => {
    const h = commandBindingFixture();
    const { client, reads } = unreadable();
    let refreshed = 0;
    const binding: DashboardCommandBinding = { ...h.binding, authority: { ...h.binding.authority, dayState: { ...h.binding.authority.dayState, refresh: () => { refreshed++; } } } };
    const rowAt = (revision: number): LogSelection => ({ ...selection(), row: { ...selection().row, rowRevision: RowRevisionSchema.parse(revision) } });
    const panelAt = (revision: number) => clientFor(path => path.endsWith("/logs") ? { section: "logs", payload: page() } : { ...detail(rowAt(revision)), rowRevision: revision });
    let current: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ selected }: { selected: LogSelection }) { current = useRunWiring(client, selected, binding); return null; }
    await serveRows(binding.authority.dayState.rows, panelAt(4), RUN);
    await mount(createElement(Probe, { selected: rowAt(3) }));
    assert.equal(current?.state, "loaded"); assert.equal(current?.snapshot?.detail.rowRevision, 4);
    await act(async () => root?.render(createElement(Probe, { selected: rowAt(5) })));
    assert.equal(current?.state, "loading");
    await serveRows(binding.authority.dayState.rows, panelAt(5), RUN);
    assert.equal(current?.state, "loaded"); assert.equal(current?.snapshot?.detail.rowRevision, 5);
    assert.equal(refreshed, 0); assert.deepEqual(reads, []);
  });
});

it("joins task screenshots by exact bundle, artifact, node, attempt and browser session", () => {
  const sessionId = "20000000-0000-4000-8000-000000000001";
  const initial = page();
  const rows = initial.rows!.map(row => row.kind === "note" ? { ...row, note: { ...row.note, screenshot: { bundleId: NOTE, artifactId: OTHER, sessionId } } } : row);
  const logs = NotePageSchema.parse({ ...initial, rows, notes: rows.flatMap(row => row.kind === "note" ? [row.note] : []) });
  const captures = RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: RUN, artifacts: [{
    artifact: { mediaKind: "image", mediaType: "image/png", artifactId: OTHER, sha256: "a".repeat(64), byteLength: 1, sensitivity: "restricted", redaction: "restricted-access", width: 1280, height: 720 },
    origins: [{ bundleId: NOTE, originKind: "operator-request", capturedAt: AT, browserCapture: { nodeId: "first", attempt: 1, sessionId } }],
  }] } });
  const snapshot = { detail: detail(), logs, sections: [captures], actionEvidence: { state: "available" as const, events: [], missingPages: [] }, unavailableEvidence: [] };
  const client = { artifactUrl: (id: string) => `/authority/${id}` };
  const projected = projectRunLogs(snapshot, client);
  assert.equal(projected.steps[0].title, "First");
  const entry = projected.steps[0].entries.find(entry => entry.kind === "decision");
  assert.ok(entry?.kind === "decision");
  assert.deepEqual(entry.decision.screenshots?.map(shot => [shot.src, shot.width, shot.height]), [[`/authority/${OTHER}`, 1280, 720]]);
  for (const patch of [{ bundleId: OTHER }, { artifactId: NOTE }, { sessionId: OTHER }]) {
    const badRows = logs.rows!.map(row => row.kind === "note" ? { ...row, note: { ...row.note, screenshot: { ...row.note.screenshot!, ...patch } } } : row);
    assert.throws(() => projectRunLogs({ ...snapshot, logs: NotePageSchema.parse({ ...logs, rows: badRows, notes: badRows.flatMap(row => row.kind === "note" ? [row.note] : []) }) }, client), /RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH/);
  }
  for (const patch of [{ nodeId: "cross-verify" }, { attempt: 2 }]) {
    const badRows = logs.rows!.map(row => row.kind === "note" ? { ...row, native: { ...row.native!, ...patch }, note: { ...row.note, native: { ...row.note.native!, ...patch } } } : row);
    assert.throws(() => projectRunLogs({ ...snapshot, logs: NotePageSchema.parse({ ...logs, rows: badRows, notes: badRows.flatMap(row => row.kind === "note" ? [row.note] : []) }) }, client), /RUN_LOG_(?:SCREENSHOT|NATIVE)_IDENTITY_MISMATCH/);
  }
  assert.throws(() => projectRunLogs({ ...snapshot, sections: [] }, client), /RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH/);
});

it("preserves a catalogued unmapped-display refusal streamed as a refused panel through the Logs hook", async () => {
  const selected=selection();
  const h=commandBindingFixture();
  const refused={state:'refused' as const,error:WireErrorSchema.parse({state:'error',code:'RUN_LOG_DISPLAY_VALUE_UNMAPPED',message:'Untrusted transport text',retryable:false})};
  await serveRows(h.binding.authority.dayState.rows,h.client,RUN,refused);
  let current:ReturnType<typeof useRunWiring>|undefined;
  function Probe(){current=useRunWiring(h.client,selected,h.binding);return createElement('div',null,current.state==='failed'?current.error:'Loading');}
  await mount(createElement(Probe));
  assert.equal(current?.state,'failed');
  assert.match(document.body.textContent??'',/A saved value has no display text/u);
  assert.doesNotMatch(document.body.textContent??'',/Dashboard data could not be read|Untrusted transport text/u);
});
