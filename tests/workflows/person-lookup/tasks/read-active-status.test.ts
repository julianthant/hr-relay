import { TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { resolvePersonLookupIdentity } from "../../../../src/rules/matching/person-lookup.js";
import { ResolvedIdentitySchema } from "../../../../src/models/workflows/person-lookup/read-resolved-identity.js";
import { ReadOnboardingRecordOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { DataPointSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { readActiveStatusTask } from "../../../../src/workflows/person-lookup/tasks/read-active-status.js";



it("names inconsistent UCPath and CRM identities without recording output facts", async () => {
  const expectedEid = EidSchema.parse("10873698");
  const otherEid = EidSchema.parse("10101010");
  const records: unknown[] = [];
  const refusals: TaskRefusal[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      const refusal = new TaskRefusal(code, message);
      refusals.push(refusal);
      throw refusal;
    },
    recordData: (input: unknown): void => { records.push(input); },
  };

  await assert.rejects(readActiveStatusTask.impl.run({
    input: {
      input: PersonLookupInput.parse({ emplId: expectedEid }),
      identity: ResolvedIdentitySchema.parse({ unselectedCrmRecords: null, state: "resolved", crmIdentity: null, selected: { ...candidate, emplId: expectedEid }, crmRecord: { recordId: "ONB-2", recordUrl: "https://example.invalid/record", emplId: otherEid, name: "Other, Person", department: "Housing", firstDayOfService: "", dateSigned: "" },
        shouldCheckCrm: true, ucpathFound: true, crmErrorCode: null, candidateEids: [expectedEid], recoveryEid: null, crmState: "Found", method: "eid-match" }),
    },
    ctx,
  }), (error: unknown) => error instanceof TaskRefusal && error.code === "INCONSISTENT_INPUTS");

  assert.deepEqual(refusals, [new TaskRefusal(
    "INCONSISTENT_INPUTS",
    "Person Lookup received inconsistent UCPath and CRM identities.",
  )]);
  assert.deepEqual(records, []);
});

const signal = new AbortController().signal;

const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const fail = (_code: string, message: string): never => {
  throw new Error(message);
};

const recordData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    DataPointSchema.parse(point);
  }
};

const commonCtx = { signal, log, fail, recordData };

const candidate = UcpathCandidateSchema.parse({
  emplId: "10873698",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active" as const,
  hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true,
});

const crmRecord = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: candidate.emplId,
    fullName: candidate.name,
    rawStage: "Completed",
  },
});

if (crmRecord.state !== "found") throw new Error("CRM found-record fixture did not parse as found");

describe("Person Lookup task implementations", () => {
  it("keeps genuine unresolved and inactive outcomes distinct", async () => {
    const unresolved = await readActiveStatusTask.impl.run({
      input: { input: PersonLookupInput.parse({ name: "Nobody, Missing" }), identity: resolvePersonLookupIdentity({ input: PersonLookupInput.parse({ name: "Nobody, Missing" }), person: { results: [], selection: { status: "not-found", selected: null, candidateEids: [], searchName: "Nobody, Missing" } }, crm: { state: "checked", records: [] } }) },
      ctx: commonCtx,
    });
    assert.equal(unresolved.state, "not-found");

    const terminated = UcpathCandidateSchema.parse({ ...candidate, employeeStatus: "terminated" });
    const inactive = await readActiveStatusTask.impl.run({
      input: { input: PersonLookupInput.parse({ emplId: candidate.emplId }), identity: resolvePersonLookupIdentity({ input: PersonLookupInput.parse({ emplId: candidate.emplId }), person: { results: [terminated], selection: { status: "resolved", selected: terminated, candidateEids: [candidate.emplId] } } }) },
      ctx: commonCtx,
    });
    assert.equal(inactive.state, "inactive");
  })

  it("checks an absent CRM EID before returning the non-HDH outcome", async () => {
    const nonHdh = UcpathCandidateSchema.parse({ ...candidate, hdh: false });
    await assert.rejects(
      readActiveStatusTask.impl.run({
        input: { input: PersonLookupInput.parse({ emplId: nonHdh.emplId }), identity: ResolvedIdentitySchema.parse({ unselectedCrmRecords: null, state: "resolved", crmIdentity: null, selected: nonHdh, crmRecord: { recordId: "ONB-2", recordUrl: "https://example.invalid/record", emplId: "10101010", name: "Other, Person", department: "Housing", firstDayOfService: "", dateSigned: "" },
          shouldCheckCrm: true, ucpathFound: true, crmErrorCode: null, candidateEids: [nonHdh.emplId], recoveryEid: null, crmState: "Found", method: "eid-match" }) },
        ctx: commonCtx,
      }),
      /inconsistent UCPath and CRM identities/,
    );
  })
});
