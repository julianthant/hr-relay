import { RunIdSchema } from "../../../rules/identity/ids.js";
import type { NotificationItem, NotificationsState } from "./notifications-view-model.js";

const sample: Extract<NotificationsState, { state: "ready" }> = {
  state: "ready",
  pinned: [{ id: "sample-gap", title: "History gap", detail: "Some events could not be recovered. Review the affected history before relying on it. This notice cannot be dismissed or marked read." }],
  items: [
    { id: "sample-verification", title: "Run failed", subject: "EID 10555001", workflow: "Person Lookup", detail: "Cross Verification failed.", tone: "danger", age: "2 min ago", read: false, action: "Open log", destination: { kind: "run", runId: RunIdSchema.parse("00000000-0004-4000-8000-000000000004"), day: "2026-08-03" } },
    { id: "sample-approval", title: "Records ready for approval", subject: "emergency-contact.pdf", workflow: "Emergency Contact", detail: "1 record is ready for review.", tone: "warning", age: "8 min ago", read: false, action: "Review records", destination: { kind: "preview-run", runId: "mock:emergency-contact:sample", day: "2026-08-03", records: true } },
    { id: "sample-completed", title: "Run completed", subject: "EID 10101010", workflow: "Person Lookup", detail: "Completed successfully.", tone: "positive", age: "14 min ago", read: false, action: "Open log", destination: { kind: "run", runId: RunIdSchema.parse("00000000-0003-4000-8000-000000000003"), day: "2026-08-03" } },
    { id: "sample-review", title: "Approval waiting", subject: "Morrow, Bea", workflow: "Person Lookup", detail: "Waiting on identity review.", tone: "warning", age: "35 min ago", read: true, action: "Review run", destination: { kind: "run", runId: RunIdSchema.parse("00000000-0005-4000-8000-000000000005"), day: "2026-08-03" } },
  ],
};
const run = (n: number) => RunIdSchema.parse(`00000000-000${n}-4000-8000-00000000000${n}`);
const settings = (section: "subscription") => ({ kind: "settings", section }) as const;
/** Storage notices have no destination: they live only here. */
const storage = { kind: "none" } as const;
/** Notification centre frames: unread and read items, Today and Earlier. */
const centreItems: NotificationItem[] = [
  { id: "c-disk", kind: "storage", title: "Your disk is full", subject: "", workflow: "", detail: "Free up space; Relay cannot save.", tone: "danger", age: "2 min ago", read: false, action: "", destination: storage },
  { id: "c-limit", kind: "chatgpt", title: "ChatGPT usage limit reached", subject: "", workflow: "", detail: "Runs that read scans wait until 3:40 PM.", tone: "warning", age: "14 min ago", read: false, action: "Open settings", destination: settings("subscription") },
  { id: "c-waiting", kind: "run", title: "Run waiting for you", subject: "Morrow, Bea", workflow: "Person Lookup", detail: "Waiting on identity review.", tone: "warning", age: "35 min ago", read: false, action: "Review run", destination: { kind: "run", runId: run(5), day: "2026-08-03" } },
  { id: "c-failed", kind: "run", title: "Run failed", subject: "EID 10555001", workflow: "Person Lookup", detail: "Cross Verification failed.", tone: "danger", age: "2 hr ago", read: true, action: "Open log", destination: { kind: "run", runId: run(4), day: "2026-08-03" } },
  { id: "c-repair", kind: "storage", title: "Relay repaired a saved file", subject: "", workflow: "", detail: "Nothing needs your attention.", tone: "info", age: "1 days ago", read: true, earlier: true, action: "", destination: storage },
  { id: "c-window", kind: "storage", title: "Relay is open in another window", subject: "", workflow: "", detail: "Close the other Relay.", tone: "warning", age: "2 days ago", read: true, earlier: true, action: "", destination: storage },
  { id: "c-disconnected", kind: "chatgpt", title: "ChatGPT disconnected", subject: "", workflow: "", detail: "Reconnect it in Settings > Subscription.", tone: "danger", age: "3 days ago", read: true, earlier: true, action: "Open settings", destination: settings("subscription") },
  { id: "c-newer", kind: "storage", title: "Your data is newer than this Relay", subject: "", workflow: "", detail: "Update Relay.", tone: "warning", age: "5 days ago", read: true, earlier: true, action: "", destination: storage },
];

export function notificationsSample(scenario: string): NotificationsState {
  if (scenario === "loading") return { state: "loading" };
  if (scenario === "unavailable") return { state: "unavailable", reason: "Notification data could not be loaded." };
  if (scenario === "centre") return { state: "ready", items: centreItems, pinned: [] };
  if (scenario === "centre-earlier") return { state: "ready", items: centreItems.filter(item => item.earlier), pinned: [] };
  if (scenario === "empty") return { state: "ready", items: [], pinned: [] };
  if (["normal", "ping"].includes(scenario)) return sample;
  throw new Error("notification-sample-missing");
}

export const previewNotificationReads: Readonly<Record<string, boolean>> = {
  "mock:emergency-contact:sample:ocr": false,
};
