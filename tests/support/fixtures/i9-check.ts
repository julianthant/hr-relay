import { I9CheckInput } from "../../../src/models/workflows/i9-check/input.js";
import { SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import type { z } from "zod";

export const i9CheckInput = I9CheckInput.parse({
  ocrRunId: "00000000-0000-4000-8000-000000000001", recordId: "record-1",
  person: { name: "Example, Person", firstName: "Person", lastName: "Example", hireDate: "2020-06-15", sourcePages: [1, 3] },
  roster: { rows: [{ eid: "10000001", ppsEid: "000012345", separationDate: "2021-11-01", action: "TER" }] },
  asOf: "2026-11-01", reviewerName: "Example Reviewer",
});
export const i9Candidate = UcpathCandidateSchema.parse({
  emplId: "10000001", name: "Example, Person", department: "Engineering", jobTitle: "Example analyst",
  employeeStatus: "terminated", hdh: false, hrStatus: "Inactive", startDate: "06/15/2020", effectiveDate: "06/15/2020",
  terminationDate: "11/01/2021", terminationReason: "Appointment ended",
});
export function i9Search(values: readonly z.input<typeof UcpathCandidateSchema>[] = [i9Candidate]) {
  const candidates = values.map(value => UcpathCandidateSchema.parse(value));
  const candidateEids = [...new Set(candidates.map(candidate => candidate.emplId))];
  return SearchPersonOrgOutputSchema.parse({ results: candidates, selection: candidates.length === 0
    ? { status: "not-found", selected: null, candidateEids: [], searchName: "Example, Person" }
    : candidateEids.length > 1
      ? { status: "ambiguous", selected: null, candidateEids, searchName: "Example, Person" }
      : { status: "resolved", selected: candidates[0], candidateEids },
  });
}
