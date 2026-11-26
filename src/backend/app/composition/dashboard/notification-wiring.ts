import { isDeepStrictEqual } from "node:util";
import { compareNotificationRows, notificationListProjection, notificationProjection, type ServedNotificationRecord } from "../../../runs/projections/notification-list.js";
import { upsertListedRow, type NotificationWire } from "../../../../models/dashboard/projection.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import type { NotificationCollectionOperation } from "../../../../models/notifications/notifications.js";
import { NotificationTriggerEventSchema, notificationStandingSources } from "../../../../rules/notifications/notification-triggers.js";
import { createNotificationDisplayContext, notificationDisplayRunId } from "../../../runs/queries/notification-display.js";
import type { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import type { createDashboardApp } from "../../../transports/http/routes/api.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import type { composeShell } from "./shell.js";
import type { composeWriteSafety } from "./write-safety.js";
import { AuthoritySnapshotChangedError } from "../../../storage/sqlite/authority-errors.js";

type NotificationWiringInput = Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "clock" | "lifecycle" | "descriptors"> & Pick<ReturnType<typeof composeWriteSafety>, "runDetailDeps">;
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

function createProjectionDependencies({ database, lifecycle, descriptors, runDetailDeps }: NotificationWiringInput) {
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
export function composeNotificationPublications(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "notificationInbox">
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

type NotificationRoutes = NonNullable<Parameters<typeof createDashboardApp>[0]["notifications"]>;
type NotificationListSource = NonNullable<Parameters<typeof composeShell>[0]["notificationList"]>;

export function composeNotificationRoutes(input: NotificationWiringInput & Pick<ReturnType<typeof prepareDashboardRuntime>, "assertCurrent" | "notificationObserver"> & {
  notificationTarget: ReturnType<typeof createNotificationTargetQuery>;
  notificationReads?: ReturnType<typeof composeNotificationReads>;
  reportListReadFailure?: () => void;
}): NotificationRoutes & { streamList: NotificationListSource; pollList: () => void } {
  const { database, clock, assertCurrent, notificationObserver, notificationTarget } = input;
  const { list, collection } = input.notificationReads ?? composeNotificationReads(database);
  const projectionDependencies = createProjectionDependencies(input);
  const position = database.trackAuthorityTables(LIST_SOURCES, "poll-hint");
  const evidencePosition = database.trackAuthorityTables(SHARED_ROW_EVIDENCE);
  type List = ReturnType<typeof notificationListProjection>;
  type Member = Readonly<{ version: number; readOnlyHistory: boolean; until: number; row: NotificationWire; runId: string | undefined; runRevision: number | undefined }>;
  const retained = new Map<string, { position: number; evidence: number | undefined; from: number; until: number; rows: List; members: Map<string, Member> }>();
  const within = (entry: { from: number; until: number }, now: number) => now >= entry.from && now < entry.until;
  const project = (actor: string): List => {
    const current = position();
    const now = clock.nowMs();
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
  const snapshot = (actor: string) => database.withAuthorityReadSnapshot(() => project(actor));
  let streamed: readonly NotificationWire[] | undefined;
  let pollFailed = false;
  const listListeners = new Set<() => void>();
  return {
    withSnapshot: (actor, respond) => database.withAuthorityReadSnapshot(() => {
      const rows = project(actor);
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
    streamList: {
      read: () => {
        const rows = snapshot(LOCAL_OPERATOR_ACTOR_ID);
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
      const prior = retained.get(LOCAL_OPERATOR_ACTOR_ID);
      try {
        if (!pollFailed && prior?.rows === streamed && prior.position === position() && within(prior, clock.nowMs())) return;
        const rows = snapshot(LOCAL_OPERATOR_ACTOR_ID);
        const changed = pollFailed || !isDeepStrictEqual(rows, streamed);
        pollFailed = false;
        streamed = rows;
        if (!changed) return;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        if (!pollFailed) {
          pollFailed = true;
          input.reportListReadFailure?.();
        }
      }
      for (const listener of listListeners) listener();
    },
  };
}
