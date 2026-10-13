import type { WorkflowCategory } from "../../../models/workflow/presentation.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";

interface CategoryDisplay {
  /** the operator's heading for this category */
  readonly label: string;
  /** where it sits in the rail and the Run Modal's picker */
  readonly order: number;
}

/** The display order, mirroring the demo's `DEMO_CATEGORY_ORDER` shape over the
 * six categories `WorkflowCategorySchema` actually closes over. Four of them */
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

/** ONE category's heading. A category this build has no word for reads as its
 * raw id — the same fallback the grouping takes, so a heading and a label can */
export function workflowCategoryLabel(categoryId: string): string {
  return displayOf(categoryId)?.label ?? categoryId;
}

/** The facts the ONE rule needs from any listed workflow, whatever view-model
 * the surface hands it. Every workflow-listing wire already serves all four */
export interface WorkflowGroupingFacts {
  readonly id: string;
  readonly label: string;
  readonly categoryId: string;
  readonly role: WorkflowModuleRole;
}

/** The harness marking every listing surface renders (ref dashboard-surfaces).
 * It is present on an entry whose OWN served role is `chunk-harness` and on no */
export interface WorkflowHarnessMarking {
  /** the composition this entry proves a step of — always known, it is served */
  readonly ofWorkflowId: string;
  /** The composition's own label when the composition is IN the list this
 * grouping was called with, and `undefined` when it is not. A surface prints */
  readonly ofLabel: string | undefined;
  /** `true` when this entry is rendered UNDER its composition's entry */
  readonly nested: boolean;
}

/** ONE rendered entry */
export interface WorkflowGroupEntry<Entry> {
  readonly entry: Entry;
  /** the harness marking, or `undefined` for a standalone/composition entry */
  readonly harness: WorkflowHarnessMarking | undefined;
  /** The proving harnesses of this entry, in first-seen order. */
  readonly members: readonly WorkflowGroupEntry<Entry>[];
}

/** one group */
export interface WorkflowCategoryGroup<Entry> {
  readonly label: string;
  readonly entries: readonly WorkflowGroupEntry<Entry>[];
}

/** What a surface prints for "a proving harness of ___". A composition this
 * list does not carry reads as its raw workflow id, because showing the id */
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

/** Nest each chunk harness under its composition, then group the resulting roots by category in the display order above.
 * THE */
export function groupWorkflowsByCategory<Entry extends WorkflowGroupingFacts>(
  workflows: readonly Entry[],
): WorkflowCategoryGroup<Entry>[] {
  // Labels come from the WHOLE list
  const labelById = new Map<string, string>();
  for (const workflow of workflows) labelById.set(workflow.id, workflow.label);

  const byCategory = new Map<string, WorkflowGroupEntry<Entry>[]>();
  const seenOrder: string[] = [];
  for (const node of nestHarnesses(workflows, labelById)) {
    const categoryId = node.entry.categoryId;
    let bin = byCategory.get(categoryId);
    if (bin === undefined) {
      bin = [];
      byCategory.set(categoryId, bin);
      seenOrder.push(categoryId);
    }
    bin.push(node);
  }
  return seenOrder
    .map((categoryId, seen) => ({ categoryId, seen, display: displayOf(categoryId) }))
    .sort((a, b) => (a.display?.order ?? UNLISTED_ORDER) - (b.display?.order ?? UNLISTED_ORDER) || a.seen - b.seen)
    .map(({ categoryId, display }) => ({
      label: display?.label ?? categoryId,
      entries: byCategory.get(categoryId) ?? [],
    }));
}

/** The whole listing, with each harness moved under its composition before category placement. */
function nestHarnesses<Entry extends WorkflowGroupingFacts>(
  workflows: readonly Entry[],
  labelById: ReadonlyMap<string, string>,
): readonly WorkflowGroupEntry<Entry>[] {
  const compositions = new Set(
    workflows.filter((entry) => entry.role.kind === "composition").map((entry) => entry.id),
  );
  const members = new Map<string, WorkflowGroupEntry<Entry>[]>();
  const topLevel: Entry[] = [];
  for (const workflow of workflows) {
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
