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

/** `target` is the read `GET /notifications/{id}/target` serves; each publication carries its answer.
 * `listed` is the row as `GET /notifications` lists it in the same read snapshot: a storage notice inside its concern's group.
 * A publication its actor's list does not hold is a named failure, never sent as its own row. */
export function composeNotificationPublications(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "notificationInbox">
  & { target: ReturnType<typeof composeNotificationRoutes>["target"] }): NonNullable<Parameters<typeof composeShell>[0]["notificationPublications"]> {
  const { database, clock, notificationInbox, target } = input;
  const deps = projectionDependencies(input);
  return { subscribe: notificationInbox.onPublication,
    target: publication => target(publication.notification.notificationId, publication.notification.actorId),
    project: publication => database.withAuthorityReadSnapshot(() => {
      const { actorId, notificationId } = publication.notification;
      const now = clock.nowMs();
      const notification = notificationProjection(publication.notification, now, { ...deps,
        source: () => ({ actorId, notificationId, adopted: false, event: publication.event }),
      });
      const listed = notificationListProjection(database.authority.notifications.listByActor(actorId), now, deps)
        .find(row => row.notificationId === notificationId || (row.kind === "notification" && row.group?.members.some(member => member.notificationId === notificationId) === true));
      // The publication is committed before it is projected, so the actor's list always holds it.
      if (listed === undefined) throw new Error(`NOTIFICATION_PUBLICATION_NOT_LISTED: ${notificationId}`);
      return { publication: { sourceId: FingerprintSchema.parse(publication.sourceId), actorId, durable: publication.durable, notification }, listed };
    }) };
}

export function composeNotificationRoutes(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "assertCurrent" | "notificationObserver"> & { notificationTarget: ReturnType<typeof createNotificationTargetQuery> }): NonNullable<Parameters<typeof createDashboardApp>[0]["notifications"]> {
  const { database, clock, assertCurrent, notificationObserver, notificationTarget } = input;
  const deps = projectionDependencies(input);
  const position = database.trackAuthorityTables(["notifications"]);
  let retained: { actor: string; position: number; from: number; until: number } | undefined;
  const project = (actor: string) => notificationListProjection(database.authority.notifications.listByActor(actor), clock.nowMs(), deps);
  return {
    withSnapshot: (actor, respond) => database.withAuthorityReadSnapshot(() => {
      const current = position();
      if (retained && retained.actor === actor && retained.position === current) {
        const now = clock.nowMs();
        if (now >= retained.from && now < retained.until) return respond(retained, () => project(actor));
      }
      const records = database.authority.notifications.listByActor(actor);
      const now = clock.nowMs();
      let until = Infinity;
      for (const record of records) {
        if (record.snooze.state !== "snoozed") continue;
        const expiry = Date.parse(record.snooze.until);
        if (expiry > now) until = Math.min(until, expiry);
      }
      const candidate = current === undefined ? undefined : { actor, position: current, from: now, until };
      let usedDisplay = false;
      const result = respond(candidate, () => notificationListProjection(records, now, {
        source: id => deps.source(id),
        get display() { usedDisplay = true; return deps.display; },
      }));
      // Display context can read run, command and retained timeline evidence outside the inbox table.
      retained = usedDisplay ? undefined : candidate;
      return result;
    }),
    collection: (actor, operation) => {
      assertCurrent();
      const value = database.withAuthorityReadSnapshot(() => database.authority.notifications.collection(actor, operation));
      assertCurrent();
      return value;
    },
    snapshot: actor => database.withAuthorityReadSnapshot(() => project(actor)),
    target: (id, actor) => database.withAuthorityReadSnapshot(() => notificationTarget(id, actor)),
    status: notificationObserver.status,
  };
}
