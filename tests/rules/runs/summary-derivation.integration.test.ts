import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";


import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { deriveCanonicalPerson } from "../../../src/rules/runs/summary-derivation.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CURRENT_SEPARATIONS_RESULT,TERMINAL_SEPARATIONS_RUN } from "../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";

import { RunRecordSchema } from "../../../src/models/run/record.js";
import { deriveRunResultDigest,deriveTerminalDependencyDigest,RunResultRecordSchema } from "../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";


import { SeparationsResultSchema } from "../../../src/workflows/separations/workflow.js";
import {
activityPersonPseudonymResultRecord,
seedTerminalSeparationsResult,
} from "../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import {
COMPOSITION_NOW,
compositionQueuedRun,
} from "../../support/helpers/separations-composition-fixtures.js";
import { openBoundDatabaseFixture } from "../../support/helpers/admission-fixture.js";

const SEPARATIONS_RESULT = CURRENT_SEPARATIONS_RESULT;

const RESULT_SCHEMA_HASH = deriveSchemaHash(SeparationsResultSchema, "output");
const TERMINAL_RUN = RunRecordSchema.parse({
  ...compositionQueuedRun(),
  lifecycle: { state: "terminal", outcome: "done", endedAt: COMPOSITION_NOW },
  claimGeneration: 1,
  completion: { schemaVersion: 1, kind: "done", expectedVersion: 1,
    claim: { workerId: "projection-fixture", claimGeneration: 1 }, authorizedAt: COMPOSITION_NOW,
    resultDigest: deriveRunResultDigest({ schemaHash: RESULT_SCHEMA_HASH, value: SEPARATIONS_RESULT }) },
  version: 2,
  updatedAt: COMPOSITION_NOW,
});

const RESULT_RECORD = RunResultRecordSchema.parse({
  runId: TERMINAL_RUN.envelope.runId,
  attempt: TERMINAL_RUN.envelope.attempt,
  workflowId: TERMINAL_RUN.envelope.workflow,
  descriptorVersion: TERMINAL_RUN.envelope.descriptorVersion,
  contractFingerprint: separationsDescriptor.contractFingerprint,
  configFingerprint: TERMINAL_RUN.envelope.configFingerprint,
  configSnapshotId: TERMINAL_RUN.envelope.configSnapshotId,
  resultSchemaHash: RESULT_SCHEMA_HASH,
  result: { schemaHash: RESULT_SCHEMA_HASH, value: SEPARATIONS_RESULT },
  resultDigest: deriveRunResultDigest({ schemaHash: RESULT_SCHEMA_HASH, value: SEPARATIONS_RESULT }),
  dependencies: [],
  dependencyDigest: deriveTerminalDependencyDigest([]),
  createdAt: COMPOSITION_NOW,
});

function resultWith(value: unknown) {
  const result = { schemaHash: RESULT_SCHEMA_HASH, value };
  return RunResultRecordSchema.parse({
    ...RESULT_RECORD,
    result,
    resultDigest: deriveRunResultDigest(result),
  });
}

