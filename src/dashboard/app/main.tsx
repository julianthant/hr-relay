/**
 * The browser entry point: one root, one client, one app.
 *
 * The client is built here — same-origin, because Vite proxies `/api` and
 * `/events` to the BFF in development and the built bundle is served beside it
 * in production. Everything below this file reaches the server through that one
 * object, which is what makes the parity lane's adapter swap a single seam.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardClient } from "../client/index.js";
import { DashboardClientProvider } from "../state/client-context.js";
import { DashboardApp } from "./dashboard-app.js";
import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the dashboard bundle requires a #root element; index.html did not provide one");
}

const client = createDashboardClient({ baseUrl: window.location.origin });
document.documentElement.dataset.dashboardDensity = "compact";

createRoot(container).render(
  <StrictMode>
    <DashboardClientProvider client={client}>
      <DashboardApp />
    </DashboardClientProvider>
  </StrictMode>,
);
