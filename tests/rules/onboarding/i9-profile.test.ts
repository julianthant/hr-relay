import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingReadI9Lookup, OnboardingI9OutcomeSchema, OnboardingI9LookupSchema } from "../../../src/models/workflows/onboarding/read-i9-lookup.js";
import { OnboardingReadI9ProfilePlan } from "../../../src/models/workflows/onboarding/read-i9-profile-plan.js";
import { readOnboardingI9Lookup, readI9ProfilePlan } from "../../../src/rules/onboarding/i9-profile.js";
import { i9LookupInput, i9LookupItemId } from "../../../src/workflows/onboarding/steps/i9-search/step.js";

const plan = OnboardingReadHirePlan.output.parse(OnboardingReadHirePlan.example);
const expectedItemId = i9LookupItemId(i9LookupInput(plan));
const done = OnboardingI9OutcomeSchema.parse({
  state: "done", itemId: expectedItemId, runId: "aaaaaaaa-0001-4000-8000-000100000001",
  output: { i9Status: "not-found", signerName: "" },
});
const request = { expectedItemId, subject: { state: "new-hire" as const, candidateEids: [] }, outcomes: [done] };

describe("onboarding I-9 delegation and profile plan", () => {
  it("retains an exact successful child no-match and declares creation inputs without a write", () => {
    const lookup = readOnboardingI9Lookup(request);
    assert.deepEqual(lookup, OnboardingReadI9Lookup.example);
    assert.deepEqual(readI9ProfilePlan({ plan, lookup }), OnboardingReadI9ProfilePlan.example);
    const legal = { ...plan, employee: { ...plan.employee, firstName: "Legal", preferredFirstName: "Lived", ssn: "123456789" } };
    const result = readI9ProfilePlan({ plan: legal, lookup });
    assert.equal(result.state, "creation-required");
    if (result.state !== "creation-required") throw new Error("creation plan required");
    assert.equal(result.request.firstName, "Legal");
    assert.equal(result.request.ssn, "123456789");
  });

  it("reuses observed profile IDs and preserves unsigned, signed and historical distinctions", () => {
    for (const i9Status of ["signed", "unsigned", "historical"] as const) {
      const lookup = OnboardingI9LookupSchema.parse({ state: "checked", childRunId: done.runId,
        result: { i9Status, signerName: i9Status === "signed" ? "Fixture Representative" : "", profileId: "900001", i9Id: "900002" } });
      assert.deepEqual(readI9ProfilePlan({ plan, lookup }), { state: "existing-profile", profileId: "900001", i9Status });
    }
  });

  it("requires review when access is restricted or unsigned lookup did not return a profile ID", () => {
    for (const [i9Status, reason] of [["unable-to-access", "lookup-restricted"], ["unsigned", "profile-id-unavailable"]] as const) {
      assert.deepEqual(readI9ProfilePlan({ plan, lookup: { state: "checked", childRunId: done.runId,
        result: { i9Status, signerName: "" } } }), { state: "review-required", reason });
    }
  });

  it("refuses missing, foreign, duplicated and unsuccessful child outcomes", () => {
    for (const outcomes of [[], [done, done], [{ ...done, itemId: "aaaaaaaa-0001-4000-8000-000100000009" }],
      [{ state: "failed", itemId: expectedItemId, runId: done.runId, failureId: "aaaaaaaa-0001-4000-8000-000100000002" }],
      [{ state: "cancelled", itemId: expectedItemId, runId: done.runId, reason: "cancelled", cancelledBy: "operator" }],
      [{ state: "blocked", itemId: expectedItemId, runId: done.runId, failureId: "aaaaaaaa-0001-4000-8000-000100000002", reason: "blocked" }],
    ]) assert.throws(() => readOnboardingI9Lookup({ ...request, outcomes: OnboardingI9OutcomeSchema.array().parse(outcomes) }));
  });

  it("skips I-9 for existing and unresolved UCPath identities and refuses a child for an existing person", () => {
    for (const subject of [
      { state: "existing-person" as const, person: { emplId: "10800000", name: "Hire, Fixture" } },
      { state: "review-required" as const, candidates: [{ emplId: "10800000", name: "Hire, Other" }] },
    ]) {
      const lookup = readOnboardingI9Lookup({ ...request, subject, outcomes: [] });
      assert.deepEqual(lookup, { state: "not-required", subjectState: subject.state });
      assert.deepEqual(readI9ProfilePlan({ plan, lookup }), lookup);
    }
    assert.throws(() => readOnboardingI9Lookup({ ...request, subject: { state: "existing-person", person: { emplId: "10800000", name: "Hire, Fixture" } } }));
  });

  it("checks one exact successful child for an unresolved identity the operator may still file as a new hire", () => {
    const subject = { state: "review-required" as const, candidates: [{ emplId: "10800000", name: "Hire, Other" }] };
    assert.equal(readOnboardingI9Lookup({ ...request, subject }).state, "checked");
    assert.throws(() => readOnboardingI9Lookup({ ...request, subject, outcomes: [done, done] }));
  });
});
