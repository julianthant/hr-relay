import { z } from "zod";
import { CANONICAL_FIELDS } from "../../../../src/models/fields/registry.js";
import { buildIntakeManifest } from "../../../../src/models/intake/manifest.js";
import { confirmBinding, detectColumns, headerFingerprint } from "../../../../src/models/intake/mapping.js";
import { defineIntakeProjection } from "../../../../src/models/intake/projection.js";
import { validateIntakeRows } from "../../../../src/models/intake/validate.js";
import { IntakeTargetFieldIdSchema, ItemIdSchema } from "../../../../src/rules/identity/ids.js";
import type { JsonValue } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

export function createWorkStudyIntakeFixtures() {
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

  const AT = "2026-08-05T18:00:00.000Z";
  const SOURCE_SHA = sha256Hex("WorkStudy_July.xlsx");
  const detected = detectColumns(
    ["Employee ID#", "Student Name", "Dept"],
    [["10456712"], ["Morrow, Bea"], ["Housing Dining Hospitality"]],
  );

  function bindings(targets: readonly [string, number][]) {
    return targets.map(([targetFieldId, index]) => confirmBinding({
      projection: workStudyIntake,
      detected,
      targetFieldId: IntakeTargetFieldIdSchema.parse(targetFieldId),
      sourceColumnId: detected[index].sourceColumnId,
      confirmedAt: AT,
    }));
  }

  /** A workflow's own identity function: EID is the match key here. */
  function deriveItemId(parsedInput: JsonValue) {
    const emplId = (parsedInput as { emplId: string }).emplId;
    const digest = sha256Hex(`test:item\0${emplId}`);
    const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
    return ItemIdSchema.parse([
      digest.slice(0, 8), digest.slice(8, 12), `5${digest.slice(13, 16)}`,
      `${variant}${digest.slice(17, 20)}`, digest.slice(20, 32),
    ].join("-"));
  }

  function validate(rows: readonly (readonly string[])[], overrides: Partial<Parameters<typeof validateIntakeRows>[0]> = {}) {
    return validateIntakeRows({
      workflow: "work-study",
      sourceSha256: SOURCE_SHA,
      projection: workStudyIntake,
      detected,
      bindings: bindings([["emplId", 0], ["department", 2]]),
      rows,
      constants: [{ targetFieldId: IntakeTargetFieldIdSchema.parse("effectiveDate"), value: "2026-07-01" }],
      readAt: AT,
      deriveItemId,
      ...overrides,
    });
  }

  function manifestFrom(
    result: ReturnType<typeof validateIntakeRows>,
    sourceRows: number,
    extras: Partial<Parameters<typeof buildIntakeManifest>[0]> = {},
  ) {
    return buildIntakeManifest({
      manifestId: "9f8a1c2d-4b5e-4a6f-9c8d-0e1f2a3b4c5d",
      workflow: "work-study",
      source: { artifactId: "11111111-2222-4333-8444-555555555555", sha256: SOURCE_SHA, originalName: "WorkStudy_July.xlsx" },
      mappingFingerprint: headerFingerprint(detected),
      mappingSnapshotHash: sha256Hex("mapping-snapshot"),
      intakeProjectionFingerprint: workStudyIntake.fingerprint,
      workflowContractFingerprint: sha256Hex("work-study-contract"),
      canonicalInputSchemaHash: sha256Hex("work-study-canonical-input"),
      createdAt: AT,
      sourceRows,
      valid: result.valid,
      currentRejects: result.currentRejects,
      rejectionHistory: result.rejected,
      corrections: [],
      exclusions: [],
      ...extras,
    });
  }
  return { WorkStudyInput, workStudyIntake, AT, SOURCE_SHA, detected, bindings, deriveItemId, validate, manifestFrom };
}
