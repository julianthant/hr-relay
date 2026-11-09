import { useCallback, useState } from "react";
import { MOCK_WORKFLOWS } from "../workflows/mocks/workflow-mock-catalog.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import { groupWorkflowsByCategory, workflowCategoryLabel, type WorkflowCategoryGroup } from "../workflows/workflow-category.js";

export interface WorkflowNavigationEntry {
  readonly id: string; readonly label: string; readonly categoryId: string; readonly role: WorkflowModuleRole;
}

const CATEGORY_ORDER = ["Search", "Separations", "Onboarding", "Work Study", "Payroll", "Utils", "OnBase", "Timekeeping"] as const;

export function workflowRailCategory(id: string, categoryId: string): string {
  return MOCK_WORKFLOWS.find(flow => flow.id === id)?.category ?? workflowCategoryLabel(categoryId);
}

export function workflowNavigationGroups<Entry extends WorkflowNavigationEntry>(entries: readonly Entry[]): WorkflowCategoryGroup<Entry>[] {
  const rank = (category: string) => { const index = CATEGORY_ORDER.findIndex(label => label === category); return index < 0 ? CATEGORY_ORDER.length : index; };
  return groupWorkflowsByCategory(entries).sort((left, right) => rank(left.label) - rank(right.label));
}

const words = (label: string) => label.split(/[\s-]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);

/** Two characters per workflow for the minimized rail: the first letters of the first two words ("I-9 Check" → I9, "OnBase" → OB) or the first two letters of one word.
 * A label whose initials are already taken uses its first and last word instead ("I-9 Check" → IC). */
export function workflowInitials(labels: readonly string[]): ReadonlyMap<string, string> {
  const taken = new Set<string>();
  return new Map(labels.map(label => {
    const parts = words(label);
    const base = (parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2)).toUpperCase();
    const initials = taken.has(base) && parts.length > 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : base;
    taken.add(initials);
    return [label, initials];
  }));
}

const COLLAPSED_KEY = "relay.workflow-rail.collapsed";

/** The minimized rail is remembered per viewer in this browser; storage that is blocked just means it starts expanded. */
export function useRailCollapsed(): readonly [boolean, (next: boolean) => void] {
  const [collapsed, setState] = useState(() => { try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } });
  const set = useCallback((next: boolean) => {
    setState(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
  }, []);
  return [collapsed, set];
}
