import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolvePersonLookupIdentity, derivePersonLookupOutcome } from "../../../src/rules/matching/person-lookup.js";
import { UcpathCandidateSchema, SearchPersonOrgOutputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { CrmDiscoveredRecordSchema } from "../../../src/models/systems/crm/search-onboarding-records.js";
import { PersonLookupInput } from "../../../src/models/workflows/person-lookup/input.js";
const person = UcpathCandidateSchema.parse({ emplId: "10000001", name: "Example, Person", department: "Housing", jobTitle: "Assistant", employeeStatus: "active", hdh: true, hrStatus: "Active", startDate: "07/01/2026", effectiveDate: "07/01/2026", terminationDate: "", terminationReason: "" });
const other = UcpathCandidateSchema.parse({ ...person, emplId: "10000002", startDate: "08/01/2026" });
const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://example.invalid/record", emplId: "10000003", name: person.name, department: person.department, firstDayOfService: "07/08/2026", dateSigned: "" });
const input = PersonLookupInput.parse({ name: person.name, includeCrmDates: true });
function resolve(candidates = [person, other], records = [record]) {
 return resolvePersonLookupIdentity({ input, person: SearchPersonOrgOutputSchema.parse({ results: candidates, selection: candidates.length === 0 ? { status: "not-found", selected: null, candidateEids: [], searchName: person.name } : { status: "ambiguous", selected: null, candidateEids: [...new Set(candidates.map(p => p.emplId))], searchName: person.name } }), crm: { state: "checked", records } });
}
describe("Person Lookup identity evidence", () => {
 it("resolves inclusive date boundaries without claiming a different CRM EID", () => {
  for (const date of ["06/24/2026", "07/08/2026"]) {
   const identity = resolve([person, other], [{ ...record, firstDayOfService: date }]);
   assert.equal(identity.selected?.emplId, person.emplId);
   assert.equal(identity.method, "date-match");
   assert.equal(identity.crmRecord, null);
   assert.equal(identity.crmState, "Not found");
   assert.equal(derivePersonLookupOutcome({ input, identity }).details.startDate, null);
  }
  for (const date of ["06/23/2026", "07/09/2026", "invalid", ""]) assert.equal(resolve([person, other], [{ ...record, firstDayOfService: date }]).state, "multiple-matches");
  assert.equal(resolve([{ ...person, startDate: "" }, other]).state, "multiple-matches");
 });
 it("collects every date person and prefers the active appointment for the resolved EID", () => {
  const inactive = { ...person, employeeStatus: "inactive" as const, hrStatus: "Inactive" };
  const identity = resolve([inactive, person, other]);
  assert.equal(identity.selected?.employeeStatus, "active");
  const ambiguous = resolve([person, { ...other, startDate: "07/02/2026" }]);
  assert.equal(ambiguous.state, "multiple-matches");
  assert.deepEqual(ambiguous.candidateEids, [person.emplId, other.emplId]);
  assert.equal(ambiguous.selected, null);
 });
 it("lets a unique exact EID outrank dates and refuses conflicting direct people", () => {
  assert.equal(resolve([person, other], [{ ...record, emplId: other.emplId }]).selected?.emplId, other.emplId);
  const identity = resolve([person, other], [{ ...record, emplId: person.emplId }, { ...record, recordId: "ONB-2", emplId: other.emplId }]);
  assert.equal(identity.state, "multiple-matches");
  assert.equal(identity.selected, null);
 });
 it("separates unique CRM person identity from conflicting form facts", () => {
  const identity = resolve([], [record, { ...record, recordId: "ONB-2", name: "Different, Person", department: "Different", firstDayOfService: "07/09/2026" }]);
  assert.equal(identity.state, "crm-only"); assert.equal(identity.crmState, "Found"); assert.equal(identity.recoveryEid, record.emplId);
  assert.equal(identity.crmRecord, null);
  assert.deepEqual(identity.crmIdentity, { emplId: record.emplId, name: null, department: null, firstDayOfService: null });
  const result = derivePersonLookupOutcome({ input, identity });
  assert.equal(result.details.eid, record.emplId); assert.equal(result.details.name, null); assert.equal(result.details.startDate, null);
  assert.equal(result.datesEid, record.emplId); assert.equal(result.ucpathSelection, "not-found");
  const agreed = resolve([], [record, { ...record, recordId: "ONB-2" }]);
  assert.equal(agreed.crmIdentity?.name, record.name); assert.equal(agreed.crmRecord, null);
 });
});

it("declares empty and ambiguous CRM results explicitly while selected or unchecked results stay absent", () => {
  assert.deepEqual(resolve([person, other], []).unselectedCrmRecords, []);
  const ambiguous = [{ ...record, emplId: person.emplId }, { ...record, recordId: "ONB-2", emplId: other.emplId }];
  assert.deepEqual(resolve([person, other], ambiguous).unselectedCrmRecords, ambiguous);
  assert.equal(resolve([person, other], [{ ...record, emplId: person.emplId }]).unselectedCrmRecords, null);
  assert.equal(resolvePersonLookupIdentity({ input }).unselectedCrmRecords, null);
});
