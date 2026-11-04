// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { readRunReview } from "../../../src/dashboard/state/review-wiring-adapter.js";
import { RunReview } from "../../../src/dashboard/surfaces/run-detail/review/review.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";
import { ocrReviewPageFixture } from "../../support/fixtures/dashboard/ocr-review.js";
import { SOURCE_RUN_ID } from "../../support/fixtures/ocr/source-pages.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

function selection(revision = 1) {
  const base = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "single"); assert.ok(base);
  return { row: QueueSurfaceWireSchema.parse({ ...base, runId: SOURCE_RUN_ID, workflowId: "ocr", parent: null,
    status: "running", title: "Synthetic source", rowRevision: revision, actions: [], panelKind: "review", availableSections: ["logs", "review"],
    endedAt: { state: "absent", reason: "Running" }, gateOpenedAt: { state: "absent", reason: "No gate" } }), workflowLabel: "OCR" };
}
function detail(selected = selection()) {
  const row = selected.row;
  return RunDetailWireSchema.parse({ runId: row.runId, rowRevision: row.rowRevision, panelKind: "review",
    header: { runId: row.runId, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: row.status, attempt: row.attempt },
    timeline: { steps: [], events: [] }, gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Running" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs", "review"] });
}

it("opens the exact stable record, retains operator focus on refresh, and retries a changed source image", async () => {
  let revision = 1;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async input => Response.json(
    String(input).endsWith("/review") ? { section: "review", payload: ocrReviewPageFixture(SOURCE_RUN_ID, revision) } : detail(selection(revision))) });
  const record = ocrReviewPageFixture().ocr?.revision.records[1]; assert.ok(record);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = () => createElement(DashboardClientProvider, { client,
    children: createElement(RunReview, { selection: selection(revision), focus: { runId: SOURCE_RUN_ID, recordId: record.recordId } }) });
  await act(async () => root?.render(render()));
  await vi.waitFor(() => assert.equal(document.activeElement?.closest<HTMLElement>("[data-review-record-id]")?.dataset.reviewRecordId, record.recordId));
  const cards = [...host.querySelectorAll<HTMLElement>("[data-review-record-id]")];
  assert.equal(cards.length, 2);
  const firstHeading = cards[0].querySelector<HTMLElement>("[data-ocr-review-heading]"); assert.ok(firstHeading);
  firstHeading.focus();
  const image = cards[1].querySelector("img"); assert.ok(image);
  await act(async () => image.dispatchEvent(new Event("error")));
  assert.match(cards[1].textContent ?? "", /Source page unavailable/u);
  revision = 2;
  await act(async () => root?.render(render()));
  await vi.waitFor(() => assert.ok(cards[1].querySelector<HTMLImageElement>("img")?.src.includes("revision=2")));
  assert.equal(document.activeElement, firstHeading);
  assert.equal(host.querySelectorAll('input:not([disabled])').length, 0);
  assert.doesNotMatch(host.textContent ?? "", /Approved/u);
});

it("refuses foreign record focus and a mismatched detail revision without selecting another person", async () => {
  const selected = selection();
  let detailRevision = selected.row.rowRevision + 1;
  let sectionReads = 0;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async input => {
    if (String(input).endsWith("/review")) { sectionReads++; return Response.json({ section: "review", payload: ocrReviewPageFixture() }); }
    return Response.json({ ...detail(selected), rowRevision: detailRevision });
  } });
  await assert.rejects(readRunReview(client, selected, new AbortController().signal), /RUN_REVIEW_IDENTITY_MISMATCH/u);
  assert.equal(sectionReads, 0);
  detailRevision = selected.row.rowRevision;
  const record = ocrReviewPageFixture().ocr?.revision.records[1]; assert.ok(record);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(RunReview, { selection: selected, focus: { runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000999"), recordId: record.recordId } }) })));
  await vi.waitFor(() => assert.match(host.textContent ?? "", /Record unavailable/u));
  assert.equal(host.querySelectorAll("[data-review-record-id]").length, 0);
});
