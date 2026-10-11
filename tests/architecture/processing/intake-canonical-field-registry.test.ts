import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from "../../../src/models/fields/registry.js";
import type { CanonicalField } from "../../../src/models/fields/registry.js";
import { auditCanonicalFieldRegistry } from "../models/helpers/canonical-field-registry-audit.js";

const registry: ReadonlyMap<string, CanonicalField> = new Map(
  CANONICAL_FIELD_IDS.map((id) => [id, CANONICAL_FIELDS[id] as CanonicalField]),
);

describe("ref data-intake-and-edit-data §1 canonical field registry", () => {
  it("keeps every registry entry coherent", () => {
    assert.deepEqual(auditCanonicalFieldRegistry(registry), []);
  });

  describe("negative controls — the audit fails when it should", () => {

    it("catches a header alias claimed by two fields", () => {
      const collided = new Map(registry);
      const eid = registry.get("eid") as CanonicalField;
      collided.set("pid", { ...(registry.get("pid") as CanonicalField), aliases: [...eid.aliases] });
      const violations = auditCanonicalFieldRegistry(collided);
      assert.equal(violations.length > 0, true);
      assert.equal(violations.every((violation) => violation.startsWith("alias ")), true, violations.join("\n"));
    });

    it("catches a deferred shape with no audit note, and a resolved one carrying one", () => {
      const silent = new Map(registry);
      const deptId = registry.get("deptId") as CanonicalField;
      silent.set("deptId", { ...deptId, auditNote: undefined });
      assert.deepEqual(auditCanonicalFieldRegistry(silent), [
        "canonical field deptId: defers its shape without an auditNote",
      ]);

      const overclaimed = new Map(registry);
      const eid = registry.get("eid") as CanonicalField;
      overclaimed.set("eid", { ...eid, auditNote: "should not be here" });
      assert.deepEqual(auditCanonicalFieldRegistry(overclaimed), [
        "canonical field eid: is resolved yet carries an auditNote",
      ]);
    });

    it("catches an illegal classification/transform pair", () => {
      const leaky = new Map(registry);
      const ssn = registry.get("ssn") as CanonicalField;
      leaky.set("ssn", { ...ssn, redactTransform: "allow" });
      assert.deepEqual(auditCanonicalFieldRegistry(leaky), [
        "canonical field ssn: transform allow is forbidden for direct-identifier",
      ]);
    });
  });

  describe("the definition factory refuses a declaration that cannot hold", () => {
    it("refuses an example its own coerce+parse rejects", async () => {
      const { defineCanonicalField } = await import("../../../src/models/fields/registry.js");
      assert.throws(
        () => defineCanonicalField({
          id: "eid",
          label: "Employee ID (EID)",
          schema: CANONICAL_FIELDS.eid.schema,
          coerce: (raw) => raw,
          aliases: ["EID"],
          examples: ["not-an-eid"],
          classification: "direct-identifier",
          redactTransform: "last4",
          evidence: "resolved",
        }),
        /does not survive its own coerce\+parse/,
      );
    });

    it("refuses a forbidden redaction pair at definition time", async () => {
      const { defineCanonicalField } = await import("../../../src/models/fields/registry.js");
      assert.throws(
        () => defineCanonicalField({
          id: "ssn",
          label: "Social Security Number",
          schema: CANONICAL_FIELDS.ssn.schema,
          coerce: CANONICAL_FIELDS.ssn.coerce,
          aliases: ["SSN"],
          examples: ["123456789"],
          classification: "direct-identifier",
          redactTransform: "allow",
          evidence: "resolved",
        }),
        /forbidden for direct-identifier/,
      );
    });
  });
});
