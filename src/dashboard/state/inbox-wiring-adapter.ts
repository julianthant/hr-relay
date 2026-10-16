import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import type { DashboardClient } from "../client/index.js";
import type { DsToast } from "../ds/ui.js";
import { NotificationWireSchema, type NotificationWire } from "../../models/dashboard/projection.js";
import type { NotificationPublicationWire } from "../../models/dashboard/subscription.js";
import type { NotificationTarget } from "../../models/notifications/notifications.js";
import type { NotificationTriggerEvent } from "../../rules/notifications/notification-triggers.js";
import { NotificationCommandRequestSchema } from "../../rules/commands/commands.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { verifyShellCommandEffect } from "../app/commands/command-dispatch.js";
import type { NotificationControl, NotificationDestination, NotificationItem, NotificationsState } from "../surfaces/notifications/notifications-view-model.js";

const policies = {
  "run-failed": { trigger: "failed", tone: "danger", detail: "Review the failed run before continuing." },
  "subject-mismatch": { trigger: "failed", tone: "danger", detail: "The subject identity did not match. Review the failure before continuing." },
  "gate-opened": { trigger: "gate-waiting", tone: "warning", detail: "This run is waiting for your review." },
  "write-parked": { trigger: "write-parked", tone: "warning", detail: "A write is parked. Review its evidence before continuing." },
  "repeating-failure": { trigger: "repeating", tone: "danger", detail: "A failure crossed its repetition threshold. Review the failure." },
  "storage-degraded": { trigger: "storage", tone: "warning", detail: "Review Storage in Settings before starting more work." },
  "verified-done": { trigger: "verified-done", tone: "positive", detail: "Completed with the required verification evidence." },
  "backfill-gap": { trigger: "backfill-gap", tone: "warning", detail: "Notification history is incomplete. Reconcile the affected work." },
} as const satisfies Readonly<Record<NotificationTriggerEvent["kind"], { trigger: string; tone: NotificationItem["tone"]; detail: string }>>;

export const inboxMessage = (code: "DASHBOARD_READ_FAILED" | "NOTIFICATION_SOURCE_UNAVAILABLE" | "NOTIFICATION_HISTORY_INCOMPLETE" | "NOTIFICATION_OBSERVATION_FAILED" | "NOTIFICATION_RECEIPT_MISSING" | "NOTIFICATION_CONTEXT_UNAVAILABLE" | "NOTIFICATION_COMMAND_PENDING" | "NOTIFICATION_TARGET_UNAVAILABLE" | "NOTIFICATION_REFRESH_PENDING") => formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text;

export function notificationPolicy(row: NotificationWire) {
  const source = row.sourceEvent;
  const policy = source?.state === "available" ? Object.entries(policies).find(([kind]) => kind === source.kind)?.[1] : undefined;
  return policy?.trigger === (row.kind === "backfill-gap" ? "backfill-gap" : row.trigger) ? policy : undefined;
}

export function notificationTargetMatches(row: NotificationWire, target: NotificationTarget): boolean {
  if (row.kind !== "notification") return false;
  const link = row.link;
  if (target.kind === "storage") return link?.kind === "storage";
  if (target.kind === "run") return link?.kind === "run" && link.runId === target.runId;
  if (target.kind === "failure") return link?.kind === "failure" && link.runId === target.runId && link.failureId === target.failureId;
  return false;
}

function notificationItem(row: Extract<NotificationWire, { kind: "notification" }>, nowIso: string): NotificationItem {
  const policy = notificationPolicy(row);
  const elapsed = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(row.occurredAt)) / 60000));
  const context = row.context;
  return { id: row.notificationId, title: row.title,
      subject: context.state === "available" ? context.subject : inboxMessage("NOTIFICATION_CONTEXT_UNAVAILABLE"),
      workflow: context.state === "available" || context.state === "workflow-only" ? context.workflow : "",
      detail: policy?.detail ?? inboxMessage("NOTIFICATION_SOURCE_UNAVAILABLE"),
      tone: policy?.tone ?? (row.severity === "error" ? "danger" : row.severity === "warning" ? "warning" : "info"),
      age: elapsed < 1 ? "Just now" : elapsed < 60 ? `${elapsed} min ago` : elapsed < 1440 ? `${Math.floor(elapsed / 60)} hr ago` : `${Math.floor(elapsed / 1440)} days ago`,
      read: row.readState === "read", action: row.link?.kind === "storage" ? "Open Storage" : "Open log",
      destination: { kind: "refused", reason: "target-unavailable" },
    };
}

