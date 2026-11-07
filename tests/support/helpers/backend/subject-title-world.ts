import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { PersonLookupInput, PersonLookupCanonicalInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { SearchPersonOrg, SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { uuidOf } from "./dashboard-harness.js";





export function createSubjectTitleTestWorld() {
  const descriptor = defineWorkflowDescriptor({
    id: "person-lookup", version: 1, contractFingerprint: HASH_A, code: "pl", label: "Synthetic subject lookup",
    icon: "Search", category: "search", canonicalInput: PersonLookupCanonicalInput, inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
    identity: { matchKey: () => "synthetic-subject" }, presentation: { title: () => "Synthetic ingress title" },
    scenarios: SearchPersonOrg.scenarios,
    subjectProjection: { nodeId: "searching", fieldPath: "selection.selected.name" },
    flow: flow(PersonLookupInput).step("searching", SearchPersonOrg, {
      dependsOn: [], replay: "checkpoint", bind: () => ({ kind: "by-eid" as const, emplId: "10873698" }),
    }).build({ schema: SearchPersonOrgOutputSchema, dependsOn: ["searching"], derive: ({ outputs }) => outputs.searching }),
  });
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
  return { descriptor, searchingCheckpoint, RESOLVED };
}
