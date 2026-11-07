import { z } from "zod";
import { NotificationWireSchema } from "../../../../models/dashboard/projection.js";
import { NotificationCollectionOperationSchema, NotificationCollectionTargetSchema, NotificationObservationStatusSchema, NotificationTargetSchema } from "../../../../models/notifications/notifications.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
export function registerNotificationRoutes(app: DashboardApp, deps: Pick<DashboardAppDeps, "notifications">): void {
  app.get("/api/v1/notifications", c => {
    if (deps.notifications === undefined) throw new SectionUnavailableError("Notification snapshot is unavailable");
    c.header("Cache-Control", "no-store");
    return c.json(z.array(NotificationWireSchema).parse(deps.notifications.snapshot(c.get("requestActorId"))));
  });
  app.get("/api/v1/notifications/status", c => {
    if (deps.notifications === undefined) throw new SectionUnavailableError("Notification observation is unavailable");
    c.header("Cache-Control", "no-store");
    return c.json(NotificationObservationStatusSchema.parse(deps.notifications.status()));
  });
  app.get("/api/v1/notifications/collection", c => {
    if (deps.notifications?.collection === undefined) throw new SectionUnavailableError("Notification collection is unavailable");
    c.header("Cache-Control", "no-store");
    return c.json(NotificationCollectionTargetSchema.parse(deps.notifications.collection(c.get("requestActorId"), NotificationCollectionOperationSchema.parse(c.req.query("operation")))));
  });
  app.get("/api/v1/notifications/:notificationId/target", c => {
    if (deps.notifications === undefined) throw new SectionUnavailableError("Notification destinations are unavailable");
    c.header("Cache-Control", "no-store");
    return c.json(NotificationTargetSchema.parse(deps.notifications.target(c.req.param("notificationId"), c.get("requestActorId"))));
  });
}
