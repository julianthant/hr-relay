import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import { separationsIdentityCheckDescriptor } from "../../src/workflows/separations/identity-check/descriptor.js";
import { separationsKronosTimecardDescriptor } from "../../src/workflows/separations/kronos-timecard/descriptor.js";
import { separationsUcpathTerminationDescriptor } from "../../src/workflows/separations/ucpath-transaction/descriptor.js";

const EID = "10833507";

describe("workflow durable match-key identity", () => {
  it("preserves the byte-exact natural keys that predate identifier redaction", () => {
    const personByEid = personLookupDescriptor.input.parse({ emplId: EID });
    const personByName = personLookupDescriptor.input.parse({ name: "Hernandez, Jose Santos" });
    const identityCheck = separationsIdentityCheckDescriptor.input.parse({
      documentNumber: "4510",
      employeeName: "Hernandez, Jose Santos",
      emplId: EID,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: EID },
    });
    const timecard = separationsKronosTimecardDescriptor.input.parse({
      emplId: EID,
      expectedName: "Hernandez, Jose Santos",
      rangeStart: "06/01/2026",
      rangeEnd: "08/12/2026",
    });
    const termination = separationsUcpathTerminationDescriptor.input.parse({
      documentNumber: "4510",
      employeeName: "Hernandez, Jose Santos",
      emplId: EID,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: EID },
      terminationType: { state: "present", value: "No Reason Given" },
      observedTerminationTypeOptions: ["- - -", "No Reason Given"],
      emplRecord: "0",
      effectiveDate: "06/11/2026",
      lastDateWorked: "06/10/2026",
      initiatorComments: "Separation filed from Kuali RRSS document 4510.",
    });

    assert.deepEqual([
      personLookupDescriptor.identity.matchKey(personByEid),
      personLookupDescriptor.identity.matchKey(personByName),
      separationsIdentityCheckDescriptor.identity.matchKey(identityCheck),
      separationsKronosTimecardDescriptor.identity.matchKey(timecard),
      separationsUcpathTerminationDescriptor.identity.matchKey(termination),
    ], [
      `eid:${EID}`,
      "name:Hernandez, Jose Santos",
      `separations-identity:4510:${EID}`,
      `kronos-timecard:${EID}:06/01/2026:08/12/2026`,
      `separations-ucpath-termination:${EID}:06/11/2026`,
    ]);
  });
});
