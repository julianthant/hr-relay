import type { z } from "zod";
import { OnboardingReadI9Lookup, OnboardingI9LookupSchema } from "../../models/workflows/onboarding/read-i9-lookup.js";
import { OnboardingReadI9ProfilePlan, OnboardingI9ProfileSchema } from "../../models/workflows/onboarding/read-i9-profile-plan.js";

export function readOnboardingI9Lookup(raw: z.input<typeof OnboardingReadI9Lookup.input>): z.output<typeof OnboardingI9LookupSchema> {
  const input = OnboardingReadI9Lookup.input.parse(raw);
  if (input.subject.state === "existing-person" || input.subject.state === "review-required" && input.outcomes.length === 0) {
    if (input.outcomes.length !== 0) throw new Error("Onboarding I-9 lookup must not run for an existing UCPath subject");
    return { state: "not-required", subjectState: input.subject.state };
  }
  const outcome = input.outcomes[0];
  if (input.outcomes.length !== 1 || outcome === undefined || outcome.itemId !== input.expectedItemId || outcome.state !== "done") {
    throw new Error("Onboarding requires exactly one successful I-9 child outcome for its requested identity");
  }
  return { state: "checked", childRunId: outcome.runId, result: outcome.output };
}

export function readI9ProfilePlan(raw: z.input<typeof OnboardingReadI9ProfilePlan.input>): z.output<typeof OnboardingI9ProfileSchema> {
  const { plan, lookup } = OnboardingReadI9ProfilePlan.input.parse(raw);
  if (lookup.state === "not-required") return lookup;
  const found = lookup.result;
  if (found.i9Status === "unable-to-access") return { state: "review-required", reason: "lookup-restricted" };
  if (found.i9Status !== "not-found") {
    if (found.profileId === undefined) return { state: "review-required", reason: "profile-id-unavailable" };
    return { state: "existing-profile", profileId: found.profileId, i9Status: found.i9Status };
  }
  const employee = plan.employee;
  return {
    state: "creation-required",
    request: { firstName: employee.firstName, lastName: employee.lastName, middleName: employee.middleName,
      ssn: employee.ssn, dob: employee.dob, email: employee.email, departmentNumber: employee.departmentNumber, startDate: employee.effectiveDate },
  };
}
