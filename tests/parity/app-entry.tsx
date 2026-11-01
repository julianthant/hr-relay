/// <reference types="vite/client" />
import { ChatGptAccountContext, createServedChatGptAccountPort } from "../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../src/dashboard/state/client-context.js";
import { DashboardApp } from "../../src/dashboard/app/dashboard-app.js";
import { PARITY_WORKFLOW_COMPOSITION } from "./helpers/workflow-composition.js";
import "../../src/dashboard/app/index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("parity dashboard root missing");
const client = createDashboardClient({ baseUrl: window.location.origin });
const fixture = new URLSearchParams(location.search).get("fixture");
const controlPreviews = import.meta.glob<{ ControlPreview: ComponentType }>("../support/helpers/dashboard/controls/*-preview.tsx");
const previewLoader = controlPreviews[`../support/helpers/dashboard/controls/${fixture}-preview.tsx`];
const ControlPreview = previewLoader ? lazy(() => previewLoader().then(module => ({ default: module.ControlPreview }))) : undefined;
const composition = fixture === "hub-served"
  ? (workflows: Parameters<typeof PARITY_WORKFLOW_COMPOSITION>[0]) => ({ ...PARITY_WORKFLOW_COMPOSITION(workflows), assistant: "served" as const })
  : fixture === "hub-integration"
  ? (workflows: Parameters<typeof PARITY_WORKFLOW_COMPOSITION>[0]) => ({ ...PARITY_WORKFLOW_COMPOSITION(workflows), spreadsheets: "served" as const })
  : PARITY_WORKFLOW_COMPOSITION;
const accountPort = createServedChatGptAccountPort(client, { open: () => ({ navigate: () => undefined, close: () => undefined }) });
createRoot(container).render(ControlPreview ? <Suspense fallback={<p role="status">Loading control preview…</p>}><ControlPreview /></Suspense> : <StrictMode><DashboardClientProvider client={client}>
  <ChatGptAccountContext.Provider value={accountPort}><DashboardApp workflowComposition={composition} /></ChatGptAccountContext.Provider>
</DashboardClientProvider></StrictMode>);
