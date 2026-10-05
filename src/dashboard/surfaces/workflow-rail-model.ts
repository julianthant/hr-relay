import type { WorkflowModuleRole } from "../../domain/workflow/module-role.js";
import { groupWorkflowsByCategory, workflowCategoryLabel, type WorkflowCategoryGroup } from "./workflow-category.js";

/** Label inventory copied from legacy hr-automation@9bb973672666b9267569a22d3fa0af722e4c5e87 src/dashboard/components/dev/rebuild-demo/demo-wire.ts; presentation only. */
export const WORKFLOW_RAIL_PREVIEWS = [{"id": "separations", "label": "Separations", "category": "Separations"}, {"id": "onboarding", "label": "Onboarding", "category": "Onboarding"}, {"id": "person-lookup", "label": "Person Lookup", "category": "Search"}, {"id": "i9-lookup", "label": "I-9 Lookup", "category": "Search"}, {"id": "work-study", "label": "Work-Study", "category": "Work Study"}, {"id": "kronos-pay-rule", "label": "Kronos Pay Rule", "category": "Payroll"}, {"id": "ocr", "label": "OCR", "category": "Utils"}, {"id": "oath-signature", "label": "Oath Signature", "category": "Onboarding"}, {"id": "oath-upload", "label": "Oath Upload", "category": "Onboarding"}, {"id": "emergency-contact", "label": "Emergency Contact", "category": "Onboarding"}, {"id": "onbase", "label": "OnBase", "category": "OnBase"}, {"id": "i9-check", "label": "I-9 Check", "category": "Separations"}, {"id": "crm-doc-download", "label": "CRM Doc Download", "category": "Utils"}, {"id": "sharepoint-download", "label": "SharePoint Download", "category": "Utils"}, {"id": "old-kronos-reports", "label": "Old Kronos Reports", "category": "Timekeeping"}] as const;

export interface WorkflowNavigationEntry {
  readonly id: string; readonly label: string; readonly categoryId: string; readonly role: WorkflowModuleRole;
}

const CATEGORY_ORDER = ["Search", "Separations", "Onboarding", "Work Study", "Payroll", "Utils", "OnBase", "Timekeeping"] as const;

export function workflowRailCategory(id: string, categoryId: string): string {
  return WORKFLOW_RAIL_PREVIEWS.find(flow => flow.id === id)?.category ?? workflowCategoryLabel(categoryId);
}

export function workflowNavigationGroups<Entry extends WorkflowNavigationEntry>(entries: readonly Entry[]): WorkflowCategoryGroup<Entry>[] {
  const rank = (category: string) => { const index = CATEGORY_ORDER.findIndex(label => label === category); return index < 0 ? CATEGORY_ORDER.length : index; };
  return groupWorkflowsByCategory(entries).sort((left, right) => rank(left.label) - rank(right.label));
}
