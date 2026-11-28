import { z } from "zod";
import { matchesCrmDocumentSubject } from "../../../rules/crm-doc-download/documents.js";
import { CrmDocumentIdentitySchema, type CrmDocumentSubject } from "../../systems/crm/documents.js";
import type { StepOmissionInput } from "../../workflow/step-omission.js";
import { CrmDocDownloadCanonicalInput, CrmDocDownloadInput } from "./input.js";

const { recordId, eid, workEmail, personalEmail } = CrmDocumentIdentitySchema.shape;
const recordRows = z.array(z.tuple([recordId, eid, workEmail, personalEmail])).min(1);

export const CRM_MANUAL_RECORDS_EXAMPLE = "fixture | | fixture@example.test |";
const CrmManualRecordIdentitiesSchema = z.string().transform((text, context) => {
  const rows = recordRows.safeParse(text.split(";").map(row => row.split("|").map(value => value.trim() || null)));
  if (!rows.success || rows.data.some(([, , work, personal]) => work === null && personal === null)) {
    context.addIssue({ code: "custom", message: "Enter all four columns, with a CRM record ID and at least one valid email per person." });
    return z.NEVER;
  }
  if (new Set(rows.data.map(([id]) => id)).size !== rows.data.length) {
    context.addIssue({ code: "custom", message: "Enter each CRM record ID only once." });
    return z.NEVER;
  }
  return rows.data.map(([recordId, eid, workEmail, personalEmail]) => ({ recordId, eid, workEmail, personalEmail }));
});

export function crmManualDocumentRecordsSchema(people: readonly CrmDocumentSubject[]) {
  return CrmManualRecordIdentitiesSchema.transform((identities, context) => {
    if (identities.length !== people.length) {
      context.addIssue({ code: "custom", message: "Enter one CRM record per requested person." });
      return z.NEVER;
    }
    const records = people.flatMap((subject, index) => {
      const identity = identities[index];
      return identity !== undefined && matchesCrmDocumentSubject(subject, identity) ? [{ subject, identity }] : [];
    });
    if (records.length !== people.length) {
      context.addIssue({ code: "custom", message: "Match the requested people in input order." });
      return z.NEVER;
    }
    return { records };
  });
}

export function crmManualRecordsIssue(text: string, input: StepOmissionInput | undefined): string | undefined {
  if (input === undefined) {
    const result = CrmManualRecordIdentitiesSchema.safeParse(text);
    return result.success ? undefined : result.error.issues[0]?.message ?? "CRM records are invalid.";
  }
  const canonical = "canonicalInput" in input;
  const submissions = canonical ? [input.canonicalInput] : input.submissions;
  if (submissions.length === 0) return "Enter the requested people first.";
  for (const submission of submissions) {
    const requested = (canonical ? CrmDocDownloadCanonicalInput : CrmDocDownloadInput).safeParse(submission);
    if (!requested.success) return "Enter valid employee IDs or emails for the requested people first.";
    const result = crmManualDocumentRecordsSchema(requested.data.people).safeParse(text);
    if (!result.success) return result.error.issues[0]?.message ?? "CRM records are invalid.";
  }
  return undefined;
}
