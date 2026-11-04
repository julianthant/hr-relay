import { CommandExecutor } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest, type CommandResult } from "../../../src/rules/commands/commands.js";
import { OcrReviewRevisionSchema, OcrApprovedSnapshotSchema, ocrReviewDigest } from "../../../src/models/ocr/review.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../src/dashboard/state/client-context.js";
import { readRunReview } from "../../../src/dashboard/state/review-wiring-adapter.js";
import { RunReview } from "../../../src/dashboard/surfaces/run-detail/review/review.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { ReviewPageSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
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
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

it("focuses a newly selected run even when the same document record ID appears in both runs", async () => {
  let selected = selection();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async input => Response.json(
    String(input).endsWith("/review") ? { section: "review", payload: ocrReviewPageFixture(selected.row.runId) } : detail(selected)) });
  const host = document.createElement("div"), outside = document.createElement("button"); document.body.append(host, outside); root = createRoot(host);
  const render = () => createElement(DashboardClientProvider, { client, children: createElement(RunReview, { selection: selected }) });
  await act(async () => root?.render(render()));
  await vi.waitFor(() => assert.ok(document.activeElement?.hasAttribute("data-ocr-review-heading")));
  outside.focus();
  selected = { ...selected, row: QueueSurfaceWireSchema.parse({ ...selected.row, runId: "00000000-0000-4000-8000-000000000997" }) };
  await act(async () => root?.render(render()));
  await vi.waitFor(() => assert.ok(document.activeElement?.hasAttribute("data-ocr-review-heading")));
});

function editorWorld(unknownOnce = false, delegated = true) {
  let runVersion = 1;
  let page = ocrReviewPageFixture(); assert.ok(page.ocr);
  page = ReviewPageSchema.parse({ ...page, ocr: { ...page.ocr, editing: { state: "available", runVersion },
    ...(delegated ? { approval: { runId: page.runId, gateId: "approve-records", expectedVersion: runVersion } } : {}) } });
  const commands: CommandRequest[] = [], recorded = new Map<string, { request: CommandRequest; result: CommandResult }>();
  let loseReply = unknownOnce;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (init?.method === "POST") {
      const body = init.body; assert.ok(typeof body === "string");
      const request = CommandRequestSchema.parse(JSON.parse(body)); commands.push(request);
      assert.ok(page.ocr);
      if (request.family === "ocr-review") {
        assert.equal(request.target.expectedRevision, page.ocr.revision.revision);
        const revision = OcrReviewRevisionSchema.parse({ ...page.ocr.revision, revision: request.target.expectedRevision + 1,
          id: `${page.runId}#${request.target.expectedRevision + 1}`, createdAt: request.requestedAt, origin: { kind: "command", commandId: request.commandId },
          records: page.ocr.revision.records.map(record => record.recordId !== request.payload.recordId ? record : request.type === "correct-ocr-record"
            ? { ...record, ...request.payload } : { ...record, discarded: request.type === "discard-ocr-record" }) });
        runVersion++;
        page = ReviewPageSchema.parse({ ...page, ocr: { ...page.ocr, revision, digest: ocrReviewDigest(revision), editing: { state: "available", runVersion },
          ...(delegated ? { approval: { runId: page.runId, gateId: "approve-records", expectedVersion: runVersion } } : {}) } });
      } else {
        assert.ok(request.family === "gate" && request.payload.ocrApproval);
        const approved = request.payload.ocrApproval;
        const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: request.commandId, sourceRunId: page.runId, revision: approved.expectedRevision,
          reviewDigest: approved.reviewDigest, selectedRecordIds: approved.selectedRecordIds,
          records: approved.selectedRecordIds.map(id => page.ocr?.revision.records.find(record => record.recordId === id)), approvedBy: request.requestedBy, approvedAt: request.requestedAt });
        runVersion++;
        const { approval: _approval, ...review } = page.ocr;
        page = ReviewPageSchema.parse({ ...page, ocr: { ...review, approvedSnapshots: [snapshot], editing: { state: "unavailable", reason: "approved" } } });
      }
      const result = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [request.family === "gate" ? { family: "gate", runId: page.runId, gateId: request.target.gateId } : { family: "ocr-review", runId: page.runId }, { family: "run", runId: page.runId }] });
      recorded.set(request.commandId, { request, result });
      if (loseReply) { loseReply = false; throw new TypeError("Synthetic lost response after commit"); }
      return Response.json(result);
    }
    if (path.endsWith("/review")) return Response.json({ section: "review", payload: page });
    if (path.includes("/ocr/commands/")) {
      const value = recorded.get(path.split("/").at(-1) ?? "");
      return Response.json(value === undefined ? { state: "unavailable" } : { state: "recorded", ...value });
    }
    return Response.json(detail(selection(runVersion)));
  } });
  const epoch = { client, bootstrap: FIXTURE_BOOTSTRAP }, day = FIXTURE_DAY_WIRE.day;
  const dayRequest = { client, day, epoch };
  const scope = { actorId: "local-operator", client, authority: epoch, dayRequest };
  let refresh: () => void = () => undefined;
  let refreshPaused = false;
  const binding: DashboardCommandBinding = { scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
    authority: { epoch, catalog: [], nowIso: FIXTURE_BOOTSTRAP.serverClock.now, today: day, day,
      dayState: { request: dayRequest, day: { state: "loaded", value: FIXTURE_DAY_WIRE }, connection: { state: "connecting" },
        refresh: () => { if (!refreshPaused) refresh(); }, subscribePublications: () => () => undefined }, selection: { route: { start: false }, workflowId: "ocr" } } };
  function Harness() {
    const [revision, setRevision] = useState(runVersion);
    refresh = () => setRevision(runVersion);
    return createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(RunReview, { selection: selection(revision) }) }) });
  }
  return { client, binding, commands, Harness, page: () => page, pauseRefresh: () => { refreshPaused = true; },
    resumeRefresh: () => { refreshPaused = false; refresh(); }, externalChange: () => {
    assert.ok(page.ocr);
    runVersion++;
    page = ocrReviewPageFixture(page.runId, page.ocr.revision.revision + 1);
    assert.ok(page.ocr);
    page = ReviewPageSchema.parse({ ...page, ocr: { ...page.ocr, editing: { state: "available", runVersion },
      ...(delegated ? { approval: { runId: page.runId, gateId: "approve-records", expectedVersion: runVersion } } : {}) } });
    refresh();
  } };
}