describe("canonical activity person", () => {

  it("preserves the complete unavailable binding matrix at the canonical-result reader",()=>{
    const queued = RunRecordSchema.parse(compositionQueuedRun());
    const failed = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      completion: { schemaVersion: 1, kind: "failed", expectedVersion: 1,
        claim: { workerId: "projection-fixture", claimGeneration: 1 }, authorizedAt: COMPOSITION_NOW,
        failureId: "66666666-6666-4666-8666-666666666666" },
      lifecycle: {
        state: "terminal",
        outcome: "failed",
        endedAt: COMPOSITION_NOW,
        failureId: "66666666-6666-4666-8666-666666666666",
        errorSummary: "safe fixture failure",
      },
    });
    const foreign = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      envelope: { ...TERMINAL_RUN.envelope, workflow: "person-lookup" },
    });
    const { emplId: _missingEmplId, ...subjectWithoutEid } = SEPARATIONS_RESULT.approved;
    const missingSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: subjectWithoutEid,
    });
    const malformedSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: { ...SEPARATIONS_RESULT.approved, emplId: "not-an-eid" },
    });
    const ambiguousSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: { ...SEPARATIONS_RESULT.approved, emplId: ["10800000", "10800001"] },
    });
    const cases = [
      { name: "missing run", run: undefined, result: undefined, reason: "run-not-found" },
      { name: "foreign workflow", run: foreign, result: RESULT_RECORD, reason: "workflow-not-separations" },
      { name: "nonterminal run", run: queued, result: RESULT_RECORD, reason: "run-not-terminal" },
      { name: "non-done terminal run", run: failed, result: undefined, reason: "terminal-outcome-not-done" },
      { name: "missing result", run: TERMINAL_RUN, result: undefined, reason: "run-result-missing" },
      {
        name: "mismatched result execution",
        run: TERMINAL_RUN,
        result: RunResultRecordSchema.parse({ ...RESULT_RECORD, attempt: RESULT_RECORD.attempt + 1 }),
        reason: "run-result-identity-mismatch",
      },
      { name: "missing binding", run: TERMINAL_RUN, result: missingSubject, reason: "canonical-subject-missing" },
      { name: "malformed binding", run: TERMINAL_RUN, result: malformedSubject, reason: "canonical-subject-malformed" },
      { name: "ambiguous binding", run: TERMINAL_RUN, result: ambiguousSubject, reason: "canonical-subject-ambiguous" },
    ] as const;

    for(const fixture of cases) {
      if(fixture.run===undefined)continue; // Missing IDs are proved through the real database below.
      if(fixture.reason==="run-result-identity-mismatch")assert.throws(()=>deriveCanonicalPerson(fixture.run,fixture.result??null),/summary-result-identity-mismatch/u);
      else assert.deepEqual(deriveCanonicalPerson(fixture.run,fixture.result??null),{state:"unavailable",reason:"canonical-result-unavailable"},fixture.name);
    }
  });
  it("returns unavailable for an absent canonical run without minting identity rows",()=>{
    const opened=openBoundDatabaseFixture("canonical-person",manualClock(new Date(COMPOSITION_NOW)));
    const db=opened.database;
    try {const before=db.getMeta();assert.deepEqual(db.canonicalPerson(TERMINAL_RUN.envelope.runId),{state:"unavailable",reason:"canonical-live-run-unavailable"});assert.deepEqual(db.getMeta(),before);}
    finally{opened.close();}
  });
  it("reads the exact approved subject repeatedly without a generation key or write",()=>{
    const opened=openBoundDatabaseFixture("canonical-person",manualClock(new Date(COMPOSITION_NOW)));
    const db=opened.database;
    try {
      db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      seedTerminalSeparationsResult(db,opened.path);const before=db.getMeta();
      for(let n=0;n<3;n++)assert.deepEqual(db.canonicalPerson(TERMINAL_SEPARATIONS_RUN.envelope.runId),{state:"available",identity:CURRENT_SEPARATIONS_RESULT.approved.emplId});
      assert.deepEqual(db.getMeta(),before);
      const raw=new DatabaseSync(opened.path,{readOnly:true});try {assert.deepEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'activity_person_pseudonym%'").all(),[]);}finally{raw.close();}
    }finally{opened.close();}
  });
  it("uses approved identity even when later transaction and finalization identities differ",()=>{
    const base=CURRENT_SEPARATIONS_RESULT;
    const finalization=base.finalization;if(!("proof" in finalization))throw new Error("performed finalization required");
    const result=activityPersonPseudonymResultRecord(TERMINAL_SEPARATIONS_RUN,{...base,termination:{...base.termination,emplId:"10800001"},finalization:{...finalization,proof:{...finalization.proof,observedEid:"10800002"}}});
    assert.deepEqual(deriveCanonicalPerson(TERMINAL_SEPARATIONS_RUN,result),{state:"available",identity:base.approved.emplId});
  });
});
