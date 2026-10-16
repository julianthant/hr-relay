import { RunIdSchema } from "../../../rules/identity/ids.js";
import type { NotificationsState } from "./notifications-view-model.js";

const sample: Extract<NotificationsState, { state: "ready" }> = {
  state: "ready",
  pinned: [{ id: "sample-gap", title: "History gap", detail: "Some events could not be recovered. Review the affected history before relying on it. This notice cannot be dismissed or marked read." }],
  items: [
    { id: "sample-verification", title: "Run failed", subject: "EID 10555001", workflow: "Person Lookup", detail: "Cross Verification failed.", tone: "danger", age: "2 min ago", read: false, action: "Open log", destination: { kind: "run", runId: RunIdSchema.parse("00000000-0004-4000-8000-000000000004"), day: "2026-08-03" } },
    { id: "sample-approval", title: "Records ready for approval", subject: "emergency-contact.pdf", workflow: "OCR", detail: "1 record is ready for review.", tone: "warning", age: "8 min ago", read: false, action: "Review records", destination: { kind: "preview-run", runId: "mock:emergency-contact:sample:ocr", day: "2026-08-03", records: true } },
    { id: "sample-completed", title: "Run completed", subject: "EID 10101010", workflow: "Person Lookup", detail: "Completed successfully.", tone: "positive", age: "14 min ago", read: false, action: "Open log", destination: { kind: "run", runId: RunIdSchema.parse("00000000-0003-4000-8000-000000000003"), day: "2026-08-03" } },
    { id: "sample-review", title: "Approval waiting", subject: "Morrow, Bea", workflow: "Person Lookup", detail: "Waiting on identity review.", tone: "warning", age: "35 min ago", read: true, action: "Review run", destination: { kind: "run", runId: RunIdSchema.parse("00000000-0005-4000-8000-000000000005"), day: "2026-08-03" } },
  ],
};
export function notificationsSample(scenario: string): NotificationsState {
  if (scenario === "loading") return { state: "loading" };
  if (scenario === "unavailable") return { state: "unavailable", reason: "Notification data could not be loaded." };
  if (scenario === "empty") return { state: "ready", items: [], pinned: [] };
  if (["normal", "ping"].includes(scenario)) return sample;
  throw new Error("notification-sample-missing");
}
