/**
 * A registered workflow's TAXONOMY, as its server module declares it
 * (doc 02 §1.2.1, D219).
 *
 * Three things a registered workflow can be to the program, and the MODULE —
 * never the descriptor — states which. The argument is D170's, verbatim:
 * taxonomy is presentation plus server bookkeeping, not part of a run's
 * contract identity. A run of `separations-kuali-finalization` behaves
 * byte-identically whether or not it is labeled a proving harness, so folding
 * the fact into `contractFingerprint` would re-stamp every existing run's
 * contract for a surface no run consumes. It also matches how the fact MOVES:
 * the five separations chunks *became* harnesses on the day the composed
 * `separations` descriptor registered (D211), and nothing about their run
 * identity moved with them.
 *
 * The union is REQUIRED on every module, never optional. That is D211's
 * optional-block lesson one level up: an optional field is one a new module can
 * forget to fill while every surface still renders, and the honest default does
 * not exist — a workflow that declared nothing would be silently standalone.
 *
 * ## Why this file lives in `src/domain/` and is still closure-safe
 *
 * It is the ONE definition of the union: the module fact, the bootstrap wire
 * and the explorer wire all bind to this exact schema, so the shapes cannot
 * quietly fork the way separations 6c's parity twins did. Both wires are
 * browser-reachable, so the schema has to be browser-clean, which `src/domain/`
 * is and `src/control/` is not.
 *
 * Being reachable is not the same as being reached: NO descriptor value-imports
 * this module, and nothing should ever make one. §1.4 item 6 walks each
 * descriptor's value-import closure, and `contractFingerprint` covers exactly
 * that closure — so a descriptor that started importing this file would move
 * every fingerprint it owns and `descriptor-coverage`'s manifest comparison
 * would go red naming it. The role belongs to `module.ts`; the descriptor never
 * sees it.
 */
import { z } from "zod";
import { WorkflowIdSchema } from "../ids.js";

export const WorkflowModuleRoleSchema = z.discriminatedUnion("kind", [
  /** An ordinary workflow that stands on its own (person-lookup). */
  z.strictObject({ kind: z.literal("standalone") }),
  /** A graph assembled from chunk-proven tasks (separations). */
  z.strictObject({ kind: z.literal("composition") }),
  /**
   * A per-chunk proving harness for `of`'s migration.
   *
   * `of` names the composition this harness is a STEP of. The composition root
   * refuses an `of` that does not resolve to a registered module whose own role
   * is `composition`, which makes a dangling target and a
   * harness-of-a-harness chain unrepresentable rather than merely banned.
   */
  z.strictObject({ kind: z.literal("chunk-harness"), of: WorkflowIdSchema }),
]);
export type WorkflowModuleRole = z.infer<typeof WorkflowModuleRoleSchema>;

/**
 * The one way a module states its role.
 *
 * It parses through the schema (so `of` is the branded workflow id every
 * registry keys by, rather than a bare string that agrees today) and freezes
 * the result, matching how every other registry value in this tree is exported.
 */
export function defineWorkflowRole(
  role: z.input<typeof WorkflowModuleRoleSchema>,
): WorkflowModuleRole {
  return Object.freeze(WorkflowModuleRoleSchema.parse(role));
}
