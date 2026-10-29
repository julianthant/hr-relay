import { PreflightReportContent } from "../../../../src/dashboard/surfaces/settings/preflight/settings-preflight.js";
import { PreflightActionsProvider } from "../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { PreflightOcrContext, type PreflightOcrSnapshot, type PreflightOcrPort } from "../../../../src/dashboard/surfaces/settings/preflight/preflight-ocr-model.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ChatGptAccountSettings } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account.js";
import type { ChatGptAccountPort, ChatGptAccountSnapshot } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { DsBodyScope } from "../../../../src/dashboard/ds/ui.js";
import "./account.css";

const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme !== "dark" && theme !== "light") throw new Error("account-fixture-theme-invalid");
document.documentElement.setAttribute("data-demo-theme", theme);
document.body.setAttribute("data-demo-theme", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.body.classList.toggle("dark", theme === "dark");
const state = query.get("state");
const identity = { name: "Jordan Lee", email: "jordan.lee@example.com" };
const snapshots: Readonly<Record<string, ChatGptAccountSnapshot>> = {
  loading: { state: "loading" },
  "signed-out": { state: "signed-out" },
  expired: { state: "expired" },
  unavailable: { state: "unavailable", message: "Account service is unavailable." },
  enabled: { state: "connected", ...identity, planUsage: "enabled" },
  disabled: { state: "connected", ...identity, planUsage: "disabled" },
  "limit-reached": { state: "connected", ...identity, planUsage: "limit-reached" },
};
const ocrSnapshots: Readonly<Record<string, PreflightOcrSnapshot>> = {
  "ocr-idle": { state: "idle" },
  "ocr-disabled": { state: "disabled", code: "CHATGPT_PLAN_DISABLED" },
  "ocr-loading": { state: "loading" },
  "ocr-completed": { state: "completed", model: "Synthetic OCR" },
  "ocr-failed": { state: "failed", code: "CHATGPT_OCR_FAILED" },
  "ocr-refused": { state: "refused", code: "CHATGPT_PLAN_DISABLED", message: "OCR refused" },
  "ocr-uncertain": { state: "uncertain", code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED", message: "OCR uncertain" },
};
const preflight = state !== null && ocrSnapshots[state] !== undefined;
if (state === null || (!preflight && snapshots[state] === undefined)) throw new Error("account-fixture-state-invalid");
const snapshot = snapshots[state] ?? snapshots.enabled;
const mode = query.get("action") ?? "success";
if (!["success", "pending", "failed"].includes(mode)) throw new Error("account-fixture-action-invalid");
let calls = 0;
const action = () => {
  calls += 1;
  document.body.setAttribute("data-action-calls", String(calls));
  if (mode === "pending") return new Promise<void>(() => {});
  if (mode === "failed") return Promise.reject(new Error("synthetic-account-action-failed"));
  return Promise.resolve();
};
const port: ChatGptAccountPort = {
  mode: "preview",
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  signIn: action,
  signOut: action,
  cancelSignIn: action,
  testOcr: action,
};
let ocr = ocrSnapshots[state] ?? { state: "idle" as const };
const ocrListeners = new Set<() => void>();
const ocrPort: PreflightOcrPort = {
  getSnapshot: () => ocr,
  subscribe: listener => { ocrListeners.add(listener); return () => { ocrListeners.delete(listener); }; },
  testOcr: async () => {
    if (ocr.state === "loading" || ocr.state === "disabled" || ocr.state === "uncertain") return;
    ocr = { state: "loading" }; for (const listener of ocrListeners) listener();
    try { await action(); ocr = { state: "completed", model: "Synthetic OCR" }; }
    catch { ocr = { state: "failed", code: "CHATGPT_OCR_FAILED" }; }
    for (const listener of ocrListeners) listener();
  },
};
const client = { preflightScopes: async () => [] } as unknown as DashboardClient;
const preflightView = createElement(DashboardClientProvider, { client, children: createElement(PreflightActionsProvider, {
  actions: { actorId: "fixture", descriptorFingerprint: "a".repeat(64), showSettings() {}, showSessions() {} },
  children: createElement(PreflightOcrContext.Provider, { value: ocrPort, children: createElement(PreflightReportContent, {
    presentation: "settings", preflight: { state: "refused", message: "Synthetic readiness report unavailable" }, onRerun() {},
  }) }),
}) });
const container = document.getElementById("account-fixture");
if (container === null) throw new Error("account-fixture-container-missing");
createRoot(container).render(createElement("main", {
  "aria-label": "ChatGPT account component fixture",
  style: { padding: "24px", minHeight: "100vh" },
}, createElement(DsBodyScope, null, preflight ? preflightView : createElement(ChatGptAccountSettings, { port }))));
