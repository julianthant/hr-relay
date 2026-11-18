import { notificationListProjection, notificationProjection } from "../../../runs/projections/notification-list.js";
import { FingerprintSchema } from "../../../../rules/identity/ids.js";
import type { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import type { createDashboardApp } from "../../../transports/http/routes/api.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import type { composeShell } from "./shell.js";
import type { composeWriteSafety } from "./write-safety.js";

type NotificationWiringInput = Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "clock" | "lifecycle" | "descriptors"> & Pick<ReturnType<typeof composeWriteSafety>, "runDetailDeps">;

function projectionDependencies({ database, lifecycle, descriptors, runDetailDeps }: NotificationWiringInput): Parameters<typeof notificationListProjection>[2] {
  return {
    display: {
      presentation: runDetailDeps,
      read: id => lifecycle.read(id),
      descriptor: id => descriptors.resolve(id),
      receipt: id => database.authority.evidenceReceipts.findByRun(id),
      command: id => database.authority.commands.get(id),
      checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
    },
    source: id => database.authority.notificationPublications.latest(id),
  };
}

export function composeNotificationPublications(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "notificationInbox">): NonNullable<Parameters<typeof composeShell>[0]["notificationPublications"]> {
  const { database, clock, notificationInbox } = input;
  const deps = projectionDependencies(input);
  return { subscribe: notificationInbox.onPublication, project: publication => database.withAuthorityReadSnapshot(() => ({
    sourceId: FingerprintSchema.parse(publication.sourceId), actorId: publication.notification.actorId, durable: publication.durable,
    notification: notificationProjection(publication.notification, clock.nowMs(), { ...deps,
      source: () => ({ actorId: publication.notification.actorId, notificationId: publication.notification.notificationId, adopted: false, event: publication.event }),
    }),
  })) };
}

export function composeNotificationRoutes(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "assertCurrent" | "notificationObserver"> & { notificationTarget: ReturnType<typeof createNotificationTargetQuery> }): NonNullable<Parameters<typeof createDashboardApp>[0]["notifications"]> {
  const { database, clock, assertCurrent, notificationObserver, notificationTarget } = input;
  const deps = projectionDependencies(input);
  return {
    collection: (actor, operation) => {
      assertCurrent();
      const value = database.withAuthorityReadSnapshot(() => database.authority.notifications.collection(actor, operation));
      assertCurrent();
      return value;
    },
    snapshot: actor => database.withAuthorityReadSnapshot(() => notificationListProjection(database.authority.notifications.listByActor(actor), clock.nowMs(), deps)),
    target: (id, actor) => database.withAuthorityReadSnapshot(() => notificationTarget(id, actor)),
    status: notificationObserver.status,
  };
}
