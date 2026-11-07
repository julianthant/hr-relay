
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
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
} from "../../../src/models/intake/mapping.js";
import { defineIntakeProjection } from "../../../src/models/intake/projection.js";
import { suggestBindings,unambiguousTopSuggestions } from "../../../src/models/intake/suggestions.js";
import { IntakeTargetFieldIdSchema,SourceColumnIdSchema } from "../../../src/rules/identity/ids.js";

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

describe("ref data-intake-and-edit-data §2.1/§2.3 column identity and layout fingerprint", () => {
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

describe("ref data-intake-and-edit-data §2.3 saved-mapping reuse is fail-closed", () => {
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
    const twins = detectColumns(["Name", "Name"], [["Morrow, Bea"], ["Doe, John"]]);
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

    assert.deepEqual(reuse.unboundRequired, ["emplId"]);
    assert.equal(reuse.readyToRun, false);
  });
});

describe("ref data-intake-and-edit-data §2.5 confirmBinding is the only mint", () => {
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

describe("ref data-intake-and-edit-data §2.5 suggestions propose and cannot bind", () => {
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
    // A schema-valid date in an audit text field is a header-only suggestion, not proof of matching data.
    const misleading = detectColumns(["Dept"], [["07/01/2026", "08/01/2026"]]);
    const DeptOnly = z.strictObject({ department: CANONICAL_FIELDS.department.schema });
    const projection = defineIntakeProjection(DeptOnly, { department: CANONICAL_FIELDS.department });
    const [suggestion] = suggestBindings({ workflow: "work-study", detected: misleading, projection, readAt: CONFIRMED_AT });
    assert.equal(suggestion.why.includes("samples-parse"), true);
    assert.equal(CANONICAL_FIELDS.department.evidence, "audit-at-migration");
  });

  it("marks indistinguishable candidates ambiguous so neither preselects", () => {
    const twins = detectColumns(["Name", "Name"], [["Morrow, Bea"], ["Doe, John"]]);
    const NameOnly = z.strictObject({ employeeName: CANONICAL_FIELDS.fullName.schema });
    const projection = defineIntakeProjection(NameOnly, { employeeName: CANONICAL_FIELDS.fullName });
    const suggestions = suggestBindings({ workflow: "emergency-contact", detected: twins, projection, readAt: CONFIRMED_AT });
    assert.equal(suggestions.length, 2);
    assert.equal(suggestions.every((entry) => entry.ambiguous), true);
    assert.equal(unambiguousTopSuggestions(suggestions).size, 0);
  });
});
