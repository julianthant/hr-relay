import { ActorIdSchema, NotificationIdSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import type { RunExistence } from "../../../models/config/authority.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { NotificationRecord } from "../../../models/notifications/notifications.js";
import { NotificationTargetSchema, type NotificationTarget } from "../../../models/notifications/notification-target.js";

export function createNotificationTargetQuery(deps: {
  get(id: string): NotificationRecord | undefined;
  read(id: string): RunExistence;
  failure(id: string): FailureRecord | undefined;
  host?(run: RunRecord): RunRecord | undefined;
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
      const host = deps.host?.(current.run);
      if (host !== undefined) return NotificationTargetSchema.parse({ kind: "run", runId: host.envelope.runId, day: localDatePart(new Date(host.envelope.enqueuedAt)) });
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
