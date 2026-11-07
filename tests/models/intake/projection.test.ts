
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { defineIntakeProjection,requiredTargetIds } from "../../../src/models/intake/projection.js";
import { IntakeTargetFieldIdSchema } from "../../../src/rules/identity/ids.js";

const WorkStudyInput = z.strictObject({
  emplId: CANONICAL_FIELDS.eid.schema,
  effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
  department: CANONICAL_FIELDS.department.schema.optional(),
});

const workStudyIntake = defineIntakeProjection(WorkStudyInput, {
  emplId: CANONICAL_FIELDS.eid,
  effectiveDate: CANONICAL_FIELDS.effectiveDate,
  department: CANONICAL_FIELDS.department,
});

describe("ref data-intake-and-edit-data §1 intake projection", () => {
  it("binds targets that reuse the canonical schema object, including optional ones", () => {
    assert.deepEqual(
      workStudyIntake.targets.map((target) => [target.targetFieldId, target.canonicalFieldId, target.required]),
      [["department", "department", false], ["effectiveDate", "effectiveDate", true], ["emplId", "eid", true]],
    );
    assert.deepEqual([...requiredTargetIds(workStudyIntake)], ["effectiveDate", "emplId"]);
  });

  it("refuses a structurally identical schema COPY", () => {

    const CopiedInput = z.strictObject({ emplId: z.string().regex(/^10\d{6}$/) });
    assert.throws(
      () => defineIntakeProjection(CopiedInput, { emplId: CANONICAL_FIELDS.eid }),
      /must reuse the canonical eid schema object/,
    );
  });

  it("refuses a target the input schema does not declare", () => {
    assert.throws(
      () => defineIntakeProjection(WorkStudyInput, { notAField: CANONICAL_FIELDS.eid }),
      /names no field in the input schema/,
    );
  });

  it("refuses a hand-built canonical field", () => {
    const impostor = { ...CANONICAL_FIELDS.eid };
    assert.throws(
      () => defineIntakeProjection(WorkStudyInput, { emplId: impostor }),
      /must use a registry canonical field/,
    );
  });

  it("keeps two targets sharing one canonical concept independent", () => {
    const ContactInput = z.strictObject({
      employeeName: CANONICAL_FIELDS.fullName.schema,
      contactName: CANONICAL_FIELDS.fullName.schema,
    });
    const projection = defineIntakeProjection(ContactInput, {
      employeeName: CANONICAL_FIELDS.fullName,
      contactName: CANONICAL_FIELDS.fullName,
    });
    assert.equal(projection.targets.length, 2);
    assert.equal(projection.targets.every((target) => target.canonicalFieldId === "fullName"), true);
  });

  it("changes its fingerprint when the target set or its required-ness changes", () => {
    const withoutOptional = defineIntakeProjection(WorkStudyInput, {
      emplId: CANONICAL_FIELDS.eid,
      effectiveDate: CANONICAL_FIELDS.effectiveDate,
    });
    assert.notEqual(withoutOptional.fingerprint, workStudyIntake.fingerprint);

    const RequiredDepartment = z.strictObject({
      emplId: CANONICAL_FIELDS.eid.schema,
      effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
      department: CANONICAL_FIELDS.department.schema,
    });
    const required = defineIntakeProjection(RequiredDepartment, {
      emplId: CANONICAL_FIELDS.eid,
      effectiveDate: CANONICAL_FIELDS.effectiveDate,
      department: CANONICAL_FIELDS.department,
    });
    assert.notEqual(required.fingerprint, workStudyIntake.fingerprint);
  });


  describe("a union input schema", () => {
    const Named = z.strictObject({
      name: CANONICAL_FIELDS.fullName.schema,
      department: CANONICAL_FIELDS.department.schema.optional(),
    });
    const Identified = z.strictObject({
      emplId: CANONICAL_FIELDS.eid.schema,
      name: CANONICAL_FIELDS.fullName.schema.optional(),
      department: CANONICAL_FIELDS.department.schema.optional(),
    });
    const UnionInput = z.union([Named, Identified]);

    it("resolves a target every arm declares, and one only some arms declare", () => {
      const projection = defineIntakeProjection(UnionInput, {
        emplId: CANONICAL_FIELDS.eid,
        name: CANONICAL_FIELDS.fullName,
      });
      assert.deepEqual(projection.targets.map((target) => target.targetFieldId), ["emplId", "name"]);

      assert.deepEqual(requiredTargetIds(projection), []);
    });

    it("refuses two arms that spell the same constraint with two schema objects", () => {
      const Divergent = z.union([
        z.strictObject({ name: CANONICAL_FIELDS.fullName.schema }),
        z.strictObject({ name: z.string().min(1) }),
      ]);
      assert.throws(
        () => defineIntakeProjection(Divergent, { name: CANONICAL_FIELDS.fullName }),
        /resolves to 2 DIFFERENT schema objects across the input union/,
      );
    });

    it("refuses a target no arm declares, naming a real arm's fields", () => {
      assert.throws(
        () => defineIntakeProjection(UnionInput, { ssn: CANONICAL_FIELDS.ssn }),
        /names no field in the input schema/,
      );
    });

    it("keeps a target required when every arm requires it", () => {
      const AlwaysNamed = z.union([
        z.strictObject({ name: CANONICAL_FIELDS.fullName.schema, kind: z.literal("a") }),
        z.strictObject({ name: CANONICAL_FIELDS.fullName.schema, kind: z.literal("b") }),
      ]);
      const projection = defineIntakeProjection(AlwaysNamed, { name: CANONICAL_FIELDS.fullName });
      assert.deepEqual(requiredTargetIds(projection), ["name"]);
    });

    it("resolves a nested path through a union of objects", () => {
      const NestedUnion = z.union([
        z.strictObject({ contact: z.strictObject({ city: CANONICAL_FIELDS.city.schema }) }),
        z.strictObject({ contact: z.strictObject({ city: CANONICAL_FIELDS.city.schema, state: CANONICAL_FIELDS.state.schema }) }),
      ]);
      const projection = defineIntakeProjection(NestedUnion, { "contact.city": CANONICAL_FIELDS.city });
      assert.equal(projection.target(IntakeTargetFieldIdSchema.parse("contact.city"))?.canonicalFieldId, "city");
    });
  });

  it("resolves a nested target path", () => {
    const NestedInput = z.strictObject({
      contact: z.strictObject({ city: CANONICAL_FIELDS.city.schema }),
    });
    const projection = defineIntakeProjection(NestedInput, { "contact.city": CANONICAL_FIELDS.city });
    assert.equal(projection.targets[0].targetFieldId, "contact.city");
  });
});
