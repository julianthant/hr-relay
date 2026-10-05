import { MOCK_WORKFLOWS } from "../workflows/mocks/workflow-mock-catalog.js";
import type { WorkflowModuleRole } from "../../../domain/workflow/module-role.js";
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
