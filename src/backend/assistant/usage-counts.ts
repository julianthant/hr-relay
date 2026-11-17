import { z } from "zod";
import { ActivityAssistantUsageSchema, type ActivityAssistantUsage } from "../../models/dashboard/activity.js";
import { createActivityDatePartReader } from "../../models/dashboard/activity-volume.js";
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";

export function queryAssistantUsage(database: AuthorityDatabase, input: { from: string; to: string; generatedAt: string }, timeZone: string): ActivityAssistantUsage {
  const bounds = z.strictObject({ from: z.iso.date(), to: z.iso.date(), generatedAt: z.iso.datetime({ offset: true }) }).parse(input);
  if (bounds.from > bounds.to) throw new Error("assistant-usage-range-invalid");
  const days: string[] = [];
  for (let instant = Date.parse(bounds.from); instant <= Date.parse(bounds.to); instant += 86_400_000) days.push(new Date(instant).toISOString().slice(0, 10));
  const dayOf = createActivityDatePartReader(timeZone);
  return database.withAuthorityReadSnapshot(() => {
    const messages = new Map(days.map(day => [day, { day, count: 0 }]));
    const actions = new Map(days.map(day => [day, { day, proposed: 0 }]));
    const proposed = new Set<string>();
    for (const message of database.authority.assistantHistory.activityMetadata(new Date(bounds.generatedAt).toISOString())) {
      const day = dayOf(message.createdAt), bucket = messages.get(day);
      if (message.kind === "turn" && bucket !== undefined) bucket.count++;
      if (message.kind !== "proposal") continue;
      if (message.actionId === null) throw new Error("assistant-usage-proposal-actionId-missing");
      if (proposed.has(message.actionId)) continue;
      proposed.add(message.actionId);
      const action = database.authority.assistantAuthorization.action(message.actionId);
      if (action !== undefined && action.binding.profileId !== database.getMeta().profileId) throw new Error("assistant-usage-action-profileId-mismatch");
      if (action?.command.family === "notification") continue;
      // Spreadsheet proposals retain their native proposal row without a canonical command action.
      const actionDay = actions.get(day);
      if (actionDay !== undefined) actionDay.proposed++;
    }
    return ActivityAssistantUsageSchema.parse({
      assistantMessages: { state: "retained-history", days: [...messages.values()] },
      assistantTools: { state: "unavailable", reason: "not-recorded" },
      assistantActions: { state: "retained-history", days: [...actions.values()], approved: { state: "unavailable", reason: "not-recorded" } },
    });
  });
}
