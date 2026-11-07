import { NotificationWireSchema, type NotificationWire } from "../../../models/dashboard/projection.js";
import { z } from "zod";
import { NotificationIdSchema } from "../../../rules/identity/ids.js";
import { NotificationCollectionOperationSchema, NotificationCollectionTargetSchema, type NotificationCollectionOperation, type NotificationCollectionTarget, NotificationObservationStatusSchema, NotificationTargetSchema, type NotificationTarget } from "../../../models/notifications/notifications.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";
export interface NotificationQueries {
  notificationCollection?(operation: NotificationCollectionOperation): Promise<NotificationCollectionTarget>;
  notificationSnapshot(): Promise<readonly NotificationWire[]>;
  notificationTarget(id: string): Promise<NotificationTarget>;
  notificationStatus(): Promise<z.infer<typeof NotificationObservationStatusSchema>>;
}
export function createNotificationQueries(transport: DashboardTransport): NotificationQueries {
  return Object.freeze({
    async notificationCollection(operation: NotificationCollectionOperation) {
      const path = `/api/v1/notifications/collection?operation=${NotificationCollectionOperationSchema.parse(operation)}`;
      return parseOrThrow(NotificationCollectionTargetSchema, "GET notification collection", await transport.requestJson(path));
    },
    async notificationSnapshot() { return parseOrThrow(z.array(NotificationWireSchema), "GET notifications", await transport.requestJson("/api/v1/notifications")); },
    async notificationTarget(id: string) {
      const path = `/api/v1/notifications/${NotificationIdSchema.parse(id)}/target`;
      return parseOrThrow(NotificationTargetSchema, "GET notification target", await transport.requestJson(path));
    },
    async notificationStatus() {
      return parseOrThrow(NotificationObservationStatusSchema, "GET notification status", await transport.requestJson("/api/v1/notifications/status"));
    },
  });
}
