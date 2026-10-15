import { ChatGptAccountContext, createServedChatGptAccountPort } from "../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../src/dashboard/state/client-context.js";
import { DashboardApp } from "../../src/dashboard/app/dashboard-app.js";
import { PARITY_WORKFLOW_COMPOSITION } from "./helpers/workflow-composition.js";
import "../../src/dashboard/app/index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("parity dashboard root missing");
const client = createDashboardClient({ baseUrl: window.location.origin });
const accountPort = createServedChatGptAccountPort(client, { open: () => ({ navigate: () => undefined, close: () => undefined }) });
createRoot(container).render(<StrictMode><DashboardClientProvider client={client}>
  <ChatGptAccountContext.Provider value={accountPort}><DashboardApp workflowComposition={PARITY_WORKFLOW_COMPOSITION} /></ChatGptAccountContext.Provider>
</DashboardClientProvider></StrictMode>);
