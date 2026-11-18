import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { withBrowserActionNotes, type BrowserAction } from "../../../../../src/backend/systems/browser-shared/action-notes.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { assertPersonMatchNoResultsDialog, parsePersonMatchRows, searchPersonMatchWithPort } from "../../../../../src/backend/systems/ucpath/driver/person-match-operation.js";
import { SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../../../../src/models/systems/ucpath/search-person-org.js";

import { EidSchema } from "../../../../../src/rules/identity/ids.js";
const hit = { emplId: EidSchema.parse("10000001"), name: "Example, Person" };
const input = { lastName: "Example", firstName: "Person", dob: "01/15/2000", ssn: "123456789" };
// Without SSN a single exact-name hit still goes through the Person Org checks.
const withoutSsn = { lastName: "Example", firstName: "Person", dob: "01/15/2000" };
const person = UcpathCandidateSchema.parse({ ...hit, department: "Housing", jobTitle: "Assistant", employeeStatus: "active", hdh: true,
  hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" });
function org(name: string | null) {
  const selected = name === null ? null : { ...person, name };
  return SearchPersonOrgOutputSchema.parse({ results: selected === null ? [] : [selected], selection: selected === null
    ? { status: "not-found", selected: null, candidateEids: [], searchName: hit.emplId }
    : { status: "resolved", selected, candidateEids: [hit.emplId] } });
}

describe("UCPath Match guarded decisions", () => {
  it("does not publish or confirm after the awaited search revokes the session", async () => {
    let current = true;
    let confirmations = 0;
    const published: BrowserAction[] = [];
    const captured: BrowserAction[] = [];
    await assert.rejects(withBrowserActionNotes(systemClock, () => searchPersonMatchWithPort(() => {
      if (!current) throw new Error("session revoked");
    }, {
      search: async () => { current = false; return [hit]; },
      confirm: async () => { confirmations++; return org(hit.name); },
    }, input), actions => { captured.push(...actions); }, action => { published.push(action); }), /session revoked/u);
    assert.equal(confirmations, 0);
    assert.deepEqual(published, []);
    assert.deepEqual(captured, []);
  });

  it("refuses missing identity controls, gaps and duplicate grid rows", () => {
    const row = { emplId: hit.emplId, firstName: "Person", lastName: "Example", rowIndex: "0" };
    assert.deepEqual(parsePersonMatchRows([row]), [hit]);
    for (const invalid of [{ ...row, emplId: "" }, { ...row, firstName: "" }, { ...row, lastName: "" }, { ...row, rowIndex: "1" }]) {
      assert.throws(() => parsePersonMatchRows([invalid]));
    }
    assert.throws(() => parsePersonMatchRows([row, row]), /incomplete or duplicated/);
    assert.throws(() => parsePersonMatchRows([]), /without a readable person/);
  });
  it("accepts only the definitive no-person message", () => {
    assert.doesNotThrow(() => assertPersonMatchNoResultsDialog("No matching person found. OK"));
    for (const message of ["OK", "No prompt values", "System error", ""]) assert.throws(() => assertPersonMatchNoResultsDialog(message), /unrecognized search dialog/);
  });
  it("checks surnames before every remaining Person Org identity, then restores the exact set", async () => {
    const calls: string[] = [];
    const unrelated = { emplId: EidSchema.parse("10000002"), name: "Elsewhere, Person" };
    const output = await searchPersonMatchWithPort(() => undefined, {
      async search(criteria) { assert.deepEqual(criteria, input); calls.push("search"); return [unrelated, hit]; },
      async confirm(eid) { calls.push(`confirm:${eid}`); return org(hit.name); },
    }, input);
    assert.deepEqual(calls, ["search", `confirm:${hit.emplId}`, "search"]);
    assert.deepEqual(output.confirmed, [hit]);
    assert.deepEqual(output.dropped, [{ ...unrelated, reason: "Last name does not match" }]);
    for (const name of [null, "Example, Another"]) {
      const absent = await searchPersonMatchWithPort(() => undefined, { search: async () => [hit], confirm: async () => org(name) }, withoutSsn);
      assert.deepEqual(absent.confirmed, []);
      assert.equal(absent.dropped.length, 1);
    }
  });
  it("confirms the one exact-name hit of a name, DOB and SSN search without the Person Org veto", async () => {
    const calls: string[] = [];
    const port = { search: async () => { calls.push("search"); return [hit]; }, confirm: async () => { calls.push("confirm"); return org("Example, Person Middle"); } };
    const output = await searchPersonMatchWithPort(() => undefined, port, input);
    assert.deepEqual(output, { hits: [hit], confirmed: [hit], dropped: [] });
    assert.deepEqual(calls, ["search"]);
  });
  it("keeps the Person Org veto without SSN, over several hits, and for a hit under another first name", async () => {
    const second = { emplId: EidSchema.parse("10000002"), name: "Example, Person" };
    for (const [criteria, hits] of [
      [withoutSsn, [hit]],
      [{ lastName: "Example", firstName: "Person", ssn: "123456789" }, [hit]],
      [input, [hit, second]],
      [input, [{ ...hit, name: "Example, Other" }]],
    ] as const) {
      let confirmations = 0;
      const output = await searchPersonMatchWithPort(() => undefined, {
        search: async () => hits, confirm: async () => { confirmations++; return org("Example, Person Middle"); },
      }, criteria);
      assert.deepEqual(output.confirmed, []);
      assert.equal(confirmations, hits.length);
    }
  });
  it("refuses complete-set drift, including a changed rejected surname", async () => {
    for (const restored of [[], [{ ...hit, name: "Example, Another" }], [hit, { ...hit, emplId: EidSchema.parse("10000002") }]]) {
      let searches = 0;
      await assert.rejects(searchPersonMatchWithPort(() => undefined, { search: async () => ++searches === 1 ? [hit] : restored, confirm: async () => org(hit.name) }, withoutSsn), /results changed/);
    }
  });
});
