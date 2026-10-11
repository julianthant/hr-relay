import assert_m1 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { DatabaseSync as DatabaseSync_m0 } from "node:sqlite";
import { afterEach as afterEach_m0,describe as describe_m0,describe as describe_m1,expect as expect_m0,it as it_m0,it as it_m1,vi } from "vitest";
import { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../src/backend/storage/sqlite/authority-database.js";
import { RunInputStorageSchema as RunInputStorageSchema_m1,RunRecordSchema as RunRecordSchema_m0 } from "../../../src/models/run/record.js";
import { SchemaBoundCanonicalValueSchema as SchemaBoundCanonicalValueSchema_m1 } from "../../../src/models/validation/schema-bound-value.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m0 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m0 } from "../../support/fixtures/phase1f-run-fixtures.js";


{

const roots:string[]=[];
const _afterEachFixture0 = ()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync_m0(root,{recursive:true,force:true});};
function fixture() {
  const root=mkdtempSync_m0(join_m0(tmpdir_m0(),"relay-native-authority-"));roots.push(root);
  const path=join_m0(root,"authority.sqlite");
  const admission=RuntimeAdmission_m0.syntheticFixture(path);
  const open=()=>AuthorityDatabase_m0.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"});
  return {path,open,admission};
}
describe_m0("native authority admission",()=>{
afterEach_m0(_afterEachFixture0);

  it_m0("admits complete run rows and publishes the derived search generation atomically",()=>{
    const f=fixture();const authority=f.open();
    authority.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
    const run=RunRecordSchema_m0.parse({...QUEUED_RUN_m0,envelope:{...QUEUED_RUN_m0.envelope,configSnapshotId:CONFIG_SNAPSHOT_m0.configSnapshotId,
      configFingerprint:CONFIG_SNAPSHOT_m0.fingerprint},runNumber:1});
    expect_m0(authority.authority.runs.enqueue(run)).toEqual({state:"inserted",record:run});
    expect_m0(authority.authority.runs.enqueue(run)).toEqual({state:"existing",record:run});
    expect_m0(authority.getMeta().authorityGeneration).toBe(2);
    expect_m0(authority.authority.runs.get(run.envelope.runId)).toEqual(run);
    expect_m0(authority.authority.runs.nextItemAttempt({workflow:run.envelope.workflow,itemId:run.envelope.itemId})).toBe(2);
    expect_m0(authority.authority.runs.nextWorkflowRunNumber(run.envelope.workflow)).toBe(2);
    authority.close();
    const reopened=f.open();expect_m0(reopened.authority.runs.get(run.envelope.runId)).toEqual(run);reopened.close();
    const db=new DatabaseSync_m0(f.path,{readOnly:true});
    try {expect_m0(db.prepare("SELECT authority_generation,search_generation,search_state FROM database_states").get())
      .toEqual({authority_generation:2,search_generation:2,search_state:"ready"});
      expect_m0(db.prepare("SELECT source_version,declaration_json FROM run_search").get()).toEqual({source_version:1,declaration_json:null});}
    finally {db.close();}
  });
});
}

{

const marker = {kind:"legacy-protected-input",inputPath:"timekeeperName",name:"timekeeperName"};

describe_m1("current private protected origins and public projections", () => {
  it_m1("requires persisted input classification while ordinary output metadata remains optional",()=>{
    const value={schemaHash:"a".repeat(64),value:{eid:"Synthetic public identifier"}};
    assert_m1.equal(SchemaBoundCanonicalValueSchema_m1.safeParse(value).success,true);
    const input={raw:value.value,parsed:value,ingressSchemaHash:"b".repeat(64)};
    assert_m1.equal(RunInputStorageSchema_m1.safeParse(input).success,false);
    assert_m1.equal(RunInputStorageSchema_m1.safeParse({...input,parsed:{...value,protectedBindings:[]}}).success,true);
    assert_m1.equal(RunInputStorageSchema_m1.safeParse({...input,parsed:{...value,protectedBindings:[marker]}}).success,false);
  });
});
}
