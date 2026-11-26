import { notificationListProjection, notificationProjection, type ServedNotificationRecord } from "../../../runs/projections/notification-list.js";
import { z } from "zod";
import { ActorIdSchema, FingerprintSchema, NotificationIdSchema } from "../../../../rules/identity/ids.js";
import { NotificationCollectionOperationSchema, NotificationCollectionTargetSchema, type NotificationCollectionOperation } from "../../../../models/notifications/notifications.js";
import { NotificationTargetSchema } from "../../../../models/notifications/notification-target.js";
import { NotificationWireSchema } from "../../../../models/dashboard/projection.js";
import { notificationStandingSources } from "../../../../rules/notifications/notification-triggers.js";
import { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import type { RunTimelineEvidenceSource } from "../../../runs/queries/run-timeline-compatibility.js";
import { createRunReadLaneReader } from "../../../runs/queries/item-attempt-history.js";
import { ocrHostRun } from "../../../runs/queries/ocr-record-members.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { defineLaneRead, type DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { SERVER_REGISTRY } from "../../registries/workflow-registry.js";
import type { createDashboardApp } from "../../../transports/http/routes/api.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import type { composeShell } from "./shell.js";
import type { composeWriteSafety } from "./write-safety.js";
import { AuthoritySnapshotChangedError } from "../../../storage/sqlite/authority-errors.js";

type NotificationWiringInput = Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "clock" | "lifecycle" | "descriptors"> & Pick<ReturnType<typeof composeWriteSafety>, "runDetailDeps">;

export function composeNotificationReads(database: NotificationWiringInput["database"], history: NotificationWiringInput["database"] = database) {
  const native = database.authority.notifications;
  const list = (actor: string): readonly ServedNotificationRecord[] => {
    if (history === database) return native.listByActor(actor);
    return history.withAuthorityReadSnapshot(() => database.withAuthorityReadSnapshot(() => {
      // Both connections must see the same native rows before absence can identify an archive row.
      if (history.getMeta().authorityGeneration !== database.getMeta().authorityGeneration) throw new AuthoritySnapshotChangedError();
      const nativeIds = new Set(native.listByActor(actor).map(record => record.notificationId));
      return history.authority.notifications.listByActor(actor)
        .map<ServedNotificationRecord>(record => nativeIds.has(record.notificationId) ? record : { ...record, readOnlyHistory: true });
    }));
  };
  return { list, collection: (actor: string, operation: NotificationCollectionOperation) =>
    database.withAuthorityReadSnapshot(() => native.collection(actor, operation)) };
}

/** The target `GET /notifications/{id}/target` serves, over the history connection and its run reader. */
export function createHistoryNotificationTarget(history: AuthorityDatabase, reader: Pick<RunRecordService, "read">) {
  return createNotificationTargetQuery({ get: history.authority.notifications.get, read: id => reader.read(id), failure: history.authority.failures.get,
    host: run => history.withAuthorityReadSnapshot(() => ocrHostRun(history.authority, run)),
    command: commandId => history.authority.commands.readForNotice(commandId),
    bulk: bulkCommandId => { const acceptance = history.authority.commands.getBulk(bulkCommandId); return acceptance === undefined ? undefined : { acceptance, children: history.authority.commands.listBulkChildren(bulkCommandId) }; } });
}

type ProjectionInput = Pick<NotificationWiringInput, "database" | "lifecycle" | "descriptors"> & { presentation: RunTimelineEvidenceSource };
function projectionDependencies({ database, lifecycle, descriptors, presentation }: ProjectionInput): Parameters<typeof notificationListProjection>[2] {
  return {
    display: {
      presentation,
      read: id => lifecycle.read(id),
      descriptor: id => descriptors.resolve(id),
      receipt: id => database.authority.evidenceReceipts.findByRun(id),
      command: id => database.authority.commands.get(id),
      checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
    },
    source: id => database.authority.notificationPublications.latest(id),
    standing: notificationStandingSources({
      runs: { get: id => database.authority.runs.get(id) },
      notificationPublications: { latest: id => database.authority.notificationPublications.latest(id) },
      notificationHealth: { get: concern => database.authority.notificationHealth.get(concern) },
      commands: { readForNotice: id => database.authority.commands.readForNotice(id) },
    }),
  };
}

/** `target` is the read `GET /notifications/{id}/target` serves; each publication carries its answer.
 * `listed` is the row as `GET /notifications` lists it in the same read snapshot: a storage notice inside its concern's group.
 * A publication its actor's list does not hold is a named failure, never sent as its own row. */
export function composeNotificationPublications(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "notificationInbox">
  & { target: ReturnType<typeof composeNotificationRoutes>["target"] }): NonNullable<Parameters<typeof composeShell>[0]["notificationPublications"]> {
  const { database, clock, notificationInbox, target } = input;
  const deps = projectionDependencies({ ...input, presentation: input.runDetailDeps });
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

const NotificationLaneRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("list"), actor: ActorIdSchema }),
  z.strictObject({ kind: z.literal("collection"), actor: ActorIdSchema, operation: NotificationCollectionOperationSchema }),
  z.strictObject({ kind: z.literal("target"), id: NotificationIdSchema, actor: ActorIdSchema }),
]);

