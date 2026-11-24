/** Fixtures for the sessions and notifications state stories: one worker per state, one browser per state, one notice per tone and kind. */
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import type { SessionBrowserState, SessionNode, SessionWorker, SessionWorkerState } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import type { SessionPreviewOperation } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import type { NotificationItem, NotificationKind, NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";

export const SESSION_STORY_WORKFLOWS = [{ id: "separations", label: "Separations" }, { id: "person-lookup", label: "Person Lookup" }] as const;

const NODES = [["identity-check", "Identity check"], ["kronos-timecard", "Kronos timecard"], ["kuali-extraction", "Kuali extraction"]] as const;
const timeline = (completed: number, state: SessionNode["state"]): readonly SessionNode[] =>
  NODES.map(([id, label], index) => ({ id, label, state: index < completed ? "completed" : index === completed ? state : "pending" }));

const browser = (id: string, label: string, state: SessionBrowserState) => ({ id, label, state });
const READY_BROWSERS = [browser("kuali", "Kuali", "ready"), browser("ucpath", "UCPath", "ready")];
const BASE = { workflowId: "separations", workflow: "Separations", subject: "Alex Morgan", elapsed: "2m 14s" } as const;

/** A worker in each state a card can show, with the run, step and reason that state carries. */
export const SESSION_WORKER_BY_STATE: Readonly<Record<SessionWorkerState, SessionWorker>> = {
  running: { ...BASE, id: "worker-running", label: "Worker 1", state: "running", action: "Kronos timecard", timeline: timeline(1, "active"), browsers: [browser("kuali", "Kuali", "ready"), browser("ucpath", "UCPath", "ready"), browser("kronos", "Kronos", "active")] },
  starting: { ...BASE, id: "worker-starting", label: "Worker 2", state: "starting", elapsed: "12s", action: "Open browser sessions", timeline: timeline(0, "active"), browsers: [browser("kuali", "Kuali", "ready"), browser("ucpath", "UCPath", "starting")] },
  idle: { id: "worker-idle", label: "Worker 3", workflowId: "person-lookup", workflow: "Person Lookup", state: "idle", action: "Ready for the next run", browsers: READY_BROWSERS },
  waiting: { ...BASE, id: "worker-waiting", label: "Worker 4", state: "waiting", action: "Identity check", note: "Signing in", timeline: timeline(0, "waiting"), browsers: [browser("kuali", "Kuali", "needs-duo"), browser("ucpath", "UCPath", "signed-out")] },
  paused: { ...BASE, id: "worker-paused", label: "Worker 5", state: "paused", action: "Kronos timecard", timeline: timeline(1, "paused"), browsers: READY_BROWSERS },
  stopped: { ...BASE, id: "worker-stopped", label: "Worker 6", state: "stopped", action: "Kronos timecard", problem: "You stopped this worker.", timeline: timeline(1, "paused"), browsers: [browser("kuali", "Kuali", "closed"), browser("ucpath", "UCPath", "closed")] },
  failed: { ...BASE, id: "worker-failed", label: "Worker 7", state: "failed", action: "Kronos timecard", problem: "Worker stopped unexpectedly.", timeline: timeline(1, "failed"), browsers: [browser("kuali", "Kuali", "closed"), browser("ucpath", "UCPath", "closed")] },
  unavailable: { id: "worker-unavailable", label: "Worker 8", workflowId: "separations", workflow: "Separations", state: "unavailable", subject: "Worker 8", elapsed: "Time unavailable", action: "Details unavailable",
    problem: "No actions until it can be read.", browsersNote: "Relay can't read this worker right now.", browsers: [] },
};

/** One running worker whose single browser row is in `state`; a served reason rides along where one explains the state. */
export function workerWithBrowser(state: SessionBrowserState): SessionWorker {
  const reason = state === "unavailable" ? { reason: "Relay can't read this browser." } : {};
  return { ...SESSION_WORKER_BY_STATE.running, id: `worker-browser-${state}`, browsers: [{ ...browser("ucpath", "UCPath", state), ...reason }] };
}

/** More systems than a card holds at the normal width, two with nicknames whose full names ride in a tooltip. */
export const WIDE_WORKER: SessionWorker = { ...SESSION_WORKER_BY_STATE.running, id: "worker-wide", browsers: [
  browser("kuali", "Kuali", "ready"), browser("ucpath", "UCPath", "ready"), browser("kronos", "Kronos", "active"),
  { id: "servicenow", label: "SNow", name: "ServiceNow", state: "ready" }, { id: "sharepoint", label: "SP", name: "SharePoint", state: "starting" },
] };

/** Idle workers with nothing to say: each is a card, like every other worker. */
export const QUIET_IDLE: readonly SessionWorker[] = [0, 1, 2].map(index => ({ ...SESSION_WORKER_BY_STATE.idle, id: `worker-quiet-${index}`, label: `Worker ${index + 9}`,
  workflowId: index % 2 === 0 ? "person-lookup" : "separations", workflow: index % 2 === 0 ? "Person Lookup" : "Separations" }));

const request = { id: "operation-1", target: SESSION_WORKER_BY_STATE.running.id, action: "pause" } as const;
export const SESSION_OPERATION_BY_STATE: Readonly<Record<SessionPreviewOperation["state"], SessionPreviewOperation>> = {
  pending: { request, state: "pending", message: "Pausing the worker…" },
  confirmed: { request, state: "confirmed", message: "Worker paused." },
  refused: { request, state: "refused", message: "Worker control was refused. No change was applied." },
};

const at = "2026-08-26T21:00:00.000Z";
const run = (n: number) => RunIdSchema.parse(`00000000-000${n}-4000-8000-00000000000${n}`);
const none = { kind: "none" } as const;
const NOTICE_BASE = { subject: "", workflow: "", age: "2 min ago", at, read: false, action: "", destination: none } as const;

/** One notice for each tone. */
export const NOTICE_BY_TONE: Readonly<Record<NotificationItem["tone"], NotificationItem>> = {
  danger: { ...NOTICE_BASE, id: "tone-danger", kind: "run", priority: true, title: "Run failed", subject: "EID 10555001", workflow: "Person Lookup", detail: "Cross Verification failed.", tone: "danger", action: "Open log",
    destination: { kind: "run", runId: run(4), day: "2026-08-26" } },
  warning: { ...NOTICE_BASE, id: "tone-warning", kind: "run", priority: true, title: "Run waiting for you", subject: "Morrow, Bea", workflow: "Person Lookup", detail: "Waiting on identity review.", tone: "warning", action: "Review run",
    destination: { kind: "run", runId: run(5), day: "2026-08-26" } },
  positive: { ...NOTICE_BASE, id: "tone-positive", kind: "run", title: "Run completed", subject: "EID 10101010", workflow: "Person Lookup", detail: "Completed successfully.", tone: "positive", read: true, action: "Open log",
    destination: { kind: "run", runId: run(3), day: "2026-08-26" } },
  info: { ...NOTICE_BASE, id: "tone-info", kind: "storage", title: "Relay repaired a saved file", detail: "Nothing needs your attention.", tone: "info" },
};

/** One notice for each source. */
export const NOTICE_BY_KIND: Readonly<Record<NotificationKind, NotificationItem>> = {
  storage: { ...NOTICE_BASE, id: "kind-storage", kind: "storage", priority: true, title: "Your disk is full", detail: "Free up space; Relay cannot save anything until then.", tone: "danger" },
  chatgpt: { ...NOTICE_BASE, id: "kind-chatgpt", kind: "chatgpt", priority: true, title: "ChatGPT usage limit reached", detail: "Runs that read scans wait until 3:40 PM.", tone: "warning", action: "Open settings",
    destination: { kind: "settings", section: "general", target: "chatgpt.account" } },
  run: NOTICE_BY_TONE.warning,
  command: { ...NOTICE_BASE, id: "kind-command", kind: "command", priority: true, title: "Pause worker was not confirmed", subject: "Worker 1", workflow: "Separations",
    detail: "Relay could not confirm whether this finished.", tone: "danger", action: "Open result", destination: { kind: "local-command-result", id: "operation-1" } },
};

export const notificationsReady = (...items: readonly NotificationItem[]): NotificationsState => ({ state: "ready", items, pinned: [] });

/** Notices for the bell popover stories, shaped like a real week: repeats folded with a count, storage with hundreds, a long name, one deleted run. */
const notice = (id: string, item: Partial<NotificationItem> & Pick<NotificationItem, "title" | "detail" | "tone">): NotificationItem =>
  ({ ...NOTICE_BASE, id, kind: "run", priority: item.tone === "danger" || item.tone === "warning", action: "Open log", destination: { kind: "run", runId: run(4), day: "2026-08-26" }, ...item });
export const POPOVER_FAILED = notice("popover-failed", { title: "Run failed", workflow: "Person Lookup", subject: "EID 10555001", detail: "CRM sign-in failed.", tone: "danger", count: 3, age: "12 min ago" });
export const POPOVER_WAITING = notice("popover-waiting", { title: "Run waiting", workflow: "Onboarding", subject: "Morrow, Bea", detail: "Waiting for hire review.", tone: "warning", age: "34 min ago", standing: true });
export const POPOVER_DONE = notice("popover-done", { title: "Run completed", workflow: "Separations", subject: "Separation 5017", detail: "Completed and verified.", tone: "positive", read: true, day: "Today", age: "2 hr ago" });
export const POPOVER_STORAGE = notice("popover-storage", { kind: "storage", title: "Storage needs attention", detail: "Relay couldn't save everything.", tone: "warning", count: 213, action: "", age: "4 days ago" });
export const POPOVER_GONE = notice("popover-gone", { title: "Run failed", workflow: "Person Lookup", subject: "EID 10101010", detail: "Couldn't save the browser screenshot.", tone: "danger", read: true, gone: true, day: "Monday", age: "8 days ago" });
export const POPOVER_LONG = notice("popover-long", { title: "Run failed", workflow: "Separations", subject: "Featherstonehaugh-Montgomery, Alexandria Josephine Wilhelmina · EID 10554120",
  detail: "Kronos couldn't verify the timecard.", tone: "danger", age: "59 min ago" });
export const POPOVER_FEW: NotificationsState = notificationsReady(POPOVER_FAILED, POPOVER_WAITING, POPOVER_DONE);
export const POPOVER_MANY: NotificationsState = notificationsReady(
  POPOVER_FAILED, POPOVER_WAITING,
  notice("many-1", { title: "Run failed", workflow: "Separations", subject: "Separation 5015", detail: "Couldn't open the Kuali document.", tone: "danger", count: 4, age: "1 hr ago" }),
  notice("many-2", { title: "Run failed", workflow: "Work-Study", subject: "EID 10777012", detail: "UCPath sign-in failed.", tone: "danger", count: 2, age: "3 hr ago" }),
  POPOVER_STORAGE,
  POPOVER_DONE,
  notice("many-3", { title: "Run completed", workflow: "Person Lookup", subject: "EID 10333015", detail: "Completed and verified.", tone: "positive", read: true, day: "Today", age: "5 hr ago" }),
  notice("many-4", { title: "Run failed", workflow: "Onboarding", subject: "Okafor, Ines", detail: "Couldn't verify CRM hire data.", tone: "danger", read: true, count: 5, day: "Yesterday", age: "1 day ago" }),
  notice("many-5", { title: "Run completed", workflow: "Onboarding", subject: "Morrow, Bea", detail: "Completed and verified.", tone: "positive", read: true, day: "Yesterday", age: "1 day ago" }),
  notice("many-6", { title: "Run failed", workflow: "Person Lookup", subject: "EID 10221844", detail: "Couldn't save the browser screenshot.", tone: "danger", read: true, count: 12, day: "Friday", age: "4 days ago" }),
  notice("many-7", { title: "Run waiting", workflow: "Onboarding", subject: "Okafor, Ines", detail: "Waiting for hire review.", tone: "warning", read: true, day: "Friday", age: "4 days ago" }),
  POPOVER_GONE,
);
export const POPOVER_LONG_NOTICES: NotificationsState = notificationsReady(POPOVER_LONG, POPOVER_STORAGE, POPOVER_FAILED, POPOVER_DONE);
