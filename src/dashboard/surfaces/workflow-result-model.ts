import type { MockRun } from "./workflow-mock-model.js";
import { mockWorkflow, type MockStep } from "./workflow-mock-catalog.js";
import type { LogEntry } from "./log-feed-model.js";
import type { LogTimelineState } from "./logs/log-timeline-model.js";
import { workflowPreviewGraph, type PreviewNode } from "./workflow-preview-contracts.js";
import { reviewName, mockInputRecord, reviewValue, reviewRecords, seedReviewRecords } from "./workflow-review-model.js";

const VALUES: Readonly<Record<string, string>> = {
  "Action": "Voluntary termination", "Active": "Yes", "Active people": "1", "Already has oath": "No", "Appointment": "Student appointment",
  "Archive zip": "Jordan-Lee-documents.zip", "CRM authentication": "Authenticated", "CRM match": "Confirmed", "CRM onboarding": "Record found",
  "Campus email": "jordan.lee@example.com", "Candidates": "1 confirmed person", "Change reason": "JRL", "Completeness gaps": "0",
  "Contacts saved": "1", "Current pay rule": "DEMO-CT-BASE", "Department": "HDH", "Department name": "Housing Dining Hospitality", "Document number": "48216",
  "Document status": "Completed", "Document type": "X_HR_Emergency Contact", "Documents downloaded": "entry-sheet.pdf, onboarding-packet.pdf",
  "Emergency contact": "Alex Lee · Sibling · (202) 555-0102", "Employment date": "08/03/2026", "Existing I-9 profile": "None",
  "Existing contact": "No exact-name duplicate", "Existing hire transaction": "None", "Export modified": "08/03/2026",
  "Files saved": "10000001-Time-Detail.pdf", "Found": "Yes", "HR status": "Active", "Holiday dates": "None", "I-9 profile": "DEMO-I9-001",
  "I-9 separation date": "Not separated", "I-9 status": "Section 2 complete", "Imported document": "DEMO-ONBASE-001 · source page 1",
  "Job code": "DEMO-JOB-001", "Job record": "0", "Job title": "Student assistant", "Last day worked": "08/02/2026", "Last punch": "08/02/2026",
  "New election": "Cash", "Oath date": "08/03/2026", "Oath signature": "08/03/2026", "Oath signatures": "1", "Oaths signed": "1",
  "Official signer": "Alex Morgan", "Onboarding documents": "entry-sheet.pdf, onboarding-packet.pdf", "Pages": "2", "Pages with a contact block": "1",
  "Pay rule": "DEMO-OT-BASE", "People found": "1", "People resolved": "1", "People typed": "1", "Position": "DEMO-POS-001", "Position number": "DEMO-POS-001",
  "Position pool": "F", "Preset merged": "None", "Primary contact": "Alex Lee", "Process stage": "Onboarding complete", "Profile id": "DEMO-I9-001",
  "Records read": "1", "Records reported": "1", "Reports selected": "Time Detail", "Retention row": "10000001 · Section 1 page 1 · Section 2 page 2",
  "Roster email": "jordan.lee@example.com", "Roster file": "Onboarding Roster.xlsx · local roster directory", "Roster rows matched": "1 / 1",
  "Row count": "1", "Rows read back": "1", "Separation date": "08/02/2026", "ServiceNow ticket": "DEMO-HR-001", "Sick dates in window": "None",
  "Signatures complete": "1 / 1", "Signed date": "08/03/2026", "Signed oaths found": "1", "Signers found": "1", "Start date": "08/03/2026",
  "Target pay rule": "DEMO-OT-BASE", "Termination date": "None", "Termination type": "Voluntary", "Timekeeper": "Demo operator", "Tracker row": "10000001 · PDF identity matched",
  "Transaction number": "DEMO-TXN-001", "Union code": "SX", "Wage": "$17.75 per hour",
};
export function mockFieldValue(run: MockRun, label: string): string {
  const record = run.workflowId === "ocr" ? seedReviewRecords(run)[0] : mockInputRecord(run);
  if (run.workflowId === "ocr" && ["Records read", "Records reported", "People resolved", "Active people"].includes(label)) return String(reviewRecords(run).length);
  if (run.workflowId === "ocr" && label === "Roster rows matched") return `${reviewRecords(run).filter(item => item.match === "matched").length} / ${reviewRecords(run).length}`;
  if (["EID", "Employee ID", "Matched EID", "Shown EID", "UCPath Employee ID", "UCPath ID"].includes(label)) return run.role === "person" ? reviewValue(record, "employeeId") : /^\d{5,}$/u.test(run.subject) && mockWorkflow(run.workflowId).inputLabel !== "Kuali ID" ? run.subject : "10000001";
  if (["Name", "Employee name", "Matched name", "Lived name"].includes(label)) return reviewName(record);
  if (label === "Names typed") return run.subject;
  if (label === "Email searched") return run.subject.includes("@") ? run.subject : "jordan.lee@example.com";
  if (label === "Contact name") return reviewValue(record, "contactName") || "Alex Lee";
  if (label === "Phone") return reviewValue(record, "cellPhone") || "(202) 555-0102";
  if (label === "Relationship") return reviewValue(record, "relationship") || "Sibling";
  if (label === "Effective date") { const [year, month, day] = run.draft.effectiveDate.split("-"); return run.workflowId === "kronos-pay-rule" ? "07/01/2026" : `${month}/${day}/${year}`; }
  if (label === "Job Data comments" || label === "Initiator comments") return `Updated pool id to F per work study award ${mockFieldValue(run, "Effective date")}`;
  const value = VALUES[label];
  if (value === undefined) throw new Error(`MOCK_RESULT_FIELD_UNKNOWN: ${label}`);
  return value;
}
const STEP_NODES: Readonly<Record<string, string>> = {
  searching: "Searching", "cross-verification": "Cross-verification", "active-status": "Active status", "crm-dates": "CRM dates",
  "kuali-extraction": "Kuali extraction", "identity-check": "Identity check", "ucpath-job-summary": "Job summary", "kronos-search": "Kronos search", "ucpath-transaction": "UCPath transaction", "kuali-finalization": "Kuali finalization",
  extraction: "CRM extraction", "pdf-download": "PDF download", "person-search": "Person search", "i9-creation": "I-9 creation", lookup: "Lookup",
  "csv-lookup": "CSV lookup", "determine-action": "Determine action", "update-pay-rule": "Update pay rule",
  "crm-verify": "CRM verify", "wait-signatures": "Wait signatures", submit: "File ticket", navigation: "Navigation", "fill-form": "Fill form", save: "Save",
  authenticate: "Authenticate", "prepare-import": "Prepare import", "fill-keywords": "Fill keywords", import: "Import",
  "person-match": "Person match", "employment-dates": "Person lookup", "roster-match": "Retention tracker", "search-record": "Search record", download: "Download", archive: "Archive", navigate: "Navigate",
  extracting: "Extracting", downloading: "Downloading", "prep:ocr": "OCR extraction", "prep:awaiting-approval": "Your review",
  ocr: "Read forms", "loading-roster": "Roster match", "awaiting-approval": "Done",
};
export function mockStepNode(run: MockRun, step: MockStep): PreviewNode | undefined {
  const ocrNodes: Readonly<Record<string, string>> = { "prep:loading-roster": "Roster match", "prep:ocr": "Read forms", "prep:person-lookup": "Person lookup", "prep:awaiting-approval": "Your review" };
  const id = run.workflowId === "ocr" ? ocrNodes[step.key] : step.key === "transaction" ? run.workflowId === "onboarding" ? "SmartHR transaction" : run.workflowId === "oath-signature" ? "Sign oath" : "Transaction" : step.key === "ucpath-auth" ? "UCPath auth" : STEP_NODES[step.key];
  return workflowPreviewGraph(run.workflowId).nodes.find(node => node.id === id);
}
export function mockDetailEntries(run: MockRun, step: MockStep, state: LogTimelineState, time: string): readonly LogEntry[] {
  if (state === "skipped" && run.workflowId === "onboarding" && run.draft.dryRun && run.draft.selectedSteps.includes(step.key) && ["i9-creation", "transaction"].includes(step.key) && !(step.key === "i9-creation" && run.draft.hireType === "rehire")) {
    const values = step.key === "i9-creation" ? [["Employee", "Jordan Lee"], ["Email", run.subject], ["Profile ID", "Synthetic placeholder · no profile created"]] : [["Template", run.draft.hireType === "rehire" ? "UC_CONC_HIRE" : "UC_FULL_HIRE"], ["Position number", "DEMO-POS-001"], ["Wage", "$17.75 per hour"], ["Effective date", "08/03/2026"]];
    return [{ kind: "fields", id: `${run.id}:${step.key}:staged`, title: "Staged form · dry run", fields: values.map(([label, value], index) => ({ id: `${run.id}:${step.key}:staged:${index}`, time, kind: "fill", label, value })) }, { kind: "note", id: `${run.id}:${step.key}:abandoned`, time, message: step.key === "i9-creation" ? "I-9 form filled and abandoned without Save & Continue." : "Smart HR form staged without Save and Submit." }];
  }
  if (state === "pending" || state === "cancelled" || state === "skipped") return [];
  const node = mockStepNode(run, step);
  const contract = node?.contract.filter(item => !item.when) ?? [];
  const entries: LogEntry[] = [];
  if (node && contract.length) {
    entries.push({ kind: "fields", id: `${run.id}:${step.key}:details`, title: node.id, fields: contract.map((item, index) => ({ id: `${run.id}:${step.key}:detail:${index}`, time, kind: item.dir === "write" ? "fill" : "read", label: item.field === "EID" ? "Employee ID" : item.field, value: mockFieldValue(run, item.field) })) });
    const proofs = [...new Set(contract.filter(item => item.proof).map(item => item.proof))];
    if (proofs.length) entries.push({ kind: "note", id: `${run.id}:${step.key}:proof`, time, message: `Readback: ${proofs.join("; ")}.`, tone: "positive" });
  }
  if (step.key === "prep:awaiting-approval" && run.workflowId === "ocr") entries.push({ kind: "decision", id: `${run.id}:review-gate`, time, decision: { title: run.approved ? "Records approved" : "Review extracted records", state: run.approved ? "resolved" : "review", message: "Review records before processing." } });
  if (run.workflowId === "oath-upload" && step.key === "fill-form") entries.push({ kind: "fields", id: `${run.id}:ticket-form`, fields: [["Subject", "HDH New Hire Oaths"], ["Attachment", run.draft.files.map(file => file.name).join(", ")]].map(([label, value], index) => ({ id: `${run.id}:ticket-field:${index}`, time, kind: "fill", label, value })) });
  return entries;
}
