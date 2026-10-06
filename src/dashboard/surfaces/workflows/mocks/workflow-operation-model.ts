import { displayExtractedDate } from "../../../lib/date-format.js";
import type { MockRun } from "./workflow-mock-model.js";
import { MOCK_FORM_TYPES, type MockStep } from "./workflow-mock-catalog.js";
import { mockInputRecord, reviewRecords, reviewValue, seedReviewRecords } from "./workflow-review-model.js";
import type { LogEntry } from "../../run-detail/logs/log-feed-model.js";
import type { LogTimelineState, LogTimelineSubstep } from "../../run-detail/logs/log-timeline-model.js";

import { MOCK_OPERATION_CATALOG, read, fill, click, type OperationField, type MockOperation } from "./workflow-operation-catalog.js";
export { MOCK_OPERATION_CATALOG } from "./workflow-operation-catalog.js";
import { manualReadFields, manualFact, usesManualRead } from "./workflow-manual-model.js";

export function mockOperationValue(run: MockRun, value: string): string {
  const manual = value.startsWith("$") ? manualFact(run.workflowId, run.draft, "", value) : undefined;
  if (manual !== undefined) return manual;
  if (!/^\$[a-z]/u.test(value)) return value;
  const original = seedReviewRecords(run)[0], record = run.workflowId === "ocr" ? original : mockInputRecord(run), field = (key: string) => reviewValue(record, key) || "—";
  const values: Record<string, string> = {
    employeeId: run.role === "person" ? field("employeeId") : /^\d{5,}$/u.test(run.subject) && run.workflowId !== "separations" ? run.subject : field("employeeId"),
    subject: run.subject, name: `${field("firstName")} ${field("lastName")}`, firstName: field("firstName"), lastName: field("lastName"),
    sourceName: `${reviewValue(original, "firstName")} ${reviewValue(original, "lastName")}`, sourceEmployeeId: reviewValue(original, "employeeId"),
    email: run.subject.includes("@") ? run.subject : "jordan.lee@example.com", effectiveDate: displayExtractedDate(run.draft.effectiveDate),
    hireType: run.draft.hireType === "rehire" ? "Rehire" : "New hire", existingPerson: run.draft.hireType === "rehire" ? field("employeeId") : "No match",
    hireTemplate: run.draft.hireType === "rehire" ? "UC_CONC_HIRE" : "UC_FULL_HIRE", hireReason: run.draft.hireType === "rehire" ? "Concurrent Hire - Non Dual Emp" : "Hire - No Prior UC Affiliation",
    hireComments: run.draft.hireType === "rehire" ? `Concurrent Hire as Dining Student Effective ${displayExtractedDate(run.draft.effectiveDate)}. PCN DEMO-POS-001. Job number #DEMO-REC-001.` : `New Dining Student Hire Effective ${displayExtractedDate(run.draft.effectiveDate)}. Job number #DEMO-REC-001.`,
    profileId: run.draft.dryRun ? "1000001 · unsaved placeholder" : "DEMO-I9-001", workStudyComments: `Updated pool id to F per work study award ${displayExtractedDate(run.draft.effectiveDate)}`,
    pdf: run.draft.files.map(file => file.name).join(", "), formType: run.parentWorkflowId === "onbase" ? run.draft.documentType : MOCK_FORM_TYPES.find(item => item.value === run.draft.formType)?.label ?? run.draft.formType, sourcePage: String(record.page),
    documentType: run.draft.documentType, documentName: run.draft.documentType === "Emergency Contact" ? "EMERGENCY CONTACT INFORMATION" : run.draft.documentType.toUpperCase(),
    roster: run.draft.formType === "i9" ? "Action History" : "Onboarding Roster", rosterMode: run.draft.roster === "download" ? "Fresh SharePoint download" : "Registered local workbook",
    recordCount: String(reviewRecords(run).length), approvedCount: String(run.approvedCount ?? 0), approval: run.approved ? "Approved" : "Waiting for review",
    signedDate: displayExtractedDate(field("dateSigned")),
    contactName: field("contactName"), relationship: field("relationship"), phone: field("cellPhone"), sameAddress: field("sameAddress") === "true" ? "Yes" : "No",
    street: field("street"), city: field("city"), state: field("state"), zip: field("zip"), country: field("country"), section1: field("section1"), section2: field("section2"),
    reportStart: displayExtractedDate(run.draft.startDate), reportEnd: displayExtractedDate(run.draft.endDate),
  };
  const result = values[value.slice(1)];
  if (result === undefined) throw new Error(`MOCK_OPERATION_VALUE_UNKNOWN: ${value}`);
  return result;
}
export function mockOperations(run: MockRun, step: MockStep): readonly MockOperation[] {
  if (usesManualRead(run.draft, step.key)) {
    const fields = manualReadFields(run.workflowId, step.key).map<OperationField>(field => [field.label, run.draft.manualValues?.[step.key]?.[field.key] ?? ""]);
    const manual = read("Operator-entered values", fields);
    let committed = false;
    const automatic = run.draft.selectedSteps.includes(step.key) ? (MOCK_OPERATION_CATALOG[run.workflowId][step.key] ?? []).filter(operation => {
      if (operation.commit) committed = true;
      return committed || !operation.fields || operation.fields.every(field => field[2] === "fill");
    }) : [];
    return [manual, ...automatic];
  }
  const key = step.key.replace(/^roster:/u, "");
  const exact = MOCK_OPERATION_CATALOG[step.key.startsWith("roster:") ? "sharepoint-download" : run.workflowId][key];
  if (exact) {
    if (run.workflowId === "ocr" && key === "prep:person-lookup" && reviewRecords(run).length === 0) return [read("Identity matching", [["People resolved", "0"]])];
    if (run.workflowId === "ocr" && ["prep:ocr", "prep:person-lookup"].includes(key) && reviewRecords(run).length > 0) {
      const systemEvidence = key === "prep:person-lookup";
      const fields = seedReviewRecords(run)[0].fields.filter(field => systemEvidence ? field.readOnly : !field.readOnly).map<OperationField>(field => [field.label, field.kind === "boolean" ? field.value === "true" ? "Yes" : "No" : field.value || "—"]);
      return fields.length ? [...exact, read(systemEvidence ? "System verification" : "Extracted source fields", fields)] : exact;
    }
    if (run.workflowId === "person-lookup" && key === "searching" && run.draft.lookupMode === "match") return [fill("Match criteria", [["Name", "$name"], ["Date of birth", "01/15/2005"], ["SSN", "•••-••-0001"]]), ...exact.slice(1)];
    if (run.workflowId === "emergency-contact" && key === "fill-form" && reviewValue(mockInputRecord(run), "sameAddress") === "true") return exact.filter(operation => operation.label !== "Contact address");
    if (run.workflowId === "onboarding" && key === "transaction" && run.draft.hireType === "rehire") {
      const job = exact.find(operation => operation.label === "Job Data" && operation.fields), receipt = exact.find(operation => operation.label === "Hire confirmation");
      if (!job || !receipt) throw new Error("MOCK_CONCURRENT_HIRE_CONTRACT_MISSING");
      return [exact[0], exact[1], exact[2], fill("Enter Transaction Details", [["Employee ID", "$employeeId"]]),
        read("Resolved identity", [["Resolved name", "$name"], ["CRM name", "$name"], ["Name match", "Confirmed"]]),
        fill("Transaction reason", [["Reason", "$hireReason"]]), click("Acknowledge the matching Person ID already exists"),
        job, fill("Job Data comments", [["Comments", "$hireComments"]]), click("Earns Dist"), click("Personal Data"),
        read("Pre-filled legal name", [["Employee ID", "$employeeId"], ["Legal name", "$name"], ["Name match", "Confirmed"]]),
        fill("Initiator comments", [["Comments", "$hireComments"]]), read("Submit readiness", [["Save and Submit", "Enabled"]]),
        click("Save and Submit", true), receipt,
        ...(run.draft.dryRun ? [click("Cancel unsubmitted draft"), read("Draft cleanup", [["Draft status", "Cancelled"], ["Submitted", "No"]])] : [])];
    }
    return exact;
  }
  if (key.includes("auth") || key === "authenticate") return [click(`Open ${step.system ?? "the system"}`), read("Session", [["System", step.system ?? "OnBase"], ["Authentication", "Authenticated"], ["Identity", "Demo operator"]])];
  if (key === "read-document") return [read("Document delegation", [["PDF", "$pdf"], ["Form type", "$formType"], ["OCR run", run.ocrRunId ?? "Not created"]])];
  if (key === "members" || key === "rollup") return [read(key === "members" ? "Approved person runs" : "Person outcomes", [["People", "$approvedCount"], ["Workflow", run.workflowId], ["Failed", "0"], ["Cancelled", "0"]])];
  throw new Error(`MOCK_OPERATION_STEP_UNKNOWN: ${run.workflowId}:${key}`);
}
export function mockOperationDuration(index: number): number { return 8 + index * 4; }
function stagesDryRunForm(run: MockRun, step: MockStep, state: LogTimelineState): boolean {
  return state === "skipped" && run.workflowId === "onboarding" && run.draft.dryRun && !!step.write && run.draft.selectedSteps.includes(step.key) && !(step.key === "i9-creation" && run.draft.hireType === "rehire");
}
export function mockOperationSubsteps(run: MockRun, step: MockStep, state: LogTimelineState): readonly LogTimelineSubstep[] {
  return mockOperations(run, step).map((operation, index) => {
    const staged = stagesDryRunForm(run, step, state) && !operation.commit && !operation.verify;
    const childState = staged ? "completed" : state === "waiting" && index > 0 ? "pending" : state;
    return { id: `${run.id}:${step.key}:operation:${index}`, label: operation.label, state: childState,
      ...(childState === "completed" ? { durationLabel: `${mockOperationDuration(index)}s` } : {}) };
  });
}
export function mockOperationEntries(run: MockRun, step: MockStep, state: LogTimelineState, time: string): readonly LogEntry[] {
  if (["pending", "cancelled", "waiting"].includes(state)) return [];
  const staged = stagesDryRunForm(run, step, state);
  if (state === "skipped" && !staged && !usesManualRead(run.draft, step.key)) return [];
  return mockOperations(run, step).flatMap<LogEntry>((operation, index) => {
    if (staged && (operation.commit || operation.verify)) return [];
    const id = `${run.id}:${step.key}:operation:${index}`, entries: LogEntry[] = [];
    if (operation.click) entries.push({ kind: "click", id, time, label: operation.click });
    if (operation.fields) entries.push({ kind: "fields", id: `${id}:fields`, title: operation.label, fields: operation.fields.map(([label, value, kind], fieldIndex) => ({ id: `${id}:field:${fieldIndex}`, time, kind: kind ?? "read", label, value: manualFact(run.workflowId, run.draft, label, value.startsWith("$") ? value : undefined) ?? mockOperationValue(run, value) })) });
    if (operation.verify) entries.push({ kind: "note", id: `${id}:verify`, time, message: operation.verify, tone: "positive" });
    return entries;
  });
}
