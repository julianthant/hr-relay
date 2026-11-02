import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingMatchHireSubject } from "../../../models/workflows/onboarding/match-hire-subject.js";
import { matchHireSubject } from "../../../rules/onboarding/match-hire-subject.js";

export const matchHireSubjectTask = defineTask(OnboardingMatchHireSubject, {
  sessions: [],
  async run({ input, ctx }) {
    if (input.mode === "rehire" && input.match.hits.length === 0 && input.match.confirmed.length === 0 && input.match.dropped.length === 0) {
      return ctx.fail("ONBOARDING_EXISTING_PERSON_REQUIRED", "Concurrent hire requires an existing UCPath person. Review the hire mode and source identity.");
    }
    let output;
    try { output = matchHireSubject(input); } catch (cause) {
      return ctx.fail("ONBOARDING_MATCH_INVALID", "UCPath duplicate search returned inconsistent identity evidence.", { cause });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
