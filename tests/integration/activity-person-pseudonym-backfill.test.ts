import { RunIdSchema } from "../../src/domain/ids.js";
import { ActivityPersonPseudonymKeyGenerationSchema } from "../../src/domain/trust/activity-person-pseudonym.js";
import {deriveCanonicalPerson} from "../../src/domain/run/summary-derivation.js";
import {CURRENT_SEPARATIONS_RESULT,TERMINAL_SEPARATIONS_RUN} from "./fixtures/activity-person-pseudonym-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { defineRuntimeIsolation } from "../../src/config/define-runtime-isolation.js";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, RunResultRecordSchema } from "../../src/domain/run/result.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { createActivityPersonPseudonymBackfillService } from "../../src/server/activity-person-pseudonym-backfill/service.js";
import { composeActivityPersonPseudonymBackfillCommand } from "../../src/server/activity-person-pseudonym-backfill/compose.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { SeparationsResultSchema } from "../../src/workflows/separations/workflow.js";
import {
  COMPOSITION_ACTION_ID,
  COMPOSITION_DEPARTMENT_OPTION,
  COMPOSITION_DOCUMENT,
  COMPOSITION_EFFECTIVE_DATE,
  COMPOSITION_EID,
  COMPOSITION_FINALIZATION_FIELDS,
  COMPOSITION_KUALI_LDW,
  COMPOSITION_LAST_DAY_WORKED,
  COMPOSITION_NOW,
  COMPOSITION_RECEIPT,
  COMPOSITION_SCOPE_OUTPUTS,
  COMPOSITION_SEPARATION_DATE,
  COMPOSITION_UCPATH_NAME,
  compositionQueuedRun,
} from "../helpers/separations-composition-fixtures.js";
import {
  activityPersonPseudonymResultRecord,
  seedTerminalSeparationsResult,
} from "./fixtures/activity-person-pseudonym-fixtures.js";
import { separationsDescriptor } from "../helpers/registered-workflows.js";

const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const TEST_PSEUDONYM_DOMAIN = createActivityPersonPseudonymDomain({
  keyGeneration: "activity-person-g1",
  keyHex: KEY_HEX,
});



const SEPARATIONS_RESULT = SeparationsResultSchema.parse({
  documentNumber: COMPOSITION_DOCUMENT,
  approved: COMPOSITION_SCOPE_OUTPUTS.approval.approved,
  employment: {
    emplRecord: COMPOSITION_SCOPE_OUTPUTS.employment.emplRecord,
    payrollTitleCode: COMPOSITION_SCOPE_OUTPUTS.employment.payrollTitleCode,
    payrollTitle: COMPOSITION_SCOPE_OUTPUTS.employment.payrollTitle,
  },
  department: {
    option: COMPOSITION_DEPARTMENT_OPTION,
    departmentCode: COMPOSITION_SCOPE_OUTPUTS["department-option"].departmentCode,
  },
  dates: {
    kualiLastDayWorked: COMPOSITION_KUALI_LDW,
    lastDayWorked: COMPOSITION_LAST_DAY_WORKED,
    kualiSeparationDate: COMPOSITION_KUALI_LDW,
    separationDate: COMPOSITION_SEPARATION_DATE,
    terminationEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
    lastDayWorkedChanged: false,
    separationDateChanged: true,
  },
  pendingSweep: {
    disposition: "committed",
    proof: {
      kind: "ucpath-pending-terminations-clear",
      emplId: COMPOSITION_EID,
      scannedRowCount: 0,
      observedAt: COMPOSITION_NOW,
      source: "ss-smart-hr-detail-read",
    },
  },
  termination: {
    transactionNumber: COMPOSITION_RECEIPT,
    approvalStatus: "Pending",
    effectiveDate: COMPOSITION_EFFECTIVE_DATE,
    emplId: COMPOSITION_EID,
    displayedName: COMPOSITION_UCPATH_NAME,
    disposition: "committed",
  },
  finalization: {
    disposition: "committed",
    proof: {
      kind: "kuali-saved-finalization",
      actionId: COMPOSITION_ACTION_ID,
      documentNumber: COMPOSITION_DOCUMENT,
      observedEid: COMPOSITION_EID,
      fields: COMPOSITION_FINALIZATION_FIELDS,
      source: "reload-read-back",
    },
  },
});

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

