import { AuthorityBootStore } from "../../../../../src/backend/storage/sqlite/authority-boot.js";
import { QUEUED_RUN } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { CONFIG_SNAPSHOT } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"relay-native-authority-"));roots.push(root);
  const path=join(root,"authority.sqlite");
  const admission=RuntimeAdmission.syntheticFixture(path);
  const open=()=>AuthorityDatabase.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"});
  return {path,open,admission};
}
describe("native authority admission",()=>{
  it("creates native schema one and reopens with genuine baseline evidence",()=>{
    const f=fixture();const authority=f.open();
    expect(authority.getMeta()).toMatchObject({schemaVersion:1,authorityGeneration:0});
    expect(authority.readUpgradePhases()).toMatchObject({state:"available",phases:[{phase:"baseline",fromSchemaVersion:0,toSchemaVersion:1}]});
    authority.close();
    const reopened=f.open();expect(reopened.getMeta().schemaVersion).toBe(1);reopened.close();
    const db=new DatabaseSync(f.path,{readOnly:true});
    try { expect(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).toHaveLength(34); }
    finally {db.close();}
  });
  it("keeps initialization, nested rollback, publication generation and after-commit callbacks atomic",()=>{
    const f=fixture();const authority=f.open();const callbacks:string[]=[];
    authority.withAuthorityTransaction(repositories=>{
      expect(()=>authority.withAuthorityTransaction(nested=>{
        nested.runtimeConfig.initialize(CONFIG_SNAPSHOT);
        authority.afterAuthorityCommit(()=>callbacks.push("rolled-back"));
        throw new Error("injected-nested-rollback");
      })).toThrow("injected-nested-rollback");
      expect(repositories.runtimeConfig.get()).toBeUndefined();
      expect(repositories.configSnapshots.get(CONFIG_SNAPSHOT.configSnapshotId)).toBeUndefined();
      repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      authority.afterAuthorityCommit(()=>callbacks.push("committed"));
      expect(callbacks).toEqual([]);
    });
    expect(callbacks).toEqual(["committed"]);
    expect(authority.getMeta().authorityGeneration).toBe(1);
    expect(authority.authority.settingsCurrent.get()).toBeUndefined();
    expect(authority.authority.runtimeConfig.get()?.configSnapshotId).toBe(CONFIG_SNAPSHOT.configSnapshotId);
    authority.close();
    const reopened=f.open();expect(reopened.authority.runtimeConfig.get()?.configSnapshotId).toBe(CONFIG_SNAPSHOT.configSnapshotId);reopened.close();
    const db=new DatabaseSync(f.path,{readOnly:true});
    try {expect(db.prepare("SELECT * FROM commands").all()).toHaveLength(1);
      expect(db.prepare("SELECT * FROM command_audits").all()).toHaveLength(1);
      expect(db.prepare("SELECT authority_generation,search_generation,search_state FROM database_states").get())
        .toEqual({authority_generation:1,search_generation:1,search_state:"ready"});}
    finally {db.close();}
  });
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
  it.each([0,2,48,99])("refuses version %i without rewriting its header or retained rows",version=>{
    const f=fixture();f.open().close();
    const db=new DatabaseSync(f.path);db.exec(`PRAGMA user_version=${String(version)}`);
    const baseline=db.prepare("SELECT * FROM database_upgrades").all();db.close();
    expect(f.open).toThrow(AuthoritySchemaVersionError);
    const after=new DatabaseSync(f.path,{readOnly:true});
    try {expect(after.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
      expect(after.prepare("SELECT * FROM database_upgrades").all()).toEqual(baseline);}
    finally {after.close();}
  });
  it("refuses a current header whose index or immutable-evidence trigger is missing",()=>{
    for(const object of ["DROP INDEX run_search_workflow_idx","DROP TRIGGER write_attempts_immutable"]) {
      const f=fixture();f.open().close();const db=new DatabaseSync(f.path);db.exec(object);db.close();
      expect(f.open).toThrow(/authority-native-schema-shape-mismatch/u);
    }
  });
});

describe("real native authority boot", () => {
  it("boots an absent native path and reopens the exact initialized owner without mocks", () => {
    const f = fixture();
    const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-boot-positive" };
    expect(existsSync(f.path)).toBe(false);
    const fresh = AuthorityBootStore.open(f.admission, options);
    try {
      expect(fresh.report()).toMatchObject({ state: "healthy", mutationAvailability: "available" });
      const authority = fresh.requireWritable("enqueue");
      expect(authority.getMeta()).toMatchObject({ schemaVersion: 1, authorityGeneration: 0 });
      authority.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      expect(authority.getMeta().authorityGeneration).toBe(1);
    } finally { fresh.close(); }
    expect(existsSync(f.path)).toBe(true);
    const existing = AuthorityBootStore.open(f.admission, options);
    try {
      expect(existing.report()).toMatchObject({ state: "healthy", mutationAvailability: "available" });
      const authority = existing.requireWritable("claim");
      expect(authority.getMeta()).toMatchObject({ schemaVersion: 1, authorityGeneration: 1 });
      expect(authority.authority.configSnapshots.get(CONFIG_SNAPSHOT.configSnapshotId)).toEqual(CONFIG_SNAPSHOT);
      expect(authority.authority.runtimeConfig.get()?.configFingerprint).toBe(CONFIG_SNAPSHOT.fingerprint);
    } finally { existing.close(); }
  });
});

describe("authority boot handle ownership after second inspection",()=>{
  it.each([false,true])("closes the opened handle and retains a failed-close handle for explicit retry: %s",closeFault=>{
    const f=fixture();const originalOpen=AuthorityDatabase.open.bind(AuthorityDatabase);
    let opened:AuthorityDatabase|undefined;let closes=0;let failClose=closeFault;
    vi.spyOn(AuthorityDatabase,"open").mockImplementation((...args)=>{
      const database=originalOpen(...args);opened=database;
      const originalClose=database.close.bind(database);
      vi.spyOn(database,"close").mockImplementation(()=>{closes+=1;if(failClose)throw new Error("injected-close-fault");originalClose();});
      return database;
    });
    vi.spyOn(AuthorityDatabase,"inspectExistingReadOnly").mockImplementation(()=>{throw new Error("injected-second-inspection-fault");});
    const boot=AuthorityBootStore.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"boot-handle-proof"});
    try{
      expect(opened).toBeDefined();expect(closes).toBe(1);
      expect(boot.report().state).toBe("degraded-read-only");
      expect(()=>boot.requireWritable("claim")).toThrow(/unavailable/u);
      if(closeFault){
        const report=boot.report();if(report.state!=="degraded-read-only")throw new Error("fixture boot not degraded");
        expect(report.cause.summary).toMatch(/close is uncertain/u);
        expect(()=>boot.close()).toThrow("injected-close-fault");expect(closes).toBe(2);
        failClose=false;boot.close();expect(closes).toBe(3);
      }else{boot.close();expect(closes).toBe(1);}
    }finally{failClose=false;boot.close();}
  });
});
