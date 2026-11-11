import type { CommandResultFeedEntry } from "../../shared/actions/actions-model.js";
import type { BulkBatchOutcome } from "../../../app/commands/bulk-dispatch.js";
import { BulkRunCommandResponseSchema } from "../../../../rules/commands/commands.js";
import { MOCK_SURFACES_FLAG } from "../../../app/mock-surfaces.js";
/** Design mock for the status pages that leave Settings; read only from the URL (`statusMock=<id>`). */
export const STATUS_MOCK_IDS = ["run-before", "run-ready", "run-a", "run-b", "run-rerun", "run-rerun-options", "run-options", "run-options-many", "run-person-lookup", "run-person-lookup-many", "run-steps", "run-rerun-steps", "queue-toolbar", "rail", "rail-min", "rail-min-tooltip", "rail-min-bell", "command-unknown", "command-results", "search-keyboard", "toasts", "toasts-open", "toasts-live", "toasts-storage", "toasts-restored", "general-a", "account", "account-edit", "account-delete", "account-password", "account-duo-setup", "subscription", "subscription-limit", "subscription-disconnected", "general-a-browser", "general-a-date", "run-sheets", "run-sheets-open", "run-sheets-add", "run-sheets-search", "run-sheets-nopins", "run-sheets-fix", "analytics-a", "analytics-b", "signup-a", "signup-b"] as const;
export type StatusMockId = (typeof STATUS_MOCK_IDS)[number];

/** Account and Subscription fixtures. Email is not served after sign-in, so the Account page has no email row; the ChatGPT email comes with the connected account. */
export const STATUS_MOCK_ACCOUNT = {
  values: { name: "Jordan Lee", initials: "JL", timekeeper: "Lee, Jordan", lastSignedInAt: "2026-08-03T15:41:00Z" },
  email: "jordan.lee@example.com",
} as const;

/** Plan and limits are not served today (backend gap); the 5-hour limit frame is the one that has run out. */
export const STATUS_MOCK_SUBSCRIPTION = {
  plan: "Plus plan",
  limits: [{ label: "5-hour limit", resets: "2h 10m", left: 64 }, { label: "Weekly limit", resets: "5d 4h", left: 82 }],
  limitReached: [{ label: "5-hour limit", resets: "1h 25m", left: 0 }, { label: "Weekly limit", resets: "5d 4h", left: 82 }],
} as const;

/** Read once at load: the dialog's view state rewrites the URL, and the frame must not change with it. The combined mock needs no parameter: without one the design renders as `general-a`. */
let loadedMock: StatusMockId | undefined | null = null;
const loadMock = (): StatusMockId | undefined => typeof window === "undefined" || Reflect.get(window, MOCK_SURFACES_FLAG) !== true ? undefined
  : STATUS_MOCK_IDS.find(id => id === new URLSearchParams(window.location.search).get("statusMock")) ?? "general-a";
/** Mock-only: one Pause all whose response was lost, so the sticky toast and its Priority notification have something to show. */
export const STATUS_MOCK_UNKNOWN_COMMAND = { inFlightKey: "mock-pause-all", label: "Pause all requested", targets: Array.from({ length: 13 }, (_, index) => ({ runId: `mock-run-${index}`, title: `Run ${index + 1}`, expectedVersion: 1 })) } as const;
/** Mock-only: a rejected and a conflicted single command plus a partly applied bulk Retry, so their sticky toasts and the Review dialog have something to show. */
const mockUuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const STATUS_MOCK_COMMAND_RESULTS: readonly CommandResultFeedEntry[] = [
  { id: mockUuid(901), targetRunId: mockUuid(4), expectedVersion: 3, subject: "EID 10000001", workflowLabel: "Person Lookup", actionLabel: "Retry", clock: "9:41 AM", actorId: "mock-actor",
    settlement: { kind: "refused", reason: "conflict", problem: "conflict", message: "This run changed while you were looking at it.", currentVersion: 4 } },
  { id: mockUuid(902), targetRunId: mockUuid(5), expectedVersion: 2, subject: "Morrow, Bea", workflowLabel: "Person Lookup", actionLabel: "Cancel run", clock: "9:42 AM", actorId: "mock-actor",
    settlement: { kind: "refused", reason: "rejected", problem: "invalid-state", message: "The run already finished.", code: "invalid-state" } },
];
export const STATUS_MOCK_BULK_OUTCOME: BulkBatchOutcome = {
  plan: { verb: "retry", label: "Retry", eligible: [], skipped: [{ runId: mockUuid(7), title: "EID 10000002" }], unavailable: [] },
  subjects: new Map([[mockUuid(4), "EID 10000001"], [mockUuid(8), "EID 10000003"], [mockUuid(9), "EID 10000004"]]),
  response: BulkRunCommandResponseSchema.parse({ state: "vector", bulkCommandId: mockUuid(910), type: "retry", requestedCount: 4, results: [
    { outcome: "applied", runId: mockUuid(4), commandId: mockUuid(911), replayed: false, detail: "Retry started." },
    { outcome: "applied", runId: mockUuid(8), commandId: mockUuid(912), replayed: false, detail: "Retry started." },
    { outcome: "conflict", runId: mockUuid(9), commandId: mockUuid(913), currentVersion: 5, detail: "The run changed before the retry reached it." },
  ] }),
};
export function statusMock(): StatusMockId | undefined {
  if (loadedMock === null) loadedMock = loadMock();
  return loadedMock;
}

