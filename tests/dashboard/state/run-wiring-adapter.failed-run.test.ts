// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { projectRunLogs, useRunWiring } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { LogSample } from "../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { mockQueueSurface } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../src/models/dashboard/projection.js";
import { projectFailureDisplay } from "../../../src/models/dashboard/failure-display.js";
import { ErrorCodeSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";
import type { LogSelection } from "../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";

// The served shape of a run that failed in its first step: every planned step is served pending, only the failure is recorded.
const RUN = "00000000-0000-4000-8000-000000000024";
const AT = "2026-08-03T10:58:45.000Z";
const FAILURE = "00000000-0000-4000-8000-0000000000f3";
const baseRow = mockQueueSurface({ id: RUN, workflowId: "onboarding", title: "Served subject", subject: "Served subject", draft: initialMockDraft("onboarding"), approved: true, seeded: true }, "2026-08-03T10:57:54.000Z");
const failedRow = (): QueueSurfaceWire => QueueSurfaceWireSchema.parse({ ...baseRow, runId: RunIdSchema.parse(RUN), status: "failed", endedAt: { state: "present", value: AT } });
const TRACE = failedRow().traceId;
const native = (order: number, nodeId = "crm-source") => NativeRunEventWireSchema.parse({ eventId: `10000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
  order, runId: RUN, attempt: 1, traceId: TRACE, nodeId, spanPath: `${TRACE}/${nodeId}#1` });
const PLANNED = [["crm-source", "Read hire data", "crm", "failed"], ["hire-plan", "Plan the hire", undefined, "pending"],
  ["ucpath-source", "Read UCPath record", "ucpath", "pending"], ["hire-create", "Create the hire", "ucpath", "pending"]] as const;

function served(row: QueueSurfaceWire = failedRow()) {
  return RunDetailWireSchema.parse({ runId: RUN, rowRevision: row.rowRevision, panelKind: "run",
    header: { runId: RUN, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: "failed", attempt: row.attempt },
    timeline: { steps: PLANNED.map(([nodeId, label, system, state]) => ({ key: nodeId, label, state, ...(system === undefined ? {} : { system }),
      members: [{ nodeId, categoryKey: nodeId, label, state }] })), events: [] },
    gate: { state: "absent", reason: "no gate" }, outcome: { state: "terminal", result: "failed", completedAt: AT },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs", "failure"] });
}
const logs = NotePageSchema.parse({ runId: RUN, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
const failure = (summary = "Failure screenshot not taken: verification-failed") => RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: {
  runId: RUN, traceId: TRACE, attempt: 1, workflowId: "onboarding", nodeId: "crm-source", taskId: "crm/read-hire-data", native: native(9), failureId: FAILURE, display: projectFailureDisplay({ code: ErrorCodeSchema.parse("TASK_UNHANDLED_FAILURE") }),
  fingerprint: "a".repeat(64), code: "TASK_UNHANDLED_FAILURE", summary: "[crm/read-hire-data] TASK_UNHANDLED_FAILURE", transient: false, writeState: "not-attempted",
  subject: { state: "absent", reason: "fixture has no subject" },
  causeChain: [{ code: "TASK_UNHANDLED_FAILURE", summary: "[crm/read-hire-data] TASK_UNHANDLED_FAILURE", role: "primary", transient: false },
    { code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary, role: "secondary", transient: false }],
  remediation: [{ kind: "operator-action", message: "Review recorded evidence." }], sameFingerprintSeen: 1,
  diagnosticBundle: { state: "absent", reason: "fixture has no bundle" }, occurredAt: AT,
} } });

function servedClient(hold?: () => Promise<void>, failed = failure()): DashboardClient & { calls: number } {
  const base = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("unprovided read"); } });
  const client = { ...base, calls: 0,
    runDetail: async (_runId: string, signal?: AbortSignal) => {
      client.calls++;
      await hold?.();
      signal?.throwIfAborted();
      return served();
    },
    runSection: async (_runId: string, section: string) => RunDetailSectionResponseSchema.parse(section === "logs" ? { section: "logs", payload: logs } : failed),
  } as DashboardClient & { calls: number };
  return client;
}

let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); }

