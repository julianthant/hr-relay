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
createRoot(container).render(<StrictMode><DashboardClientProvider client={client}>
  <DashboardApp workflowComposition={PARITY_WORKFLOW_COMPOSITION} />
</DashboardClientProvider></StrictMode>);