/** Toasts are a title and at most one short line, no buttons. The stack shows the newest and folds the rest behind it; hovering opens it. */
const THREE_TOASTS = [
  { tone: "warning", title: "UCPath is down for maintenance", description: "Runs that use UCPath wait." },
  { tone: "warning", title: "ChatGPT is disconnected", description: "Reconnect it in Settings > Account." },
  { tone: "danger", title: "Relay is missing files", description: "Download Relay again." },
] as const;
export const STATUS_MOCK_TOASTS = {
  toasts: THREE_TOASTS,
  "toasts-open": THREE_TOASTS,
  "toasts-storage": [
    { tone: "danger", title: "Your disk is full", description: "Free up space; Relay cannot save." },
    { tone: "warning", title: "Relay is open somewhere else", description: "Close the other Relay." },
    { tone: "warning", title: "Your data is newer than this Relay", description: "Update Relay." },
  ],
  "toasts-restored": [
    { tone: "info", title: "Restored a file from the 6:30 PM backup", description: "Check UCPath for later changes." },
  ],
} as const;

/** Readiness blockers by frame. The roster blocker shows only when the library has no usable spreadsheet; otherwise the picker preselects the last one used. */
export const STATUS_MOCK_BLOCKERS = {
  "run-a": [{ id: "roster", title: "Import a roster first", note: "Relay matches each scan against it.", action: "Import" }],
  "run-b": [{ id: "chatgpt", title: "ChatGPT is disconnected", note: "Relay reads the scans with your ChatGPT plan.", action: "Reconnect" }],
} as const;

export const STATUS_MOCK_REQUIRED_FIELDS = "Employee ID, Name";

export const STATUS_MOCK_FIRST_RUN = [
  { id: "browser", label: "Browser for workflows", state: "ok" },
  { id: "storage", label: "Saved on this computer", state: "ok" },
  { id: "duo", label: "Duo sign-in", state: "ok" },
  { id: "folders", label: "Downloads folder", state: "running" },
] as const;

/** Outcome vocabulary shared by the key figures, the daily chart and the workflow rows. Needs attention = finished but not checked after saving, or waiting for you. */
export const STATUS_MOCK_OUTCOMES = [
  { key: "done", label: "Done", color: "var(--chart-done)" },
  { key: "failed", label: "Failed", color: "var(--chart-failed)" },
  { key: "attention", label: "Needs attention", color: "var(--chart-attention)" },
] as const;
export type StatusMockOutcomeKey = (typeof STATUS_MOCK_OUTCOMES)[number]["key"];
export type StatusMockCounts = Readonly<Record<StatusMockOutcomeKey, number>>;

/** Synthetic week; each workflow's per-day [done, failed, needs attention] counts are the one source for the chart, key figures and table. Served today: finished and running totals, per-workflow counts, per-day run totals, one median time, failure counts by reason. The per-day outcome split, per-workflow lines under a row, the failing workflow per reason, per-day times per workflow and the workflow filter are backend gaps. */
export const STATUS_MOCK_ANALYTICS = {
  running: 5,
  typicalTime: "2m 14s",
  workflows: [
    { id: "separations", label: "Separations", time: "2m 41s", failedAt: [["Reading the scan", 1]], seconds: [190, 170, 160, 165, 150, 175, 155],
      byDay: [[2, 0, 1], [3, 0, 0], [4, 0, 1], [2, 0, 0], [4, 0, 1], [2, 1, 0], [2, 0, 0]] },
    { id: "emergency-contact", label: "Emergency Contact", time: "1m 38s", failedAt: [["UCPath save", 2]], seconds: [110, 95, 100, 92, 98, 90, 96],
      byDay: [[1, 0, 0], [2, 1, 0], [2, 0, 1], [2, 1, 1], [3, 0, 0], [1, 0, 0], [1, 0, 0]] },
    { id: "person-lookup", label: "Person Lookup", time: "0m 52s", failedAt: [], seconds: [60, 55, 52, 50, 54, 48, 51],
      byDay: [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1]] },
  ],
  reasons: [
    { label: "UCPath did not answer", runs: 2, workflow: "Emergency Contact" },
    { label: "The scan could not be read", runs: 1, workflow: "Separations" },
  ],
} as const;
