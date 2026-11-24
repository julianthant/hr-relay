import { type NotificationCollectionOperation, notificationMatchesCollection, notificationStanding, type NotificationRecord } from "../../../models/notifications/notifications.js";
import { notificationStandingSources } from "../../../rules/notifications/notification-triggers.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { TargetReference } from "../lifecycle/run-fan-out.js";
import { applied, type CommandApplication } from "./command-application.js";
import { reject } from "./command-refusal.js";

type NotificationCommand = Extract<CommandRequest, { family: "notification" }>;

export function executeNotification(
  repositories: AuthorityRepositories,
  request: NotificationCommand,
  now: string,
): CommandApplication {
  if (request.target.actorId !== request.requestedBy) {
    reject(request, "invalid-state", "notification target actor does not match the admitted command actor");
  }
  const sources = notificationStandingSources(repositories);
  if ("members" in request.target) {
    const operation: NotificationCollectionOperation = request.type === "notification-read-all" ? "read" : request.type === "notification-unread-all" ? "unread"
      : request.type === "notification-snooze-all" ? "snooze" : request.type === "notification-unsnooze-all" ? "unsnooze"
      : request.type === "notification-clear-all" ? "clear" : "clear-unread";
    const observed = repositories.notifications.collection(request.target.actorId, operation);
    if (canonicalJsonStringify(observed) !== canonicalJsonStringify(request.target)) reject(request, "invalid-state", "notification collection changed; reload the inbox");
    const rows = repositories.notifications.listByActor(request.target.actorId).filter(row => notificationMatchesCollection(row, operation, notificationStanding(row, sources)));
    const changes = rows.map(row => applyNotificationState(repositories, row, operation, now));
    return applied(request, changes.map(change => change.target), changes.map(change => change.version));
  }
  const current = repositories.notifications.get(request.target.notificationId);
  if (current === undefined) {
    reject(request, "target-not-found", `notification ${request.target.notificationId} does not exist`);
  }
  if (current.actorId !== request.target.actorId) {
    reject(
      request,
      "invalid-state",
      `notification ${request.target.notificationId} belongs to ${current.actorId}, not ${request.target.actorId}`,
    );
  }
  if (current.trigger === "backfill-gap") {
    reject(
      request,
      "policy-refused",
      "a pinned backfill gap cannot be marked read, marked unread, or snoozed; resnapshot and reconcile the affected work",
    );
  }
  if (current.clearedAt !== undefined) {
    reject(request, "invalid-state", `notification ${request.target.notificationId} is already cleared; reload the inbox`);
  }
  if (request.type === "notification-clear" && notificationStanding(current, sources)) {
    reject(request, "policy-refused", "this notice still waits on you; handle it before clearing it");
  }
  if (current.version !== request.target.expectedVersion) {
    reject(
      request,
      "invalid-state",
      `notification ${request.target.notificationId} moved to version ${String(current.version)} `
      + `(you loaded ${String(request.target.expectedVersion)}); reload the inbox`,
    );
  }
  const operation: NotificationCollectionOperation = request.type === "notification-read" ? "read" : request.type === "notification-unread" ? "unread"
    : request.type === "notification-snooze" ? "snooze" : request.type === "notification-unsnooze" ? "unsnooze" : "clear";
  const change = applyNotificationState(repositories, current, operation, now);
  return applied(request, [change.target], [change.version]);
}

function applyNotificationState(repositories: AuthorityRepositories, current: NotificationRecord, operation: NotificationCollectionOperation, now: string) {
  repositories.notifications.updateState({ notificationId: current.notificationId, expectedVersion: current.version,
    status: operation === "read" ? "read" : operation === "unread" ? "unread" : current.status,
    snooze: operation === "snooze" ? { state: "snoozed", until: new Date(Date.parse(now) + 3_600_000).toISOString() }
      : operation === "unsnooze" ? { state: "not-snoozed" } : current.snooze,
    ...(operation === "clear" || operation === "clear-unread" ? { clearedAt: now } : {}), updatedAt: now });
  const target: TargetReference = { family: "notification", notificationId: current.notificationId };
  return { target, version: { target, before: current.version, after: current.version + 1 } };
}
