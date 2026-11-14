// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../src/models/config/person-preferences.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { RunDetailWireSchema, NotePageSchema } from "../../../src/models/dashboard/run-detail.js";
import { parseViewRoute } from "../../../src/dashboard/app/navigation/view-route-model.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../mocks/helpers/workflow-composition.js";
import { queueParentFixture } from "../../support/helpers/dashboard/queue-parent-fixture.js";
import { ocrReviewPageFixture } from "../../support/fixtures/dashboard/ocr-review.js";

it("opens shared-lookup records through real routes and keyboard selection without using a record key as a run ID", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const source = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "operation"); assert.ok(source?.surfaceKind === "operation");
  const original = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === source.memberRunIds[0]); assert.ok(original);
  const page = ocrReviewPageFixture(original.runId); assert.ok(page.ocr);
  const records = page.ocr.revision.records;
  const lookupRunId = "00000000-0000-4000-8000-000000000998";
  const recordMembers = { runIds: [lookupRunId], members: records.map((record, index) => ({ kind: "record", record: { runId: original.runId, recordId: record.recordId },
    title: index === 0 ? "Example, Avery" : "Example, Robin", status: "awaiting-approval", statusLabel: "Needs lookup", childRunIds: [lookupRunId],
    target: { runId: original.runId, workflowId: "ocr", partitionDay: FIXTURE_DAY_WIRE.day, label: "OCR", status: "awaiting-approval", panelKind: "review", section: "review",
      record: { runId: original.runId, recordId: record.recordId } } })) };
  const parent = QueueSurfaceWireSchema.parse({ ...source, recordMembers, linkedRuns: [{ runId: original.runId, workflowId: "ocr", label: "OCR",
    partitionDay: FIXTURE_DAY_WIRE.day, status: "awaiting-approval", panelKind: "review" }] });
  const owner = QueueSurfaceWireSchema.parse({ ...original, workflowId: "ocr", surfaceKind: "operation", recordMembers,
    parent: queueParentFixture(source.runId, { visibility: "linked" }), panelKind: "review", availableSections: ["logs", "review"],
    memberRunIds: [], memberRollup: { total: 0, terminal: 0, failed: 0 }, memberPreview: { state: "absent", reason: "No native inline children" } });
  const day = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: [parent, owner], attemptHistory: undefined });
  const detail = RunDetailWireSchema.parse({ runId: owner.runId, rowRevision: owner.rowRevision, panelKind: "review", header: {
    runId: owner.runId, workflowId: owner.workflowId, traceId: owner.traceId, attempt: owner.attempt, title: owner.title, status: owner.status },
    timeline: { steps: [], events: [] }, gate: { state: "absent", reason: "Fixture read" }, outcome: { state: "absent", reason: "Fixture read" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "Not captured" }, availableSections: ["logs", "review"] });
  const logs = NotePageSchema.parse({ runId: owner.runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
  const { app } = createFixtureBff();
  const requestedRuns: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path.includes("/runs/")) {
      requestedRuns.push(path.split("/runs/")[1].split("/")[0]);
      return Response.json(path.endsWith("/review") ? { section: "review", payload: page } : path.endsWith("/logs") ? { section: "logs", payload: logs } : detail);
    }
    if (url.includes("/events/v1?")) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const messages = [{ type: "hello", wireVersion: 1, descriptorHash: day.descriptorHash, projectionGeneration: day.projectionGeneration, cursor: day.snapshotCursor },
        { type: "snapshot", topic: "dashboard-day", cursor: day.snapshotCursor, payload: day }];
      for (const message of messages) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`));
      init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
    } }), { headers: { "content-type": "text/event-stream" } });
    if (path.endsWith("/dashboard")) return Response.json(day);
    return app.request(url, init);
  } });
  window.history.replaceState(null, "", `/?day=${day.day}`);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, {
      workflowComposition: MOCK_WORKFLOW_COMPOSITION, previewPreferences: createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, workflowPanelMode: "sidebar" }),
    }) })));
    await vi.waitFor(() => assert.ok(host.querySelector(`[data-queue-record-id="${records[0].recordId}"]`)));
    await act(async () => host.querySelector<HTMLElement>(`[data-queue-record-id="${records[0].recordId}"]`)?.click());
    await vi.waitFor(() => assert.equal(document.activeElement?.closest<HTMLElement>("[data-review-record-id]")?.dataset.reviewRecordId, records[0].recordId));
    const readSelection = () => {
      const query = new URLSearchParams(window.location.search);
      assert.equal(query.get("run"), owner.runId); assert.equal(query.get("section"), "review");
      return parseViewRoute(query.get("view"))?.queueMember;
    };
    assert.deepEqual(readSelection(), { kind: "record", record: { runId: owner.runId, recordId: records[0].recordId } });
    // Review records is a dialog; queue shortcuts resume once it closes.
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await vi.waitFor(() => assert.equal(document.querySelector('[role="dialog"][data-state="open"]'), null));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true })));
    await vi.waitFor(() => assert.deepEqual(readSelection(), { kind: "record", record: { runId: owner.runId, recordId: records[1].recordId } }));
    assert.ok(requestedRuns.length > 0); assert.ok(requestedRuns.every(runId => runId === owner.runId));
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.clear(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); }
});
