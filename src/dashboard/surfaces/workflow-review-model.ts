import type { MockRun } from "./workflow-mock-model.js";

// Review shapes and selection rules copied from legacy@9bb973672666b9267569a22d3fa0af722e4c5e87,
// src/dashboard/components/ocr/{EcRecordView,OathRecordView,VerifyRecordView,types,approval-selection}.
export type ReviewField = Readonly<{ key: string; label: string; value: string; kind?: "date" | "boolean" | "relationship"; readOnly?: boolean }>;
export type ReviewRecord = Readonly<{
  id: string; page: number; kind: "oath" | "contact" | "verify" | "i9";
  fields: readonly ReviewField[]; selected: boolean; unknown?: boolean;
  match: "matched" | "unresolved" | "manual"; warnings: readonly string[];
}>;
export const REVIEW_RELATIONSHIPS = ["Parent", "Sibling", "Spouse", "Domestic Partner Adult", "Domestic Partner Child", "Child", "Grandchild", "Grand Parent", "Other Relative", "Friend", "Neighbor", "Roommate", "Ward", "Medical Provider", "Emerg/Detention/Arrest Contact", "Contact if Detained/Arrested", "Other"];
const field = (key: string, label: string, value: string, kind?: ReviewField["kind"]): ReviewField => ({ key, label, value, ...(kind ? { kind } : {}), ...(["serviceDate", "oathDate", "i9Status", "i9Signer", "ucpathFound", "ppsId", "hireDate", "separationDate", "tracker"].includes(key) ? { readOnly: true } : {}) });
export function seedReviewRecords(run: Pick<MockRun, "workflowId" | "draft">): readonly ReviewRecord[] {
  const type = run.workflowId === "i9-check" ? "i9" : run.workflowId === "ocr" ? run.draft.formType : run.workflowId === "onbase" || run.workflowId === "emergency-contact" ? "emergency-contact" : "oath";
  const kind = type === "i9" ? "i9" : type === "verify" ? "verify" : type === "oath" ? "oath" : "contact";
  return [{ id: "person-1", page: 1, kind, selected: true, match: "matched", warnings: [], fields: [
    field("employeeId", "Employee ID", "10000001"), field("firstName", "First name", "Jordan"), field("lastName", "Last name", "Lee"),
    ...(kind === "oath" ? [field("dateSigned", "Date signed", "2026-08-03", "date"), field("employeeSigned", "Employee signed", "true", "boolean"), field("officerSigned", "Officer signed", "true", "boolean")] : []),
    ...(kind === "contact" ? [field("contactName", "Contact name", "Alex Lee"), field("relationship", "Relationship", "Sibling", "relationship"), field("sameAddress", "Same address as employee", "true", "boolean"), field("street", "Street", "100 Example Street"), field("city", "City", "San Diego"), field("state", "State", "CA"), field("zip", "ZIP", "92101"), field("country", "Country", "USA"), field("cellPhone", "Cell phone", "(202) 555-0102"), field("homePhone", "Home phone", ""), field("workPhone", "Work phone", "")] : []),
    ...(kind === "verify" ? [field("paperOath", "Employee signature on paper", "Present"), field("paperContact", "Emergency contact on paper", "Present"), field("serviceDate", "First day of service · CRM", "08/03/2026"), field("oathDate", "Oath date · CRM", "08/03/2026"), field("i9Status", "Section 2 · I-9 portal", "Complete"), field("i9Signer", "Authorized representative · I-9 portal", "Alex Morgan")] : []),
    ...(kind === "i9" ? [field("section1", "Section 1 page", "1"), field("section2", "Section 2 page", "2")] : []),
  ] }];
}
export function reviewValue(record: ReviewRecord, key: string): string { return record.fields.find(item => item.key === key)?.value ?? ""; }
export function reviewName(record: ReviewRecord): string { return `${reviewValue(record, "firstName")} ${reviewValue(record, "lastName")}`.trim() || "Unnamed record"; }
export function reviewCanApprove(record: ReviewRecord): boolean {
  return record.selected && !record.unknown && record.match !== "unresolved" && /^\d{5,}$/u.test(reviewValue(record, "employeeId"));
}
export function editReviewRecord(record: ReviewRecord, key: string, value: string): ReviewRecord {
  const target = record.fields.find(item => item.key === key);
  if (!target) throw new Error(`MOCK_REVIEW_FIELD_UNKNOWN: ${key}`);
  if (target.readOnly) throw new Error(`MOCK_REVIEW_FIELD_READ_ONLY: ${key}`);
  const manual = key === "employeeId" && value !== reviewValue(record, key);
  const warning = "Employee ID entered by the operator — not confirmed by a UCPath lookup.";
  return { ...record, fields: record.fields.map(item => item.key === key ? { ...item, value } : item),
    ...(manual ? { match: /^\d{5,}$/u.test(value) ? "manual" : "unresolved", warnings: [...record.warnings.filter(item => item !== warning), warning] } : {}) };
}
export function reviewRecords(run: MockRun): readonly ReviewRecord[] { return run.workflowId === "ocr" ? run.records ?? seedReviewRecords(run) : []; }
export function mockInputRecord(run: MockRun): ReviewRecord { return run.inputRecord ?? reviewRecords(run)[0] ?? seedReviewRecords(run)[0]; }
export function reviewIsReadOnly(run: MockRun): boolean {
  return run.workflowId !== "ocr" || run.approved || run.discarded === true || run.role === "person";
}
export function addMockReviewRecord(records: readonly ReviewRecord[]): readonly ReviewRecord[] {
  const base = records[0];
  if (!base) throw new Error("MOCK_REVIEW_SHAPE_MISSING");
  const record: ReviewRecord = { ...base, id: `manual-${records.length + 1}`, selected: false, match: "unresolved", warnings: [], fields: base.fields.map(item => ({ ...item, value: item.kind === "boolean" ? "false" : "" })) };
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
