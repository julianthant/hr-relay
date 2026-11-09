/** Design mock for the status pages that leave Settings; read only from the URL (`statusMock=<id>`). */
export const STATUS_MOCK_IDS = ["run-before", "run-ready", "run-a", "run-b", "run-rerun", "queue-toolbar", "toasts", "toasts-storage", "toasts-restored", "general-a", "general-a-chatgpt-limit", "general-a-chatgpt-disconnected", "analytics-a", "analytics-b", "signup-a", "signup-b"] as const;
export type StatusMockId = (typeof STATUS_MOCK_IDS)[number];

/** Read once at load: the dialog's view state rewrites the URL, and the frame must not change with it. */
const LOADED_MOCK: StatusMockId | undefined = typeof window === "undefined" ? undefined
  : STATUS_MOCK_IDS.find(id => id === new URLSearchParams(window.location.search).get("statusMock"));
export function statusMock(): StatusMockId | undefined {
  return LOADED_MOCK;
}

/** Three toasts per frame (the viewport stacks three). Each sticky one is for what automation cannot fix; the restore notice only says what was fixed and dismisses itself. */
export const STATUS_MOCK_TOASTS = {
  toasts: [
    { tone: "warning", title: "UCPath is down for maintenance", description: "Runs that use UCPath wait until it is back." },
    { tone: "warning", title: "ChatGPT is disconnected", description: "Reconnect it in Settings > General." },
    { tone: "danger", title: "Relay is missing files it needs", description: "Download Relay again." },
  ],
  "toasts-storage": [
    { tone: "danger", title: "Your disk is full", description: "Free up space on this computer; Relay cannot save." },
    { tone: "warning", title: "Relay is open somewhere else", description: "Close the other Relay on this profile." },
    { tone: "warning", title: "Your saved data is newer than this Relay", description: "Update Relay." },
  ],
  "toasts-restored": [
    { tone: "info", title: "Restored a damaged file from the 6:30 PM backup", description: "Check UCPath for anything done after that." },
  ],
} as const;

/** Readiness blockers by frame. The roster blocker shows only when the library has no usable spreadsheet; otherwise the picker preselects the last one used. */
export const STATUS_MOCK_BLOCKERS = {
  "run-a": [{ id: "roster", title: "Import a roster first", note: "Relay matches each scan against it.", action: "Import" }],
  "run-rerun": [{ id: "chatgpt", title: "ChatGPT is disconnected", note: "Relay reads the scans with your ChatGPT plan.", action: "Reconnect" }],
  "run-b": [{ id: "chatgpt", title: "ChatGPT is disconnected", note: "Relay reads the scans with your ChatGPT plan.", action: "Reconnect" }],
} as const;

/** The workflow's spreadsheets in the library. A spreadsheet that lacks a required column is listed disabled with the reason; `used` is the last selection for the workflow. */
export const STATUS_MOCK_SPREADSHEETS = [
  { value: "ec-roster-oct", label: "EC roster Oct 2026", description: "Updated Nov 2", used: true },
  { value: "student-staff", label: "Student staff roster", description: "Updated Oct 28", used: true },
  { value: "old-contacts", label: "Old contacts list", description: "No Name column", disabled: true, used: false },
] as const;
export const STATUS_MOCK_REQUIRED_FIELDS = "EID, Name";

export const STATUS_MOCK_FIRST_RUN = [
  { id: "browser", label: "Browser for workflows", state: "ok" },
  { id: "storage", label: "Saved on this computer", state: "ok" },
  { id: "duo", label: "Duo sign-in", state: "ok" },
  { id: "folders", label: "Download and report folders", state: "running" },
] as const;

/** Outcome vocabulary shared by the tiles, the daily chart and the per-workflow bars. Needs attention = finished but not checked after saving, or waiting for you. */
export const STATUS_MOCK_OUTCOMES = [
  { key: "done", label: "Done", fill: "bg-ui-positive" },
  { key: "failed", label: "Failed", fill: "bg-ui-danger" },
  { key: "attention", label: "Needs attention", fill: "bg-ui-warning" },
] as const;
export type StatusMockOutcomeKey = (typeof STATUS_MOCK_OUTCOMES)[number]["key"];
export type StatusMockCounts = Readonly<Record<StatusMockOutcomeKey, number>>;

export const STATUS_MOCK_ANALYTICS = {
  tiles: [
    { label: "Done", value: "38", note: "of 52 runs · 5 still running" },
    { label: "Failed", value: "3", note: "of 47 finished runs", tone: "danger" },
    { label: "Needs attention", value: "6", note: "3 not checked after saving · 3 waiting for you", tone: "warning" },
    { label: "Typical time", value: "2m 14s", note: "per finished run" },
  ],
  days: [
    { label: "Sun 20", done: 4, failed: 0, attention: 1 },
    { label: "Mon 21", done: 6, failed: 1, attention: 0 },
    { label: "Tue 22", done: 7, failed: 0, attention: 2 },
    { label: "Wed 23", done: 5, failed: 1, attention: 1 },
    { label: "Thu 24", done: 8, failed: 0, attention: 1 },
    { label: "Fri 25", done: 5, failed: 1, attention: 0 },
    { label: "Sat 26", done: 3, failed: 0, attention: 1 },
  ],
  workflows: [
    { label: "Separations", done: 19, failed: 1, attention: 3, time: "2m 41s" },
    { label: "Emergency Contact", done: 12, failed: 2, attention: 2, time: "1m 38s" },
    { label: "Person Lookup", done: 7, failed: 0, attention: 1, time: "0m 52s" },
  ],
  reasons: [
    { label: "UCPath did not answer", runs: 2, workflow: "Emergency Contact" },
    { label: "The scan could not be read", runs: 1, workflow: "Separations" },
  ],
} as const;
