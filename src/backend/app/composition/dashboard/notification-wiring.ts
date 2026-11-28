import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { compareNotificationRows, notificationListProjection, notificationProjection, type ServedNotificationRecord } from "../../../runs/projections/notification-list.js";
import { NotificationWireSchema, upsertListedRow, type NotificationWire } from "../../../../models/dashboard/projection.js";
import { ActorIdSchema, FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID, NotificationIdSchema } from "../../../../rules/identity/ids.js";
import { NotificationCollectionOperationSchema, NotificationCollectionTargetSchema, type NotificationCollectionOperation } from "../../../../models/notifications/notifications.js";
import { NotificationTriggerEventSchema, notificationStandingSources } from "../../../../rules/notifications/notification-triggers.js";
import { createNotificationDisplayContext, notificationDisplayRunId } from "../../../runs/queries/notification-display.js";
import { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import { NotificationTargetSchema } from "../../../../models/notifications/notification-target.js";
import { createRunReadLaneReader } from "../../../runs/queries/item-attempt-history.js";
import { ocrHostRun } from "../../../runs/queries/ocr-record-members.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { RunTimelineEvidenceSource } from "../../../runs/queries/run-timeline-compatibility.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { defineLaneRead, type DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { SERVER_REGISTRY } from "../../registries/workflow-registry.js";
import type { createDashboardApp } from "../../../transports/http/routes/api.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import type { composeShell } from "./shell.js";
import type { composeWriteSafety } from "./write-safety.js";
import { AuthoritySnapshotChangedError } from "../../../storage/sqlite/authority-errors.js";

type NotificationWiringInput = Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "database" | "clock" | "lifecycle" | "descriptors"> & Pick<ReturnType<typeof composeWriteSafety>, "runDetailDeps">;
const RUN_EVIDENCE = ["runs", "deleted_runs", "run_checkpoints", "run_receipts", "gate_results", "timeline_events"] as const;
const SHARED_ROW_EVIDENCE = ["notification_states", "commands", "command_audits"] as const;
const LIST_SOURCES = ["notifications", ...SHARED_ROW_EVIDENCE, ...RUN_EVIDENCE] as const;

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

type NotificationProjectionInput = Pick<NotificationWiringInput, "database" | "descriptors"> & {
  lifecycle: Pick<RunRecordService, "read">;
  runDetailDeps: RunTimelineEvidenceSource;
};

function createProjectionDependencies({ database, lifecycle, descriptors, runDetailDeps }: NotificationProjectionInput) {
  const runEvidence = database.trackAuthorityRuns(RUN_EVIDENCE);
  const commandById = (id: string) => database.authority.commands.get(id);
  const display = createNotificationDisplayContext({
      presentation: runDetailDeps,
      read: id => lifecycle.read(id),
      descriptor: id => descriptors.resolve(id),
      receipt: id => database.authority.evidenceReceipts.findByRun(id),
      command: commandById,
      checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
  });
  return () => {
    const sources = new Map<string, ReturnType<typeof database.authority.notificationPublications.latest>>();
    const runs = new Map<string, ReturnType<typeof lifecycle.read>>();
    const commands = new Map<string, ReturnType<typeof commandById>>();
    const source = (id: string) => {
      if (!sources.has(id)) sources.set(id, database.authority.notificationPublications.latest(id));
      return sources.get(id);
    };
    const read = (id: string) => {
      const held = runs.get(id);
      if (held !== undefined) return held;
      const current = lifecycle.read(id);
      runs.set(id, current);
      return current;
    };
    const command = (id: string) => {
      if (!commands.has(id)) commands.set(id, commandById(id));
      return commands.get(id);
    };
    const revision = runEvidence() ?? (() => undefined);
    return { display: (record: ServedNotificationRecord) => display(record, revision, read, command), source,
      linkedRunId: (record: ServedNotificationRecord) => notificationDisplayRunId(record, command), revision, standing: notificationStandingSources({
      runs: { get: id => database.authority.runs.get(id) },
      notificationPublications: { latest: source },
      notificationHealth: { get: concern => database.authority.notificationHealth.get(concern) },
      commands: { readForNotice: id => database.authority.commands.readForNotice(id) },
    }) };
  };
}

/** `target` is the read `GET /notifications/{id}/target` serves; each publication carries its answer.
 * `listed` is the row as `GET /notifications` lists it in the same read snapshot: a storage notice inside its concern's group.
 * A publication its actor's list does not hold is a named failure, never sent as its own row. */
export function composeNotificationPublications(input: NotificationWiringInput & Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "notificationInbox">
  & { target: ReturnType<typeof composeNotificationRoutes>["target"] }): NonNullable<Parameters<typeof composeShell>[0]["notificationPublications"]> {
  const { database, clock, notificationInbox, target } = input;
  const projectionDependencies = createProjectionDependencies(input);
  return { subscribe: notificationInbox.onPublication,
    target: publication => target(publication.notification.notificationId, publication.notification.actorId),
    project: publication => database.withAuthorityReadSnapshot(() => {
      const { actorId, notificationId } = publication.notification;
      const now = clock.nowMs();
      const current = database.authority.notifications.get(notificationId);
      if (current === undefined || current.actorId !== actorId || current.clearedAt !== undefined) throw new Error(`NOTIFICATION_PUBLICATION_NOT_LISTED: ${notificationId}`);
      const deps = projectionDependencies();
      const notification = notificationProjection(publication.notification, now, { ...deps,
        source: () => ({ actorId, notificationId, adopted: false, event: publication.event }),
      });
      const event = publication.event;
      const listed = event.kind !== "storage-degraded" ? notification
        : notificationListProjection(database.authority.notifications.listByActor(actorId).filter(record => {
          if (record.trigger !== "storage" || record.clearedAt !== undefined) return false;
          const source = deps.source(record.notificationId)?.event;
          if (source === undefined) return false;
          const parsed = NotificationTriggerEventSchema.parse(source);
          return parsed.kind === "storage-degraded" && parsed.concern === event.concern;
        }), now, deps).find(row => row.notificationId === notificationId
          || (row.kind === "notification" && row.group?.members.some(member => member.notificationId === notificationId) === true));
      if (listed === undefined) throw new Error(`NOTIFICATION_PUBLICATION_NOT_LISTED: ${notificationId}`);
      return { publication: { sourceId: FingerprintSchema.parse(publication.sourceId), actorId, durable: publication.durable, notification }, listed };
    }) };
}

function createNotificationListProjector(input: NotificationProjectionInput, list: ReturnType<typeof composeNotificationReads>["list"]) {
  const { database } = input;
  const projectionDependencies = createProjectionDependencies(input);
  const position = database.trackAuthorityTables(LIST_SOURCES, "poll-hint");
  const evidencePosition = database.trackAuthorityTables(SHARED_ROW_EVIDENCE);
  type List = ReturnType<typeof notificationListProjection>;
  type Member = Readonly<{ version: number; readOnlyHistory: boolean; until: number; row: NotificationWire; runId: string | undefined; runRevision: number | undefined }>;
  const retained = new Map<string, { position: number; evidence: number | undefined; from: number; until: number; rows: List; members: Map<string, Member> }>();
  const within = (entry: { from: number; until: number }, now: number) => now >= entry.from && now < entry.until;
  const project = (actor: string, now: number): List => {
    const current = position();
    const prior = retained.get(actor);
    if (prior !== undefined && prior.position === current && within(prior, now)) return prior.rows;
    const records = list(actor);
    const evidence = evidencePosition();
    const previous = evidence !== undefined && prior?.evidence === evidence && prior.from <= now ? prior.members : undefined;
    const members = new Map<string, Member>();
    const deps = projectionDependencies();
    let until = Infinity;
    const projected = notificationListProjection(records, now, deps, (record, nowMs) => {
      const readOnlyHistory = record.readOnlyHistory === true;
      const saved = previous?.get(record.notificationId);
      if (saved?.version === record.version && saved.readOnlyHistory === readOnlyHistory && nowMs < saved.until
        && (saved.runId === undefined || saved.runRevision === deps.revision(saved.runId))) {
        members.set(record.notificationId, saved);
        until = Math.min(until, saved.until);
        return saved.row;
      }
      const expiry = !readOnlyHistory && record.snooze.state === "snoozed" ? Date.parse(record.snooze.until) : Infinity;
      const validUntil = expiry > nowMs ? expiry : Infinity;
      const row = notificationProjection(record, nowMs, deps);
      const runId = deps.linkedRunId(record);
      members.set(record.notificationId, { version: record.version, readOnlyHistory, until: validUntil, row,
        runId, runRevision: runId === undefined ? undefined : deps.revision(runId) });
      until = Math.min(until, validUntil);
      return row;
    });
    const rows = prior !== undefined && isDeepStrictEqual(projected, prior.rows) ? prior.rows : projected;
    if (current === undefined) retained.delete(actor);
    else retained.set(actor, { position: current, evidence, from: now, until, rows, members });
    return rows;
  };
  return { project, position, retained, within };
}

const NotificationLaneRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("list"), actor: ActorIdSchema }),
  z.strictObject({ kind: z.literal("collection"), actor: ActorIdSchema, operation: NotificationCollectionOperationSchema }),
  z.strictObject({ kind: z.literal("target"), id: NotificationIdSchema, actor: ActorIdSchema }),
]);

