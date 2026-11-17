import { describe, expect, it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/models/config/authority-schema-versions.js";
import { restoreEligibilityOf } from "../../../src/rules/storage/restore-eligibility.js";

const UNSUPPORTED = { state: "unsupported", reason: "The backup uses an unsupported authority schema. Preserve it and use its compatible release." };
const AUTHORITY_UNAVAILABLE = { state: "unavailable", reason: "Current authority could not be inspected safely. Preserve it before recovery." };
const PERSON_UNPROVED = { state: "unavailable", reason: "Backup does not prove the current person and installation." };
const neverAsked = () => { throw new Error("same-person validation must not run"); };

describe("restore eligibility derivation (design machine 4)", () => {
  // D7: the restorable list is the openable list, so the doctor agrees with automatic restore on 20 through 30.
  it.each([8, 15, 19, 20, 24, 28, 30, CURRENT_AUTHORITY_SCHEMA_VERSION])("keeps person backup schema %s eligible behind current authority", schemaVersion => {
    expect(restoreEligibilityOf({ schemaVersion, authorityAvailable: true, samePersonValid: () => true })).toEqual({ state: "eligible" });
  });

  it.each([1, 6, 7, CURRENT_AUTHORITY_SCHEMA_VERSION + 1])("reports schema %s unsupported before any other fact", schemaVersion => {
    expect(restoreEligibilityOf({ schemaVersion, authorityAvailable: false, samePersonValid: neverAsked })).toEqual(UNSUPPORTED);
  });

  it("reports an uninspectable current authority unavailable without validating the person", () => {
    expect(restoreEligibilityOf({ schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, authorityAvailable: false, samePersonValid: neverAsked }))
      .toEqual(AUTHORITY_UNAVAILABLE);
  });

  it("reports a backup that does not prove the current person unavailable", () => {
    expect(restoreEligibilityOf({ schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, authorityAvailable: true, samePersonValid: () => false }))
      .toEqual(PERSON_UNPROVED);
  });
});
