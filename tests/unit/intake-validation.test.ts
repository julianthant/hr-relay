/**
 * Ref data-intake-and-edit-data §5 — mapped dataset → N inputs, with a pre-run rejection review.
 *
 * This walks §8's worked example (42 rows, 2 bad EIDs, corrected in the grid)
 * and then attacks the invariants that make a partial intake impossible to
 * mistake for a complete one.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { CANONICAL_FIELDS } from "../../src/domain/fields/registry.js";
import { confirmBinding, detectColumns, headerFingerprint } from "../../src/domain/intake/mapping.js";
import { defineIntakeProjection } from "../../src/domain/intake/projection.js";
import {
  IntakePlanManifestSchema,
  buildIntakeManifest,
  deriveRowRejectId,
  enqueueReadiness,
  rerunDiff,
} from "../../src/domain/intake/manifest.js";
import { validateIntakeRows } from "../../src/domain/intake/validate.js";
import { canonicalJsonStringify, type JsonValue } from "../../src/domain/canonical-json.js";
import { IntakeTargetFieldIdSchema, ItemIdSchema } from "../../src/domain/ids.js";
import { sha256Hex } from "../../src/domain/sha256.js";

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
  [["10456712"], ["Cleckoa, Crithe"], ["Housing Dining Hospitality"]],
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

describe("ref data-intake-and-edit-data §5 intake validation", () => {
  it("walks §8's worked example: 42 rows, 40 valid, 2 named rejections", () => {
    const rows = Array.from({ length: 42 }, (_, index) => {
      const row = index + 1;
      if (row === 17) return ["10-4567", "Cleckoa, Crithe", "HDH"];
      if (row === 31) return ["TBD", "Roe, Rick", "HDH"];
      return [`10${String(400000 + row).padStart(6, "0")}`, "Cleckoa, Crithe", "HDH"];
    });
    const result = validate(rows);
    assert.equal(result.valid.length, 40);
    assert.equal(result.rejected.length, 2);
    assert.deepEqual(result.rejected.map((reject) => reject.sourceRow), [17, 31]);
    assert.equal(result.rejected.every((reject) => reject.kind === "cell-coercion"), true);
    assert.match(result.rejected[0].reason, /not a UCPath EID/);
    assert.match(result.rejected[1].reason, /contains no digits/);

    const manifest = manifestFrom(result, 42);
    assert.equal(manifest.totals.valid, 40);
    assert.equal(manifest.totals.rejected, 2);
    assert.equal(manifest.totals.rejectionEvents, 2);
    const readiness = enqueueReadiness(manifest);
    assert.equal(readiness.ready, false);
    if (readiness.ready) return;
    assert.equal(readiness.reason, "unresolved-rejections");
    assert.deepEqual(readiness.unresolvedRows, [17, 31]);
  });

  it("re-validates a corrected cell without rewriting the source, and keeps the rejection history", () => {
    const rows = [["10-4567", "Cleckoa, Crithe", "HDH"], ["10998801", "Roe, Rick", "HDH"]];
    const first = validate(rows);
    assert.equal(first.rejected.length, 1);

    const second = validate(rows, {
      corrections: [{ sourceRow: 1, field: IntakeTargetFieldIdSchema.parse("emplId"), correctedValue: "10456712" }],
    });
    assert.equal(second.valid.length, 2);
    assert.equal(second.rejected.length, 0);

    const manifest = manifestFrom(second, 2, {
      // The history is the union of both passes — the event survives the fix.
      rejectionHistory: first.rejected,
      corrections: [{
        sourceRow: 1,
        field: "emplId",
        original: { state: "transformed", classification: "direct-identifier", transform: "last4", value: "4567" },
        correctedValue: "10456712",
        correctedAt: AT,
      }],
    });
    assert.equal(manifest.totals.valid, 2);
    assert.equal(manifest.totals.rejected, 0);
    assert.equal(manifest.totals.rejectionEvents, 1);
    assert.equal(manifest.totals.corrected, 1);
    assert.equal(enqueueReadiness(manifest).ready, true);
  });

  it("derives the same reject id for the same defect, so revalidation is idempotent", () => {
    const rows = [["10-4567", "Cleckoa, Crithe", "HDH"]];
    assert.equal(validate(rows).rejected[0].rejectId, validate(rows).rejected[0].rejectId);
    assert.notEqual(
      deriveRowRejectId({ sourceSha256: SOURCE_SHA, sourceRow: 1, kind: "cell-coercion", subject: "emplId" }),
      deriveRowRejectId({ sourceSha256: SOURCE_SHA, sourceRow: 2, kind: "cell-coercion", subject: "emplId" }),
    );
  });

  it("rejects BOTH rows of an identity collision rather than picking a winner", () => {
    const rows = [
      ["10456712", "Cleckoa, Crithe", "HDH"],
      ["10998801", "Roe, Rick", "HDH"],
      ["10456712", "Cleckoa, Crithe", "HDH"],
    ];
    const result = validate(rows);
    assert.equal(result.valid.length, 1);
    assert.equal(result.valid[0].sourceRow, 2);
    const collisions = result.rejected.filter((reject) => reject.kind === "duplicate-identity");
    assert.equal(collisions.length, 2);
    assert.deepEqual(
      collisions.map((reject) => reject.kind === "duplicate-identity" ? reject.collidingSourceRows : []),
      [[1, 3], [1, 3]],
    );
  });

  it("blocks every row when a required target has neither a column nor a run value", () => {
    const result = validateIntakeRows({
      workflow: "work-study",
      sourceSha256: SOURCE_SHA,
      projection: workStudyIntake,
      detected,
      bindings: bindings([["emplId", 0]]),
      rows: [["10456712", "Cleckoa, Crithe", "HDH"], ["10998801", "Roe, Rick", "HDH"]],
      readAt: AT,
    deriveItemId,
    });
    assert.equal(result.valid.length, 0);
    assert.equal(result.rejected.length, 2);
    assert.equal(result.rejected.every((reject) => reject.kind === "unmapped-required"), true);
    assert.equal(
      result.rejected.every((reject) => reject.kind === "unmapped-required" && reject.field === "effectiveDate"),
      true,
    );
  });

  it("treats a blank optional cell as absent and a blank required cell as a rejection", () => {
    const result = validate([["10456712", "Cleckoa, Crithe", "   "]]);
    assert.equal(result.valid.length, 1);
    assert.equal("department" in (result.valid[0].parsedInput as object), false);

    const required = validate([["   ", "Cleckoa, Crithe", "HDH"]]);
    assert.equal(required.rejected.length, 1);
    assert.equal(required.rejected[0].kind, "cell-coercion");
  });

  it("redacts the offending cell in the durable rejection", () => {
    const result = validate([["10-4567", "Cleckoa, Crithe", "HDH"]]);
    const reject = result.rejected[0];
    assert.equal(reject.kind, "cell-coercion");
    if (reject.kind !== "cell-coercion") return;
    // The manifest must not become a second copy of the identifier; the grid
    // shows the operator the real cell from the content-addressed artifact.
    assert.deepEqual(reject.raw, {
      state: "transformed",
      classification: "direct-identifier",
      transform: "last4",
      value: "4567",
    });
    assert.equal(canonicalJsonStringify(reject).includes("10-4567"), false);
  });

  it("refuses loudly when a confirmed binding's column is missing at validation time", () => {
    assert.throws(
      () => validateIntakeRows({
        workflow: "work-study",
        sourceSha256: SOURCE_SHA,
        projection: workStudyIntake,
        detected: detectColumns(["Student Name"]),
        bindings: bindings([["emplId", 0]]),
        rows: [["Cleckoa, Crithe"]],
        readAt: AT,
        constants: [{ targetFieldId: IntakeTargetFieldIdSchema.parse("effectiveDate"), value: "2026-07-01" }],
        deriveItemId,
      }),
      /bound to a column that is not in this file/,
    );
  });

  it("produces canonical, stable parsed inputs", () => {
    const once = validate([["10456712", "Cleckoa, Crithe", "HDH"]]).valid[0];
    const twice = validate([["10456712", "Cleckoa, Crithe", "HDH"]]).valid[0];
    assert.equal(once.inputHash, twice.inputHash);
    assert.deepEqual(once.parsedInput, { department: "HDH", effectiveDate: "2026-07-01", emplId: "10456712" });
  });
});

describe("ref data-intake-and-edit-data §5 manifest invariants", () => {
  const result = validate([["10456712", "Cleckoa, Crithe", "HDH"], ["10-4567", "Roe, Rick", "HDH"]]);

  it("refuses a manifest whose totals disagree with its own dispositions", () => {
    const manifest = manifestFrom(result, 2);
    assert.throws(
      () => IntakePlanManifestSchema.parse({ ...manifest, totals: { ...manifest.totals, valid: 2 } }),
      /totals.valid 2 disagrees with 1 valid dispositions/,
    );
  });

  it("refuses a manifest that leaves a source row with no disposition", () => {
    const manifest = manifestFrom(result, 2);
    assert.throws(
      () => IntakePlanManifestSchema.parse({
        ...manifest,
        sourceRowDispositions: manifest.sourceRowDispositions.slice(0, 1),
      }),
      /source row 2 has no disposition/,
    );
  });

  it("refuses a valid row that still carries a current rejection", () => {
    const manifest = manifestFrom(result, 2);
    assert.throws(
      () => IntakePlanManifestSchema.parse({
        ...manifest,
        sourceRowDispositions: manifest.sourceRowDispositions.map((row) =>
          row.sourceRow === 1 ? { ...row, currentRejectIds: [result.rejected[0].rejectId] } : row),
      }),
      /source row 1 is valid but still carries a current rejection/,
    );
  });

  it("refuses an excluded row with no recorded operator confirmation", () => {
    const excludedResult = validate([["10456712", "Cleckoa, Crithe", "HDH"], ["10-4567", "Roe, Rick", "HDH"]], {
      excludedRows: [2],
    });
    const manifest = manifestFrom(excludedResult, 2, {
      exclusions: [{ sourceRow: 2, reason: "left the department", operatorConfirmedAt: AT }],
    });
    assert.equal(manifest.totals.excluded, 1);
    assert.equal(enqueueReadiness(manifest).ready, true);
    assert.throws(
      () => IntakePlanManifestSchema.parse({ ...manifest, exclusions: [] }),
      /source row 2 is excluded with no recorded operator confirmation/,
    );
  });

  it("refuses to build a manifest that would leave a row unaccounted for", () => {
    assert.throws(
      () => manifestFrom(result, 3),
      /source row 3 is neither valid, rejected, nor excluded/,
    );
  });

  it("blocks a zero-valid-row intake instead of reporting a no-op success", () => {
    const empty = validate([]);
    const manifest = manifestFrom(empty, 0);
    const readiness = enqueueReadiness(manifest);
    assert.equal(readiness.ready, false);
    if (readiness.ready) return;
    assert.equal(readiness.reason, "no-valid-rows");
  });

  it("shows a rerun diff when the file, mapping or contract has moved", () => {
    const manifest = manifestFrom(validate([["10456712", "Cleckoa, Crithe", "HDH"]]), 1);
    const same = {
      sourceSha256: manifest.source.sha256,
      mappingSnapshotHash: manifest.mappingSnapshotHash,
      intakeProjectionFingerprint: manifest.intakeProjectionFingerprint,
      workflowContractFingerprint: manifest.workflowContractFingerprint,
      canonicalInputSchemaHash: manifest.canonicalInputSchemaHash,
    };
    assert.deepEqual(rerunDiff(manifest, same), { kind: "same-plan" });

    const moved = rerunDiff(manifest, { ...same, sourceSha256: sha256Hex("a different file") });
    assert.equal(moved.kind, "changed");
    if (moved.kind !== "changed") return;
    assert.deepEqual(moved.changes.map((change) => change.what), ["source-artifact"]);
  });
});
