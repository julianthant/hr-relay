/**
 * Ported from legacy hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/demo-wire.ts:227-245,1806-1846
 * (`DEMO_CATEGORY_ORDER`, `DEMO_CATEGORY_OTHER`, `buildWorkflowCategoryGroups`).
 *
 * WHERE GROUPING IS DECIDED, and why it is here rather than on the wire.
 *
 * Doc 03 §Shell is normative: *"Grouping in the panel comes from each
 * descriptor's own `category` … never a frontend list: the frontend hardcodes
 * only the display order, membership is the descriptor's, an unlisted category
 * appends, and an empty category drops."* The bootstrap wire used to carry a
 * `workflowCategories` projection instead, whose `label` was
 * `id.replace(/-/g, " ")` and whose `order` was the registry's first-seen
 * index — two display decisions the SERVER invented, so the panel's headings
 * read `separation` and their order was whichever workflow module happened to
 * import first. Both are display, both are now here, and the wire serves the
 * raw `categoryId` alone (R2 D17/D18).
 *
 * The table is `Record<WorkflowCategory, …>` on purpose: `WorkflowCategory` is
 * a closed enum, so adding a category to the descriptor vocabulary without
 * giving it a heading fails `tsc` rather than rendering a hole. A value outside
 * the enum can still reach a browser off an older/newer server, and that case
 * takes the demo's own fallback — appended after the listed groups, in
 * first-seen order, headed by the raw id, because showing the id verbatim is
 * the honest rendering of a category this build has no word for.
 */
import type { WorkflowCategory } from "../../domain/workflow/presentation.js";

interface CategoryDisplay {
  /** the operator's heading for this category */
  readonly label: string;
  /** where it sits in the rail and the Run Modal's picker */
  readonly order: number;
}

/**
 * The display order, mirroring the demo's `DEMO_CATEGORY_ORDER` shape over the
 * six categories `WorkflowCategorySchema` actually closes over. Four of them
 * are registered today (`separation`, `timekeeping`, `search`, `operations`);
 * the other two cost nothing while empty, because an empty category DROPS —
 * which is exactly why an order entry for a group nothing is registered under
 * needs no edit when it is registered later.
 */
const WORKFLOW_CATEGORY_DISPLAY: Record<WorkflowCategory, CategoryDisplay> = {
  onboarding: { label: "Onboarding", order: 0 },
  documents: { label: "Documents", order: 1 },
  separation: { label: "Separations", order: 2 },
  timekeeping: { label: "Timekeeping", order: 3 },
  search: { label: "Search", order: 4 },
  operations: { label: "Operations", order: 5 },
};

/** what a category this build has no heading for is worth in the sort */
const UNLISTED_ORDER = Number.MAX_SAFE_INTEGER;

function displayOf(categoryId: string): CategoryDisplay | undefined {
  return Object.hasOwn(WORKFLOW_CATEGORY_DISPLAY, categoryId)
    ? WORKFLOW_CATEGORY_DISPLAY[categoryId as WorkflowCategory]
    : undefined;
}

/**
 * ONE category's heading. A category this build has no word for reads as its
 * raw id — the same fallback the grouping takes, so a heading and a label can
 * never disagree about the same category.
 */
export function workflowCategoryLabel(categoryId: string): string {
  return displayOf(categoryId)?.label ?? categoryId;
}

/** one group: a heading and the workflows the registry binned under it */
export interface WorkflowCategoryGroup<Entry> {
  readonly label: string;
  readonly entries: readonly Entry[];
}

/**
 * Group any list of served workflows by each entry's OWN `categoryId`, in the
 * display order above. THE one rule — the Workflow Panel's rail and the Run
 * Modal's picker both call it, over different lists (the picker's is filtered
 * to what is startable), so the two surfaces cannot drift into two orders.
 *
 *  - membership is the entry's `categoryId`;
 *  - listed categories come first in display order, then any unlisted category
 *    in first-seen order;
 *  - a category with no entries is DROPPED rather than rendered as an empty
 *    heading.
 */
export function groupWorkflowsByCategory<Entry extends { readonly categoryId: string }>(
  workflows: readonly Entry[],
): WorkflowCategoryGroup<Entry>[] {
  const byCategory = new Map<string, Entry[]>();
  const seenOrder: string[] = [];
  for (const workflow of workflows) {
    let bin = byCategory.get(workflow.categoryId);
    if (bin === undefined) {
      bin = [];
      byCategory.set(workflow.categoryId, bin);
      seenOrder.push(workflow.categoryId);
    }
    bin.push(workflow);
  }
  return seenOrder
    .map((categoryId, seen) => ({ categoryId, seen, display: displayOf(categoryId) }))
    .sort((a, b) => (a.display?.order ?? UNLISTED_ORDER) - (b.display?.order ?? UNLISTED_ORDER) || a.seen - b.seen)
    .map(({ categoryId, display }) => ({
      label: display?.label ?? categoryId,
      entries: byCategory.get(categoryId) ?? [],
    }));
}
