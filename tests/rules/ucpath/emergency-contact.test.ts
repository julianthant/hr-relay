import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { UcpathEmergencyContactInputSchema, contactEffectIdentity, normalizedName } from "../../../src/models/systems/ucpath/emergency-contacts.js";
import { contactEffect, sameEffect } from "../../../src/rules/ucpath/emergency-contact.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import fixture from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

describe("UCPath name normalisation", () => {
  const effect = contactEffect(UcpathEmergencyContactInputSchema.parse(fixture.input));

  it("trims, single-spaces and lowercases a name", () => {
    assert.equal(normalizedName("  Jane \t  DOE "), "jane doe");
  });

  it("keeps the contact effect identity bytes", () => {
    assert.equal(
      contactEffectIdentity({ ...effect, name: "  Jane \t  DOE " }),
      canonicalJsonStringify({ ...effect, name: "jane doe" }),
    );
    assert.equal(sameEffect({ ...effect, name: "JANE DOE" }, { ...effect, name: "jane  doe" }), true);
  });
});