const laneProjectors = new WeakMap<AuthorityDatabase, ReturnType<typeof createNotificationListProjector>>();

/** The notification GETs, built and validated in the lane: the list, the collection target and a row's destination. */
const notificationLaneRead = defineLaneRead(import.meta.url, "notifications", {
  lane: "navigation", priority: "interactive", args: NotificationLaneRequestSchema,
  run({ native, history, nowMs }, request) {
    if (request.kind === "collection") return NotificationCollectionTargetSchema.parse(native.authority.notifications.collection(request.actor, request.operation));
    const reader = createRunReadLaneReader(history);
    if (request.kind === "target") return NotificationTargetSchema.parse(createHistoryNotificationTarget(history, reader)(request.id, request.actor));
    let projector = laneProjectors.get(history);
    if (projector === undefined) {
      const runDetailDeps: RunTimelineEvidenceSource = { timeline: history.authority.timelineEvents, authority: {
        listCheckpoints: (workflowId, itemId) => history.authority.runCheckpoints.listByItem(workflowId, itemId),
        listGateResults: runId => history.authority.gateResults.listByRun(runId),
      } };
      projector = createNotificationListProjector({ database: history, lifecycle: reader, runDetailDeps,
        descriptors: { resolve: workflowId => SERVER_REGISTRY[workflowId]?.descriptor } }, composeNotificationReads(native, history).list);
      laneProjectors.set(history, projector);
    }
    return z.array(NotificationWireSchema).parse(projector.project(request.actor, nowMs));
  },
});

