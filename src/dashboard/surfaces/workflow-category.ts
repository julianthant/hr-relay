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
 *
 * D219 (2026-08-14) adds the second half of the same rule, in the same module
 * and for the same reason: MEMBERSHIP. A chunk harness is a step of its
 * composition, never a peer workflow, so inside its category group it renders
 * nested under its composition's entry rather than beside it. Both facts the
 * rule reads — `categoryId` and `role` — are served raw; both display
 * decisions are here; and every workflow-listing surface (the rail, the Run
 * Modal's picker over BOTH its lists, and the Explorer) calls this one
 * function, so no two of them can disagree about what is a step and what is a
 * workflow.
 */
import type { WorkflowCategory } from "../../domain/workflow/presentation.js";
import type { WorkflowModuleRole } from "../../domain/workflow/module-role.js";

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

/**
 * The heading a PROVING workflow renders under, on every surface that lists
 * one (doc 03 §Shell, D241).
 *
 * D220 dropped proving workflows from the rail and left them where they were
 * everywhere else — which meant `kuali-timekeeper-annotation` still headed the
 * Run Modal's picker and the Explorer under **Operations**, beside the daily HR
 * work it is not. The operator's words were *"a crash test dummy is not a
 * workflow … maybe it belongs in a different category, perhaps in test."*
 *
 * A descriptor's `category` answers *which HR area does this touch* — and for
 * a workflow that exists to prove the write kernel, that is the wrong question
 * with a plausible answer, which is the worst combination: `operations` is not
 * false, it just does not say the thing the operator needs to know before
 * starting a run. The MODULE's role answers the right one, so the role decides
 * the heading here and the category is not consulted. That keeps the fact where
 * D219 put it — no rail-side or picker-side id list, which is the
 * workflow-specific customization the role model exists to avoid.
 *
 * It sorts LAST, after every unlisted category, because equipment is not work.
 */
const PROVING_GROUP_LABEL = "Test equipment";

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

/**
 * The facts the ONE rule needs from any listed workflow, whatever view-model
 * the surface hands it. Every workflow-listing wire already serves all four —
 * the bootstrap primitive, the explorer wire, and the Run Modal's composed
 * `RunStartWorkflow` — so nothing here is derived, defaulted or inferred.
 *
 * `label` is here for ONE reason: a nested harness names the composition it is
 * a step of, and the only honest source of that composition's name is the
 * composition's own served entry in the SAME list.
 */
export interface WorkflowGroupingFacts {
  readonly id: string;
  readonly label: string;
  readonly categoryId: string;
  readonly role: WorkflowModuleRole;
}

/**
 * The harness marking every listing surface renders (doc 03 §Shell, D219).
 *
 * It is present on an entry whose OWN served role is `chunk-harness` and on no
 * other — *its harness identity comes from its own role, not from its
 * neighbourhood*, which is what keeps the orphan case (below) honest.
 */
export interface WorkflowHarnessMarking {
  /** the composition this entry proves a step of — always known, it is served */
  readonly ofWorkflowId: string;
  /**
   * The composition's own label when the composition is IN the list this
   * grouping was called with, and `undefined` when it is not. A surface prints
   * `workflowHarnessOfName` rather than reading this directly, so a name this
   * list cannot supply reads as the raw id — the same honest fallback an
   * unlisted category heading takes — instead of a fabricated title.
   */
  readonly ofLabel: string | undefined;
  /**
   * `true` when this entry is rendered UNDER its composition's entry in this
   * group, `false` when it is rendered at top level because the composition is
   * not in this group (see the orphan rule on `groupWorkflowsByCategory`).
   */
  readonly nested: boolean;
}

/**
 * ONE rendered entry: the surface's own view-model, its harness marking, and
 * the harness entries nested under it.
 *
 * The return shape is deliberately NOT `Entry[]`. A caller reaches its own
 * view-model through `.entry`, so a surface written against the old flat shape
 * fails `tsc` rather than silently rendering harnesses as peers, and `members`
 * is a field it has to render on purpose. Nesting is exactly ONE level deep by
 * construction — a member never carries members, and the composition root
 * already makes a harness-of-a-harness chain unrepresentable (doc 02 §1.2.1).
 */
export interface WorkflowGroupEntry<Entry> {
  readonly entry: Entry;
  /** the harness marking, or `undefined` for a standalone/composition entry */
  readonly harness: WorkflowHarnessMarking | undefined;
  /**
   * The proving harnesses of this entry, in first-seen order. ALWAYS RENDERED:
   * doc 03 §Shell decides against a collapse-by-default disclosure, because a
   * hidden harness's `Needs you` could vanish without an attention-forwarding
   * rule, and visible-but-subordinate hides nothing.
   */
  readonly members: readonly WorkflowGroupEntry<Entry>[];
}

/** one group: a heading and the workflows the registry binned under it */
export interface WorkflowCategoryGroup<Entry> {
  readonly label: string;
  readonly entries: readonly WorkflowGroupEntry<Entry>[];
}

/**
 * What a surface prints for "a proving harness of ___". A composition this
 * list does not carry reads as its raw workflow id, because showing the id
 * verbatim is the honest rendering of a name nothing here supplies.
 */
export function workflowHarnessOfName(harness: WorkflowHarnessMarking): string {
  return harness.ofLabel ?? harness.ofWorkflowId;
}

function markingFor(
  role: WorkflowModuleRole,
  labelById: ReadonlyMap<string, string>,
  nested: boolean,
): WorkflowHarnessMarking | undefined {
  if (role.kind !== "chunk-harness") return undefined;
  const ofWorkflowId = String(role.of);
  return { ofWorkflowId, ofLabel: labelById.get(ofWorkflowId), nested };
}

/**
 * Group any list of served workflows by each entry's OWN `categoryId`, in the
 * display order above, and nest each chunk harness under its composition. THE
 * one rule — the Workflow Panel's rail, the Run Modal's picker (its startable
 * AND its "not startable" lists) and the Explorer all call it, over different
 * lists, so no two surfaces can drift into two orders or disagree about what
 * is a step and what is a workflow (doc 03 §Shell, D219).
 *
 *  - membership is the entry's `categoryId`, with ONE exception: an entry whose
 *    role is `proving` is grouped by its ROLE under `Test equipment`, appended
 *    last, and never under the HR category its descriptor declares (D241);
 *  - listed categories come first in display order, then any unlisted category
 *    in first-seen order;
 *  - a category with no entries is DROPPED rather than rendered as an empty
 *    heading;
 *  - inside a group, an entry whose served role is `chunk-harness` is NOT a
 *    peer: it renders under its composition's entry, marked as a harness, and
 *    the top-level order of everything else is untouched by the move.
 *
 * ## The orphan rule, stated because the alternative is a lie
 *
 * A harness whose composition is not in the list this was called with — a
 * filtered list that kept the harness and dropped the composition, or (today,
 * really) `separations-kronos-timecard`, which files itself under
 * `timekeeping` while its composition files itself under `separation` — has
 * nowhere to nest. Neither tempting answer is available: nesting it under
 * nothing and dropping it silently loses a served workflow, and rendering it as
 * a plain peer says it is a workflow of its own, which D219 decided it is not.
 * So it renders at TOP LEVEL and still carries its harness marking with
 * `nested: false` — its harness identity comes from its own role, not from
 * whether its composition happens to be beside it. A surface renders the
 * marking either way; only the indent is conditional.
 *
 * Nesting also requires the target to be a `composition`, which is what keeps
 * the structure one level deep no matter what a list contains: a harness
 * naming a non-composition entry takes the orphan arm rather than nesting
 * under something that is itself nested.
 */
export function groupWorkflowsByCategory<Entry extends WorkflowGroupingFacts>(
  workflows: readonly Entry[],
): WorkflowCategoryGroup<Entry>[] {
  // Labels come from the WHOLE list: a composition in another category still
  // names itself, so an orphan harness can say what it is a harness of.
  const labelById = new Map<string, string>();
  for (const workflow of workflows) labelById.set(workflow.id, workflow.label);

  // A proving workflow's HEADING comes from its role, not its category
  // (D241) — see `PROVING_GROUP_LABEL`. It is lifted out before the category
  // pass so it cannot also appear under the HR area its descriptor files
  // itself under; one entry, one group.
  const proving = workflows.filter((workflow) => workflow.role.kind === "proving");
  const byCategory = new Map<string, Entry[]>();
  const seenOrder: string[] = [];
  for (const workflow of workflows) {
    if (workflow.role.kind === "proving") continue;
    let bin = byCategory.get(workflow.categoryId);
    if (bin === undefined) {
      bin = [];
      byCategory.set(workflow.categoryId, bin);
      seenOrder.push(workflow.categoryId);
    }
    bin.push(workflow);
  }
  const groups = seenOrder
    .map((categoryId, seen) => ({ categoryId, seen, display: displayOf(categoryId) }))
    .sort((a, b) => (a.display?.order ?? UNLISTED_ORDER) - (b.display?.order ?? UNLISTED_ORDER) || a.seen - b.seen)
    .map(({ categoryId, display }) => ({
      label: display?.label ?? categoryId,
      entries: nestHarnesses(byCategory.get(categoryId) ?? [], labelById),
    }));
  // Appended, never inserted: equipment sorts after work, and an empty
  // equipment group DROPS exactly as an empty category does.
  if (proving.length > 0) {
    groups.push({ label: PROVING_GROUP_LABEL, entries: nestHarnesses(proving, labelById) });
  }
  return groups;
}

/** ONE category's entries, with each harness moved under its composition. */
function nestHarnesses<Entry extends WorkflowGroupingFacts>(
  bin: readonly Entry[],
  labelById: ReadonlyMap<string, string>,
): readonly WorkflowGroupEntry<Entry>[] {
  const compositions = new Set(bin.filter((entry) => entry.role.kind === "composition").map((entry) => entry.id));
  const members = new Map<string, WorkflowGroupEntry<Entry>[]>();
  const topLevel: Entry[] = [];
  for (const workflow of bin) {
    const nestUnder = workflow.role.kind === "chunk-harness" && compositions.has(String(workflow.role.of))
      ? String(workflow.role.of)
      : undefined;
    if (nestUnder === undefined) {
      topLevel.push(workflow);
      continue;
    }
    const bucket = members.get(nestUnder) ?? [];
    bucket.push({ entry: workflow, harness: markingFor(workflow.role, labelById, true), members: [] });
    members.set(nestUnder, bucket);
  }
  return topLevel.map((workflow) => ({
    entry: workflow,
    harness: markingFor(workflow.role, labelById, false),
    members: members.get(workflow.id) ?? [],
  }));
}
