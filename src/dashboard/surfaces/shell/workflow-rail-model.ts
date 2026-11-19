import { useCallback, useState, useSyncExternalStore } from "react";
import { WORKFLOW_SOURCES } from "../../app/workflow-sources.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import { groupWorkflowsByCategory, type WorkflowCategoryGroup } from "../workflows/workflow-category.js";

export interface WorkflowNavigationEntry {
  readonly id: string; readonly label: string; readonly categoryId: string; readonly role: WorkflowModuleRole;
}

const CATEGORY_ORDER = ["Lookup", "Separations", "Onboarding", "Work-Study", "Payroll", "Utils", "OnBase", "Timekeeping"] as const;

const WORKFLOW_ORDER: readonly string[] = Object.keys(WORKFLOW_SOURCES);

/** The one place a workflow's position is decided: the order the dashboard workflow sources declare. A workflow they do not list follows the listed ones, in the order given. */
function workflowPosition(id: string): number {
  const index = WORKFLOW_ORDER.indexOf(id);
  return index < 0 ? WORKFLOW_ORDER.length : index;
}

export function workflowNavigationGroups<Entry extends WorkflowNavigationEntry>(entries: readonly Entry[]): WorkflowCategoryGroup<Entry>[] {
  const ordered = [...entries].sort((left, right) => workflowPosition(left.id) - workflowPosition(right.id));
  const rank = (category: string) => { const index = CATEGORY_ORDER.findIndex(label => label === category); return index < 0 ? CATEGORY_ORDER.length : index; };
  return groupWorkflowsByCategory(ordered).sort((left, right) => rank(left.label) - rank(right.label));
}

/** The rail lists every workflow in one flat group, in the order given, with no category heading. */
export function flatWorkflowGroup<Entry extends WorkflowNavigationEntry>(entries: readonly Entry[]): WorkflowCategoryGroup<Entry>[] {
  const entriesInOrder = workflowNavigationGroups(entries).flatMap(group => group.entries);
  return entriesInOrder.length > 0 ? [{ label: "", entries: entriesInOrder }] : [];
}

const NARROW_QUERY = "(max-width: 1199px)";

function subscribeNarrow(notify: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
const isNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

/** The rail starts collapsed below 1200px window width and expanded above it. The toggle overrides that at any width; the choice holds until the width crosses 1200px again. */
export function useRailCollapsed(): readonly [boolean, (next: boolean) => void] {
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const [choice, setChoice] = useState<{ readonly narrow: boolean; readonly collapsed: boolean } | undefined>(undefined);
  const set = useCallback((next: boolean) => setChoice({ narrow, collapsed: next }), [narrow]);
  return [choice !== undefined && choice.narrow === narrow ? choice.collapsed : narrow, set];
}
