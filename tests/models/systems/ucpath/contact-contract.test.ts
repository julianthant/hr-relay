import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ERROR_CATALOG,failureCodeFromTaskCode } from "../../../../src/models/failures/error-catalog.js";
import { UcpathContactRefusalCodeSchema } from "../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UcpathMatchEmergencyContact } from "../../../../src/models/systems/ucpath/match-emergency-contact.js";
import { UcpathReadEmergencyContacts } from "../../../../src/models/systems/ucpath/read-emergency-contacts.js";
import { UcpathStageEmergencyContact } from "../../../../src/models/systems/ucpath/stage-emergency-contact.js";

describe("UCPath contact contracts awaiting workflow integration", () => {
  it("declares every named driver refusal with dashboard text for all three contracts", () => {
    for (const contract of [UcpathReadEmergencyContacts, UcpathStageEmergencyContact, UcpathMatchEmergencyContact]) {
      assert.deepEqual([...contract.errorCodes].sort(), [...UcpathContactRefusalCodeSchema.options].sort());
      for (const code of contract.errorCodes) {
        assert.equal(Object.hasOwn(ERROR_CATALOG, failureCodeFromTaskCode(code)), true);
      }
    }
  });

  it("keeps saved-effect comparison observational without protected-write authority", () => {
    assert.equal(UcpathMatchEmergencyContact.effect, "read");
    assert.equal("writeSafety" in UcpathMatchEmergencyContact, false);
  });
});
