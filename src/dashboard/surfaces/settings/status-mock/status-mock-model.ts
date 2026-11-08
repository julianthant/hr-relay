import { createPreviewChatGptAccountPort } from "../general/chatgpt-account-model.js";

/** Design mock for the status pages that leave Settings; read only from the URL (`statusMock=<id>`). */
export const STATUS_MOCK_IDS = ["run-a", "run-b", "toasts", "general-a", "general-a-problem", "general-b", "general-b-problem", "analytics-a", "analytics-b", "signup-a", "signup-b"] as const;
export type StatusMockId = (typeof STATUS_MOCK_IDS)[number];

export function statusMock(): StatusMockId | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("statusMock");
  return STATUS_MOCK_IDS.find(id => id === value);
}

export const STATUS_MOCK_TOASTS = [
  { tone: "warning", title: "UCPath is down for maintenance", description: "Runs that use UCPath wait until it is back." },
  { tone: "warning", title: "ChatGPT is disconnected", description: "Reconnect it in Settings > General." },
  { tone: "danger", title: "Saved data needs attention", description: "Restore or check it in Settings > General." },
] as const;

export const STATUS_MOCK_BLOCKERS = [
  { id: "roster", title: "Emergency Contact needs an OCR roster", note: "Relay matches each scan against it.", action: "Import roster" },
  { id: "chatgpt", title: "ChatGPT is disconnected", note: "Relay reads the scans with your ChatGPT plan.", action: "Reconnect" },
] as const;

export const STATUS_MOCK_CHECKS = [
  { id: "chatgpt", label: "ChatGPT sign-in", result: "ok" },
  { id: "ocr", label: "Reading scans", result: "ok" },
  { id: "assistant", label: "Assistant", result: "ok" },
  { id: "ucpath", label: "UCPath", result: "failed" },
] as const;

export const STATUS_MOCK_FIRST_RUN = [
  { id: "browser", label: "Browser for workflows", state: "ok" },
  { id: "storage", label: "Saved on this computer", state: "ok" },
  { id: "duo", label: "Duo sign-in", state: "ok" },
  { id: "folders", label: "Download and report folders", state: "running" },
] as const;

export const STATUS_MOCK_ANALYTICS = {
  tiles: [
    { label: "Done", value: "41", note: "of 52 runs in this period" },
    { label: "Needs attention", value: "3", note: "failed", tone: "danger" },
    { label: "Outstanding", value: "8", note: "5 running · 3 waiting for you", tone: "warning" },
    { label: "Typical time", value: "2m 14s", note: "per finished run" },
  ],
  workflows: [
    { label: "Separations", done: 22, failed: 1, outstanding: 4, time: "2m 41s" },
    { label: "Emergency Contact", done: 12, failed: 2, outstanding: 3, time: "1m 38s" },
    { label: "Person Lookup", done: 7, failed: 0, outstanding: 1, time: "0m 52s" },
  ],
  reasons: [
    { label: "UCPath did not answer", runs: 2, workflow: "Emergency Contact" },
    { label: "The scan could not be read", runs: 1, workflow: "Separations" },
  ],
  details: {
    verified: "38 of 41 done runs were checked in UCPath after saving",
    unchecked: "3 done runs were not checked",
    receipts: "26 saved in UCPath · 9 saved in Kuali",
  },
} as const;

/** A connected account, so the check result below it reads consistently. */
export const STATUS_MOCK_ACCOUNT_PORT = (() => { const port = createPreviewChatGptAccountPort(); void port.signIn({ usePlan: true }); return port; })();