describe("Logs of a run that failed in its first step", () => {
  it("settles its read while day frames re-serve the same queue row", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const client = servedClient(() => held);
    let state: ReturnType<typeof useRunWiring> | undefined;
    function Probe({ selection }: { selection: LogSelection }) { state = useRunWiring(client, selection, undefined); return null; }
    await mount(createElement(Probe, { selection: { row: failedRow(), workflowLabel: "Onboarding" } }));
    // Each dashboard-day frame parses a fresh, equal row while the first read is still in flight.
    for (let frame = 0; frame < 3; frame++) await act(async () => root?.render(createElement(Probe, { selection: { row: failedRow(), workflowLabel: "Onboarding" } })));
    await act(async () => { release?.(); await held; });
    assert.equal(state?.state, "loaded");
    assert.equal(client.calls, 1);
  });

  it("lists the planned steps and the failed step's failure card", async () => {
    const client = servedClient();
    await mount(createElement(DashboardClientProvider, { client, children: createElement(LogSample, { selection: { row: failedRow(), workflowLabel: "Onboarding" } }) }));
    const text = document.body.textContent ?? "";
    for (const [, label] of PLANNED) assert.match(text, new RegExp(label, "u"));
    assert.match(text, /Nothing was written|No changes were made/u);
    assert.doesNotMatch(text, /TASK_UNHANDLED_FAILURE|crm\/read-hire-data/u);
  });

  it.each([
    ["verification-failed", "No screenshot: the captured page could not be checked."],
    ["page-closed", "No screenshot: the page had already closed."],
    ["secret-controls-present", "No screenshot: the page showed a password or other secret field."],
    ["lease-ended", "No screenshot: the browser had already been released."],
    ["TimeoutError", "No screenshot: the browser did not respond in time."],
  ])("states why the failed step has no screenshot (%s)", (reason, line) => {
    const card = projectRunLogs({ detail: served(), logs, sections: [failure(`Failure screenshot not taken: ${reason}`)], unavailableEvidence: [] }, { artifactUrl: id => id })
      .steps.flatMap(step => step.entries).find(entry => entry.kind === "decision" && entry.decision.state === "failed");
    assert.ok(card?.kind === "decision");
    assert.equal(card.decision.unavailableCapture, line);
  });

  it("names no screenshot reason when the failed step was captured", () => {
    const captured = failure(); assert.ok(captured.section === "failure" && captured.payload.state === "available");
    const value = { ...captured.payload.value, causeChain: captured.payload.value.causeChain.slice(0, 1) };
    const card = projectRunLogs({ detail: served(), logs, sections: [{ ...captured, payload: { ...captured.payload, value } }], unavailableEvidence: [] }, { artifactUrl: id => id })
      .steps.flatMap(step => step.entries).find(entry => entry.kind === "decision");
    assert.ok(card?.kind === "decision");
    assert.equal(card.decision.unavailableCapture, undefined);
  });

  it("does not repeat the step's capture warning beside the failure card", () => {
    const note = { native: native(5), noteId: "00000000-0000-4000-8000-000000000105", runId: RUN, sequence: 5, at: AT, level: "warning", message: "Screenshot capture unavailable.",
      fields: [{ key: "code", kind: "text", value: "BROWSER_SCREENSHOT_CAPTURE_FAILED" }, { key: "boundary", kind: "text", value: "step" }, { key: "reason", kind: "text", value: "page-closed" }] };
    const page = NotePageSchema.parse({ ...logs, rows: [{ kind: "note", native: note.native, logId: note.noteId, sequence: 5, note }], notes: [note] });
    const text = logPlainText(projectRunLogs({ detail: served(), logs: page, sections: [failure("Failure screenshot not taken: page-closed")], unavailableEvidence: [] }, { artifactUrl: id => id }).steps);
    assert.equal(text.match(/No screenshot/gu)?.length, 1);
    assert.doesNotMatch(text, /Screenshot capture unavailable/u);
  });
});
