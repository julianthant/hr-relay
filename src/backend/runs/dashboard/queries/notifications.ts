import { ActorIdSchema, NotificationIdSchema } from "../../../../domain/ids.js";
import { localDatePart } from "../../../../domain/clock.js";
import type { RunExistence } from "../../../../domain/authority.js";
import type { FailureRecord } from "../../../../domain/trust/failure.js";
import { NotificationTargetSchema, type NotificationRecord, type NotificationTarget } from "../../../../domain/notifications.js";

export function createNotificationTargetQuery(deps: {
  get(id: string): NotificationRecord | undefined;
  read(id: string): RunExistence;
  failure(id: string): FailureRecord | undefined;
  report(id: string): { runId: string; digest: string } | undefined;
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
      if (current.disposition === "archived") {
        const report = deps.report(link.runId);
        if (report === undefined || report.runId !== link.runId) return refused("archive-unavailable");
        return NotificationTargetSchema.parse({ kind: "archive", runId: link.runId, reportDigest: report.digest });
      }
      const day = localDatePart(new Date(current.run.envelope.enqueuedAt));
      if (link.kind === "failure") {
        const failure = deps.failure(link.failureId);
        if (failure === undefined || failure.runId !== link.runId || current.run.lifecycle.state !== "terminal" || current.run.lifecycle.failureId !== link.failureId) return refused("failure-unavailable");
        return NotificationTargetSchema.parse({ kind: "failure", runId: link.runId, failureId: link.failureId, day });
      }
      return NotificationTargetSchema.parse({ kind: "run", runId: link.runId, day });
    } catch {
      // Do not return private archive/parser exceptions in a notification response.
      return refused("target-unavailable");
    }
  };
}
