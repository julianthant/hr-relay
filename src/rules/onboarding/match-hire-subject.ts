import type { z } from "zod";
import { HireSubjectSchema, OnboardingMatchHireSubject } from "../../models/workflows/onboarding/match-hire-subject.js";

const normalizedName = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function matchHireSubject(input: z.output<typeof OnboardingMatchHireSubject.input>): z.infer<typeof HireSubjectSchema> {
  const { mode, firstName, lastName, match } = OnboardingMatchHireSubject.input.parse(input);
  if (match.hits.length === 0) {
    if (match.confirmed.length !== 0 || match.dropped.length !== 0) throw new Error("UCPath match confirmation has no originating hit");
    if (mode === "rehire") throw new Error("Concurrent hire requires an existing UCPath person");
    return { state: "new-hire", candidateEids: [] };
  }
  if (new Set(match.hits.map(hit => hit.emplId)).size !== match.hits.length) throw new Error("UCPath Search/Match returned duplicate person IDs");
  for (const observation of [...match.confirmed, ...match.dropped]) {
    if (!match.hits.some(hit => hit.emplId === observation.emplId && normalizedName(hit.name) === normalizedName(observation.name))) {
      throw new Error("UCPath confirmation names a person outside its search hits");
    }
  }
  const decisions = [...match.confirmed, ...match.dropped].map(hit => hit.emplId);
  if (new Set(decisions).size !== decisions.length || decisions.length !== match.hits.length) {
    throw new Error("UCPath confirmation did not classify every person exactly once");
  }
  const person = match.confirmed[0];
  if (mode === "rehire" || match.hits.length !== 1 || match.confirmed.length !== 1 || person === undefined
    || normalizedName(person.name) !== normalizedName(`${lastName}, ${firstName}`)) {
    return { state: "review-required", candidates: match.hits };
  }
  return { state: "existing-person", person };
}
