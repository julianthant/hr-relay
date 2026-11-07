import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveSubjectTitle } from "../../../../src/backend/runs/projections/run-subject-title.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { searchingCheckpoint, RESOLVED } = createSubjectTitleTestWorld();


describe("the subject-derived queue-row title (ref dashboard-surfaces)", () => {

  it("joins the confirmed name and EID from the same declared checkpoint", () => {
    const projection = { nodeId: "searching", fieldPath: "selection.selected.name", eidFieldPath: "selection.selected.emplId" };
    assert.equal(resolveSubjectTitle(projection, { workflowId: "person-lookup", itemId: uuidOf(5000) }, {
      latestCheckpoint: () => RunCheckpointRecordSchema.parse(searchingCheckpoint(1, RESOLVED)),
    }), "Battistessa, Johnnie · EID 10873698");
    assert.equal(resolveSubjectTitle(projection, { workflowId: "person-lookup", itemId: uuidOf(5000) }, {
      latestCheckpoint: () => undefined,
    }), undefined);
    assert.throws(() => resolveSubjectTitle({ ...projection, eidFieldPath: "selection.selected.missing" },
      { workflowId: "person-lookup", itemId: uuidOf(5000) }, {
        latestCheckpoint: () => RunCheckpointRecordSchema.parse(searchingCheckpoint(1, RESOLVED)),
      }), /subject-title-eid-missing/u);
  });

  it("names a structured value for what it is rather than stringifying it", () => {

    assert.throws(
      () => resolveSubjectTitle(
        { nodeId: "searching", fieldPath: "selection.selected" },
        { workflowId: "person-lookup", itemId: uuidOf(5000) },
        {
          latestCheckpoint: () => searchingCheckpoint(1, RESOLVED) as never,
        },
      ),
      /declares its subject name at searching\.selection\.selected.*object/s,
    );
  });
});
