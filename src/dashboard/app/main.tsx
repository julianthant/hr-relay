/** The browser entry point: one root, one client, one app. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardClient } from "../client/index.js";
import { DashboardClientError, DashboardReportDeliveryError } from "../client/errors.js";
import { serializeErrorCauses } from "../../models/failures/error-origins.js";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { DashboardClientProvider } from "../state/client-context.js";
import { profileForDashboardPort } from "../../models/config/define-runtime-isolation.js";
import { DashboardApp } from "./dashboard-app.js";
import { activeTakeover, parseRoute, shellViewOf } from "./navigation/url-state.js";
import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the dashboard bundle requires a #root element; index.html did not provide one");
}

const client = createDashboardClient({ baseUrl: window.location.origin,
  surface: () => shellViewOf(activeTakeover(parseRoute(window.location.search))),
  runId: () => {
    const route = parseRoute(window.location.search);
    if (activeTakeover(route) !== "none") return undefined;
    const parsed = RunIdSchema.safeParse(route.run);
    return parsed.success ? parsed.data : undefined;
  } });

const clientId = crypto.randomUUID();
const report = (error: unknown) => {
  const classification = error instanceof DashboardClientError
    ? new DashboardClientError({ kind: error.kind, code: error.code, message: "" })
    : undefined;
  const [{ code, reason, name }] = serializeErrorCauses(classification);
  void client.reportError({ reportId: crypto.randomUUID(), clientId, release: "dashboard", route: "/", surface: "app",
    code, reason, message: name })
    .catch(() => {
      window.reportError(new DashboardReportDeliveryError());
    });
};
const onError = (event: ErrorEvent) => {
  if (event.error instanceof DashboardReportDeliveryError) return;
  // The browser delivers the remaining ResizeObserver notifications next frame; nothing failed.
  if (event.error === null && event.message.startsWith("ResizeObserver loop")) return;
  report(event.error);
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
    <small className="pointer-events-none fixed right-2 bottom-1 z-50 rounded bg-background px-1 text-xs capitalize text-muted-foreground" aria-label="Runtime profile">
      {profileForDashboardPort(window.location.port) ?? "Unknown environment"}
    </small>
    <DashboardClientProvider client={client}>
      <DashboardApp />
    </DashboardClientProvider>
  </StrictMode>,
);
