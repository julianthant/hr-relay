
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
CANONICAL_FIELDS,
CANONICAL_FIELD_IDS,
normalizeHeader,
} from "../../../src/models/fields/registry.js";

describe("ref data-intake-and-edit-data §1 canonical field registry shape", () => {
  it("exposes one entry per declared id, keyed by that id", () => {
    for (const id of CANONICAL_FIELD_IDS) assert.equal(CANONICAL_FIELDS[id].id, id);
  });

  it("normalizes headers the same way the fingerprint does", () => {
    assert.equal(normalizeHeader("  Employee   ID#  "), "employee id#");
    assert.equal(normalizeHeader("EMPLOYEE ID#"), "employee id#");
  });

  it("freezes each field, so a caller cannot widen a declared alias set", () => {
    assert.equal(Object.isFrozen(CANONICAL_FIELDS.eid), true);
    assert.equal(Object.isFrozen(CANONICAL_FIELDS.eid.aliases), true);
    assert.throws(() => {
      (CANONICAL_FIELDS.eid.aliases as string[]).push("Anything");
    });
  });

  it("carries every recognized legacy roster header as a suggestion alias", () => {

    const owns = (id: (typeof CANONICAL_FIELD_IDS)[number], header: string): boolean =>
      CANONICAL_FIELDS[id].aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(header));
    assert.equal(owns("eid", "UCPath ID"), true);
    assert.equal(owns("eid", "Empl ID"), true);
    assert.equal(owns("eid", "Employee ID"), true);
    assert.equal(owns("fullName", "Legal Name"), true);
    assert.equal(owns("fullName", "Lived Name") || owns("livedName", "Lived Name"), true);
    assert.equal(owns("fullName", "Employee Name"), true);
    assert.equal(owns("firstName", "First Name"), true);
    assert.equal(owns("lastName", "Last Name"), true);
    assert.equal(owns("address1", "Street"), true);
    assert.equal(owns("address1", "Address"), true);
    assert.equal(owns("city", "City"), true);
    assert.equal(owns("state", "State"), true);
    assert.equal(owns("postalCode", "Zip"), true);
    assert.equal(owns("postalCode", "Postal"), true);
  });
});