async function mountEditor(h: ReturnType<typeof editorWorld>) {
  vi.useFakeTimers();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(h.Harness)));
  await vi.waitFor(() => assert.ok(host.querySelector<HTMLInputElement>('input[name="contact.name"]')));
  return host;
}
function changeInput(host: HTMLElement, key: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${key}"]`); assert.ok(input);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); assert.ok(descriptor !== undefined && typeof descriptor.set === "function");
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function saveEdits() { await act(async () => { await vi.advanceTimersByTimeAsync(450); }); }
function button(host: HTMLElement, label: string) {
  const target = [...host.querySelectorAll("button")].find(button => button.textContent === label); assert.ok(target); return target;
}

it("coalesces existing-record edits, confirms revision readback before approval and freezes approved inputs", async () => {
  const h = editorWorld(), host = await mountEditor(h);
  assert.equal(host.textContent?.includes("Add record"), false);
  await act(async () => {
    changeInput(host, "contact.name", "Draft"); changeInput(host, "contact.name", "Edited Contact");
    changeInput(host, "employee.employeeId", "10800000");
  });
  assert.equal(button(host, "Approve records").disabled, true);
  await saveEdits();
  assert.equal(h.commands.length, 1);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.value, "Edited Contact");
  const request = h.commands[0]; assert.ok(request.family === "ocr-review" && request.type === "correct-ocr-record");
  assert.equal(request.payload.assertedEid, "10800000");
  assert.equal(request.payload.fields.answers.find(answer => answer.path === "contact.name")?.state, "read");
  const second = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]; assert.ok(second);
  assert.equal(second.disabled, false);
  await act(async () => second.click());
  assert.equal(second.getAttribute("aria-checked"), "false");
  assert.equal(button(host, "Approve records").disabled, true);
  await saveEdits();
  assert.equal(h.commands.length, 2);
  assert.equal(button(host, "Approve records").disabled, false);
  await act(async () => button(host, "Approve records").click());
  assert.equal(h.commands.length, 3);
  assert.equal(host.querySelectorAll("input").length, 0);
  assert.equal(h.page().ocr?.approvedSnapshots[0].records.length, 1);
});

