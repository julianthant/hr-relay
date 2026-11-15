import { registerAssistantRoutes } from "./assistant.js";
import { afterRequestOutcome, registerDebugResponses } from "./debug-responses.js";
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
import { registerOcrRoutes } from "./ocr.js";
import { registerCommandsRoutes } from "./commands.js";
import { resolveGateArmAnswer, resolveIdentityGateAnswer } from "../../../runs/queries/run-detail.js";
import { registerRunDetailRoutes } from "./run-detail.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
export type { DashboardApp, DashboardAppDeps } from "./api-types.js";
import { registerDataRoutes } from "./data.js";
import { registerTrustRoutes } from "./trust.js";
import { composeDataQueries } from "../../../app/composition/dashboard/data.js";

import { withEmergencyTimelineWriter } from "../../../logs/emergency-faults.js";
import { createDebugEventWriter } from "../../../logs/debug-events.js";
import { serializeErrorCauses } from "../../../../models/failures/error-origins.js";
import { randomUUID } from "node:crypto";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { dashboardReportAccepted, DashboardErrorReportSchema } from "../../../../models/events/debug-report.js";
import { Hono } from "hono";

import { staticBundleHandler } from "../static-bundle.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import { type RequestIdentityCheckpoint } from "../request-identity.js";
import { failureStatus, wireError } from "./failure-status.js";
import { preflightRunnerTimeout } from "../../../../models/preflight/preflight.js";

export function createDashboardApp(deps: DashboardAppDeps): DashboardApp {
  const app = new Hono<{ Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> } }>();
  const debugEvents = deps.debugEvents ?? createDebugEventWriter({ repository: withEmergencyTimelineWriter(deps.runDetail.timeline, { stateRoot: deps.runDetail.stateRoot, clock: deps.bootstrap.clock, build: deps.bootstrap.appVersion }), clock: deps.bootstrap.clock, build: deps.bootstrap.appVersion });
  registerDebugResponses(app, debugEvents);
  let reportWindow = 0, reportCount = 0;
  app.onError((error, c) => {
    const { status, body } = failureStatus(error);
    if (status >= 500) {
      try {
        const causes = serializeErrorCauses(error);
        const disconnected = causes.some(cause => cause.reason === "request-disconnected");
        const correlationId = randomUUID();
        afterRequestOutcome(c.req.raw, () => {
          for (const cause of causes) debugEvents.emit({ category: "http", phase: "failed",
            correlationId, area: "request", reason: "request-cause", ...(disconnected ? {} : { status }),
            code: cause.code, message: cause.name, stack: cause.stack });
        });
      } catch {
        return c.json(wireError("LOGGING_UNAVAILABLE", ERROR_CATALOG.LOGGING_UNAVAILABLE.text, false), 500);
      }
    }
    const timeout = preflightRunnerTimeout(error);
    if (timeout !== undefined) {
      const correlationId = randomUUID();
      afterRequestOutcome(c.req.raw, () => {
        debugEvents.emit({ category: "http", phase: "failed", correlationId, area: "request", reason: "preflight-timeout",
          code: "PREFLIGHT_TIMEOUT", status, message: timeout.message });
      });
    }
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
  app.use("/api/v1/exports/xlsx", operatorMutationIngressGuard);
  app.use("/api/v1/exports/search", operatorMutationIngressGuard);
  app.use("/api/v1/start-plans", operatorMutationIngressGuard);
  app.use("/api/v1/rerun-warnings", operatorMutationIngressGuard);
  // Intake bytes use the file media type; Host/Origin admission still applies.
  app.use("/api/v1/intake/files", operatorOpaqueIngressGuard);
  app.use("/api/v1/ocr/files", operatorOpaqueIngressGuard);
  app.use("/api/v1/workbooks", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/types", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/import", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/:libraryId/operations", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/:libraryId/library-actions", operatorMutationIngressGuard);
  app.use("/api/v1/workbooks/:libraryId/sync", operatorMutationIngressGuard);
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
    if (!parsed.success || !dashboardReportAccepted(parsed.data)) return c.json(wireError("DEBUG_REPORT_INVALID", "Dashboard error report fields are invalid.", false), 400);
    const report = parsed.data;
    const runReader = deps.runDetail.runReader;
    if (report.runId !== undefined && runReader === undefined) throw new Error("TRUST_RUN_READER_NOT_CONFIGURED");
    const existence = report.runId === undefined ? undefined : runReader?.read(report.runId);
    const run = existence?.state === "present" ? existence.run : undefined;
    debugEvents.emit({ category: "client", phase: "failed", correlationId: report.reportId,
      area: "dashboard", reason: report.reason,
      route: report.route, surface: report.surface, release: report.release, code: report.code, message: report.message, stack: report.stack },
      run === undefined ? { kind: "client", clientId: report.clientId } : { kind: "run", runId: run.envelope.runId }, run?.envelope.workflow);
    return c.json({ state: "recorded", reportId: report.reportId }, 201);
  });
  registerDataRoutes(app, () => deps.data ?? composeDataQueries(deps.runDetail));
  registerRunDetailRoutes(app, deps);
  registerTrustRoutes(app, deps);
  registerShellRoutes(app, { ...deps, debugEvents });
  registerNotificationRoutes(app, deps);
  registerSettingsPreflightRoutes(app, { clock: deps.bootstrap.clock, preflight: deps.preflight });
  registerSettingsRoutes(app, deps);
  registerChatGptAccountRoutes(app, { ...deps, debugEvents, clock: deps.bootstrap.clock });
  registerAssistantRoutes(app, deps.assistant);
  registerStorageRoutes(app, deps);
  registerExplorerRoutes(app, deps);
  registerActivityRoutes(app, { activityPopulation: deps.activityPopulation, activity: deps.activity ?? { read: () => { throw new Error("activity-service-not-configured"); }, readSelected: () => { throw new Error("activity-service-not-configured"); } } });
  registerQueueRoutes(app, { startPlans: deps.startPlans, queue: { day: day => deps.projection.buildDashboardDayWire(day) } });
  registerIntakeRoutes(app, deps);
  registerOcrRoutes(app, deps);
  registerWorkbookRoutes(app, deps);
  registerCommandsRoutes(app, { clock: deps.bootstrap.clock, commands: deps.commands, resolveWriteCommand: deps.resolveWriteCommand, commandJournal: deps.commandJournal,
    bulkCommandAcceptances: deps.bulkCommandAcceptances, protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    intake: deps.intake, resolveIdentityGateAnswer: (answer, journaled) => resolveIdentityGateAnswer(deps.runDetail, answer, journaled),
    resolveGateArmAnswer: (answer, journaled) => resolveGateArmAnswer(deps.runDetail, answer, journaled),
    ...(deps.workerCommandResult === undefined ? {} : { workerCommandResult: deps.workerCommandResult }) });
  if (deps.staticBundle !== undefined) app.use("*", staticBundleHandler(deps.staticBundle));

  app.notFound((c) => c.json(wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${c.req.path}`, false), 404));

  return app;
}
