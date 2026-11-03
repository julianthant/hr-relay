import { z } from "zod";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { ChildVisibilitySchema } from "../workflow/delegation-policy.js";

export const QueueParentSchema = z.strictObject({ runId: RunIdSchema, visibility: ChildVisibilitySchema });
export type QueueParent = z.infer<typeof QueueParentSchema>;

export function isQueueTopLevel(row: { readonly parent: QueueParent | null }): boolean {
  return row.parent === null || row.parent.visibility === "linked";
}

export function isQueueMember(row: { readonly parent: QueueParent | null; readonly status: string }): boolean {
  return row.parent?.visibility === "inline" || row.parent?.visibility === "hidden-unless-failed" && row.status === "failed";
}
