import assert from "node:assert/strict";
import { it } from "vitest";
import { deriveCanonicalPerson,deriveRunSummary } from "../../../../src/backend/runs/projections/run-summary.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema } from "../../../../src/models/run/result.js";
import { TERMINAL_SEPARATIONS_RESULT,TERMINAL_SEPARATIONS_RUN } from "../../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";

it("measures enqueue-to-end duration and keeps unknown warnings explicit", () => {
  const run=TERMINAL_SEPARATIONS_RUN;
  const row=deriveRunSummary({run,result:TERMINAL_SEPARATIONS_RESULT,receipt:null,failure:null,resolution:null,cursor:0,startedAt:null,queueTitle:null,children:[],dependencyRunIds:[]},1);
  assert.equal(row.durationMs,Date.parse(run.lifecycle.state === "terminal" ? run.lifecycle.endedAt : "")-Date.parse(run.envelope.enqueuedAt));
  assert.equal(row.warningCount,null);
  assert.equal(row.person.state,"available");
  assert.throws(()=>deriveCanonicalPerson(run,RunResultRecordSchema.parse({...TERMINAL_SEPARATIONS_RESULT,attempt:2})),/summary-result-identity-mismatch/);
});

it("keeps heartbeat-only derivation identity stable and notices presentation changes",async ()=>{
  const f=await foundationFixture();try {
    const source={run:f.run,result:null,receipt:null,failure:null,resolution:null,cursor:0,startedAt:null,queueTitle:null,children:[],dependencyRunIds:[]};
    const before=deriveRunSummary(source,1);
    assert.equal(before.durationMs,null);
    if(f.run.lifecycle.state!=="running")throw new Error("fixture-state");
    const renewed=RunRecordSchema.parse({...f.run,version:f.run.version+1,updatedAt:"2026-09-09T12:00:01.000Z",lifecycle:{...f.run.lifecycle,heartbeatAt:"2026-09-09T12:00:01.000Z"}});
    assert.equal(deriveRunSummary({...source,run:renewed},2).sourceDigest,before.sourceDigest);
    assert.notEqual(deriveRunSummary({...source,run:{...renewed,displayName:"Changed"}},2).sourceDigest,before.sourceDigest);
  }finally{await f.dispose();}
});

it("uses the local enqueue day across a UTC boundary without changing the instant",async ()=>{
  const f=await foundationFixture(),prior=process.env.TZ;
  try{
    const run=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,enqueuedAt:"2026-09-09T00:30:00.000Z"}});
    const source={run,result:null,receipt:null,failure:null,resolution:null,cursor:0,startedAt:null,queueTitle:null,children:[],dependencyRunIds:[]};
    process.env.TZ="UTC";assert.equal(deriveRunSummary(source,1).localDay,"2026-09-09");
    process.env.TZ="America/Los_Angeles";assert.equal(deriveRunSummary(source,1).localDay,"2026-09-08");
  }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;await f.dispose();}
});

import { cleanReceiptOf,receiptWithWarningsOf } from "../../../support/helpers/backend/dashboard-harness.js";
it("serves retained receipt warnings and distinguishes clean from warned modern receipts",()=>{
  const run=TERMINAL_SEPARATIONS_RUN;
  const source={run,result:TERMINAL_SEPARATIONS_RESULT,failure:null,resolution:null,cursor:0,startedAt:null,queueTitle:null,children:[],dependencyRunIds:[]};
  const clean={...cleanReceiptOf({seed:620,workflow:"separations"}),composition:5 as const};
  const warned={...receiptWithWarningsOf({seed:620,workflow:"separations",summaries:["Synthetic warning"]}),composition:5 as const};
  assert.equal(deriveRunSummary({...source,receipt:clean},1).warningCount,0);
  assert.ok((deriveRunSummary({...source,receipt:warned},1).warningCount??0)>0);
});
