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

import { Hono } from "hono";

import { staticBundleHandler } from "../static-bundle.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import { type RequestIdentityCheckpoint } from "../request-identity.js";
import { failureStatus, wireError } from "./failure-status.js";

export function createDashboardApp(deps: DashboardAppDeps): DashboardApp {
  const app = new Hono<{ Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> } }>();
  app.onError((error, c) => {
    const { status, body } = failureStatus(error);
    return c.json(body, status);
  });

  app.use("*", async (c, next) => {
    c.set("requestActorId", deps.requestIdentity.identify(c.req.raw));
    return next();
  });

  // Admit browser-reachable mutations before reading body or touching authority or provider state.
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
  app.use("/api/v1/settings/path-picker", operatorMutationIngressGuard);
  app.use("/api/v1/exports/xlsx", operatorMutationIngressGuard);
  app.use("/api/v1/exports/search", operatorMutationIngressGuard);
  app.use("/api/v1/start-plans", operatorMutationIngressGuard);
  app.use("/api/v1/rerun-warnings", operatorMutationIngressGuard);
  app.use("/api/v1/explorer/validate", operatorMutationIngressGuard);
  // Intake bytes use the file media type; Host/Origin admission still applies.
  app.use("/api/v1/intake/files", operatorOpaqueIngressGuard);

  registerDataRoutes(app, () => deps.data ?? composeDataQueries(deps.runDetail));
  registerRunDetailRoutes(app, deps);
  registerTrustRoutes(app, deps);
  registerShellRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerSettingsPreflightRoutes(app, { clock: deps.bootstrap.clock, preflight: deps.preflight });
  registerSettingsRoutes(app, deps);
  registerStorageRoutes(app, deps);
  registerExplorerRoutes(app, deps);
  registerActivityRoutes(app, { activity: deps.activity ?? { read: () => { throw new Error("activity-service-not-configured"); }, readSelected: () => { throw new Error("activity-service-not-configured"); } } });
  registerQueueRoutes(app, { startPlans: deps.startPlans, queue: { day: day => deps.projection.buildDashboardDayWire(day) } });
  registerIntakeRoutes(app, deps);
  registerCommandsRoutes(app, { clock: deps.bootstrap.clock, commands: deps.commands, commandJournal: deps.commandJournal,
    bulkCommandAcceptances: deps.bulkCommandAcceptances, protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    intake: deps.intake });
  if (deps.staticBundle !== undefined) app.use("*", staticBundleHandler(deps.staticBundle));

  app.notFound((c) => c.json(wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${c.req.path}`, false), 404));

  return app;
}
