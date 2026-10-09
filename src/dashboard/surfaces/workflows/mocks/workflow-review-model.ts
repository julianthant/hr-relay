import type { MockRun } from "./workflow-mock-model.js";
import { mockOnbaseDocumentType, type MockWorkflowId } from "./workflow-mock-catalog.js";
import { mockDocumentFixture } from "./workflow-document-model.js";

// Review shapes and selection rules copied from legacy@9bb973672666b9267569a22d3fa0af722e4c5e87
// src/dashboard/components/ocr/{EcRecordView,OathRecordView,VerifyRecordView,types,approval-selection}.
export type ReviewField = Readonly<{ key: string; label: string; value: string; kind?: "date" | "boolean" | "relationship"; section?: string; readOnly?: boolean }>;
export type ReviewRecord = Readonly<{
  id: string; page: number; kind: "oath" | "contact" | "verify" | "i9" | "separation";
  fields: readonly ReviewField[]; selected: boolean; unknown?: boolean;
  match: "matched" | "unresolved" | "manual"; warnings: readonly string[];
  targetWorkflowId?: MockWorkflowId;
  i9Section?: 1 | 2; manualEntry?: boolean; sourcePageCount?: number;
}>;
export const REVIEW_RELATIONSHIPS = ["Parent", "Sibling", "Spouse", "Domestic Partner Adult", "Domestic Partner Child", "Child", "Grandchild", "Grand Parent", "Other Relative", "Friend", "Neighbor", "Roommate", "Ward", "Medical Provider", "Emerg/Detention/Arrest Contact", "Contact if Detained/Arrested", "Other"];
const field = (key: string, label: string, value: string, kind?: ReviewField["kind"], section?: string): ReviewField => ({ key, label, value, ...(kind ? { kind } : {}), ...(section ? { section } : {}) });
function extractedReviewRecords(run: Pick<MockRun, "workflowId" | "draft">, useFixture = true): readonly ReviewRecord[] {
  const fixture = mockDocumentFixture(run.draft);
  const documentType = mockOnbaseDocumentType(run.draft.documentType);
  const type = run.workflowId === "i9-check" ? "i9" : run.workflowId === "ocr" ? run.draft.formType : run.workflowId === "onbase" ? documentType.formType : run.workflowId === "emergency-contact" ? "emergency-contact" : run.workflowId === "separations" ? "separation" : "oath";
  if (!["i9", "verify", "oath", "emergency-contact", "onbase-emergency-contact", "separation"].includes(type)) throw new Error("MOCK_REVIEW_DOCUMENT_TYPE_UNKNOWN");
  const kind = type === "i9" ? "i9" : type === "verify" ? "verify" : type === "oath" ? "oath" : type === "separation" ? "separation" : "contact";
  const i9Section = kind === "i9" && "i9Section" in documentType ? documentType.i9Section : undefined;
  const records: readonly ReviewRecord[] = [{ id: "person-1", page: 1, kind, ...(i9Section ? { i9Section } : {}), selected: true, match: "matched", warnings: [], fields: [
    field("employeeId", "Employee ID", "10000001"), field("firstName", "First name", "Jordan"), field("lastName", "Last name", "Lee"),
    ...(kind === "oath" ? [field("printedName", "Printed name", "Lee, Jordan"), field("dateSigned", "Date signed", "2026-08-03", "date", "Oath"), field("employeeSigned", "Employee signed", "true", "boolean", "Oath"), field("officerSigned", "Officer signed", "true", "boolean", "Oath")] : []),
    ...(kind === "contact" ? [
      ...[["employeeName", "Employee name", "Jordan Lee"], ["pid", "PID", ""], ["jobTitle", "Job title", ""], ["workLocation", "Work location", ""], ["supervisor", "Supervisor", ""], ["workEmail", "Work email", "jordan.lee@example.com"], ["personalEmail", "Personal email", ""], ["employeeHomePhone", "Employee home phone", ""], ["employeeCellPhone", "Employee cell phone", "(202) 555-0101"]].map(([key, label, value]) => field(key, label, value)),
      ...[["employeeStreet", "Employee street", "100 Example Street"], ["employeeCity", "Employee city", "San Diego"], ["employeeState", "Employee state", "CA"], ["employeeZip", "Employee ZIP", "92101"], ["employeeCountry", "Employee country", "USA"]].map(([key, label, value]) => field(key, label, value, undefined, "Employee address")),
      field("contactName", "Contact name", "Alex Lee", undefined, "Emergency contact"), field("relationship", "Relationship", "Sibling", "relationship", "Emergency contact"), field("primary", "Primary contact", "true", "boolean", "Emergency contact"), field("sameAddress", "Same address as employee", "true", "boolean", "Emergency contact"),
      ...[["cellPhone", "Cell phone", "(202) 555-0102"], ["homePhone", "Home phone", ""], ["workPhone", "Work phone", ""], ["street", "Street", "100 Example Street"], ["city", "City", "San Diego"], ["state", "State", "CA"], ["zip", "ZIP", "92101"], ["country", "Country", "USA"]].map(([key, label, value]) => field(key, label, value, undefined, "Emergency contact")),
    ] : []),
    ...(kind === "verify" ? [field("printedName", "Printed name", "Lee, Jordan"), field("paperEmployeeId", "Employee ID on paper", "10000001"), field("paperEmploymentDate", "First day of service on paper", "2026-08-03", "date", "Paper forms"), field("paperDateSigned", "Date signed on paper", "2026-08-03", "date", "Paper forms"), field("employeeSigned", "Employee signed", "true", "boolean", "Paper forms"), field("officerSigned", "Officer signed", "true", "boolean", "Paper forms"), field("paperOfficialName", "Official name on paper", "Alex Morgan", undefined, "Paper forms")] : []),
    ...(kind === "i9" ? [field("middleInitial", "Middle initial", ""), ...(i9Section !== 2 ? [field("dateOfBirth", "Date of birth", "1990-01-01", "date", "I-9"), field("ssn", "Social Security number", "", undefined, "I-9"), field("section1", "Section 1 page", "1", undefined, "I-9")] : []), ...(i9Section !== 1 ? [field("hireDate", "First day of employment", "2026-08-03", "date", "I-9"), field("section2", "Section 2 page", i9Section === 2 ? "1" : "2", undefined, "I-9")] : [])] : []),
    ...(kind === "separation" ? [field("kualiId", "Kuali ID", "48231"), field("separationDate", "Separation date", "2026-08-03", "date")] : []),
  ] }];
  if (!useFixture || !fixture) return records;
  if (fixture.records.every(record => record.kind === kind && (!i9Section || record.i9Section === i9Section))) return structuredClone(fixture.records);
  return records.map(record => ({ ...record, manualEntry: true, match: "unresolved", warnings: ["The document does not match the selected form type. Enter its fields manually."], fields: record.fields.map(item => ({ ...item, value: /^section[12]$/u.test(item.key) ? item.value : item.kind === "boolean" ? "false" : "" })) }));
}
export function seedReviewRecords(run: Pick<MockRun, "workflowId" | "draft">): readonly ReviewRecord[] {
  const extracted = extractedReviewRecords(run);
  if (run.draft.ocrMode !== "manual" || run.workflowId !== "ocr" && run.draft.method !== "pdf") return extracted;
  const shape = extractedReviewRecords(run, false)[0];
  const extractedBase = extracted[0];
  const base = extractedBase?.kind === shape.kind && extractedBase.i9Section === shape.i9Section ? extractedBase : shape;
  if (!base) throw new Error("MOCK_REVIEW_SHAPE_MISSING");
  return [{ ...base, selected: true, unknown: false, manualEntry: true, sourcePageCount: mockDocumentFixture(run.draft)?.pages.length ?? (base.kind === "i9" && !base.i9Section ? 2 : 1), match: "unresolved", warnings: [], fields: base.fields.map(item => {
    const structural = /^section[12]$/u.test(item.key);
    return { ...item, readOnly: false, value: structural ? item.value : item.kind === "boolean" ? "false" : "" };
  }) }];
}
export function reviewApprovalError(record: ReviewRecord): string | undefined {
  const employeeId = reviewValue(record, "employeeId");
  if (!employeeId.trim()) return "Enter an Employee ID to approve this record.";
  if (!/^10\d{6}$/u.test(employeeId)) return "Employee ID must start with 10 and contain eight digits.";
  if (record.unknown || record.match === "unresolved") return "Resolve this record before approval.";
  if (!record.manualEntry) return undefined;
  if (!["firstName", "lastName"].every(key => reviewValue(record, key).trim())) return "Enter the employee’s first and last name.";
  const required = record.kind === "oath" ? ["dateSigned"] : record.kind === "contact" ? ["contactName", "cellPhone"] : record.kind === "i9" ? ["dateOfBirth", "hireDate"] : record.kind === "verify" ? ["paperEmploymentDate", "paperDateSigned"] : ["kualiId", "separationDate"];
  for (const item of record.fields.filter(field => required.includes(field.key))) {
    if (!item.value.trim()) return `Enter ${item.label.toLowerCase()}.`;
    if (item.kind === "date" && !validManualDate(item.value)) return `${item.label} must be a valid date in MM/DD/YYYY format.`;
  }
  for (const item of record.fields.filter(field => /^section[12]$/u.test(field.key))) {
    if (!/^\d+$/u.test(item.value) || Number(item.value) < 1 || Number(item.value) > (record.sourcePageCount ?? 1)) return `Choose a valid ${item.label.toLowerCase()}.`;
  }
  if (record.kind === "oath" && ["employeeSigned", "officerSigned"].some(key => reviewValue(record, key) !== "true")) return "Confirm the employee and officer signatures before approval.";
  return undefined;
}
function validManualDate(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value) ?? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const iso = value.includes("/") ? `${match[3]}-${match[1]}-${match[2]}` : value;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
}
export function reviewValue(record: ReviewRecord, key: string): string { return record.fields.find(item => item.key === key)?.value ?? ""; }
export function reviewName(record: ReviewRecord): string { return `${reviewValue(record, "firstName")} ${reviewValue(record, "lastName")}`.trim() || "Unnamed record"; }
export function reviewCanApprove(record: ReviewRecord): boolean {
  return record.selected && reviewApprovalError(record) === undefined;
}
export function editReviewRecord(record: ReviewRecord, key: string, value: string): ReviewRecord {
  const target = record.fields.find(item => item.key === key);
  if (!target) throw new Error(`MOCK_REVIEW_FIELD_UNKNOWN: ${key}`);
  if (target.readOnly) throw new Error(`MOCK_REVIEW_FIELD_READ_ONLY: ${key}`);
  const manual = key === "employeeId" && value !== reviewValue(record, key);
  const warning = "Employee ID entered by the operator — not confirmed by a UCPath lookup.";
  return { ...record, ...(record.manualEntry && (key === "section1" || record.i9Section === 2 && key === "section2") ? { page: Number(value) } : {}), fields: record.fields.map(item => item.key === key ? { ...item, value } : item),
    ...(manual ? { match: /^10\d{6}$/u.test(value) ? "manual" : "unresolved", warnings: record.warnings.filter(item => item !== warning) } : {}) };
}
export function reviewRecords(run: MockRun): readonly ReviewRecord[] { return run.workflowId === "ocr" ? run.records ?? seedReviewRecords(run) : []; }
export function mockInputRecord(run: MockRun): ReviewRecord { return run.inputRecord ?? reviewRecords(run)[0] ?? seedReviewRecords(run)[0]; }
export function reviewIsReadOnly(run: MockRun): boolean {
  return run.workflowId !== "ocr" || run.approved || run.discarded === true || run.role === "person";
}
export function addMockReviewRecord(records: readonly ReviewRecord[]): readonly ReviewRecord[] {
  const base = records[0];
  if (!base) throw new Error("MOCK_REVIEW_SHAPE_MISSING");
  const record: ReviewRecord = { ...base, id: `manual-${records.length + 1}`, selected: false, match: "unresolved", warnings: [], fields: base.fields.map(item => ({ ...item, value: /^section[12]$/u.test(item.key) ? item.value : item.kind === "boolean" ? "false" : "" })) };
  return [...records, record];
}
export function updateMockReview(runs: readonly MockRun[], id: string, records: readonly ReviewRecord[]): readonly MockRun[] {
  const run = runs.find(item => item.id === id);
  if (!run || reviewIsReadOnly(run)) throw new Error("MOCK_REVIEW_READ_ONLY");
  return runs.map(item => item.id === id ? { ...item, records: structuredClone(records) } : item);
}
export function discardMockReview(runs: readonly MockRun[], id: string): readonly MockRun[] {
  const run = runs.find(item => item.id === id);
  if (!run || reviewIsReadOnly(run)) throw new Error("MOCK_REVIEW_READ_ONLY");
  return runs.map(item => item.id === id || item.id === run.parentId ? { ...item, discarded: true } : item);
}
export function restoreMockReview(runs: readonly MockRun[], id: string): readonly MockRun[] {
  const run = runs.find(item => item.id === id);
  if (run?.workflowId !== "ocr" || !run.discarded || run.approved || run.role === "person") throw new Error("MOCK_REVIEW_RESTORE_UNAVAILABLE");
  return runs.map(item => item.id === id || item.id === run.parentId ? { ...item, discarded: false } : item);
}
