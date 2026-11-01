import { registerAssistantRoutes } from "./assistant.js";
import { errorText } from "../../../runs/lifecycle/support.js";
import { DashboardReadFailedError } from "../../../runs/commands/refusals.js";
import { registerChatGptAccountRoutes } from "./chatgpt-account.js";
import { registerWorkbookRoutes } from "./workbooks.js";
import { registerNotificationRoutes } from "./notifications.js";
import { registerShellRoutes } from "./shell.js";
import { registerSettingsPreflightRoutes } from "./settings-preflight.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerStorageRoutes } from "./storage.js";
import { registerExplorerRoutes } from "./explorer.js";
import { registerActivityRoutes } from "./activity.js";
import { registerQueueRoutes } from "./queue.js";
import { registerIntakeRoutes } from "./intake.js";
import { registerCommandsRoutes } from "./commands.js";
import { registerRunDetailRoutes } from "./run-detail.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
export type { DashboardApp, DashboardAppDeps } from "./api-types.js";
import { registerDataRoutes } from "./data.js";
import { registerTrustRoutes } from "./trust.js";
import { composeDataQueries } from "../../../app/composition/dashboard/data.js";

import { withEmergencyTimelineWriter } from "../../../logs/emergency-faults.js";
import { createDebugEventWriter } from "../../../logs/debug-events.js";
import { DashboardErrorReportSchema } from "../../../../models/events/debug-report.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";

import { staticBundleHandler } from "../static-bundle.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import { type RequestIdentityCheckpoint } from "../request-identity.js";
import { failureStatus, wireError } from "./failure-status.js";

export function createDashboardApp(deps: DashboardAppDeps): DashboardApp {
  const app = new Hono<{ Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> } }>();
  const debugEvents = createDebugEventWriter({ repository: withEmergencyTimelineWriter(deps.runDetail.timeline, { stateRoot: deps.runDetail.stateRoot, clock: deps.bootstrap.clock, build: deps.bootstrap.appVersion }), clock: deps.bootstrap.clock, build: deps.bootstrap.appVersion });
  let reportWindow = 0, reportCount = 0;
  app.onError((error, c) => {
    const { status, body } = failureStatus(error);
    const diagnostic = error instanceof DashboardReadFailedError ? error.cause : error;
    try { debugEvents.emit({ category: "http", phase: "failed", correlationId: randomUUID(),
      code: String(body.code), method: c.req.method, route: c.req.routePath, status,
      message: errorText(diagnostic), stack: diagnostic instanceof Error ? diagnostic.stack : undefined }); }
    catch { return c.json(wireError("LOGGING_UNAVAILABLE", "Debug logging is unavailable; inspect the local emergency fault log.", false), 500); }
    return c.json(body, status);
  });

  app.use("*", async (c, next) => {
    c.set("requestActorId", deps.requestIdentity.identify(c.req.raw));
    return next();
  });

  // Admit browser-reachable mutations before reading body or touching authority or provider state.
  app.use("/api/v1/debug/errors", operatorMutationIngressGuard);
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
  app.use("/api/v1/settings/path-picker", operatorMutationIngressGuard);
  app.use("/api/v1/settings/chatgpt-account/sign-in", operatorMutationIngressGuard);
  app.use("/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel", operatorMutationIngressGuard);
  app.use("/api/v1/settings/chatgpt-account/sign-out", operatorMutationIngressGuard);
  app.use("/api/v1/exports/xlsx", operatorMutationIngressGuard);
  app.use("/api/v1/exports/search", operatorMutationIngressGuard);
  app.use("/api/v1/start-plans", operatorMutationIngressGuard);
  app.use("/api/v1/rerun-warnings", operatorMutationIngressGuard);
  // Intake bytes use the file media type; Host/Origin admission still applies.
  app.use("/api/v1/intake/files", operatorOpaqueIngressGuard);
  app.use("/api/v1/workbooks", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/:libraryId/save", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/:libraryId/intake", operatorMutationIngressGuard);

  app.post("/api/v1/debug/errors", async c => {
    const now = deps.bootstrap.clock.nowMs();
    if (now - reportWindow >= 60_000) { reportWindow = now; reportCount = 0; }
    if (++reportCount > 30) return c.json(wireError("DEBUG_REPORT_RATE_LIMIT", "Too many dashboard error reports; retry in one minute.", true), 429);
    const reader = c.req.raw.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader !== undefined) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 64 * 1024) { await reader.cancel(); return c.json(wireError("DEBUG_REPORT_SIZE_LIMIT", "Dashboard error reports are limited to 64 KiB.", false), 413); }
        chunks.push(chunk.value);
      }
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(combined)); }
    catch { return c.json(wireError("DEBUG_REPORT_INVALID", "Dashboard error report must be valid JSON.", false), 400); }
    const parsed = DashboardErrorReportSchema.safeParse(input);
    if (!parsed.success) return c.json(wireError("DEBUG_REPORT_INVALID", "Dashboard error report fields are invalid.", false), 400);
    const report = parsed.data;
    debugEvents.emit({ category: "client", phase: "failed", correlationId: report.reportId,
      route: report.route, surface: report.surface, release: report.release, code: report.code, message: report.message, stack: report.stack }, { kind: "client", clientId: report.clientId });
    return c.json({ state: "recorded", reportId: report.reportId }, 201);
  });
  registerDataRoutes(app, () => deps.data ?? composeDataQueries(deps.runDetail));
  registerRunDetailRoutes(app, deps);
  registerTrustRoutes(app, deps);
  registerShellRoutes(app, { ...deps, debugEvents });
  registerNotificationRoutes(app, deps);
  registerSettingsPreflightRoutes(app, { clock: deps.bootstrap.clock, preflight: deps.preflight });
  registerSettingsRoutes(app, deps);
  registerChatGptAccountRoutes(app, deps);
  registerAssistantRoutes(app, deps.assistant);
  registerStorageRoutes(app, deps);
  registerExplorerRoutes(app, deps);
  registerActivityRoutes(app, { activityPopulation: deps.activityPopulation, activity: deps.activity ?? { read: () => { throw new Error("activity-service-not-configured"); }, readSelected: () => { throw new Error("activity-service-not-configured"); } } });
  registerQueueRoutes(app, { startPlans: deps.startPlans, queue: { day: day => deps.projection.buildDashboardDayWire(day) } });
  registerIntakeRoutes(app, deps);
  registerWorkbookRoutes(app, deps);
  registerCommandsRoutes(app, { clock: deps.bootstrap.clock, commands: deps.commands, commandJournal: deps.commandJournal,
    bulkCommandAcceptances: deps.bulkCommandAcceptances, protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    intake: deps.intake });
  if (deps.staticBundle !== undefined) app.use("*", staticBundleHandler(deps.staticBundle));

  app.notFound((c) => c.json(wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${c.req.path}`, false), 404));

  return app;
}
