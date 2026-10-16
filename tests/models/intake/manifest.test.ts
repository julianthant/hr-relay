import { createWorkStudyIntakeFixtures } from "../../support/helpers/intake/work-study-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";


import {
IntakePlanManifestSchema,
RerunDiffSchema
} from "../../../src/models/intake/manifest.js";





import { sha256Hex } from "../../../src/rules/validation/sha256.js";

const { deriveItemId, validate, manifestFrom } =
  createWorkStudyIntakeFixtures();

describe("ref data-intake-and-edit-data §5 manifest invariants", () => {
  const result = validate([["10456712", "Morrow, Bea", "HDH"], ["10-4567", "Roe, Rick", "HDH"]]);

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

  it("requires both membership vectors on a changed rerun wire", () => {
    assert.throws(
      () => RerunDiffSchema.parse({
        kind: "changed",
        changes: [{
          what: "mapping",
          was: sha256Hex("old mapping"),
          now: sha256Hex("new mapping"),
        }],
        added: [],
        changedInputs: [],
      }),
      /removed/u,
    );
  });

  it("requires the changed-input vector on a changed rerun wire", () => {
    assert.throws(
      () => RerunDiffSchema.parse({
        kind: "changed",
        changes: [{
          what: "mapping",
          was: sha256Hex("old mapping"),
          now: sha256Hex("new mapping"),
        }],
        added: [],
        removed: [],
      }),
      /changedInputs/u,
    );
  });

  it("refuses a changed-input signal whose before and after hashes are equal", () => {
    const itemId = deriveItemId({ emplId: "10456712" });
    const inputHash = sha256Hex("same input");

    assert.throws(
      () => RerunDiffSchema.parse({
        kind: "changed",
        changes: [],
        added: [],
        removed: [],
        changedInputs: [{ itemId, beforeInputHash: inputHash, afterInputHash: inputHash }],
      }),
      /different before and after hashes/u,
    );
  });

  it("refuses a changed rerun wire with no changed fact", () => {
    assert.throws(
      () => RerunDiffSchema.parse({ kind: "changed", changes: [], added: [], removed: [], changedInputs: [] }),
      /names an axis change, an added item, a removed item, or changed input/u,
    );
  });

  it("refuses identity vectors on an identical rerun wire", () => {
    assert.throws(
      () => RerunDiffSchema.parse({ kind: "same-plan", added: [], removed: [] }),
      /Unrecognized key/u,
    );
  });
});
