import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveSubjectTitle } from "../../../../src/backend/runs/projections/run-subject-title.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { searchingCheckpoint, RESOLVED } = createSubjectTitleTestWorld();


describe("the subject-derived queue-row title (ref dashboard-surfaces §1.2)", () => {

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
