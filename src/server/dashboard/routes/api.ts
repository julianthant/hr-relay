import { registerNotificationRoutes } from "./notifications.js";
import { registerShellRoutes } from "./shell.js";
import { registerSettingsPreflightRoutes } from "./settings-preflight.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerStorageRoutes } from "./storage.js";
import { registerExplorerRoutes } from "./explorer.js";
import { registerArchiveRoutes } from "./archive.js";
import { registerActivityRoutes } from "./activity.js";
import { registerQueueRoutes } from "./queue.js";
import { registerIntakeRoutes } from "./intake.js";
import { registerCommandsRoutes } from "./commands.js";
import { registerRunDetailRoutes } from "./run-detail.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
export type { DashboardApp, DashboardAppDeps } from "./api-types.js";
import { registerDataRoutes } from "./data.js";
import { registerTrustRoutes } from "./trust.js";
import { composeDataQueries } from "../compose/data.js";
/**
 * The dashboard BFF routes (ref frontend-backend-integration §0/§3.6) — thin parse/dispatch boundaries
 * over the queries, the command service, and the stream hub. A handler here
 * parses input, calls one service, parses output, and returns it; no
 * projection logic, no workflow switches, no second count path.
 *
 * Every failure leaves as a typed `WireError` body: schema failures are 400,
 * a named-target miss is 404, an unavailable section/capability is 409, and
 * anything else is a 500 that carries the real message — never a silent 200
 * with a plausible body.
 */
import { Hono } from "hono";

import {
  ArchivedCaptureReadError,
} from "../queries/archive.js";
import { staticBundleHandler } from "../static-bundle.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import {
  type RequestIdentityCheckpoint,
} from "../request-identity.js";
import { failureStatus, wireError } from "./failure-status.js";

export function createDashboardApp(deps: DashboardAppDeps): DashboardApp {
  const app = new Hono<{ Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> } }>();
  app.onError((error, c) => {
    if (error instanceof ArchivedCaptureReadError) {
      return c.json(wireError(error.code, error.message, false), 500);
    }
    const { status, body } = failureStatus(error);
    return c.json(body, status);
  });

  app.use("*", async (c, next) => {
    c.set("requestActorId", deps.requestIdentity.identify(c.req.raw));
    return next();
  });

  // Every browser-reachable POST that can touch durable authority, spend a
  // constrained provider, or create a session is admitted HERE, before its
  // handler reads a byte (ref frontend-backend-integration §3.4, D75). The
  // architecture guard `operator-mutation-admission` pins this table: a new
  // POST route without a row below is a red gate, not a quiet exposure.
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
  app.use("/api/v1/exports/xlsx", operatorMutationIngressGuard);
  app.use("/api/v1/exports/search", operatorMutationIngressGuard);
  app.use("/api/v1/start-plans", operatorMutationIngressGuard);
  app.use("/api/v1/rerun-warnings", operatorMutationIngressGuard);
  app.use("/api/v1/explorer/validate", operatorMutationIngressGuard);
  // Intake bytes travel under the file's own media type (D170) and the advisory
  // carries no body: Host/Origin gate both; the body contract stays the route's.
  app.use("/api/v1/intake/files", operatorOpaqueIngressGuard);
  app.use("/api/v1/runs/:runId/advisory", operatorOpaqueIngressGuard);

  registerDataRoutes(app, () => deps.data ?? composeDataQueries(deps.runDetail));
  registerRunDetailRoutes(app, deps);
  registerTrustRoutes(app, deps);
  registerShellRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerSettingsPreflightRoutes(app, { clock: deps.bootstrap.clock, preflight: deps.preflight });
  registerSettingsRoutes(app, deps);
  registerStorageRoutes(app, deps);
  registerExplorerRoutes(app, deps);
  registerArchiveRoutes(app, deps);
  registerActivityRoutes(app, { activity: deps.activity ?? { read: () => { throw new Error("activity-service-not-configured"); }, readSelected: () => { throw new Error("activity-service-not-configured"); } } });
  registerQueueRoutes(app, { startPlans: deps.startPlans, queue: { day: day => deps.projection.buildDashboardDayWire(day) } });
  registerIntakeRoutes(app, deps);
  registerCommandsRoutes(app, { clock: deps.bootstrap.clock, commands: deps.commands, commandJournal: deps.commandJournal,
    bulkCommandAcceptances: deps.bulkCommandAcceptances, protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    runtimeVersionAcceptedAt: deps.runtimeVersionAcceptedAt, intake: deps.intake });
  if (deps.staticBundle !== undefined) app.use("*", staticBundleHandler(deps.staticBundle));

  app.notFound((c) => c.json(wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${c.req.path}`, false), 404));

  return app;
}
