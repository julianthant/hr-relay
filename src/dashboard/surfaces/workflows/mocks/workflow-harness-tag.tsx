/** The ONE affix that says "this entry is a step, not a workflow" (ref dashboard-surfaces
 * §Shell). */
import { CornerDownRight } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import { dsIcon } from "../../../ds/ui.js";
import { workflowHarnessOfName, type WorkflowHarnessMarking } from "../workflow-category.js";

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
