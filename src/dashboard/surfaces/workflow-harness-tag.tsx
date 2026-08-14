/**
 * The ONE affix that says "this entry is a step, not a workflow" (doc 03
 * §Shell, D219).
 *
 * It lives beside `workflow-category.ts` and is shared by every listing surface
 * that has room for a token rather than a sentence — the Workflow Panel's rail
 * and the Run Modal's picker — for the same reason the grouping rule is one
 * function: two surfaces marking the same fact two ways is how an operator
 * learns the marking means nothing. (The Explorer has room for the sentence and
 * prints it, which is the same fact at the density that surface affords.)
 *
 * **The relationship is in the accessible name, not only in the paint.** The
 * visible token is the word `harness`; the composition it is a harness OF
 * follows it as screen-reader-only text, so the entry's accessible name reads
 * "… harness of Separations" while the row stays one line at rail density.
 * D187's lesson is the reason it is built this way round: when one
 * representation of a surface asserts something, the other has to assert it
 * too — an indent a screen reader cannot hear is a visual-only hierarchy.
 *
 * Tone is the recess plane (`--ds-recess-*`), the same fill `Chip`'s neutral
 * tone reads, at the `-quiet` foreground tokens.css reserves for "a recessed
 * surface carrying a MARKER you SCAN" — this is a quiet fact ABOUT the row,
 * never a status competing with the row's own counts.
 */
import { cn } from "../lib/utils.js";
import { dsRadius, dsText } from "../ds/ui.js";
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
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap border",
        "h-[var(--ds-h-xs)] px-[var(--ds-space-tight)]",
        dsRadius.sm,
        dsText.caps,
        dsText.flush,
        "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg-quiet)]",
        className,
      )}
    >
      harness
      {/* Never `aria-hidden` on the visible half: the token is the sighted
          read and this is the rest of the same sentence, so the accessible
          name carries the whole relationship. */}
      <span className="sr-only">{` of ${of}`}</span>
    </span>
  );
}
