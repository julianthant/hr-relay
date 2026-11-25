import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { defineIntakeProjection } from "../../../src/models/intake/projection.js";
import {
  ColumnMappingSchema,
  detectColumns,
  headerFingerprint,
  resolveSavedMapping,
  sourceColumnId,
} from "../../../src/models/intake/mapping.js";
import { SourceColumnIdSchema } from "../../../src/rules/identity/ids.js";

describe("ref data-intake-and-edit-data §7 intake mapping boundary", () => {

  describe("the behavioural half", () => {
    const WorkStudyInput = z.strictObject({
      emplId: CANONICAL_FIELDS.eid.schema,
      effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
    });
    const projection = defineIntakeProjection(WorkStudyInput, {
      emplId: CANONICAL_FIELDS.eid,
      effectiveDate: CANONICAL_FIELDS.effectiveDate,
    });

    it("refuses a target whose schema is a copy rather than the canonical object (#6)", () => {
      const Copied = z.strictObject({ emplId: z.string().regex(/^10\d{6}$/) });
      assert.throws(
        () => defineIntakeProjection(Copied, { emplId: CANONICAL_FIELDS.eid }),
        /must reuse the canonical eid schema object/,
      );
    });

    it("never resolves an absent column to whatever now sits at its index (#3)", () => {
      const detected = detectColumns(["Employee ID#", "Effective Date"], [["10456712"], ["07/01/2026"]]);
      const mapping = ColumnMappingSchema.parse({
        workflow: "work-study",
        intakeProjectionFingerprint: projection.fingerprint,
        fingerprint: headerFingerprint(detected),
        savedAt: "2026-08-05T18:00:00.000Z",
        headerRowIndex: 0,
        columns: detected.map(({ samples: _samples, ...rest }) => rest),
        bindings: [{
          targetFieldId: "emplId",
          canonicalFieldId: "eid",
          // A column that is NOT in the file, while index 0 is occupied.
          sourceColumnId: SourceColumnIdSchema.parse(sourceColumnId("Employee Number", 1)),
          confirmedAt: "2026-08-05T18:00:00.000Z",
        }],
      });
      const reuse = resolveSavedMapping({ mapping, detected, projection, workflow: "work-study" });
      assert.equal(reuse.outcome, "offered");
      if (reuse.outcome !== "offered") return;
      assert.equal(reuse.resolutions.every((entry) => entry.state === "unbound"), true);

      assert.deepEqual([...reuse.unboundRequired].sort(), ["effectiveDate", "emplId"]);
      assert.equal(reuse.readyToRun, false);
    });

    it("keeps two targets on one canonical concept separately bindable (#13)", () => {
      const NameInput = z.strictObject({
        employeeName: CANONICAL_FIELDS.fullName.schema,
        contactName: CANONICAL_FIELDS.fullName.schema,
      });
      const names = defineIntakeProjection(NameInput, {
        employeeName: CANONICAL_FIELDS.fullName,
        contactName: CANONICAL_FIELDS.fullName,
      });
      assert.deepEqual(
        names.targets.map((target) => target.targetFieldId).sort(),
        ["contactName", "employeeName"],
      );
    });
  });
});
