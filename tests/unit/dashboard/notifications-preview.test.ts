import { describe, expect, it } from "vitest";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../parity/helpers/fixture-queue.js";
import { FIXTURE_DAY, FIXTURE_NOW } from "../../parity/helpers/fixture-identity.js";
import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { notificationDestinationRefusal, notificationPreviewState } from "../../../src/dashboard/surfaces/notifications/notifications-preview-model.js";
import { applyNotificationReads, notificationView } from "../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { approveMockRun, initialMockDraft, mockRunsForDraft, seedMockRuns } from "../../../src/dashboard/surfaces/workflow-mock-model.js";
import { discardMockReview } from "../../../src/dashboard/surfaces/workflow-review-model.js";

const input = { day: FIXTURE_DAY, nowIso: FIXTURE_NOW, rows: FIXTURE_DAY_WIRE.queueSurfaces, runs: seedMockRuns(), workflowLabel: () => "Person Lookup" };
function ready(state = notificationPreviewState("normal", input)) {
  if (state.state !== "ready") throw new Error("Expected ready notification preview");
  return state;
}
describe("interactive notification destinations", () => {
  it("uses the exact source subjects, workflows, gate and failed/completed runs", () => {
    const state = ready();
    expect(state.items).toHaveLength(5);
    expect(notificationView(state, "all").unread).toBe(3);
    const failed = state.items.find(item => item.id.startsWith("sample-verification:"))!;
    expect(failed).toMatchObject({ subject: "EID 10555001", title: "Run failed", destination: { kind: "run", runId: FIXTURE_IDS.failedRun, day: FIXTURE_DAY } });
    const waiting = state.items.find(item => item.id.startsWith("sample-review:"))!;
    expect(waiting).toMatchObject({ subject: "Blirea, Glaundi", title: "Approval waiting", detail: "Waiting on identity review", destination: { kind: "run", runId: FIXTURE_IDS.openGateRun } });
    for (const item of state.items) expect(notificationDestinationRefusal(item.destination, input)).toBeUndefined();
  });
  it("opens OCR review and reflects approval/discard without changing read state", () => {
    const before = ready();
    const item = before.items.find(item => item.id.startsWith("sample-approval:"))!;
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
    const done = mockRunsForDraft("onboarding", { ...initialMockDraft("onboarding"), text: "new.hire@example.com" }, 51);
    const pending = mockRunsForDraft("emergency-contact", { ...initialMockDraft("emergency-contact"), files: [{ name: "new-contact.pdf", size: 100, digest: "synthetic" }] }, 52);
    const state = ready(notificationPreviewState("normal", { ...input, runs: [...done, ...pending, ...input.runs] }));
    const added = state.items.filter(item => item.id.startsWith("preview:"));
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ subject: "new.hire@example.com", title: "Run completed", detail: "Dry run complete", destination: { kind: "preview-run", runId: done[0].id, records: false } });
    expect(added[1]).toMatchObject({ subject: "new-contact.pdf", title: "Records ready for approval", destination: { kind: "preview-run", runId: pending[1].id, records: true } });
    const read = applyNotificationReads(state, Object.fromEntries(state.items.map(item => [item.id, true])));
    expect(notificationView(read, "all").unread).toBe(0);
    expect(notificationView(read, "attention").shown).not.toHaveLength(0);
  });
  it("refuses deleted, stale-day and invalid records destinations instead of opening another run", () => {
    const state = ready();
    expect(notificationDestinationRefusal(state.items[0].destination, { ...input, rows: [] })).toMatch(/no longer in the queue/);
    expect(notificationDestinationRefusal(state.items[0].destination, { ...input, day: "2026-08-02" })).toMatch(/day is no longer open/);
    expect(notificationDestinationRefusal({ kind: "preview-run", day: FIXTURE_DAY, runId: "missing", records: true }, input)).toMatch(/unavailable/);
    expect(notificationDestinationRefusal({ kind: "preview-run", day: FIXTURE_DAY, runId: "mock:onboarding:sample", records: true }, input)).toMatch(/unavailable/);
    expect(notificationDestinationRefusal({ kind: "archive" }, { ...input, rows: [], runs: [] })).toBeUndefined();
  });
  it("keeps missing data distinct and never invents failed or completed runs for an empty queue", () => {
    expect(notificationPreviewState("normal", { ...input, rows: undefined })).toEqual({ state: "loading" });
    expect(notificationPreviewState("normal", { ...input, unavailable: "Queue unavailable" })).toEqual({ state: "unavailable", reason: "Queue unavailable" });
    const empty = ready(notificationPreviewState("normal", { ...input, rows: [], runs: [] }));
    expect(empty.items.map(item => item.id)).toEqual(["sample-archive"]);
    for (const scenario of ["loading", "unavailable", "empty"]) expect(notificationPreviewState(scenario, input).state).toBe(scenario === "empty" ? "ready" : scenario);
    expect(() => notificationPreviewState("unknown", input)).toThrow("notification-sample-missing");
  });
  it("uses the shared served clock for ages, retaining no invented timestamp for Archive", () => {
    const before = ready();
    const later = ready(notificationPreviewState("normal", { ...input, nowIso: "2026-08-03T11:05:00.000-07:00" }));
    expect(before.items[0].age).toBe("26 min ago");
    expect(later.items[0].age).toBe("1 hr ago");
    expect(before.items.find(item => item.id === "sample-archive")!.age).toBe("");
    const fresh = ready(notificationPreviewState("normal", { ...input, eventTimes: { "mock:emergency-contact:sample:ocr": FIXTURE_NOW } }));
    expect(fresh.items.find(item => item.id.startsWith("sample-approval:"))!.age).toBe("Just now");
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
