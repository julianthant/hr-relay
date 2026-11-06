/** The browser entry point: one root, one client, one app. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardClient } from "../client/index.js";
import { DashboardReportDeliveryError } from "../client/errors.js";
import { serializeErrorCauses } from "../../models/failures/error-origins.js";
import { DashboardClientProvider } from "../state/client-context.js";
import { DashboardApp } from "./dashboard-app.js";
import { activeTakeover, parseRoute, shellViewOf } from "./navigation/url-state.js";
import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the dashboard bundle requires a #root element; index.html did not provide one");
}

const client = createDashboardClient({ baseUrl: window.location.origin,
  surface: () => shellViewOf(activeTakeover(parseRoute(window.location.search))) });

const clientId = crypto.randomUUID();
const report = (error: unknown) => {
  const [cause] = serializeErrorCauses(error);
  if (cause === undefined) return;
  void client.reportError({ reportId: crypto.randomUUID(), clientId, release: "dashboard",
    route: window.location.pathname, surface: "app", code: cause.code, reason: cause.reason, message: cause.name, stack: cause.stack })
    .catch(() => {
      window.reportError(new DashboardReportDeliveryError());
    });
};
const onError = (event: ErrorEvent) => {
  if (event.error instanceof DashboardReportDeliveryError) return;
  report(event.error ?? new Error(event.message));
};
const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
window.addEventListener("error", onError);
window.addEventListener("unhandledrejection", onRejection);
const disposeErrorReports = () => {
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
};
const onPageHide = (event: PageTransitionEvent) => {
  if (!event.persisted) { disposeErrorReports(); }
};
window.addEventListener("pagehide", onPageHide);
const hot = (import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot;
hot?.dispose(() => { disposeErrorReports(); });

createRoot(container).render(
  <StrictMode>
    <DashboardClientProvider client={client}>
      <DashboardApp profileSource="served" />
    </DashboardClientProvider>
  </StrictMode>,
);
