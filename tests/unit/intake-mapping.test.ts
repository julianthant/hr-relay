/**
 * Doc 06 §2 — the intake projection, the column-mapping identity scheme, the
 * fail-closed reuse resolver, and the suggestion scorer.
 *
 * The cases that matter are the ones where a permissive implementation would
 * still have produced a mapping: a structurally identical schema copy, a
 * reordered export, two columns both called `Name`, and a header that matches
 * a field whose data it cannot possibly hold.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { CANONICAL_FIELDS } from "../../src/domain/fields/registry.js";
import {
  ColumnMappingSchema,
  confirmBinding,
  detectColumns,
  headerFingerprint,
  heldBindings,
  resolveSavedMapping,
  sourceColumnId,
  type ColumnMapping,
  type DetectedColumn,
} from "../../src/domain/intake/mapping.js";
import { defineIntakeProjection, requiredTargetIds } from "../../src/domain/intake/projection.js";
import { suggestBindings, unambiguousTopSuggestions } from "../../src/domain/intake/suggestions.js";
import { IntakeTargetFieldIdSchema, SourceColumnIdSchema } from "../../src/domain/ids.js";

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

const CONFIRMED_AT = "2026-08-05T18:00:00.000Z";

function mappingFor(detected: readonly DetectedColumn[], bindings: readonly [string, DetectedColumn][]): ColumnMapping {
  return ColumnMappingSchema.parse({
    workflow: "work-study",
    intakeProjectionFingerprint: workStudyIntake.fingerprint,
    fingerprint: headerFingerprint(detected),
    savedAt: CONFIRMED_AT,
    headerRowIndex: 0,
    columns: detected.map(({ samples: _samples, ...rest }) => rest),
    bindings: bindings.map(([targetFieldId, column]) => ({
      targetFieldId,
      canonicalFieldId: workStudyIntake.target(IntakeTargetFieldIdSchema.parse(targetFieldId))?.canonicalFieldId,
      sourceColumnId: column.sourceColumnId,
      confirmedAt: CONFIRMED_AT,
    })),
  });
}

describe("doc 06 §1 intake projection", () => {
  it("binds targets that reuse the canonical schema object, including optional ones", () => {
    assert.deepEqual(
      workStudyIntake.targets.map((target) => [target.targetFieldId, target.canonicalFieldId, target.required]),
      [["department", "department", false], ["effectiveDate", "effectiveDate", true], ["emplId", "eid", true]],
    );
    assert.deepEqual([...requiredTargetIds(workStudyIntake)], ["effectiveDate", "emplId"]);
  });

  it("refuses a structurally identical schema COPY", () => {
    // The dangerous case: this regex is byte-identical to the canonical one
    // today. Accepting it means the two can drift apart in one commit with
    // nothing to notice — doc 06 §7 vector #6.
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

  it("keeps two targets sharing one canonical concept independent (D66)", () => {
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

  it("resolves a nested target path", () => {
    const NestedInput = z.strictObject({
      contact: z.strictObject({ city: CANONICAL_FIELDS.city.schema }),
    });
    const projection = defineIntakeProjection(NestedInput, { "contact.city": CANONICAL_FIELDS.city });
    assert.equal(projection.targets[0].targetFieldId, "contact.city");
  });
});

describe("doc 06 §2.1/§2.3 column identity and layout fingerprint", () => {
  it("gives two identically-spelled columns distinct ids", () => {
    const detected = detectColumns(["Name", "Name", "EID"]);
    assert.notEqual(detected[0].sourceColumnId, detected[1].sourceColumnId);
    assert.deepEqual(detected.map((column) => column.occurrence), [1, 2, 1]);
  });

  it("normalizes case and whitespace into one id", () => {
    assert.equal(sourceColumnId("  Employee   ID#  ", 1), sourceColumnId("EMPLOYEE ID#", 1));
  });

  it("is order-insensitive but never collides across element boundaries", () => {
    assert.equal(
      headerFingerprint(detectColumns(["EID", "Name"])),
      headerFingerprint(detectColumns(["Name", "EID"])),
    );
    // Canonical JSON preserves element boundaries, so these two layouts cannot
    // hash alike however they are concatenated.
    assert.notEqual(
      headerFingerprint(detectColumns(["a b", "c"])),
      headerFingerprint(detectColumns(["a", "b c"])),
    );
  });

  it("changes when a duplicate count changes", () => {
    assert.notEqual(
      headerFingerprint(detectColumns(["Name", "EID"])),
      headerFingerprint(detectColumns(["Name", "Name", "EID"])),
    );
  });
});

describe("doc 06 §2.3 saved-mapping reuse is fail-closed", () => {
  const detected = detectColumns(
    ["Employee ID#", "Effective Date", "Dept"],
    [["10456712"], ["07/01/2026"], ["Housing Dining Hospitality"]],
  );
  const saved = mappingFor(detected, [
    ["emplId", detected[0]],
    ["effectiveDate", detected[1]],
    ["department", detected[2]],
  ]);

  it("offers an unchanged layout with every binding held", () => {
    const reuse = resolveSavedMapping({ mapping: saved, detected, projection: workStudyIntake, workflow: "work-study" });
    assert.equal(reuse.outcome, "offered");
    if (reuse.outcome !== "offered") return;
    assert.equal(reuse.resolutions.every((entry) => entry.state === "held"), true);
    assert.deepEqual(reuse.unboundRequired, []);
    assert.equal(reuse.readyToRun, true);
    assert.deepEqual([...heldBindings(reuse)], ["department", "effectiveDate", "emplId"]);
  });

  it("refuses a near-miss layout outright rather than partially reusing it", () => {
    const changed = detectColumns(["Employee ID#", "Effective Date", "Dept", "Notes"]);
    const reuse = resolveSavedMapping({ mapping: saved, detected: changed, projection: workStudyIntake, workflow: "work-study" });
    assert.equal(reuse.outcome, "refused");
    if (reuse.outcome !== "refused") return;
    assert.equal(reuse.reason, "layout-mismatch");
  });

  it("refuses when the intake projection has changed since the mapping was saved", () => {
    const narrowed = defineIntakeProjection(WorkStudyInput, {
      emplId: CANONICAL_FIELDS.eid,
      effectiveDate: CANONICAL_FIELDS.effectiveDate,
    });
    const reuse = resolveSavedMapping({ mapping: saved, detected, projection: narrowed, workflow: "work-study" });
    assert.equal(reuse.outcome, "refused");
    if (reuse.outcome !== "refused") return;
    assert.equal(reuse.reason, "projection-changed");
  });

  it("refuses a mapping saved for a different workflow", () => {
    const reuse = resolveSavedMapping({ mapping: saved, detected, projection: workStudyIntake, workflow: "separations" });
    assert.equal(reuse.outcome, "refused");
    if (reuse.outcome !== "refused") return;
    assert.equal(reuse.reason, "workflow-mismatch");
  });

  it("marks a moved column for confirmation instead of silently rebinding", () => {
    const reordered = detectColumns(
      ["Effective Date", "Employee ID#", "Dept"],
      [["07/01/2026"], ["10456712"], ["Housing Dining Hospitality"]],
    );
    // Order-insensitive by design, so the layout still matches.
    assert.equal(headerFingerprint(reordered), saved.fingerprint);
    const reuse = resolveSavedMapping({ mapping: saved, detected: reordered, projection: workStudyIntake, workflow: "work-study" });
    assert.equal(reuse.outcome, "offered");
    if (reuse.outcome !== "offered") return;
    const moved = reuse.resolutions.filter((entry) => entry.state === "confirmation-required");
    assert.equal(moved.length, 2);
    assert.equal(moved.every((entry) => entry.state === "confirmation-required" && entry.reason === "column-moved"), true);
    assert.equal(reuse.readyToRun, false);
  });

  it("marks any binding involving a duplicated header for confirmation", () => {
    const NameInput = z.strictObject({
      employeeName: CANONICAL_FIELDS.fullName.schema,
      contactName: CANONICAL_FIELDS.fullName.schema,
    });
    const projection = defineIntakeProjection(NameInput, {
      employeeName: CANONICAL_FIELDS.fullName,
      contactName: CANONICAL_FIELDS.fullName,
    });
    const twins = detectColumns(["Name", "Name"], [["Cleckoa, Crithe"], ["Doe, John"]]);
    const mapping = ColumnMappingSchema.parse({
      workflow: "emergency-contact",
      intakeProjectionFingerprint: projection.fingerprint,
      fingerprint: headerFingerprint(twins),
      savedAt: CONFIRMED_AT,
      headerRowIndex: 0,
      columns: twins.map(({ samples: _samples, ...rest }) => rest),
      bindings: [
        { targetFieldId: "employeeName", canonicalFieldId: "fullName", sourceColumnId: twins[0].sourceColumnId, confirmedAt: CONFIRMED_AT },
        { targetFieldId: "contactName", canonicalFieldId: "fullName", sourceColumnId: twins[1].sourceColumnId, confirmedAt: CONFIRMED_AT },
      ],
    });
    const reuse = resolveSavedMapping({ mapping, detected: twins, projection, workflow: "emergency-contact" });
    assert.equal(reuse.outcome, "offered");
    if (reuse.outcome !== "offered") return;
    assert.equal(
      reuse.resolutions.every((entry) => entry.state === "confirmation-required" && entry.reason === "duplicate-header"),
      true,
    );
    assert.equal(reuse.readyToRun, false);
  });

  it("unbinds a binding whose column is gone, and never falls back to its stored index", () => {
    // The layout gate normally catches this; the second gate exists because a
    // mapping file is operator-greppable configuration and can disagree with
    // itself. Here the fingerprint matches the CURRENT columns while a binding
    // still points at a column that is not among them.
    const corrupt = ColumnMappingSchema.parse({
      ...saved,
      bindings: [
        { ...saved.bindings[0], sourceColumnId: SourceColumnIdSchema.parse(sourceColumnId("Employee Number", 1)) },
        saved.bindings[1],
        saved.bindings[2],
      ],
    });
    const reuse = resolveSavedMapping({ mapping: corrupt, detected, projection: workStudyIntake, workflow: "work-study" });
    assert.equal(reuse.outcome, "offered");
    if (reuse.outcome !== "offered") return;
    const unbound = reuse.resolutions.filter((entry) => entry.state === "unbound");
    assert.equal(unbound.length, 1);
    assert.equal(unbound[0].state === "unbound" && unbound[0].reason, "column-absent");
    // `emplId` is required, so Run stays blocked rather than launching against
    // whatever column sits at the old index.
    assert.deepEqual(reuse.unboundRequired, ["emplId"]);
    assert.equal(reuse.readyToRun, false);
  });
});

describe("doc 06 §2.5 confirmBinding is the only mint", () => {
  const detected = detectColumns(["Employee ID#"], [["10456712"]]);

  it("stamps the operator's confirmation instant", () => {
    const binding = confirmBinding({
      projection: workStudyIntake,
      detected,
      targetFieldId: IntakeTargetFieldIdSchema.parse("emplId"),
      sourceColumnId: detected[0].sourceColumnId,
      confirmedAt: CONFIRMED_AT,
    });
    assert.equal(binding.canonicalFieldId, "eid");
    assert.equal(binding.confirmedAt, CONFIRMED_AT);
  });

  it("refuses a target the projection does not declare, and a column not in the file", () => {
    assert.throws(() => confirmBinding({
      projection: workStudyIntake,
      detected,
      targetFieldId: IntakeTargetFieldIdSchema.parse("notAField"),
      sourceColumnId: detected[0].sourceColumnId,
      confirmedAt: CONFIRMED_AT,
    }), /does not declare it/);

    assert.throws(() => confirmBinding({
      projection: workStudyIntake,
      detected,
      targetFieldId: IntakeTargetFieldIdSchema.parse("emplId"),
      sourceColumnId: SourceColumnIdSchema.parse(sourceColumnId("Ghost", 1)),
      confirmedAt: CONFIRMED_AT,
    }), /not present in this file/);
  });
});

describe("doc 06 §2.5 suggestions propose and cannot bind", () => {
  it("ranks an exact alias top and corroborates it with sample values", () => {
    const detected = detectColumns(
      ["Employee ID#", "Effective Date", "Dept"],
      [["10456712", "10873698"], ["07/01/2026"], ["Housing Dining Hospitality"]],
    );
    const top = unambiguousTopSuggestions(
      suggestBindings({ workflow: "work-study", detected, projection: workStudyIntake, readAt: CONFIRMED_AT }),
    );
    assert.equal(top.get(IntakeTargetFieldIdSchema.parse("emplId"))?.sourceColumnId, detected[0].sourceColumnId);
    assert.equal(top.get(IntakeTargetFieldIdSchema.parse("effectiveDate"))?.sourceColumnId, detected[1].sourceColumnId);
    assert.equal(top.get(IntakeTargetFieldIdSchema.parse("emplId"))?.why.includes("samples-parse"), true);
  });

  it("carries no field that could make it a binding", () => {
    const detected = detectColumns(["Employee ID#"], [["10456712"]]);
    const [suggestion] = suggestBindings({ workflow: "work-study", detected, projection: workStudyIntake, readAt: CONFIRMED_AT });
    assert.equal("confirmedAt" in suggestion, false);
    // And the parse that mints a binding refuses the suggestion's own shape.
    assert.throws(() => ColumnMappingSchema.shape.bindings.element.parse(suggestion));
  });

  it("suppresses a matching header whose data the field cannot hold", () => {
    // An exact alias hit — and every sample fails coercion. That is a mis-map,
    // not a weak match, so it scores zero and is not proposed at all.
    const EidOnly = z.strictObject({ emplId: CANONICAL_FIELDS.eid.schema });
    const projection = defineIntakeProjection(EidOnly, { emplId: CANONICAL_FIELDS.eid });
    const wrongData = detectColumns(["Employee ID"], [["not-an-eid", "also-not"]]);
    assert.deepEqual(suggestBindings({ workflow: "work-study", detected: wrongData, projection, readAt: CONFIRMED_AT }), []);
  });

  it("cannot disconfirm a field whose schema accepts any text — and does not pretend to", () => {
    // `department` is one of the `audit-at-migration` text fields, so a date is
    // a schema-valid department. The scorer therefore reports a header-only
    // match rather than inventing evidence, and the operator still confirms.
    const misleading = detectColumns(["Dept"], [["07/01/2026", "08/01/2026"]]);
    const DeptOnly = z.strictObject({ department: CANONICAL_FIELDS.department.schema });
    const projection = defineIntakeProjection(DeptOnly, { department: CANONICAL_FIELDS.department });
    const [suggestion] = suggestBindings({ workflow: "work-study", detected: misleading, projection, readAt: CONFIRMED_AT });
    assert.equal(suggestion.why.includes("samples-parse"), true);
    assert.equal(CANONICAL_FIELDS.department.evidence, "audit-at-migration");
  });

  it("marks indistinguishable candidates ambiguous so neither preselects", () => {
    const twins = detectColumns(["Name", "Name"], [["Cleckoa, Crithe"], ["Doe, John"]]);
    const NameOnly = z.strictObject({ employeeName: CANONICAL_FIELDS.fullName.schema });
    const projection = defineIntakeProjection(NameOnly, { employeeName: CANONICAL_FIELDS.fullName });
    const suggestions = suggestBindings({ workflow: "emergency-contact", detected: twins, projection, readAt: CONFIRMED_AT });
    assert.equal(suggestions.length, 2);
    assert.equal(suggestions.every((entry) => entry.ambiguous), true);
    assert.equal(unambiguousTopSuggestions(suggestions).size, 0);
  });
});
