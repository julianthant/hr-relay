import { z } from "zod";
import { NotificationTriggerSchema } from "../../../../models/notifications/notifications.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { referenceSchema, type AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

const MAX_ITEMS = 50;

export function notificationsPlugin(deps: AssistantPluginDeps): AssistantPlugin {
  const parameters = z.strictObject({ unreadOnly: z.boolean() });
  const Output = z.strictObject({ items: z.array(z.strictObject({ note: referenceSchema("N"), trigger: z.union([NotificationTriggerSchema, z.literal("backfill-gap")]),
    severity: z.enum(["info", "warning", "error"]), state: z.enum(["unread", "read", "snoozed", "pinned"]), at: z.iso.datetime() })).max(MAX_ITEMS),
  counts: z.strictObject({ total: z.number().int().nonnegative(), unread: z.number().int().nonnegative() }) });
  return { domain: "notifications", tools: [{
    kind: "read", tier: "read", name: "list_notifications",
    description: "List the operator's notifications, newest first: what triggered each one, its severity and whether it is unread, read, snoozed or pinned. Notification text stays local.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const { unreadOnly } = parameters.parse(value), rows = deps.notifications(context.actorId);
      context.assertCurrent();
      const listed = rows.filter(row => !unreadOnly || row.state === "unread").toSorted((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, MAX_ITEMS);
      return JsonValueSchema.parse({ items: listed.map(row => ({ note: context.references.issue("N", row.notificationId, row.title),
        trigger: row.kind === "notification" ? row.trigger : row.kind, severity: row.severity, state: row.state, at: row.occurredAt })),
      counts: { total: rows.length, unread: rows.filter(row => row.state === "unread").length } });
    },
  }] };
}
