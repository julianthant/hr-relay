import type { NotificationsState } from "./notifications-view-model.js";

const sample: Extract<NotificationsState, { state: "ready" }> = {
  state: "ready",
  pinned: [{ id: "sample-gap", title: "History gap", detail: "Some events could not be recovered. Review the affected history before relying on it. This notice cannot be dismissed or marked read." }],
  items: [
    { id: "sample-verification", title: "Document verification failed", subject: "Casey Rivera", workflow: "Separations", detail: "The saved Kuali document did not match the staged values. Review the log before taking the next action.", tone: "danger", age: "2 min ago", read: false, action: "Open log" },
    { id: "sample-approval", title: "Approval waiting", subject: "Jordan Lee", workflow: "Person lookup", detail: "An employee match needs your review. The workflow is paused at the approval step.", tone: "warning", age: "8 min ago", read: false, action: "Review run" },
    { id: "sample-completed", title: "Separation completed", subject: "Alex Morgan", workflow: "Separations", detail: "UCPath termination and the saved Kuali document were verified.", tone: "positive", age: "14 min ago", read: false, action: "Open log" },
    { id: "sample-archive", title: "Archive ready", subject: "September 25", workflow: "Archive", detail: "The previous day is available in Archive.", tone: "info", age: "1 hr ago", read: true, action: "Open archive" },
    { id: "sample-review", title: "Run waiting for review", subject: "Taylor Park", workflow: "Separations", detail: "Review the employee identity before this run continues.", tone: "warning", age: "35 min ago", read: true, action: "Review run" },
  ],
};
export function notificationsSample(scenario: string): NotificationsState {
  if (scenario === "loading") return { state: "loading" };
  if (scenario === "unavailable") return { state: "unavailable", reason: "Notification data could not be loaded." };
  if (scenario === "empty") return { state: "ready", items: [], pinned: [] };
  if (["normal", "ping"].includes(scenario)) return sample;
  throw new Error("notification-sample-missing");
}
