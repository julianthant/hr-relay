/**
 * The ONE affix that says "this entry is a step, not a workflow" (ref dashboard-surfaces
 * §Shell, D219).
 *
 * It lives beside `workflow-category.ts` and is shared by every listing surface
 * that has room for a marker rather than a sentence — the Workflow Panel's rail
 * and the Run Modal's picker — for the same reason the grouping rule is one
 * function: two surfaces marking the same fact two ways is how an operator
 * learns the marking means nothing. (The Explorer has room for the sentence and
 * prints it, which is the same fact at the density that surface affords.)
 *
 * **Why a glyph and not a word, measured rather than preferred.** The rail is
 * 200px and the picker 204px, both carrying a label AND a count column. A
 * bordered `HARNESS` token spends ~60px of that and a bare `STEP` ~30px, and
 * the registry's real labels are long: at `STEP` width, `Separation Document`
 * and `Separation Timecard` BOTH render as `Separation…` in the same panel —
 * a marking that costs the operator the ability to tell two steps apart is a
 * worse trade than the word it buys. The branch glyph is 12px, it says
 * "beneath the row above" in the direction the indent already points, and the
 * word is one hover away.
 *
 * **The relationship is in the accessible name, not only in the paint.** The
 * glyph is `aria-hidden` and the sentence beside it is screen-reader-only, so
 * a harness entry's accessible name reads "Identity Check, a proving harness
 * of Separation, 0 active of 0 …" — D187's lesson is the reason it is built
 * this way round: when one representation of a surface asserts something, the
 * other has to assert it too, and an indent a screen reader cannot hear is a
 * visual-only hierarchy.
 */
import { CornerDownRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { dsIcon } from "../ds/ui.js";
import { workflowHarnessOfName, type WorkflowHarnessMarking } from "./workflow-category.js";

export function WorkflowHarnessTag({
  harness,
  className,
}: {
  harness: WorkflowHarnessMarking;
  className?: string;
}) {
  const of = workflowHarnessOfName(harness);
  return (
    <span
      title={`A proving harness of ${of} — a step of that workflow, not a workflow of its own`}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <CornerDownRight aria-hidden className={cn(dsIcon.sm, "text-[color:var(--ds-fg-faint)]")} />
      <span className="sr-only">{`, a proving harness of ${of}`}</span>
    </span>
  );
}
