import { matchHireSubject } from "./match-hire-subject.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import type { z } from "zod";
import { OnboardingReadWritePlan, OnboardingWritePlanSchema } from "../../models/workflows/onboarding/read-write-plan.js";
import { UcpathHireQuerySchema } from "../../models/ui/ucpath-hire.js";
import { I9ProfileTargetSchema } from "../../models/ui/i9-creation.js";
import { ucpathHireVerdict } from "../ucpath/hire-verdict.js";

export function readOnboardingWritePlan(raw: z.input<typeof OnboardingReadWritePlan.input>) {
  const { mode, plan, subject, match, lookup, findings, approval } = OnboardingReadWritePlan.input.parse(raw);
  const employee = plan.employee;
  const classified = matchHireSubject({ mode, firstName: employee.firstName, lastName: employee.lastName, match });
  if (canonicalJsonStringify(classified) !== canonicalJsonStringify(subject)) throw new Error("hire-subject-source-disagrees");
  if (subject.state !== "new-hire" && (lookup.state !== "not-required" || lookup.subjectState !== subject.state)) throw new Error("i9-skip-source-disagrees");
  const selected = approval.decision === "existing-person" ? match.confirmed.filter(person => person.emplId === approval.emplId) : [];
  if (approval.decision === "new-hire" && (subject.state !== "new-hire" || match.hits.length !== 0 || match.confirmed.length !== 0 || match.dropped.length !== 0)) {
    throw new Error("new-hire-choice-has-existing-or-unresolved-identity");
  }
  const person = selected[0];
  if (approval.decision === "existing-person" && (selected.length !== 1 || person === undefined
    || !match.hits.some(hit => hit.emplId === person.emplId && hit.name === person.name)
    || match.dropped.some(hit => hit.emplId === person.emplId))) throw new Error("existing-hire-choice-not-independently-confirmed");
  const hire = UcpathHireQuerySchema.parse({ mode: approval.decision === "new-hire" ? "new-hire" : "rehire", employee,
    expectedName: person?.name ?? `${employee.firstName} ${employee.lastName}`, emplId: person?.emplId ?? null });
  if (hire.mode === "new-hire" && (lookup.state !== "checked" || lookup.result.i9Status === "unable-to-access")) throw new Error("i9-lookup-unverified");
  const existing = ucpathHireVerdict(hire, findings);
  if (existing.state === "unknown" || existing.state === "ambiguous") throw new Error("hire-findings-unresolved");
  if (existing.state === "present" && hire.mode === "new-hire" && (lookup.state !== "checked" || !("profileId" in lookup.result)
    || lookup.result.profileId === undefined || existing.proof.profileId !== lookup.result.profileId)) throw new Error("filed-hire-profile-link-unverified");
  if (existing.state === "present" && hire.mode === "rehire" && existing.proof.profileId !== null) throw new Error("concurrent-hire-profile-link-unexpected");
  const recruitment = employee.recruitmentNumber || "N/A";
  const comments = hire.mode === "rehire"
    ? `Concurrent Hire as Dining Student Effective ${employee.effectiveDate}. PCN ${employee.positionNumber}. Job number #${recruitment}.`
    : `New Dining Student Hire Effective ${employee.effectiveDate}. Job number #${recruitment}.`
      + (employee.ssn === null ? " EE does not have an SSN yet, we will add it as soon as it is provided." : "");
  const i9 = hire.mode === "rehire" ? null : I9ProfileTargetSchema.parse({ firstName: employee.firstName, lastName: employee.lastName,
    middleName: employee.middleName, ssn: employee.ssn, dob: employee.dob, email: employee.email, departmentNumber: employee.departmentNumber,
    expectedName: `${employee.firstName} ${employee.lastName}` });
  return OnboardingWritePlanSchema.parse({ roster: plan.roster, hire, i9, comments,
    subject: person === undefined ? { state: "new-hire", candidateEids: [] } : { state: "existing-person", person } });
}