type NotificationRoutes = NonNullable<Parameters<typeof createDashboardApp>[0]["notifications"]>;
type NotificationListSource = NonNullable<Parameters<typeof composeShell>[0]["notificationList"]>;

export function composeNotificationRoutes(input: NotificationWiringInput & Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "assertCurrent" | "notificationObserver"> & {
  notificationTarget: ReturnType<typeof createNotificationTargetQuery>;
  notificationReads?: ReturnType<typeof composeNotificationReads>;
  readLanes?: Pick<DashboardReadLanes, "read">;
  reportListReadFailure?: () => void;
}): NotificationRoutes & { streamList: NotificationListSource; pollList: () => Promise<void> | void } {
  const { database, clock, assertCurrent, notificationObserver, notificationTarget, readLanes } = input;
  const { list, collection } = input.notificationReads ?? composeNotificationReads(database);
  const { project, position, retained, within } = createNotificationListProjector(input, list);
  const snapshot = (actor: string) => database.withAuthorityReadSnapshot(() => project(actor, clock.nowMs()));
  let streamed: readonly NotificationWire[] | undefined;
  let pollFailure: Error | undefined;
  let pollPending: Promise<void> | undefined;
  let decoded: { body: string; rows: NotificationWire[] } | undefined;
  const laneRead = async (request: z.input<typeof NotificationLaneRequestSchema>, signal?: AbortSignal) => {
    if (readLanes === undefined) throw new Error("notification-lane-missing");
    const parsed = NotificationLaneRequestSchema.parse(request);
    return (await readLanes.read(notificationLaneRead, parsed, signal === undefined ? {} : { signal })).body;
  };
  const listListeners = new Set<() => void>();
  const readLaneList = async () => {
    const body = await laneRead({ kind: "list", actor: LOCAL_OPERATOR_ACTOR_ID });
    if (decoded?.body === body) return decoded.rows;
    const rows = z.array(NotificationWireSchema).parse(JSON.parse(body));
    decoded = { body, rows };
    return rows;
  };
  const notify = () => { for (const listener of listListeners) listener(); };
  const settlePoll = (rows: NotificationWire[]) => {
    const changed = pollFailure !== undefined || !isDeepStrictEqual(rows, streamed);
    pollFailure = undefined;
    streamed = rows;
    if (changed) notify();
  };
  const reportPollFailure = (error: unknown) => {
    if (!(error instanceof Error)) throw error;
    if (pollFailure === undefined) {
      pollFailure = error;
      input.reportListReadFailure?.();
    }
    notify();
  };
  return {
    withSnapshot: (actor, respond) => database.withAuthorityReadSnapshot(() => {
      const rows = project(actor, clock.nowMs());
      return respond(retained.has(actor) ? rows : undefined, () => rows);
    }),
    collection: (actor, operation) => {
      assertCurrent();
      const value = collection(actor, operation);
      assertCurrent();
      return value;
    },
    snapshot,
    target: (id, actor) => database.withAuthorityReadSnapshot(() => notificationTarget(id, actor)),
    status: notificationObserver.status,
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
    streamList: {
      read: readLanes === undefined ? () => {
        const rows = snapshot(LOCAL_OPERATOR_ACTOR_ID);
        streamed ??= rows;
        return rows;
      } : async () => {
        const rows = await readLaneList();
        streamed ??= rows;
        return rows;
      },
      notePublication: row => {
        if (streamed !== undefined) streamed = [...upsertListedRow(streamed, row)].sort(compareNotificationRows);
      },
      onChange: listener => { listListeners.add(listener); return () => { listListeners.delete(listener); }; },
    },
    pollList: () => {
      if (streamed === undefined || listListeners.size === 0) return;
      if (readLanes !== undefined) {
        if (pollPending !== undefined) return pollPending;
        const before = streamed;
        // A publication delivered during the lane read already moved the stream past that poll's starting point.
        pollPending = readLaneList().then(rows => {
          if (streamed === before) settlePoll(rows);
        }, (error: unknown) => {
          if (streamed === before) reportPollFailure(error);
        }).finally(() => { pollPending = undefined; });
        return pollPending;
      }
      const prior = retained.get(LOCAL_OPERATOR_ACTOR_ID);
      let rows: NotificationWire[];
      try {
        if (pollFailure === undefined && prior?.rows === streamed && prior.position === position() && within(prior, clock.nowMs())) return;
        rows = snapshot(LOCAL_OPERATOR_ACTOR_ID);
      } catch (error) {
        reportPollFailure(error);
        return;
      }
      settlePoll(rows);
    },
  };
}
