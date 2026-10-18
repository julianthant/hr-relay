import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ChatGptAccountSettings } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account.js";
import type { ChatGptAccountPort, ChatGptAccountSnapshot } from "../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { DsBodyScope } from "../../../../src/dashboard/ds/ui.js";
import "../../../../src/dashboard/app/index.css";

const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme !== "dark" && theme !== "light") throw new Error("account-fixture-theme-invalid");
document.documentElement.setAttribute("data-demo-theme", theme);
document.body.setAttribute("data-demo-theme", theme);
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
if (state === null || snapshots[state] === undefined) throw new Error("account-fixture-state-invalid");
const snapshot = snapshots[state];
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
};
const container = document.getElementById("account-fixture");
if (container === null) throw new Error("account-fixture-container-missing");
createRoot(container).render(createElement("main", {
  "aria-label": "ChatGPT account component fixture",
  style: { padding: "24px", minHeight: "100vh" },
}, createElement(DsBodyScope, null, createElement(ChatGptAccountSettings, { port }))));
