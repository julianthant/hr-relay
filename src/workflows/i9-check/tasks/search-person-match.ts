import type { z } from "zod";
import { defineStepEntries } from "../../../workflow-kit/workflow-definition.js";
import { requireFact } from "../../../workflow-kit/workflow.js";
import { SearchPersonMatch } from "../../../models/systems/ucpath/search-person-match.js";
import type { I9CheckInputValue } from "../../../models/workflows/i9-check/input.js";

export function searchPersonMatchTask(step: Readonly<{ key: string; label: string }>) {
  return defineStepEntries(step).task("identifier-match", SearchPersonMatch, { replay: "checkpoint",
    when: { kind: "is-true", of: { from: "input", path: "person.useMatch" } },
  });
}
export function personMatchInput(input: I9CheckInputValue): z.output<typeof SearchPersonMatch.input> {
  return {
    firstName: requireFact(input.person.firstName, "identifier-match", "firstName"),
    lastName: requireFact(input.person.lastName, "identifier-match", "lastName"),
    ...(input.person.dob === undefined ? {} : { dob: `${input.person.dob.slice(5, 7)}/${input.person.dob.slice(8, 10)}/${input.person.dob.slice(0, 4)}` }),
    ...(input.person.ssn === undefined ? {} : { ssn: input.person.ssn }),
  };
}
