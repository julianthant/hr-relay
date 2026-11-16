import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { deriveTerminalFailureDigest,terminalEvidenceResult } from "../../../src/models/run/result.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";
import { foundationFixture as baseFoundationFixture,failure,id,terminalizeFixtureFailure } from "../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

import { RunRecordSchema } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
async function foundationFixture(){return await baseFoundationFixture({input:RunRecordSchema.shape.input.parse({...QUEUED_RUN.input,parsed:{
  schemaHash:deriveSchemaHash(PersonLookupCanonicalInput,"output"),value:{emplId:"10873698",keepNonHdh:false,includeCrmDates:false},
  protectedBindings:[{kind:"test-data-local",inputPath:"emplId",name:"personLookupCanaryEid",sourceId:id(89)}],
}})});}
function rawState(path:string) {
  const db=new DatabaseSync(path,{readOnly:true});try{return canonicalJsonStringify(["runs","run_failures","run_results","run_receipts","commands","command_audits","timeline_events"].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));}finally{db.close();}
}
function trust(db:AuthorityDatabase,f:Awaited<ReturnType<typeof foundationFixture>>){return createReceiptService({database:db,
  runReader:sqliteRunReader(db,f.clock),descriptors:[personLookupDescriptor]});}

describe("truthful immutable final evidence",()=>{
  it("binds failed evidence to the exact failure and genuine authorization, reopens and replays without effects",async ()=>{
    const f=await foundationFixture();try{
      const report=terminalizeFixtureFailure(f,f.run,failure());
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert.ok(result);
      assert.deepEqual(terminalEvidenceResult(result),{kind:"failed-evidence",authorization:report.authorization,failureDigest:deriveTerminalFailureDigest(failure())});
      assert.deepEqual(result.dependencies,[]);assert.equal(result.operationSources,undefined);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert.deepEqual(receipt.output,[]);
      const before=rawState(f.path);assert.equal(terminalizeFixtureFailure(f,f.run,failure()).state,"replayed");assert.equal(rawState(f.path),before);
      f.db.close();const reopened=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-reopen"},f.clock);
      try{assert.deepEqual(reopened.authority.runResults.get(result.runId),result);assert.deepEqual(trust(reopened,f).ensureReceipt(result.runId),receipt);assert.equal(rawState(f.path),before);}finally{reopened.close();}
    }finally{await f.dispose();}
  });
});
