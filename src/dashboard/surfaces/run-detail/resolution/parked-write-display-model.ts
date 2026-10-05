export const PARKED_WRITE_DISPLAY = {
  unknown: { title: "Submission unconfirmed", observation: "The transaction outcome could not be confirmed." },
  ambiguous: { title: "Conflicting transaction evidence", observation: "The observations do not establish one transaction outcome." },
  "present-proof-invalid": { title: "Completion evidence rejected", observation: "The completion evidence did not pass validation." },
  "binding-invalid": { title: "Write binding invalid", observation: "The write evidence does not validate against the intended subject." },
  "operator-required": { title: "Operator verification required", observation: "Automatic recovery could not settle this transaction." },
} as const;


import type { ProofFieldWire } from "../../../../domain/dashboard/run-detail.js";
import { proofFieldLabel } from "./proof-form.js";

export function proofDisplayLabel(field: ProofFieldWire): string {
  const labels: Readonly<Record<string, string>> = {
    emplId: "Employee ID", observedEid: "Employee ID", documentNumber: "Document number",
    transactionId: "Transaction number", "fields.transactionNumber": "Transaction number",
    "fields.department": "Department", "fields.payrollTitleCode": "Payroll title code",
    "fields.payrollTitle": "Payroll title", "fields.timekeeperName": "Timekeeper",
    "fields.lastDateWorked": "Last day worked", "fields.lastDayWorked": "Last day worked", "fields.separationDate": "Separation date",
    "fields.terminationEffectiveDate": "Termination effective date", "fields.comments": "Comments",
    "fields.initiatorComments": "Initiator comments", "fields.timekeeperComments": "Timekeeper comments",
    "fields.requestAcknowledged": "Request acknowledged", "fields.templateSubmitted": "Template submitted", "fields.finalPay": "Final pay",
  };
  return labels[field.path] ?? proofFieldLabel(field);
}
