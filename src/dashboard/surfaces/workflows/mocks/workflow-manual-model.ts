import { MOCK_OPERATION_CATALOG } from "./workflow-operation-catalog.js";
import { mockWorkflow, type MockStep, type MockWorkflowId } from "./workflow-mock-catalog.js";
import type { MockDraft } from "./workflow-mock-model.js";

export type ManualReadField = Readonly<{ key: string; label: string; token?: string; date: boolean; options?: readonly string[] }>;
export function mockStepIsDependency(step: MockStep): boolean { return ["wait-approval", "wait-signatures"].includes(step.key); }
export function mockStepIsLocked(id: MockWorkflowId, step: MockStep): boolean {
  return Boolean(step.write || ["fill-form", "fill-keywords", "prepare-import"].includes(step.key)
    || id === "separations" && ["ucpath-job-summary", "kronos-search"].includes(step.key)
    || id === "i9-check" && step.key === "roster-match");
}
export function manualReadFields(id: MockWorkflowId, key: string): readonly ManualReadField[] {
  if (["ocr", "i9-lookup"].includes(id) || key.includes("auth") || mockStepIsDependency({ key, label: key, message: "" })) return [];
  const fields = new Map<string, ManualReadField>();
  for (const operation of MOCK_OPERATION_CATALOG[id][key] ?? []) {
    // A receipt stays an automatic readback; entered facts cannot attest to a completed write.
    if (operation.commit) break;
    for (const [label, value, kind] of operation.fields ?? []) {
      if (kind === "fill") continue;
      const key = label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/-$/u, "");
      fields.set(key, { key, label, ...(value.startsWith("$") ? { token: value } : {}), date: /^\d{2}\/\d{2}\/\d{4}$/u.test(value) || value === "$signedDate",
        ...(["Yes", "No"].includes(value) ? { options: ["Yes", "No"] } : {}) });
    }
  }
  return [...fields.values()];
}
export function usesManualRead(draft: MockDraft, key: string): boolean { return draft.manualSteps?.includes(key) === true; }
export function editableMockDraft(id: MockWorkflowId, draft: MockDraft): MockDraft {
  const steps = mockWorkflow(id).steps;
  return { ...structuredClone(draft), selectedSteps: [...new Set([...draft.selectedSteps, ...steps.filter(step => mockStepIsLocked(id, step) || mockStepIsDependency(step)).map(step => step.key)])],
    manualSteps: [...new Set([...(draft.manualSteps ?? []), ...steps.filter(step => !draft.selectedSteps.includes(step.key) && !mockStepIsLocked(id, step) && manualReadFields(id, step.key).length > 0).map(step => step.key)])] };
}
export function mockStepInputError(id: MockWorkflowId, draft: MockDraft): string | undefined {
  const steps = mockWorkflow(id).steps;
  if (draft.manualSteps?.some(key => !steps.some(step => step.key === key))) return "Unknown manual reading step.";
  for (const step of steps) {
    if (id === "oath-upload" && draft.uploadMode === "upload-only" && mockStepIsDependency(step)) continue;
    if ((mockStepIsLocked(id, step) || mockStepIsDependency(step)) && !draft.selectedSteps.includes(step.key)) return `${step.label} is required.`;
    const fields = manualReadFields(id, step.key), manual = usesManualRead(draft, step.key);
    if (fields.length && !draft.selectedSteps.includes(step.key) && !manual) return `Enter manual values for ${step.label.toLowerCase()}.`;
    if (!manual) continue;
    if (!fields.length) return `${step.label} does not accept manual values.`;
    for (const field of fields) {
      const value = draft.manualValues?.[step.key]?.[field.key]?.trim();
      if (!value) return `Enter ${field.label.toLowerCase()} for ${step.label.toLowerCase()}.`;
      if (field.options && !field.options.includes(value)) return `Choose ${field.label.toLowerCase()}.`;
      if (/employee id$/iu.test(field.label) && !/^10\d{6}$/u.test(value)) return "Employee ID must start with 10 and contain eight digits.";
      if (field.date) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
        const iso = match ? `${match[3]}-${match[1]}-${match[2]}` : "";
        const date = new Date(`${iso}T00:00:00Z`);
        if (!match || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== iso) return `${field.label} must be a valid date in MM/DD/YYYY format.`;
      }
    }
  }
  return undefined;
}
const aliases: Readonly<Record<string, string>> = { "Signature date": "Signed date", "Oath date": "Signed date", "Compensation rate": "Wage", "Pay rule": "New pay rule", EID: "Employee ID", "UCPath ID": "Employee ID", "Employee name": "Employee", Name: "Employee" };
export function manualFact(id: MockWorkflowId, draft: MockDraft, label: string, token?: string): string | undefined {
  const wanted = aliases[label] ?? label;
  for (const step of [...mockWorkflow(id).steps].reverse()) {
    if (!usesManualRead(draft, step.key)) continue;
    const fields = manualReadFields(id, step.key);
    const field = (token ? fields.find(field => field.token === token) : undefined) ?? fields.find(field => field.label === wanted);
    if (field) {
      const value = draft.manualValues?.[step.key]?.[field.key]?.trim();
      if (!value) throw new Error(`MOCK_MANUAL_VALUE_MISSING: ${step.key}:${field.key}`);
      return value;
    }
  }
  return undefined;
}
