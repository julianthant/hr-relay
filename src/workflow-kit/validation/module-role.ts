/** A registered workflow's role taxonomy, stated by its server module — never the descriptor. Role is presentation, not contract identity, so it stays out of `contractFingerprint`. */
import { z } from "zod";
import { WorkflowIdSchema } from "../../rules/identity/ids.js";
import { TimelineCategoryKeySchema } from "../../models/workflow/presentation.js";

export const WorkflowModuleRoleSchema = z.discriminatedUnion("kind", [
  /** An ordinary workflow that stands on its own. */
  z.strictObject({ kind: z.literal("standalone") }),
  /** A graph assembled from chunk-proven tasks. */
  z.strictObject({ kind: z.literal("composition") }),
  /** A per-chunk proving harness: `of` names the composition and `step` one of its declared timeline keys; both are refused if dangling/undeclared, and `step` is required (no default). */
  z.strictObject({
    kind: z.literal("chunk-harness"),
    of: WorkflowIdSchema,
    step: TimelineCategoryKeySchema,
  }),
]);
export type WorkflowModuleRole = z.infer<typeof WorkflowModuleRoleSchema>;

/** The one way a module states its role: parse through the schema (branded ids, not bare strings that agree today) and freeze, matching every other registry value here. */
export function defineWorkflowRole(
  role: z.input<typeof WorkflowModuleRoleSchema>,
): WorkflowModuleRole {
  return Object.freeze(WorkflowModuleRoleSchema.parse(role));
}
