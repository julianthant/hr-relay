import type { z } from "zod";
import { HireSubjectSchema, OnboardingMatchHireSubject } from "../../models/workflows/onboarding/match-hire-subject.js";
import type { SearchPersonMatchOutputSchema } from "../../models/systems/ucpath/search-person-match.js";
import { isHireNameForm } from "../ucpath/hire-name.js";

const normalizedName = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

type Match = z.output<typeof SearchPersonMatchOutputSchema>;

/** Throws unless every UCPath hit is unique and classified exactly once as confirmed or dropped. */
function assertClassifiedMatch(match: Match): void {
  if (match.hits.length === 0) {
    if (match.confirmed.length !== 0 || match.dropped.length !== 0) throw new Error("UCPath match confirmation has no originating hit");
    return;
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
}

export type HireReviewChoices = Readonly<{
  newHire: boolean;
  existing: readonly Readonly<{ emplId: Match["hits"][number]["emplId"]; name: string; confirmedBy: "person-org" | "operator"; reason?: string }>[];
}>;

/**
 * The hire-review arms an operator may answer: a new hire only when Person Org confirmed nobody (over hits, the operator rules every one out),
 * an existing person among the confirmed hits or, when none is confirmed, among the dropped hits that carry the hire's own name.
 * A hit under another name stays unpickable: the UCPath hire scans and checks identity by the hire's name, in exactly the forms `isHireNameForm` accepts.
 */
export function hireReviewChoices(mode: "new-hire" | "rehire", match: Match, hire: Readonly<{ firstName: string; middleName: string; lastName: string }>): HireReviewChoices {
  assertClassifiedMatch(match);
  return {
    newHire: mode === "new-hire" && match.confirmed.length === 0,
    existing: match.confirmed.length > 0
      ? match.confirmed.map(({ emplId, name }) => ({ emplId, name, confirmedBy: "person-org" as const }))
      : match.dropped.filter(({ name }) => isHireNameForm(hire, name)).map(({ emplId, name, reason }) => ({ emplId, name, confirmedBy: "operator" as const, reason })),
  };
}

export function matchHireSubject(input: z.output<typeof OnboardingMatchHireSubject.input>): z.infer<typeof HireSubjectSchema> {
  const { mode, firstName, lastName, match } = OnboardingMatchHireSubject.input.parse(input);
  assertClassifiedMatch(match);
  if (match.hits.length === 0) {
    if (mode === "rehire") throw new Error("Concurrent hire requires an existing UCPath person");
    return { state: "new-hire", candidateEids: [] };
  }
  const person = match.confirmed[0];
  if (mode === "rehire" || match.hits.length !== 1 || match.confirmed.length !== 1 || person === undefined
    || normalizedName(person.name) !== normalizedName(`${lastName}, ${firstName}`)) {
    return { state: "review-required", candidates: match.hits };
  }
  return { state: "existing-person", person };
}