it("retains an uncertain save across remount and checks its original command without sending it again", async () => {
  const h = editorWorld(true, false); let host = await mountEditor(h);
  assert.equal([...host.querySelectorAll("button")].some(button => button.textContent === "Approve records"), false);
  await act(async () => changeInput(host, "contact.name", "Retained Edit"));
  await saveEdits();
  assert.ok(button(host, "Check result"));
  assert.equal(h.commands.length, 1);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.disabled, true);
  await act(async () => root?.unmount()); root = undefined; host.remove();
  host = await mountEditor(h);
  await saveEdits();
  assert.ok(button(host, "Check result"));
  await act(async () => button(host, "Check result").click());
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.disabled, false);
  assert.equal(h.commands.length, 1);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.value, "Retained Edit");
});

it("keeps zero selections editable and restores only the records selected at footer Discard", async () => {
  const h = editorWorld(), host = await mountEditor(h);
  await act(async () => changeInput(host, "employee.employeeId", "10800000")); await saveEdits();
  const selections = () => [...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
  await act(async () => selections()[1].click()); await saveEdits();
  await act(async () => selections()[0].click()); await saveEdits();
  assert.equal(button(host, "Approve records").disabled, true);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.disabled, false);
  await act(async () => selections()[0].click()); await saveEdits();
  await act(async () => button(host, "Discard").click()); await saveEdits();
  assert.equal(host.querySelectorAll("input").length, 0);
  const cards = host.querySelector('[aria-label="Record review cards"]'); assert.ok(cards);
  await act(async () => cards.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
  await saveEdits();
  assert.equal(selections()[0].getAttribute("aria-checked"), "true");
  assert.equal(selections()[1].getAttribute("aria-checked"), "false");
  assert.equal(button(host, "Approve records").disabled, false);
  assert.deepEqual(h.commands.map(request => request.type), ["correct-ocr-record", "discard-ocr-record", "discard-ocr-record", "restore-ocr-record", "discard-ocr-record", "restore-ocr-record"]);
});

it("starts a new draft from a refreshed review after an earlier save has settled", async () => {
  const h = editorWorld(), host = await mountEditor(h);
  await act(async () => changeInput(host, "contact.name", "First Edit")); await saveEdits();
  await act(async () => h.externalChange());
  await act(async () => changeInput(host, "contact.name", "Current Edit")); await saveEdits();
  assert.equal(h.commands.length, 2);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.value, "Current Edit");
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.disabled, false);
});

it("holds selection and approval closed until the displayed revision reaches confirmed native readback", async () => {
  const h = editorWorld(), host = await mountEditor(h);
  h.pauseRefresh();
  const second = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]; assert.ok(second);
  await act(async () => second.click()); await saveEdits();
  assert.equal(h.commands.length, 1);
  assert.equal(second.disabled, true);
  assert.equal(button(host, "Approve records").disabled, true);
  await act(async () => second.click()); await saveEdits();
  assert.equal(h.commands.length, 1);
  await act(async () => h.resumeRefresh());
  assert.equal(second.getAttribute("aria-checked"), "false");
  assert.equal(second.disabled, false);
});

it("retains draft text and refuses automatic rebasing when another review revision wins", async () => {
  const h = editorWorld(), host = await mountEditor(h);
  await act(async () => changeInput(host, "contact.name", "Unsent Draft"));
  await act(async () => h.externalChange());
  await saveEdits();
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.disabled, true);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.value, "Unsent Draft");
  assert.equal(h.commands.length, 0);
  assert.equal(button(host, "Approve records").disabled, true);
});

it("keeps another client and person epoch separate from a retained uncertain edit on the same run ID", async () => {
  const first = editorWorld(true); let host = await mountEditor(first);
  await act(async () => changeInput(host, "contact.name", "Earlier Session"));
  await saveEdits(); assert.ok(button(host, "Check result"));
  await act(async () => root?.unmount()); root = undefined; host.remove();
  const next = editorWorld(); host = await mountEditor(next);
  assert.equal(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.disabled, false);
  assert.notEqual(host.querySelector<HTMLInputElement>('input[name="contact.name"]')?.value, "Earlier Session");
  assert.equal([...host.querySelectorAll("button")].some(button => button.textContent === "Check result"), false);
  assert.equal(first.commands.length, 1); assert.equal(next.commands.length, 0);
});
