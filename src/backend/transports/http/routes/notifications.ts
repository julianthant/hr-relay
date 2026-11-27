import { etag } from "hono/etag";
import { z } from "zod";
import { NotificationWireSchema } from "../../../../models/dashboard/projection.js";
import { NotificationCollectionOperationSchema, NotificationCollectionTargetSchema } from "../../../../models/notifications/notifications.js";
import { NotificationTargetSchema } from "../../../../models/notifications/notification-target.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import { createPositionedReadResponse } from "../read-reuse.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
const laneJson = (body: string) => new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function registerNotificationRoutes(app: DashboardApp, deps: Pick<DashboardAppDeps, "notifications">): void {
  const rows = z.array(NotificationWireSchema);
  const snapshotResponse = createPositionedReadResponse("no-store", wire => rows.parse(wire));
  app.get("/api/v1/notifications", etag(), async c => {
    if (deps.notifications === undefined) throw new SectionUnavailableError("Notification snapshot is unavailable");
    const actor = c.get("requestActorId");
    if (deps.notifications.lane !== undefined) return laneJson(await deps.notifications.lane.list(actor, c.req.raw.signal));
    if (deps.notifications.withSnapshot) return deps.notifications.withSnapshot(actor, snapshotResponse);
    c.header("Cache-Control", "no-store");
    return c.json(rows.parse(deps.notifications.snapshot(actor)));
  });
  app.get("/api/v1/notifications/collection", async c => {
    if (deps.notifications?.collection === undefined) throw new SectionUnavailableError("Notification collection is unavailable");
    const operation = NotificationCollectionOperationSchema.parse(c.req.query("operation"));
    if (deps.notifications.lane !== undefined) return laneJson(await deps.notifications.lane.collection(c.get("requestActorId"), operation));
    c.header("Cache-Control", "no-store");
    return c.json(NotificationCollectionTargetSchema.parse(deps.notifications.collection(c.get("requestActorId"), operation)));
  });
  app.get("/api/v1/notifications/:notificationId/target", async c => {
    if (deps.notifications === undefined) throw new SectionUnavailableError("Notification destinations are unavailable");
    if (deps.notifications.lane !== undefined) return laneJson(await deps.notifications.lane.target(c.req.param("notificationId"), c.get("requestActorId")));
    c.header("Cache-Control", "no-store");
    return c.json(NotificationTargetSchema.parse(deps.notifications.target(c.req.param("notificationId"), c.get("requestActorId"))));
  });
}