/** The notification GETs, built and validated in the lane: the list, the collection target and a row's destination. */
const notificationLaneRead = defineLaneRead(import.meta.url, "notifications", {
  lane: "navigation", priority: "interactive", args: NotificationLaneRequestSchema,
  run({ native, history, nowMs }, request) {
    if (request.kind === "collection") return NotificationCollectionTargetSchema.parse(native.authority.notifications.collection(request.actor, request.operation));
    const reader = createRunReadLaneReader(history);
    if (request.kind === "target") return NotificationTargetSchema.parse(createHistoryNotificationTarget(history, reader)(request.id, request.actor));
    const presentation: RunTimelineEvidenceSource = { timeline: history.authority.timelineEvents, authority: {
      listCheckpoints: (workflowId, itemId) => history.authority.runCheckpoints.listByItem(workflowId, itemId),
      listGateResults: runId => history.authority.gateResults.listByRun(runId),
    } };
    const deps = projectionDependencies({ database: history, lifecycle: reader, presentation,
      descriptors: { resolve: workflowId => SERVER_REGISTRY[workflowId]?.descriptor } });
    return z.array(NotificationWireSchema).parse(notificationListProjection(composeNotificationReads(native, history).list(request.actor), nowMs, deps));
  },
});

export function composeNotificationRoutes(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "assertCurrent" | "notificationObserver"> & {
  notificationTarget: ReturnType<typeof createNotificationTargetQuery>;
  notificationReads?: ReturnType<typeof composeNotificationReads>;
  readLanes?: Pick<DashboardReadLanes, "read">;
}): NonNullable<Parameters<typeof createDashboardApp>[0]["notifications"]> {
  const { database, clock, assertCurrent, notificationObserver, notificationTarget, readLanes } = input;
  const { list, collection } = input.notificationReads ?? composeNotificationReads(database);
  const deps = projectionDependencies({ ...input, presentation: input.runDetailDeps });
  const laneRead = async (request: z.input<typeof NotificationLaneRequestSchema>, signal?: AbortSignal) => {
    if (readLanes === undefined) throw new Error("notification-lane-missing");
    const parsed = NotificationLaneRequestSchema.parse(request);
    return (await readLanes.read(notificationLaneRead, parsed, signal === undefined ? {} : { signal })).body;
  };
  const position = database.trackAuthorityTables(["notifications", "notification_states"]);
  let retained: { actor: string; position: number; from: number; until: number } | undefined;
  const project = (actor: string) => notificationListProjection(list(actor), clock.nowMs(), deps);
  return {
    withSnapshot: (actor, respond) => database.withAuthorityReadSnapshot(() => {
      const current = position();
      if (retained && retained.actor === actor && retained.position === current) {
        const now = clock.nowMs();
        if (now >= retained.from && now < retained.until) return respond(retained, () => project(actor));
      }
      const records = list(actor);
      const now = clock.nowMs();
      let until = Infinity;
      for (const record of records) {
        if (record.readOnlyHistory === true || record.snooze.state !== "snoozed") continue;
        const expiry = Date.parse(record.snooze.until);
        if (expiry > now) until = Math.min(until, expiry);
      }
      const candidate = current === undefined ? undefined : { actor, position: current, from: now, until };
      let usedDisplay = false;
      const result = respond(candidate, () => notificationListProjection(records, now, {
        source: id => deps.source(id),
        get display() { usedDisplay = true; return deps.display; },
        standing: {
          runPark: id => { usedDisplay = true; return deps.standing.runPark(id); },
          noticePark: id => deps.standing.noticePark(id),
          storageConcern: id => deps.standing.storageConcern(id),
          concernActive: concern => deps.standing.concernActive(concern),
          commandSettled: id => { usedDisplay = true; return deps.standing.commandSettled(id); },
        },
      }));
      // Display context and run or command standing read evidence outside the tracked tables; health is tracked.
      retained = usedDisplay ? undefined : candidate;
      return result;
    }),
    collection: (actor, operation) => {
      assertCurrent();
      const value = collection(actor, operation);
      assertCurrent();
      return value;
    },
    snapshot: actor => database.withAuthorityReadSnapshot(() => project(actor)),
    target: (id, actor) => database.withAuthorityReadSnapshot(() => notificationTarget(id, actor)),
    status: notificationObserver.status,
    // The assistant and the stream's publications keep the synchronous reads above; the routes read on the lane.
    ...(readLanes === undefined ? {} : { lane: {
      list: (actor: string, signal?: AbortSignal) => laneRead({ kind: "list", actor }, signal),
      collection: async (actor: string, operation: NotificationCollectionOperation) => {
        assertCurrent();
        const body = await laneRead({ kind: "collection", actor, operation });
        assertCurrent();
        return body;
      },
      target: (id: string, actor: string) => laneRead({ kind: "target", id, actor }),
    } }),
  };
}
