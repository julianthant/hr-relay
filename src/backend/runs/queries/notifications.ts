import { ActorIdSchema, NotificationIdSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import type { RunExistence } from "../../../models/config/authority.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import { NotificationTargetSchema, type NotificationRecord, type NotificationTarget } from "../../../models/notifications/notifications.js";

export function createNotificationTargetQuery(deps: {
  get(id: string): NotificationRecord | undefined;
  read(id: string): RunExistence;
  failure(id: string): FailureRecord | undefined;
}) {
  return (id: string, actor: string): NotificationTarget => {
    const notificationId = NotificationIdSchema.parse(id), actorId = ActorIdSchema.parse(actor);
    const refused = (reason: Extract<NotificationTarget, { kind: "refused" }>["reason"]): NotificationTarget => ({ kind: "refused", reason });
    try {
      const row = deps.get(notificationId);
      if (row === undefined) return refused("notification-unavailable");
      if (row.actorId !== actorId) return refused("wrong-actor");
      if (row.trigger === "backfill-gap") return refused("pinned");
      const link = row.links[0];
      if (link === undefined) return refused("target-unavailable");
      if (link.kind === "storage") return { kind: "storage" };
      const current = deps.read(link.runId);
      if (current.state !== "present") return refused("run-unavailable");
      const day = localDatePart(new Date(current.run.envelope.enqueuedAt));
      if (link.kind === "failure") {
        const failure = deps.failure(link.failureId);
        if (failure === undefined || failure.runId !== link.runId || current.run.lifecycle.state !== "terminal" || current.run.lifecycle.failureId !== link.failureId) return refused("failure-unavailable");
        return NotificationTargetSchema.parse({ kind: "failure", runId: link.runId, failureId: link.failureId, day });
      }
      return NotificationTargetSchema.parse({ kind: "run", runId: link.runId, day });
    } catch {
      // Parser diagnostics can contain private row values.
      return refused("target-unavailable");
    }
  };
}
