import { notificationSourceEventOf,notificationWireOf } from "../../../../models/dashboard/projection.js";
import { FingerprintSchema } from "../../../../rules/identity/ids.js";
import { notificationDisplayContext } from "../../../runs/queries/notification-display.js";
import type { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import type { createDashboardApp } from "../../../transports/http/routes/api.js";
import type { prepareDashboardRuntime } from "./runtime-startup.js";
import type { composeShell } from "./shell.js";

import type { composeWriteSafety } from "./write-safety.js";

type NotificationWiringInput = Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "database" | "clock" | "lifecycle" | "descriptors"> & Pick<Awaited<ReturnType<typeof composeWriteSafety>>, "runDetailDeps">;

export function composeNotificationPublications(input: NotificationWiringInput & Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "notificationInbox">): NonNullable<Parameters<typeof composeShell>[0]["notificationPublications"]> {
  const { database, clock, lifecycle, descriptors, runDetailDeps, notificationInbox } = input;
  return { subscribe: notificationInbox.onPublication, project: publication => database.withAuthorityReadSnapshot(() => ({
      sourceId: FingerprintSchema.parse(publication.sourceId), actorId: publication.notification.actorId, durable: publication.durable,
      notification: notificationWireOf(publication.notification, clock.nowMs(), notificationDisplayContext(publication.notification, {
        presentation: runDetailDeps,
        read: id => lifecycle.read(id), descriptor: id => descriptors.resolve(id),
        receipt: id => database.authority.evidenceReceipts.findByRun(id),
        checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
      }), notificationSourceEventOf(publication.notification, { actorId: publication.notification.actorId, notificationId: publication.notification.notificationId, adopted: false, event: publication.event })),
    })) };
}

export function composeNotificationRoutes(input: NotificationWiringInput & Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "assertCurrent" | "notificationObserver"> & { notificationTarget: ReturnType<typeof createNotificationTargetQuery> }): NonNullable<Parameters<typeof createDashboardApp>[0]["notifications"]> {
  const { database, clock, lifecycle, descriptors, runDetailDeps, assertCurrent, notificationObserver, notificationTarget } = input;
  return { collection: (actor, operation) => { assertCurrent(); const value = database.withAuthorityReadSnapshot(() => database.authority.notifications.collection(actor, operation)); assertCurrent(); return value; }, snapshot: actor => database.withAuthorityReadSnapshot(() => database.authority.notifications.listByActor(actor).map(record => notificationWireOf(record, clock.nowMs(), notificationDisplayContext(record, {
      presentation: runDetailDeps,
      read: id => lifecycle.read(id), descriptor: id => descriptors.resolve(id),
        receipt: id => database.authority.evidenceReceipts.findByRun(id),
      checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
    }), notificationSourceEventOf(record, database.authority.notificationPublications.latest(record.notificationId))))), target: (id, actor) => database.withAuthorityReadSnapshot(() => notificationTarget(id, actor)), status: notificationObserver.status };
}
