import type { CommandResult } from "../../../rules/commands/commands.js";
import { settleCommandResult } from "../../app/command-result.js";

export type NotificationControlType = "notification-read" | "notification-unread" | "notification-snooze" | "notification-unsnooze";
export type NotificationControlFeedback = { tone: "success" | "danger"; title: string; description: string; outcome: "confirmed" | "refused" | "unknown" };

const LABELS: Record<NotificationControlType, string> = {
  "notification-read": "Marked read", "notification-unread": "Marked unread",
  "notification-snooze": "Snoozed", "notification-unsnooze": "Unsnoozed",
};

export function notificationControlFeedback(command: { commandId: string; target: { notificationId: string } ; type: NotificationControlType }, result: CommandResult | undefined): NotificationControlFeedback {
  if (result === undefined || result.commandId !== command.commandId) return {
    tone: "danger", title: "Notification result unknown", description: "The request may have changed the notification. Refresh the inbox before acting again.", outcome: "unknown",
  };
  const settlement = settleCommandResult(result);
  if (settlement.kind === "refused") return {
    tone: "danger", title: settlement.reason === "conflict" ? "Notification changed" : "Notification request refused",
    description: settlement.reason === "conflict" ? "The notification changed. Refresh the inbox before acting again." : "The server refused this notification request.", outcome: "refused",
  };
  if (result.state !== "applied" && result.state !== "already-applied") throw new Error("NOTIFICATION_CONTROL_RESULT_FOLD_MISMATCH");
  if (result.affectedTargets.length !== 1 || result.affectedTargets[0]?.family !== "notification" || result.affectedTargets[0].notificationId !== command.target.notificationId) return {
    tone: "danger", title: "Notification result unknown", description: "The response did not confirm this notification. Refresh the inbox before acting again.", outcome: "unknown",
  };
  return { tone: "success", title: LABELS[command.type], description: "Notification updated.", outcome: "confirmed" };
}

export function createNotificationControlFeedback(emit: (feedback: NotificationControlFeedback) => string, dismiss: (id: string) => void) {
  const seen = new Set<string>();
  const active = new Set<string>();
  return {
    reset() { for (const id of active) dismiss(id); active.clear(); seen.clear(); },
    publish(scope: string, commandId: string, feedback: NotificationControlFeedback): "delivered" | "duplicate" | "delivery-failed" {
      const key = `${scope}:${commandId}:${feedback.outcome}`;
      if (seen.has(key)) return "duplicate";
      try { active.add(emit(feedback)); }
      catch { return "delivery-failed"; }
      seen.add(key);
      return "delivered";
    },
  };
}
