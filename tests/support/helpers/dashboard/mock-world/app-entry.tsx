/// <reference types="vite/client" />
import { createPersonPreferences } from "../../../../../src/dashboard/state/person-preferences-model.js";
import { PersonPreferencesContext } from "../../../../../src/dashboard/lib/person-preferences.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../../src/models/config/person-preferences.js";
import { ChatGptAccountContext, createServedChatGptAccountPort } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { DashboardApp } from "../../../../../src/dashboard/app/dashboard-app.js";
import { mockParam } from "../../../../../src/dashboard/app/mock-surfaces.js";
import { productWorkflowComposition } from "../../../../../src/dashboard/app/workflow-sources.js";
import { MOCK_WORKFLOW_COMPOSITION, servedLogsComposition } from "./workflow-composition.js";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import "../../../../../src/dashboard/app/index.css";

Reflect.set(window, "relayMockSurfaces", true);
const container = document.getElementById("root");
if (container === null) throw new Error("mock dashboard root missing");
const client = createDashboardClient({ baseUrl: window.location.origin });
const fixture = new URLSearchParams(location.search).get("fixture");
const personAppearance = Reflect.get(window, "relayMockPersonPreferences") === true;
const controlPreviews = import.meta.glob<{ ControlPreview: ComponentType }>("../controls/*-preview.tsx");
const previewPath = `../controls/${fixture}-preview.tsx`;
const previewLoader = Object.hasOwn(controlPreviews, previewPath) ? controlPreviews[previewPath] : undefined;
const ControlPreview = previewLoader ? lazy(() => previewLoader().then(module => ({ default: module.ControlPreview }))) : undefined;
const composition = fixture === "product-workflows" || Reflect.get(window, "relayMockProductWorkflows") === true
  ? productWorkflowComposition
  : fixture === "picked-a"
  ? servedLogsComposition
  : MOCK_WORKFLOW_COMPOSITION;
const theme: unknown = Reflect.get(window, "relayMockTheme");
const preferences = createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, theme: theme === "light" ? "light" : "dark",
  animations: Reflect.get(window, "relayMockMotion") !== false, assistantFullAccess: mockParam("assistantFullAccess") === "1" });
const accountPort = createServedChatGptAccountPort(client, { open: () => ({ navigate: () => undefined, close: () => undefined }) });
createRoot(container).render(<PersonPreferencesContext.Provider value={preferences}>{ControlPreview ? <ToastProvider><Suspense fallback={<p role="status">Loading control preview…</p>}><ControlPreview /></Suspense></ToastProvider> : <StrictMode><DashboardClientProvider client={client}>
  <ChatGptAccountContext.Provider value={accountPort}><DashboardApp workflowComposition={composition} previewPreferences={personAppearance ? undefined : preferences} /></ChatGptAccountContext.Provider>
</DashboardClientProvider></StrictMode>}</PersonPreferencesContext.Provider>);
