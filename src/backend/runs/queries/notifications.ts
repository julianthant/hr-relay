import { ActorIdSchema, NotificationIdSchema } from "../../../rules/identity/ids.js";
import { deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";
import type { BulkRunCommandAcceptanceRecord, BulkRunCommandOutcome, CommandRequest, CommandResult } from "../../../rules/commands/commands.js";
import { localDatePart } from "../../../rules/time/clock.js";
import type { RunExistence } from "../../../models/config/authority.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { NotificationRecord } from "../../../models/notifications/notifications.js";
import { NotificationTargetSchema, type NotificationTarget } from "../../../models/notifications/notification-target.js";
import { publicWriteCommand } from "../commands/write-command-target.js";

type CommandNotice = Readonly<{
  request: CommandRequest;
  state: "admitted" | "executing" | "succeeded" | "refused" | "uncertain";
  result?: CommandResult;
}>;

export function createNotificationTargetQuery(deps: {
  get(id: string): NotificationRecord | undefined;
  read(id: string): RunExistence;
  failure(id: string): FailureRecord | undefined;
  host?(run: RunRecord): RunRecord | undefined;
  command(id: string): CommandNotice | undefined;
  bulk(id: string): { acceptance: BulkRunCommandAcceptanceRecord; children: readonly CommandNotice[] } | undefined;
}) {
  return (id: string, actor: string): NotificationTarget => {
    const notificationId = NotificationIdSchema.parse(id), actorId = ActorIdSchema.parse(actor);
    const dayOf = (runId: string): string | undefined => {
      const current = deps.read(runId);
      if (current.state !== "present") return undefined;
      return localDatePart(new Date((deps.host?.(current.run) ?? current.run).envelope.enqueuedAt));
    };
    const refused = (reason: Extract<NotificationTarget, { kind: "refused" }>["reason"]): NotificationTarget => ({ kind: "refused", reason });
    try {
      const row = deps.get(notificationId);
      if (row === undefined) return refused("notification-unavailable");
      if (row.actorId !== actorId) return refused("wrong-actor");
      if (row.trigger === "backfill-gap") return refused("pinned");
      const link = row.links[0];
      if (link === undefined) return refused("target-unavailable");
      if (link.kind === "storage") return { kind: "storage" };
      if (link.kind === "recovery" || link.kind === "command-result") return commandTarget(link, deps.command(link.commandId), dayOf, refused);
      if (link.kind === "bulk-result") return bulkTarget(link.bulkCommandId, deps.bulk(link.bulkCommandId), dayOf, refused);
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

function commandTarget(link: { kind: "recovery" | "command-result"; commandId: string }, command: CommandNotice | undefined, dayOf: (runId: string) => string | undefined, refused: (reason: "target-unavailable") => NotificationTarget): NotificationTarget {
  if (command === undefined || command.request.commandId !== link.commandId) return refused("target-unavailable");
  if (command.result === undefined) {
    if (link.kind === "recovery" && command.state === "admitted") return NotificationTargetSchema.parse({ kind: "recovery", commandId: link.commandId, request: publicWriteCommand(command.request) });
    return refused("target-unavailable");
  }
  const runId = command.request.family === "run" && "runId" in command.request.target ? command.request.target.runId : undefined;
  const day = runId === undefined ? undefined : dayOf(runId);
  if (runId !== undefined && day === undefined) return refused("target-unavailable");
  return NotificationTargetSchema.parse({ kind: "command-result", commandId: link.commandId, ...(day === undefined ? {} : { day }), request: publicWriteCommand(command.request), result: command.result });
}

function bulkTarget(bulkCommandId: string, bulk: { acceptance: BulkRunCommandAcceptanceRecord; children: readonly CommandNotice[] } | undefined, dayOf: (runId: string) => string | undefined, refused: (reason: "target-unavailable") => NotificationTarget): NotificationTarget {
  if (bulk === undefined || bulk.acceptance.bulkCommandId !== bulkCommandId) return refused("target-unavailable");
  const { acceptance } = bulk;
  const targets = acceptance.request.targets;
  if (new Set(targets.map(target => target.runId)).size !== targets.length) return refused("target-unavailable");
  const byRun = new Map<string, CommandNotice>();
  for (const child of bulk.children) {
    if (child.request.family !== "run" || !("runId" in child.request.target)) return refused("target-unavailable");
    const runId = child.request.target.runId;
    if (byRun.has(runId) || child.request.commandId !== deriveBulkChildCommandId(bulkCommandId, runId)) return refused("target-unavailable");
    byRun.set(runId, child);
  }
  const results: BulkRunCommandOutcome[] = [];
  const notAttempted: string[] = [];
  for (const target of targets) {
    const child = byRun.get(target.runId);
    if (child === undefined) { notAttempted.push(target.runId); continue; }
    byRun.delete(target.runId);
    if (child.result === undefined) return refused("target-unavailable");
    const outcome = bulkChildOutcome(acceptance.request.type, child.request, child.result);
    if (outcome === undefined) return refused("target-unavailable");
    results.push(outcome);
  }
  if (byRun.size !== 0) return refused("target-unavailable");
  const days: Record<string, string> = {};
  for (const target of targets) { const day = dayOf(target.runId); if (day !== undefined) days[target.runId] = day; }
  return NotificationTargetSchema.parse({
    kind: "bulk-result", bulkCommandId, type: acceptance.request.type, requestedCount: targets.length, results, notAttempted, days,
  });
}

function bulkChildOutcome(type: BulkRunCommandAcceptanceRecord["request"]["type"], request: CommandRequest, result: CommandResult): BulkRunCommandOutcome | undefined {
  if (request.family !== "run" || !("runId" in request.target) || result.commandId !== request.commandId) return undefined;
  const runId = request.target.runId, commandId = request.commandId;
  if (result.state === "rejected" && result.code === "bulk-child-errored") return { outcome: "errored", runId, commandId, detail: result.message };
  if (result.state === "conflict") return { outcome: "conflict", runId, commandId, currentVersion: result.currentVersion, detail: result.message };
  if (result.state === "rejected") return { outcome: "refused", runId, commandId, code: result.code, detail: result.message };
  if (result.state === "applied" || result.state === "already-applied") return { outcome: "applied", runId, commandId, replayed: false, detail: `${type} recorded` };
  return undefined;
}