export function inboxProjection(rows: readonly NotificationWire[], nowIso: string): { state: NotificationsState; notice: string } {
  const notices = new Set<string>();
  const items: NotificationItem[] = [];
  for (const row of rows) {
    if (row.kind === "backfill-gap") { notices.add(inboxMessage("NOTIFICATION_HISTORY_INCOMPLETE")); continue; }
    const policy = notificationPolicy(row);
    if (policy === undefined) notices.add(inboxMessage("NOTIFICATION_SOURCE_UNAVAILABLE"));
    items.push(notificationItem(row, nowIso));
  }
  return { state: { state: "ready", items, pinned: [] }, notice: [...notices].join(" ") };
}

export interface InboxWiring {
  readonly state: NotificationsState;
  readonly notice: string;
  control(id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean>;
  readAll(): Promise<void>;
  open(item: NotificationItem, navigate: (target: NotificationDestination, opened: () => void, refused: (message: string) => void) => void, opened: () => void, refused: (message: string) => void): void;
}

export function useInboxWiring({ client, enabled, binding, toast, openInbox }: { client: DashboardClient; enabled: boolean; binding: DashboardCommandBinding;
  toast: (input: Omit<DsToast, "id">) => string; openInbox: () => void }): InboxWiring {
  const request = useMemo(() => ({ client, enabled, scope: binding.scope }), [client, enabled, binding.scope]);
  const current = useRef({ request, binding, toast, openInbox, fresh: false }); current.current = { request, binding, toast, openInbox, fresh: false };
  const [revision, refresh] = useState(0);
  const readEpoch = useRef(0);
  const [settled, setSettled] = useState<{ request: typeof request; read: object; rows: readonly NotificationWire[] | undefined; notice: string; failed?: boolean }>();
  const [commandNotice, setCommandNotice] = useState<{ request: typeof request; text: string }>();
  const [publicationNotice, setPublicationNotice] = useState<{ request: typeof request; text: string }>();
  const subscribePublications = binding.authority.dayState.subscribePublications;
  const day = binding.authority.dayState.day;
  const snapshotKey = day.state === "loaded" ? canonicalJsonStringify(day.value.notifications) : day.state;
  const read = useMemo(() => ({ request, revision, snapshotKey }), [request, revision, snapshotKey]);
  current.current.fresh = settled?.request === request && settled.read === read && !settled.failed;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const token = ++readEpoch.current;
    void Promise.all([client.notificationSnapshot(), client.notificationStatus()]).then(([rows, status]) => {
      if (!active || token !== readEpoch.current || current.current.request !== request) return;
      if (rows.some(row => row.actorId !== request.scope.actorId) || new Set(rows.map(row => row.notificationId)).size !== rows.length) throw new Error("NOTIFICATION_INBOX_IDENTITY_MISMATCH");
      const notice = status.state === "ready" ? "" : inboxMessage(status.code ?? "NOTIFICATION_OBSERVATION_FAILED");
      setSettled({ request, read, rows, notice });
    }).catch(() => {
      if (active && token === readEpoch.current && current.current.request === request) setSettled(previous => ({ request, read, rows: previous?.request === request ? previous.rows : undefined, notice: inboxMessage("DASHBOARD_READ_FAILED"), failed: true }));
    });
    return () => { active = false; };
  }, [client, enabled, request, read]);
  const rows = settled?.request === request ? settled.rows : undefined;
  const rowsRef = useRef(rows); rowsRef.current = rows;
  useEffect(() => {
    if (!enabled) return;
    const delivered = new Set<string>();
    return subscribePublications((publication: NotificationPublicationWire) => {
      if (current.current.request !== request || publication.actorId !== request.scope.actorId || delivered.has(publication.sourceId)) return;
      delivered.add(publication.sourceId);
      current.current.fresh = false;
      readEpoch.current++;
      refresh(value => value + 1);
      const row = publication.notification, policy = notificationPolicy(row);
      if (row.kind === "backfill-gap" || policy === undefined) {
        setPublicationNotice({ request, text: inboxMessage(row.kind === "backfill-gap" ? "NOTIFICATION_HISTORY_INCOMPLETE" : "NOTIFICATION_SOURCE_UNAVAILABLE") }); return;
      }
      if (row.state === "snoozed") return;
      void client.notificationTarget(row.notificationId).then(target => {
        if (current.current.request !== request) return;
        if (!notificationTargetMatches(row, target)) { setPublicationNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return; }
        const item = { ...notificationItem(row, current.current.binding.authority.nowIso), destination: target };
        current.current.toast({ tone: policy.tone === "positive" ? "success" : policy.tone, title: item.title,
          description: policy.tone === "positive" ? `${item.subject} · ${item.workflow}` : item.detail,
          action: { label: "Open notifications", onAction: () => { if (current.current.request === request) current.current.openInbox(); } } });
      }).catch(() => { if (current.current.request === request) setPublicationNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); });
    });
  }, [client, enabled, request, subscribePublications]);
  const control = async (id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean> => {
    if (!enabled || current.current.request !== request || !current.current.fresh) return false;
    const row = rowsRef.current?.find(row => row.notificationId === id);
    if (row?.kind !== "notification" || row.actorId !== request.scope.actorId) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return false; }
    const owner = current.current.binding;
    const retained = owner.executor.retainedAttempts().find(attempt => !("targets" in attempt.request) && attempt.request.family === "notification"
      && attempt.request.target.notificationId === id && attempt.request.target.actorId === request.scope.actorId
      && (attempt.state === "pending" || attempt.outcome?.kind === "uncertain"));
    if (retained !== undefined) { setCommandNotice({ request, text: retained.outcome?.kind === "uncertain" ? retained.outcome.feedback.text : inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return false; }
    const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.nowIso, requestedBy: request.scope.actorId,
      source: "dashboard", family: "notification", type: `notification-${action}`, target: { notificationId: id, actorId: request.scope.actorId, expectedVersion: row.revision } });
    setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") });
    const outcome = await owner.executor.execute(command, { scope: owner.scope, readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
      publish: outcome => {
        if (current.current.request !== request) return;
        if (outcome.kind === "confirmed") {
          const confirmed = NotificationWireSchema.parse(outcome.readback);
          const next = rowsRef.current?.map(row => row.notificationId === confirmed.notificationId ? confirmed : row);
          rowsRef.current = next;
          if (next !== undefined) setSettled(previous => previous?.request === request ? { ...previous, rows: next } : previous);
          setCommandNotice({ request, text: "" });
          if (!current.current.fresh) { readEpoch.current++; refresh(value => value + 1); }
        }
        else { setCommandNotice({ request, text: outcome.feedback.text }); owner.feedback(outcome); if (outcome.kind === "conflict") { current.current.fresh = false; refresh(value => value + 1); } }
      } });
    const replacement = current.current;
    if (replacement.request !== request && replacement.request.enabled && replacement.request.client === client
      && replacement.binding.scope.client === owner.scope.client && replacement.binding.scope.actorId === owner.scope.actorId
      && replacement.binding.scope.authority === owner.scope.authority) {
      replacement.fresh = false; readEpoch.current++; refresh(value => value + 1);
    }
    return current.current.request === request && outcome.kind === "confirmed";
  };
  const projection = rows === undefined ? { state: settled?.request === request && settled.failed ? { state: "unavailable" as const, reason: settled.notice } : { state: "loading" as const }, notice: "" }
    : inboxProjection(rows, binding.authority.nowIso);
  return { state: projection.state, notice: [rows !== undefined && !current.current.fresh && !settled?.failed ? inboxMessage("NOTIFICATION_REFRESH_PENDING") : "", projection.notice, settled?.request === request ? settled.notice : "", commandNotice?.request === request ? commandNotice.text : "", publicationNotice?.request === request ? publicationNotice.text : ""].filter(Boolean).join(" "),
    control,
    readAll: async () => { for (const row of rowsRef.current ?? []) if (row.kind === "notification" && row.readState === "unread" && !await control(row.notificationId, "read")) return; },
    open: (item, navigate, opened, refused) => {
      if (!enabled || current.current.request !== request || !current.current.fresh) return;
      void client.notificationTarget(item.id).then(target => {
        if (current.current.request !== request || !current.current.fresh) return;
        const row = rowsRef.current?.find(row => row.notificationId === item.id);
        if (row === undefined || (target.kind !== "refused" && target.kind !== "archive" && !notificationTargetMatches(row, target))) { refused(inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE")); return; }
        navigate(target, () => { if (current.current.request !== request) return; opened(); if (row.kind === "notification" && row.readState !== "read") void control(item.id, "read"); }, refused);
      }).catch(() => { if (current.current.request === request) refused(inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE")); });
    },
  };
}
