import { useCallback, useState, useSyncExternalStore } from "react";
import { WORKFLOW_SOURCES } from "../../app/workflow-sources.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import type { IconName } from "../../../models/workflow/presentation.js";
import { groupWorkflowsByCategory, type WorkflowCategoryGroup } from "../workflows/workflow-category.js";

export interface WorkflowNavigationEntry {
  readonly id: string; readonly label: string; readonly categoryId: string; readonly role: WorkflowModuleRole; readonly icon: IconName;
}

/** A workflow's mark in the rail: the first letters of its first two words, or the first two letters of a single word. */
export function workflowInitials(label: string): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(word => word !== "");
  const letters = words.length > 1 ? words.slice(0, 2).map(word => word[0]).join("") : (words[0] ?? label).slice(0, 2);
  return letters.toUpperCase();
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
  const [state, setState] = useState<{ readonly narrow: boolean; readonly choice: boolean | undefined }>({ narrow, choice: undefined });
  if (state.narrow !== narrow) setState({ narrow, choice: undefined });
  const set = useCallback((next: boolean) => setState({ narrow, choice: next }), [narrow]);
  return [state.narrow === narrow && state.choice !== undefined ? state.choice : narrow, set];
}
