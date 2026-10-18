import { describe,expect,it } from "vitest";
import { notificationDestinationRefusal,notificationPreviewState } from "../../../../src/dashboard/surfaces/notifications/notifications-preview-model.js";
import { applyNotificationReads,notificationView } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { approveMockRun,initialMockDraft,mockRunsForDraft,seedMockRuns } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { discardMockReview } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY,FIXTURE_NOW } from "../../../parity/helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "../../../parity/helpers/fixture-queue.js";

const input = { day: FIXTURE_DAY, nowIso: FIXTURE_NOW, anchorIso: FIXTURE_NOW, rows: FIXTURE_DAY_WIRE.queueSurfaces, runs: seedMockRuns(), workflowLabel: () => "Person Lookup" };
function ready(state = notificationPreviewState("normal", input)) {
  if (state.state !== "ready") throw new Error("Expected ready notification preview");
  return state;
}
describe("interactive notification destinations", () => {
  it("uses the exact source subjects, workflows, gate and failed/completed runs", () => {
    const state = ready();
    expect(state.items).toHaveLength(13);
    expect(state.items.some(item => item.id === "sample-archive")).toBe(false);
    expect(notificationView(state, "all").unread).toBe(3);
    const failed = state.items.find(item => item.destination.kind === "run" && item.destination.runId === FIXTURE_IDS.failedRun)!;
    expect(failed).toMatchObject({ subject: "EID 10555001", title: "Run failed", destination: { kind: "run", runId: FIXTURE_IDS.failedRun, day: FIXTURE_DAY } });
    const waiting = state.items.find(item => item.destination.kind === "run" && item.destination.runId === FIXTURE_IDS.openGateRun)!;
    expect(waiting).toMatchObject({ subject: "Morrow, Bea", title: "Approval waiting", detail: "Waiting on identity review", destination: { kind: "run", runId: FIXTURE_IDS.openGateRun } });
    for (const item of state.items) expect(notificationDestinationRefusal(item.destination, input)).toBeUndefined();
  });
  it("connects every relevant top-level queue row, including groups and parked writes", () => {
    const state = ready();
    const linked = state.items.flatMap(item => item.destination.kind === "run" ? [item.destination.runId] : []);
    expect(new Set(linked)).toEqual(new Set([
      FIXTURE_IDS.failedRun, FIXTURE_IDS.doneRun, FIXTURE_IDS.openGateRun, FIXTURE_IDS.parkedRun,
      FIXTURE_IDS.partialRun, FIXTURE_IDS.groupOf4, FIXTURE_IDS.groupOf12, FIXTURE_IDS.groupOf13,
    ]));
    expect(linked).toHaveLength(8);
    expect(state.items.find(item => item.subject === "EID 10777012")).toMatchObject({ title: "Write parked", tone: "warning", detail: "A write to UCPath is parked pending proof" });
    expect(state.items.find(item => item.subject === "Rehire eligibility sweep")).toMatchObject({ title: "Approval waiting", action: "Review run", destination: { kind: "run", runId: FIXTURE_IDS.groupOf4 } });
    expect(state.items.find(item => item.subject === "EID 10333015")).toMatchObject({ title: "Run completed with issues", tone: "warning", detail: "CRM separation dates were replayed from a checkpoint older than the freshness limit" });
    expect(state.items.some(item => item.subject === "Tran, Bao")).toBe(false);
    expect(state.items.some(item => item.subject === "Battistessa, Johnnie")).toBe(false);
  });
  it("links all five OCR documents with queue review counts and removes deleted targets", () => {
    const state = ready();
    const documents = state.items.filter(item => item.destination.kind === "preview-run");
    expect(documents.map(item => [item.subject, item.detail])).toEqual([
      ["single-oath.pdf", "1 of 1 records ready for approval"],
      ["multiple-oath.pdf", "4 of 4 records ready for approval"],
      ["emergency-contacts.pdf", "3 of 3 records ready for approval"],
      ["detect-test.pdf", "3 of 4 records ready for approval"],
      ["i9.pdf", "2 of 2 records ready for approval"],
    ]);
    for (const item of documents) expect(item).toMatchObject({ workflow: "OCR", action: "Review records", destination: { kind: "preview-run", records: true } });
    const missing = ready(notificationPreviewState("normal", { ...input, rows: input.rows.filter(row => row.runId !== FIXTURE_IDS.parkedRun), runs: input.runs.filter(run => run.workflowId !== "ocr") }));
    expect(missing.items.some(item => item.subject === "EID 10777012" || item.workflow === "OCR")).toBe(false);
    expect(state.items.some(item => item.subject === "sick-hours.pdf")).toBe(false);
  });
  it("keeps read identity when queue order or a run's status changes", () => {
    const before = ready();
    const reads = Object.fromEntries(before.items.map(item => [item.id, true]));
    const rows = [...input.rows].reverse().map(row => row.runId === FIXTURE_IDS.partialRun ? QueueSurfaceWireSchema.parse({ ...row, status: "done" }) : row);
    const after = ready(notificationPreviewState("normal", { ...input, rows, runs: [...input.runs].reverse() }));
    expect(new Set(after.items.map(item => item.id))).toEqual(new Set(before.items.map(item => item.id)));
    expect(notificationView(applyNotificationReads(after, reads), "unread").shown).toEqual([]);
  });
  it("opens OCR review and reflects approval/discard without changing read state", () => {
    const before = ready();
    const item = before.items.find(item => item.destination.kind === "preview-run" && item.destination.runId === "mock:emergency-contact:sample:ocr")!;
    expect(item.destination).toEqual({ kind: "preview-run", runId: "mock:emergency-contact:sample:ocr", day: FIXTURE_DAY, records: true });
    const approved = ready(notificationPreviewState("normal", { ...input, runs: approveMockRun(input.runs, item.destination.kind === "preview-run" ? item.destination.runId : "") }));
    expect(approved.items.find(row => row.id === item.id)).toMatchObject({ title: "Records approved", tone: "positive", action: "View records", read: false });
    expect(notificationView(approved, "attention").shown.map(row => row.id)).not.toContain(item.id);
    const discarded = ready(notificationPreviewState("normal", { ...input, runs: discardMockReview(input.runs, "mock:emergency-contact:sample:ocr") }));
    expect(discarded.items.find(row => row.id === item.id)).toMatchObject({ title: "Records discarded", tone: "info", action: "View records" });
    const read = applyNotificationReads(before, { [item.id]: true });
    expect(notificationView(read, "attention").shown.map(row => row.id)).toContain(item.id);
    expect(notificationView(applyNotificationReads(approved, { [item.id]: true }), "all").unread).toBe(2);
  });
  it("adds notifications for new completed runs and delegated OCR approvals, not unfinished parents", () => {
    const done = mockRunsForDraft("onboarding", { ...initialMockDraft("onboarding"), text: "new.hire@example.com", dryRun: true }, 51);
    const pending = mockRunsForDraft("emergency-contact", { ...initialMockDraft("emergency-contact"), files: [{ name: "new-contact.pdf", size: 100, digest: "synthetic" }] }, 52);
    const state = ready(notificationPreviewState("normal", { ...input, runs: [...done, ...pending, ...input.runs] }));
    const added = state.items.filter(item => { const destination = item.destination; return destination.kind === "preview-run" && [...done, ...pending].some(run => run.id === destination.runId); });
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ subject: "new.hire@example.com", title: "Run completed", detail: "Dry run complete", destination: { kind: "preview-run", runId: done[0].id, records: false } });
    expect(added[1]).toMatchObject({ subject: "new-contact.pdf", title: "Records ready for approval", destination: { kind: "preview-run", runId: pending[1].id, records: true } });
    const read = applyNotificationReads(state, Object.fromEntries(state.items.map(item => [item.id, true])));
    expect(notificationView(read, "all").unread).toBe(0);
    expect(notificationView(read, "attention").shown).not.toHaveLength(0);
  });
  it("refuses deleted, stale-day and invalid records destinations instead of opening another run", () => {
    const state = ready();
    expect(notificationDestinationRefusal(state.items[0].destination, { ...input, rows: [] })).toMatch(/no longer available/);
    expect(notificationDestinationRefusal(state.items[0].destination, { ...input, day: "2026-08-02" })).toMatch(/day is no longer open/);
    expect(notificationDestinationRefusal({ kind: "preview-run", day: FIXTURE_DAY, runId: "missing", records: true }, input)).toMatch(/unavailable/);
    expect(notificationDestinationRefusal({ kind: "preview-run", day: FIXTURE_DAY, runId: "mock:onboarding:sample", records: true }, input)).toMatch(/unavailable/);
    expect(state.items.every(item => item.destination.kind === "run" || item.destination.kind === "preview-run")).toBe(true);
  });
  it("keeps missing data distinct and never invents failed or completed runs for an empty queue", () => {
    expect(notificationPreviewState("normal", { ...input, rows: undefined })).toEqual({ state: "loading" });
    expect(notificationPreviewState("normal", { ...input, unavailable: "Queue unavailable" })).toEqual({ state: "unavailable", reason: "Queue unavailable" });
    const empty = ready(notificationPreviewState("normal", { ...input, rows: [], runs: [] }));
    expect(empty.items).toEqual([]);
    for (const scenario of ["loading", "unavailable", "empty"]) expect(notificationPreviewState(scenario, input).state).toBe(scenario === "empty" ? "ready" : scenario);
    expect(() => notificationPreviewState("unknown", input)).toThrow("notification-sample-missing");
  });
  it("uses the shared served clock for ages and omits the retired Archive shortcut", () => {
    const before = ready();
    const later = ready(notificationPreviewState("normal", { ...input, nowIso: "2026-08-03T11:05:00.000-07:00" }));
    expect(before.items.find(item => item.title === "Run failed")!.age).toBe("26 min ago");
    expect(later.items.find(item => item.title === "Run failed")!.age).toBe("1 hr ago");
    expect(before.items.some(item => item.id === "sample-archive")).toBe(false);
    const fresh = ready(notificationPreviewState("normal", { ...input, eventTimes: { "mock:emergency-contact:sample:ocr": FIXTURE_NOW } }));
    expect(fresh.items.find(item => item.destination.kind === "preview-run" && item.destination.runId === "mock:emergency-contact:sample:ocr")!.age).toBe("Just now");
    expect(() => notificationPreviewState("normal", { ...input, nowIso: "invalid" })).toThrow("NOTIFICATION_PREVIEW_TIME_INVALID");
  });
  it("keeps read overrides attached to the exact run and day", () => {
    const before = ready();
    const reads = Object.fromEntries(before.items.map(item => [item.id, true]));
    const nextDay = ready(notificationPreviewState("normal", { ...input, day: "2026-08-02" }));
    expect(notificationView(applyNotificationReads(nextDay, reads), "all").unread).toBe(3);
    const failed = input.rows.find(row => row.runId === FIXTURE_IDS.failedRun)!;
    const anotherRun = QueueSurfaceWireSchema.parse({ ...failed, runId: "00000000-9904-4000-8000-000000009904", title: "Another failed run" });
    const changed = ready(notificationPreviewState("normal", { ...input, rows: input.rows.map(row => row === failed ? anotherRun : row) }));
    expect(notificationView(applyNotificationReads(changed, reads), "unread").shown.map(item => item.subject)).toEqual(["Another failed run"]);
  });
});
