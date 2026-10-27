import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { id } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import { resolveOperationSource } from "../../../../src/backend/runs/queries/operation-source.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { resolutionFixture,resolutionReadDeps } from "../../../support/helpers/failure-resolution/fixtures.js";
function rawState(path:string) {
  const db=new DatabaseSync(path,{readOnly:true});try{return canonicalJsonStringify(["runs","run_failures","run_results","run_receipts","commands","command_audits","timeline_events"].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));}finally{db.close();}
}

describe("truthful immutable final evidence",()=>{
  it("keeps failed owner action-source reads truthful without inventing successful result lineage",async ()=>{
    const f=await resolutionFixture();try{
      const deps=resolutionReadDeps(f);assert.ok(deps.runReader);
      const run=f.db.authority.runs.get(f.record.runId);assert.ok(run);assert.ok(f.db.authority.runResults.get(f.record.runId));
      const canonical={reader:deps.runReader,database:f.db,descriptors:{resolve:()=>personLookupDescriptor}};
      const identity={runId:run.envelope.runId,definitionFingerprint:run.envelope.contractFingerprint,nodeId:"searching",taskId:SearchPersonOrg.id,
        attempt:run.envelope.attempt,claimGeneration:run.claimGeneration,taskAttempt:1,invocationId:"synthetic-read",
        occurrencePath:["synthetic-read"],logicalActionId:"read-result",occurrence:1,logicalSessionId:"synthetic-session",state:"failed"};
      const before=rawState(f.path);
      assert.deepEqual(resolveOperationSource({...deps,canonical,stateRoot:f.root},run.envelope.runId,{identity}),
        {state:"unavailable",reason:"exact-occurrence-not-retained"});
      assert.throws(()=>resolveOperationSource({...deps,canonical,stateRoot:f.root},run.envelope.runId,{identity:{...identity,runId:id(999)}}),/operation-source-run-unavailable/u);
      assert.equal(rawState(f.path),before);
    }finally{await f.dispose();}
  });
});
