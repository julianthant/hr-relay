import { default as assert } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";
import { vi } from "vitest";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { RunInputStorageSchema } from "../../../src/models/run/record.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { SchemaBoundCanonicalValueSchema } from "../../../src/models/validation/schema-bound-value.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";

{

const roots:string[]=[];
const _afterEachFixture0 = ()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});};
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"relay-native-authority-"));roots.push(root);
  const path=join(root,"authority.sqlite");
  const admission=RuntimeAdmission.syntheticFixture(path);
  const open=()=>AuthorityDatabase.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"});
  return {path,open,admission};
}
describe("native authority admission",()=>{
afterEach(_afterEachFixture0);

  it("admits complete run rows and publishes the derived search generation atomically",()=>{
    const f=fixture();const authority=f.open();
    authority.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const run=RunRecordSchema.parse({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,
      configFingerprint:CONFIG_SNAPSHOT.fingerprint},runNumber:1});
    expect(authority.authority.runs.enqueue(run)).toEqual({state:"inserted",record:run});
    expect(authority.authority.runs.enqueue(run)).toEqual({state:"existing",record:run});
    expect(authority.getMeta().authorityGeneration).toBe(2);
    expect(authority.authority.runs.get(run.envelope.runId)).toEqual(run);
    expect(authority.authority.runs.nextItemAttempt({workflow:run.envelope.workflow,itemId:run.envelope.itemId})).toBe(2);
    expect(authority.authority.runs.nextWorkflowRunNumber(run.envelope.workflow)).toBe(2);
    authority.close();
    const reopened=f.open();expect(reopened.authority.runs.get(run.envelope.runId)).toEqual(run);reopened.close();
    const db=new DatabaseSync(f.path,{readOnly:true});
    try {expect(db.prepare("SELECT authority_generation,search_generation,search_state FROM database_states").get())
      .toEqual({authority_generation:2,search_generation:2,search_state:"ready"});
      expect(db.prepare("SELECT source_version,declaration_json FROM run_search").get()).toEqual({source_version:1,declaration_json:null});}
    finally {db.close();}
  });
});
}

{

const marker = {kind:"legacy-protected-input",inputPath:"timekeeperName",name:"timekeeperName"};

describe("current private protected origins and public projections", () => {
  it("requires persisted input classification while ordinary output metadata remains optional",()=>{
    const value={schemaHash:"a".repeat(64),value:{eid:"Synthetic public identifier"}};
    assert.equal(SchemaBoundCanonicalValueSchema.safeParse(value).success,true);
    const input={raw:value.value,parsed:value,ingressSchemaHash:"b".repeat(64)};
    assert.equal(RunInputStorageSchema.safeParse(input).success,false);
    assert.equal(RunInputStorageSchema.safeParse({...input,parsed:{...value,protectedBindings:[]}}).success,true);
    assert.equal(RunInputStorageSchema.safeParse({...input,parsed:{...value,protectedBindings:[marker]}}).success,false);
  });
});
}
