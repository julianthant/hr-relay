import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { uuidOf } from "./dashboard-harness.js";





export function createSubjectTitleTestWorld() {
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
  return { searchingCheckpoint, RESOLVED };
}
