import { z } from "zod";
import { NotificationTriggerSchema } from "../../../../models/notifications/notifications.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { NotificationCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { observeEdit, requireEditRead } from "../../applied-edits.js";
import { AssistantChangeOutput, AssistantToolRefusal, referenceSchema, type AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

const MAX_ITEMS = 50;
const Change = z.strictObject({ note: referenceSchema("N"), state: z.enum(["read", "unread"]) });

export function notificationsPlugin(deps: AssistantPluginDeps): AssistantPlugin {
  const parameters = z.strictObject({ unreadOnly: z.boolean() });
  const Output = z.strictObject({ items: z.array(z.strictObject({ note: referenceSchema("N"), trigger: z.union([NotificationTriggerSchema, z.literal("backfill-gap")]),
    severity: z.enum(["info", "warning", "error"]), state: z.enum(["unread", "read", "snoozed", "pinned"]), at: z.iso.datetime() })).max(MAX_ITEMS),
  counts: z.strictObject({ total: z.number().int().nonnegative(), unread: z.number().int().nonnegative() }) });
  const tools: AssistantPlugin["tools"][number][] = [{
    kind: "read", tier: "read", name: "list_notifications",
    description: "List the operator's notifications, newest first: what triggered each one, its severity and whether it is unread, read, snoozed or pinned. Notification text stays local.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const { unreadOnly } = parameters.parse(value), rows = deps.notifications(context.actorId);
      context.assertCurrent();
      const listed = rows.filter(row => !unreadOnly || row.state === "unread").toSorted((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, MAX_ITEMS);
      for (const row of listed) {
        if (row.kind !== "backfill-gap" && (row.kind !== "notification" || row.group === undefined)) {
          observeEdit(context, `notification:${row.notificationId}`, row.revision);
        }
      }
      return JsonValueSchema.parse({ items: listed.map(row => ({ note: context.references.issue("N", row.notificationId, row.title),
        trigger: row.kind === "notification" ? row.trigger : row.kind, severity: row.severity, state: row.state, at: row.occurredAt })),
      counts: { total: rows.length, unread: rows.filter(row => row.state === "unread").length } });
    },
  }];
  const { edits } = deps;
  if (edits !== undefined) tools.push({
    kind: "change", tier: "write-local", name: "change_notifications",
    description: "Mark one listed notification read or unread as the operator explicitly requested.",
    parameters: Change, output: AssistantChangeOutput, privacy: [],
    async change(input, context) {
      const { note, state } = Change.parse(input), notificationId = context.references.resolve(note, ["N"]).target;
      return edits.apply(context, owner => {
        const previous = edits.notification(notificationId);
        if (previous === undefined || previous.actorId !== context.actorId || previous.clearedAt !== undefined
          || previous.trigger === "backfill-gap") throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
        requireEditRead(context, `notification:${notificationId}`, previous.version);
        if (previous.status === state) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
        const command = state === "read" ? "notification-read" : "notification-unread";
        const result = owner.execute(NotificationCommandRequestSchema.parse({ commandId: owner.id, requestedAt: owner.at,
          requestedBy: context.actorId, source: "assistant", family: "notification", type: command,
          target: { actorId: context.actorId, notificationId, expectedVersion: previous.version } }));
        if (result.state !== "applied") throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
        const next = edits.notification(notificationId);
        if (next === undefined || next.status !== state || next.version !== previous.version + 1) throw new Error("assistant-edit-notification-readback-mismatch");
        return { details: { kind: "notifications", command, notificationId, revision: next.version,
          prior: { status: previous.status, snooze: previous.snooze }, next: { status: next.status, snooze: next.snooze } },
          label: "Changed the notification", before: previous.status, after: next.status };
      });
    },
  });
  return { domain: "notifications", tools };
}
