import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { requireActivityPersonPseudonymDomain } from "../../src/domain/secrets.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,TERMINAL_SEPARATIONS_RUN,seedTerminalSeparationsResult } from "./fixtures/activity-person-pseudonym-fixtures.js";

const runId=TERMINAL_SEPARATIONS_RUN.envelope.runId;
const domain=createActivityPersonPseudonymDomain({keyGeneration:"activity-person-g1",keyHex:ACTIVITY_PERSON_PSEUDONYM_KEY_HEX});
it("retains the reviewed historical HMAC derivation without activating a runtime writer",()=>{
  assert.deepEqual(domain.deriveEvidence({runId,workflowId:"separations",canonicalSubject:"10873698"}),{
    runId,workflowId:"separations",keyGeneration:"activity-person-g1",
    pseudonym:"010d6acdd7e42d681de6849d727d0afca66a6a0f8ce82b8df48fd768b3f9d8f2",derivation:"hmac-sha-256/activity-person/v1",
  });
});
it.each(["missing","invalid","valid"])("refuses retired secret composition before reading %s key material",()=>{
  let reads=0;
  assert.throws(()=>requireActivityPersonPseudonymDomain({read:()=>{reads++;throw new Error("secret-must-not-be-read");}}),/^Error: activity-person-pseudonyms-retired$/u);
  assert.equal(reads,0);
});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"pseudonym-retirement-")),path=join(root,"state.db");
  const db=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"pseudonym-retirement"},manualClock(new Date("2026-08-28T20:00:00Z")));
  return {path,db,dispose:()=>{db.close();rmSync(root,{recursive:true,force:true});}};
}
it("exposes no minting method and refuses all former readers, including an empty batch",()=>{
  const f=fixture();try{
    const repository=f.db.authority.activityPersonPseudonyms,before=f.db.getMeta();
    assert.equal(Reflect.has(repository,"insert"),false);
    for(const read of [()=>repository.get(runId,"activity-person-g1"),()=>repository.listByRun(runId),()=>repository.listByRuns([runId]),()=>repository.listByRuns([])])assert.throws(read,/activity-person-pseudonyms-retired/u);
    assert.deepEqual(f.db.getMeta(),before);
  }finally{f.dispose();}
});
it.each(["authentic","same-generation-changed-key","rotated-generation","forged-capability"])("refuses %s backfill before any derivation or authority mutation",variant=>{
  const f=fixture();try {
    seedTerminalSeparationsResult(f.db,f.path);
    const before=f.db.getMeta(),run=f.db.authority.runs.get(runId),person=f.db.canonicalPerson(runId);
    const selected=createActivityPersonPseudonymDomain({keyGeneration:variant==="rotated-generation"?"activity-person-g2":"activity-person-g1",keyHex:variant==="same-generation-changed-key"?"f".repeat(64):ACTIVITY_PERSON_PSEUDONYM_KEY_HEX});
    const capability=variant==="forged-capability"?{...selected,deriveEvidence:()=>{throw new Error("forged-derivation-ran");}}:selected;
    assert.throws(()=>f.db.createActivityPersonPseudonymBackfillWriteCapability(capability),/activity-person-pseudonyms-retired/u);
    assert.deepEqual(f.db.getMeta(),before);assert.deepEqual(f.db.authority.runs.get(runId),run);assert.deepEqual(f.db.canonicalPerson(runId),person);
    assert.equal(person.state,"available");
  }finally{f.dispose();}
});
it.each(["activity_person_pseudonyms","activity_person_pseudonym_generations"])("has no %s rows to update, delete or replace",table=>{
  const f=fixture();try {
    const raw=new DatabaseSync(f.path);try {
      assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),undefined);
      raw.exec("PRAGMA recursive_triggers=OFF");
      for(const sql of [`UPDATE ${table} SET record_json='{}'`,`DELETE FROM ${table}`,`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`])assert.throws(()=>raw.exec(sql),/no such table/u);
    }finally{raw.close();}
  }finally{f.dispose();}
});
