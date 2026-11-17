import { AssistantActivityWireSchema, type AssistantActivityWire } from "../../models/dashboard/assistant.js";
import { createActivityDatePartReader } from "../../models/dashboard/activity-volume.js";
import type { AssistantActionRecord } from "../../models/profiles/assistant-authorization.js";
import { COMMAND_ASSISTANT_METADATA } from "../../rules/commands/commands.js";
import type { Clock } from "../../rules/time/clock.js";
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import { z } from "zod";

export function createAssistantActivityQuery(options: Readonly<{
  database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot" | "getMeta">;
  clock: Clock;
  timeZone: string;
  assertCurrent(): void;
  workflowLabel(workflowId: string): string;
}>) {
  const dayOf = createActivityDatePartReader(options.timeZone);
  const actionLabel = (action: AssistantActionRecord) => {
    const command = action.command;
    if (command.family === "start") return `Start ${options.workflowLabel(command.target.workflowId)}`;
    if (command.family === "run" && (command.type === "pause" || command.type === "resume" || command.type === "cancel")) {
      const run = options.database.authority.runs.get(command.target.runId);
      if (run !== undefined) return `${{ pause: "Pause", resume: "Resume", cancel: "Cancel" }[command.type]} ${options.workflowLabel(run.envelope.workflow)}`;
    }
    return COMMAND_ASSISTANT_METADATA[command.type];
  };
  return {
    read(this: void, search = ""): AssistantActivityWire {
      const needle = z.string().max(200).parse(search).trim().toLowerCase();
      options.assertCurrent();
      const now = options.clock.now().toISOString(), day = dayOf(now);
      const result = options.database.withAuthorityReadSnapshot(() => {
        const rows = options.database.authority.assistantHistory.activityMetadata(now).flatMap(message => {
          const at = message.kind === "turn" ? message.updatedAt : message.createdAt;
          if (dayOf(at) !== day) return [];
          let label = message.kind === "turn" && message.delivery === "refused" ? "Request refused"
            : message.kind === "proposal" ? "Proposed change" : message.kind === "decision" ? "Reviewed proposal" : undefined;
          if (message.kind === "proposal" || message.kind === "decision") {
            if (message.actionId === null) throw new Error("assistant-activity-message-actionId-missing");
            const action = options.database.authority.assistantAuthorization.action(message.actionId);
            if (action !== undefined) {
              if (action.binding.profileId !== options.database.getMeta().profileId) throw new Error("assistant-activity-action-profileId-mismatch");
              const verb = message.kind === "proposal" ? "Proposed" : action.state === "cancelled" ? "Declined"
                : action.state === "unknown" ? "Outcome unknown" : action.state === "settled"
                  ? action.result?.state === "applied" || action.result?.state === "already-applied" ? "Approved" : "Refused" : "Reviewed";
              label = `${verb}: ${actionLabel(action)}`;
            }
          }
          return label === undefined ? [] : [{ id: message.id, label, at }];
        });
        for (const activity of options.database.authority.assistantAuthorization.notificationActivity()) {
          if (dayOf(activity.completedAt) !== day) continue;
          const noun = activity.operation.endsWith("-all") ? "notifications" : "notification";
          const labels = {
            "notification-read": [`Marked ${noun} read`, `Mark ${noun} read`],
            "notification-read-all": [`Marked ${noun} read`, `Mark ${noun} read`],
            "notification-unread": [`Marked ${noun} unread`, `Mark ${noun} unread`],
            "notification-unread-all": [`Marked ${noun} unread`, `Mark ${noun} unread`],
            "notification-snooze": [`Snoozed ${noun}`, `Snooze ${noun}`],
            "notification-snooze-all": [`Snoozed ${noun}`, `Snooze ${noun}`],
            "notification-unsnooze": [`Unsnoozed ${noun}`, `Unsnooze ${noun}`],
            "notification-unsnooze-all": [`Unsnoozed ${noun}`, `Unsnooze ${noun}`],
          } as const;
          const [applied, requested] = labels[activity.operation];
          const label = activity.outcome === "applied" || activity.outcome === "already-applied" ? applied : `Refused: ${requested}`;
          rows.push({ id: activity.id, label, at: activity.completedAt });
        }
        const filtered = rows.filter(row => row.label.toLowerCase().includes(needle))
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
        return AssistantActivityWireSchema.parse({ day, rows: filtered });
      });
      options.assertCurrent();
      return result;
    },
  };
}