describe("reviewed activity person pseudonym backfill", () => {
  it("writes one generation-bound row from the terminal Separations approved subject", () => {
    const reviewed: unknown[] = [];
    const service = createActivityPersonPseudonymBackfillService({
      authority: {
        runs: {
          get: () => TERMINAL_RUN,
          listCurrentByWorkflow: () => [TERMINAL_RUN],
        },
      },
      writeCapability: {
        keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
        reviewAndInsert: (runIds: unknown) => {
          reviewed.push(runIds);
          return [{
            runId: TERMINAL_RUN.envelope.runId,
            state: "inserted",
            keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
          }];
        },
      },
    });

    const report = service.backfill({ scope: "current-separations" });

    assert.deepEqual(report, {
      scope: "current-separations",
      keyGeneration: "activity-person-g1",
      outcomes: [{
        runId: TERMINAL_RUN.envelope.runId,
        state: "inserted",
        keyGeneration: "activity-person-g1",
      }],
      counts: { examined: 1, inserted: 1, existing: 0, unavailable: 0 },
    });
    assert.deepEqual(reviewed, [[TERMINAL_RUN.envelope.runId]]);
  });

  it("refuses a selected-run lookup that returns a different run identity", () => {
    const foreignRun = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      envelope: {
        ...TERMINAL_RUN.envelope,
        runId: "99999999-9999-4999-8999-999999999999",
        traceId: "sp-200000-9999",
      },
    });
    let reviewed = 0;
    const service = createActivityPersonPseudonymBackfillService({
      authority: {
        runs: {
          get: () => foreignRun,
          listCurrentByWorkflow: () => [],
        },
      },
      writeCapability: {
        keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
        reviewAndInsert: () => {
          reviewed += 1;
          return [{
            runId: foreignRun.envelope.runId,
            state: "inserted",
            keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
          }];
        },
      },
    });

    const report = service.backfill({
      scope: "selected-runs",
      runIds: [TERMINAL_RUN.envelope.runId],
    });

    assert.deepEqual(report.outcomes, [{
      runId: TERMINAL_RUN.envelope.runId,
      state: "unavailable",
      reason: "run-identity-mismatch",
    }]);
    assert.equal(reviewed, 0);
  });

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
    const root=mkdtempSync(join(tmpdir(),"canonical-person-")),path=join(root,"state.db");
    const db=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"canonical-person"},manualClock(new Date(COMPOSITION_NOW)));
    try {const before=db.getMeta();assert.deepEqual(db.canonicalPerson(TERMINAL_RUN.envelope.runId),{state:"unavailable",reason:"canonical-live-run-unavailable"});assert.deepEqual(db.getMeta(),before);}
    finally{db.close();rmSync(root,{recursive:true,force:true});}
  });
  it("reads the exact approved subject repeatedly without a generation key or write",()=>{
    const root=mkdtempSync(join(tmpdir(),"canonical-person-")),path=join(root,"state.db");
    const db=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"canonical-person"},manualClock(new Date(COMPOSITION_NOW)));
    try {
      seedTerminalSeparationsResult(db,path);const before=db.getMeta();
      for(let n=0;n<3;n++)assert.deepEqual(db.canonicalPerson(TERMINAL_SEPARATIONS_RUN.envelope.runId),{state:"available",identity:CURRENT_SEPARATIONS_RESULT.approved.emplId});
      assert.deepEqual(db.getMeta(),before);
      const raw=new DatabaseSync(path,{readOnly:true});try {assert.deepEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'activity_person_pseudonym%'").all(),[]);}finally{raw.close();}
    }finally{db.close();rmSync(root,{recursive:true,force:true});}
  });
  it("uses approved identity even when later transaction and finalization identities differ",()=>{
    const base=CURRENT_SEPARATIONS_RESULT;
    const finalization=base.finalization;if(!("proof" in finalization))throw new Error("performed finalization required");
    const result=activityPersonPseudonymResultRecord(TERMINAL_SEPARATIONS_RUN,{...base,termination:{...base.termination,emplId:"10800001"},finalization:{...finalization,proof:{...finalization.proof,observedEid:"10800002"}}});
    assert.deepEqual(deriveCanonicalPerson(TERMINAL_SEPARATIONS_RUN,result),{state:"available",identity:base.approved.emplId});
  });
  it("refuses retired command composition without creating state or credential files",()=>{
    const root=mkdtempSync(join(tmpdir(),"retired-backfill-cli-"));
    try {
      const isolation=defineRuntimeIsolation({stateRoot:".tracker",artifactRoot:".tracker/artifacts",archiveDatabaseFile:"archive.sqlite",backendPort:3938,frontendPort:5174,processLockRoot:".tracker/locks",browserProfileRoot:".auth",browserSessionNamespace:"hrauto-rebuild"});
      const result=composeActivityPersonPseudonymBackfillCommand({isolation,args:["backfill","--run",TERMINAL_RUN.envelope.runId,"--json"],repoRoot:root});
      assert.deepEqual(result,{exitCode:1,output:"activity-person-pseudonyms retired; Activity uses validated canonical results"});
      assert.deepEqual(readdirSync(root),[]);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("rejects foreign or incomplete batch replies before presenting plausible success",()=>{
    for(const replies of [[],[{runId:RunIdSchema.parse("99999999-9999-4999-8999-999999999999"),state:"inserted" as const,keyGeneration:ActivityPersonPseudonymKeyGenerationSchema.parse("activity-person-g1")}]]) {
      const service=createActivityPersonPseudonymBackfillService({authority:{runs:{get:()=>TERMINAL_RUN,listCurrentByWorkflow:()=>[TERMINAL_RUN]}},writeCapability:{keyGeneration:ActivityPersonPseudonymKeyGenerationSchema.parse("activity-person-g1"),reviewAndInsert:()=>replies}});
      assert.throws(()=>service.backfill({scope:"current-separations"}),/batch returned/u);
    }
  });
});
