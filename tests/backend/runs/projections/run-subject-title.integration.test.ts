
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { resolveSubjectTitle } from "../../../../src/backend/runs/projections/run-subject-title.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { HASH_A,HASH_B,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
uuidOf,
type DashboardWorld
} from "../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/** A `searching` checkpoint holding whatever the run is said to have resolved. */
function searchingCheckpoint(seed: number, selection: unknown): unknown {
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: uuidOf(seed + 5000),
    nodeId: "searching",
    attempt: 1,
    claimGeneration: 1,
    runId: uuidOf(seed),
    output: {
      schemaHash: HASH_A,
      value: { query: { kind: "by-eid", emplId: "10873698" }, selection },
    },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance: [],
    writtenAt: NOW,
  });
}

const RESOLVED = {
  status: "resolved",
  selected: { emplId: "10873698", name: "Battistessa, Johnnie", hdh: true },
} as const;

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
