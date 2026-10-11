import { copyFileSync as copyFileSync_m1,existsSync as existsSync_m0,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m0,DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,expect as expect_m0,expect as expect_m1,it as it_m0,it as it_m1,vi } from "vitest";
import { composeWorkerRuntime as composeWorkerRuntime_m1 } from "../../../../src/backend/app/composition/worker-compose.js";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m1 } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission as RuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityBootStore as AuthorityBootStore_m0,AuthorityBootStore as AuthorityBootStore_m1 } from "../../../../src/backend/storage/sqlite/authority-boot.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readAppSettings as readAppSettings_m1 } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { hostConfigFacts as hostConfigFacts_m1 } from "../../../../src/models/config/host-display.js";
import { SettingsCurrentRecordSchema as SettingsCurrentRecordSchema_m1 } from "../../../../src/models/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m1,derivePersistedSettingsFingerprint as derivePersistedSettingsFingerprint_m1,deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m1,initialSettingsFileRecord as initialSettingsFileRecord_m1 } from "../../../../src/models/config/settings.js";
import { CommandAuditRecordSchema as CommandAuditRecordSchema_m1,CommandRequestSchema as CommandRequestSchema_m1,deriveSettingsCommandFingerprint as deriveSettingsCommandFingerprint_m1 } from "../../../../src/rules/commands/commands.js";
import { capturedInstantClock as capturedInstantClock_m1 } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex as sha256Hex_m1 } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m0,LATER as LATER_m1,NOW as NOW_m1,UUID_1 as UUID_1_m1,UUID_2 as UUID_2_m1,UUID_3 as UUID_3_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const effects=vi.hoisted(()=>({credentials:0,browsers:0}));
vi.mock("../../../../src/backend/storage/configuration/credential-store.js",async()=>{
  const actual=await vi.importActual<typeof import("../../../../src/backend/storage/configuration/credential-store.js")>("../../../../src/backend/storage/configuration/credential-store.js");
  return {...actual,createCredentialStore:(...args:Parameters<typeof actual.createCredentialStore>)=>{effects.credentials+=1;return actual.createCredentialStore(...args);}};
});

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

  it_m0("creates native schema one and reopens with genuine baseline evidence",()=>{
    const f=fixture();const authority=f.open();
    expect_m0(authority.getMeta()).toMatchObject({schemaVersion:1,authorityGeneration:0});
    expect_m0(authority.readUpgradePhases()).toMatchObject({state:"available",phases:[{phase:"baseline",fromSchemaVersion:0,toSchemaVersion:1}]});
    authority.close();
    const reopened=f.open();expect_m0(reopened.getMeta().schemaVersion).toBe(1);reopened.close();
    const db=new DatabaseSync_m0(f.path,{readOnly:true});
    try { expect_m0(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).toHaveLength(34); }
    finally {db.close();}
  });
  it_m0("keeps initialization, nested rollback, publication generation and after-commit callbacks atomic",()=>{
    const f=fixture();const authority=f.open();const callbacks:string[]=[];
    authority.withAuthorityTransaction(repositories=>{
      expect_m0(()=>authority.withAuthorityTransaction(nested=>{
        nested.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
        authority.afterAuthorityCommit(()=>callbacks.push("rolled-back"));
        throw new Error("injected-nested-rollback");
      })).toThrow("injected-nested-rollback");
      expect_m0(repositories.runtimeConfig.get()).toBeUndefined();
      expect_m0(repositories.configSnapshots.get(CONFIG_SNAPSHOT_m0.configSnapshotId)).toBeUndefined();
      repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
      authority.afterAuthorityCommit(()=>callbacks.push("committed"));
      expect_m0(callbacks).toEqual([]);
    });
    expect_m0(callbacks).toEqual(["committed"]);
    expect_m0(authority.getMeta().authorityGeneration).toBe(1);
    expect_m0(authority.authority.settingsCurrent.get()).toBeUndefined();
    expect_m0(authority.authority.runtimeConfig.get()?.configSnapshotId).toBe(CONFIG_SNAPSHOT_m0.configSnapshotId);
    authority.close();
    const reopened=f.open();expect_m0(reopened.authority.runtimeConfig.get()?.configSnapshotId).toBe(CONFIG_SNAPSHOT_m0.configSnapshotId);reopened.close();
    const db=new DatabaseSync_m0(f.path,{readOnly:true});
    try {expect_m0(db.prepare("SELECT * FROM commands").all()).toHaveLength(1);
      expect_m0(db.prepare("SELECT * FROM command_audits").all()).toHaveLength(1);
      expect_m0(db.prepare("SELECT authority_generation,search_generation,search_state FROM database_states").get())
        .toEqual({authority_generation:1,search_generation:1,search_state:"ready"});}
    finally {db.close();}
  });
  it_m0("refuses a current header whose index or immutable-evidence trigger is missing",()=>{
    for(const object of ["DROP INDEX run_search_workflow_idx","DROP TRIGGER write_attempts_immutable"]) {
      const f=fixture();f.open().close();const db=new DatabaseSync_m0(f.path);db.exec(object);db.close();
      expect_m0(f.open).toThrow(/authority-native-schema-shape-mismatch/u);
    }
  });
});

describe_m0("real native authority boot", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("boots an absent native path and reopens the exact initialized owner without mocks", () => {
    const f = fixture();
    const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-boot-positive" };
    expect_m0(existsSync_m0(f.path)).toBe(false);
    const fresh = AuthorityBootStore_m0.open(f.admission, options);
    try {
      expect_m0(fresh.report()).toMatchObject({ state: "healthy", mutationAvailability: "available" });
      const authority = fresh.requireWritable("enqueue");
      expect_m0(authority.getMeta()).toMatchObject({ schemaVersion: 1, authorityGeneration: 0 });
      authority.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
      expect_m0(authority.getMeta().authorityGeneration).toBe(1);
    } finally { fresh.close(); }
    expect_m0(existsSync_m0(f.path)).toBe(true);
    const existing = AuthorityBootStore_m0.open(f.admission, options);
    try {
      expect_m0(existing.report()).toMatchObject({ state: "healthy", mutationAvailability: "available" });
      const authority = existing.requireWritable("claim");
      expect_m0(authority.getMeta()).toMatchObject({ schemaVersion: 1, authorityGeneration: 1 });
      expect_m0(authority.authority.configSnapshots.get(CONFIG_SNAPSHOT_m0.configSnapshotId)).toEqual(CONFIG_SNAPSHOT_m0);
      expect_m0(authority.authority.runtimeConfig.get()?.configFingerprint).toBe(CONFIG_SNAPSHOT_m0.fingerprint);
    } finally { existing.close(); }
  });
});

describe_m0("authority boot handle ownership after second inspection",()=>{
afterEach_m0(_afterEachFixture0);

  it_m0.each([false,true])("closes the opened handle and retains a failed-close handle for explicit retry: %s",closeFault=>{
    const f=fixture();const originalOpen=AuthorityDatabase_m0.open.bind(AuthorityDatabase_m0);
    let opened:AuthorityDatabase_m0|undefined;let closes=0;let failClose=closeFault;
    vi.spyOn(AuthorityDatabase_m0,"open").mockImplementation((...args)=>{
      const database=originalOpen(...args);opened=database;
      const originalClose=database.close.bind(database);
      vi.spyOn(database,"close").mockImplementation(()=>{closes+=1;if(failClose)throw new Error("injected-close-fault");originalClose();});
      return database;
    });
    vi.spyOn(AuthorityDatabase_m0,"inspectExistingReadOnly").mockImplementation(()=>{throw new Error("injected-second-inspection-fault");});
    const boot=AuthorityBootStore_m0.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"boot-handle-proof"});
    try{
      expect_m0(opened).toBeDefined();expect_m0(closes).toBe(1);
      expect_m0(boot.report().state).toBe("degraded-read-only");
      expect_m0(()=>boot.requireWritable("claim")).toThrow(/unavailable/u);
      if(closeFault){
        const report=boot.report();if(report.state!=="degraded-read-only")throw new Error("fixture boot not degraded");
        expect_m0(report.cause.summary).toMatch(/close is uncertain/u);
        expect_m0(()=>boot.close()).toThrow("injected-close-fault");expect_m0(closes).toBe(2);
        failClose=false;boot.close();expect_m0(closes).toBe(3);
      }else{boot.close();expect_m0(closes).toBe(1);}
    }finally{failClose=false;boot.close();}
  });
});
}

{
const cleanups:(()=>void)[]=[];
const _afterEachFixture0 = ()=>{effects.credentials=0;effects.browsers=0;for(const cleanup of cleanups.splice(0))cleanup();};
function fixture() {
  const root=realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(),"relay-native-snapshot-"))),stateRoot=join_m1(root,rebuildRuntimeIsolation_m1.stateRoot);
  copyFileSync_m1("package.json",join_m1(root,"package.json"));
  mkdirSync_m1(join_m1(root,rebuildRuntimeIsolation_m1.processLockRoot),{recursive:true,mode:0o700});
  mkdirSync_m1(stateRoot,{recursive:true,mode:0o700});const path=join_m1(stateRoot,"state.db");
  const admission=RuntimeAdmission_m1.syntheticFixture(path),clock=capturedInstantClock_m1(NOW_m1);
  const resolved=resolveConfigWithProvenance_m1(initialSettingsFileRecord_m1().settings,hostConfigFacts_m1({}),clock,
    {stateRoot,artifactRoot:join_m1(root,rebuildRuntimeIsolation_m1.artifactRoot)});
  const snapshot={configSnapshotId:UUID_1_m1,revision:1,fingerprint:resolved.fingerprint,capturedAt:NOW_m1,capturedBy:"local-operator",config:resolved.config,provenance:resolved.provenance};
  const options={path,busyTimeoutMs:5000,migrationOwner:"native-snapshot-proof"};
  const database=AuthorityDatabase_m1.open(admission,options,clock);database.authority.runtimeConfig.initialize(snapshot);database.close();
  cleanups.push(()=>{admission.release();rmSync_m1(root,{recursive:true,force:true});});
  return {root,admission,clock,snapshot,options,path};
}
function applySettings(f:ReturnType<typeof fixture>){
  const database=AuthorityDatabase_m1.open(f.admission,f.options,f.clock);
  try{return database.withAuthorityTransaction(repositories=>{
    const patch={"browser.headless":{set:false}};
    const command=CommandRequestSchema_m1.parse({commandId:UUID_2_m1,requestedAt:NOW_m1,requestedBy:"local-operator",source:"dashboard",family:"settings",type:"apply-settings",
      target:{expectedRevision:1},payload:{settingsSchemaHash:SETTINGS_SCHEMA_HASH_m1,patchFingerprint:deriveSettingsPatchFingerprint_m1(patch),patch}});
    const settings={browser:{headless:false}},settingsFingerprint=derivePersistedSettingsFingerprint_m1(settings),target={family:"settings",revision:2};
    const audit=CommandAuditRecordSchema_m1.parse({auditId:UUID_3_m1,request:command,result:{state:"applied",commandId:UUID_2_m1,affectedTargets:[target],restartRequired:true,settingsRevision:2,settingsFingerprint},
      completedAt:LATER_m1,versionChanges:[{target,before:1,after:2}],affectedDependencyIds:[]});
    repositories.commands.insert(command);repositories.commandAudits.insert(audit);
    const saved=SettingsCurrentRecordSchema_m1.parse({revision:2,settings,settingsFingerprint,commandId:UUID_2_m1,commandFingerprint:deriveSettingsCommandFingerprint_m1(command),auditId:UUID_3_m1,committedAt:LATER_m1});
    expect_m1(repositories.settingsCurrent.advance(saved)).toEqual(saved);return saved;
  });}finally{database.close();}
}
describe_m1("native selected configuration proof",()=>{
afterEach_m1(_afterEachFixture0);

  it_m1("reads and reopens exact unchanged config bytes through genuine initialized command/audit/snapshot links",()=>{
    const f=fixture();const database=AuthorityDatabase_m1.open(f.admission,f.options,f.clock);
    try {
      expect_m1(database.authority.configSnapshots.get(UUID_1_m1)).toEqual(f.snapshot);
      expect_m1(database.authority.runtimeConfig.get()?.configFingerprint).toBe(sha256Hex_m1(canonicalJsonStringify_m1(f.snapshot.config)));
      expect_m1(database.authority.settingsCurrent.get()).toBeUndefined();
    } finally {database.close();}
    const boot=AuthorityBootStore_m1.open(f.admission,f.options,f.clock);try{expect_m1(boot.report().state).toBe("healthy");}finally{boot.close();}
  });
  it_m1("refuses an otherwise-valid changed selected body with untouched saved fingerprint/links before credentials, browser or worker admission",async()=>{
    const f=fixture();effects.credentials=0;const raw=new DatabaseSync_m1(f.path);
    try {
      const trigger=raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='settings_snapshots_immutable'").get();
      expect_m1(typeof trigger?.sql).toBe("string");
      raw.exec("DROP TRIGGER settings_snapshots_immutable");
      raw.prepare("UPDATE settings_snapshots SET payload_json=json_set(payload_json,'$.config.browser.headless',json(?))").run(JSON.stringify(!f.snapshot.config.browser.headless));
      if(typeof trigger?.sql!=="string")throw new Error("missing immutable snapshot trigger");
      raw.exec(trigger.sql);
    } finally {raw.close();}
    const boot=AuthorityBootStore_m1.open(f.admission,f.options,f.clock);
    try {expect_m1(boot.report()).toMatchObject({state:"degraded-read-only",mutationAvailability:"blocked",cause:{code:"authority-record-invalid"}});
      expect_m1(()=>boot.requireWritable("claim")).toThrow(/unavailable/u);
    }finally{boot.close();}
    expect_m1(effects.credentials).toBe(0);
    await expect_m1(composeWorkerRuntime_m1({admission:f.admission,isolation:rebuildRuntimeIsolation_m1,args:["person-lookup","--pool-index","1","--drain"],
      repoRoot:f.root,clock:f.clock,env:{},sessionFactory:{open:async()=>{effects.browsers+=1;throw new Error("unrequested browser effect");}}})).rejects.toThrow(/config-snapshot-fingerprint-mismatch/u);
    expect_m1(effects).toEqual({credentials:0,browsers:0});
    const read=new DatabaseSync_m1(f.path,{readOnly:true});try {
      expect_m1(read.prepare("SELECT * FROM worker_slots").all()).toEqual([]);expect_m1(read.prepare("SELECT * FROM worker_leases").all()).toEqual([]);
    }finally{read.close();}
  });
  it_m1("admits an unchanged genuine saved revision with its exact ordinary command and audit",()=>{
    const f=fixture(),saved=applySettings(f);
    const database=AuthorityDatabase_m1.open(f.admission,f.options,f.clock);
    try{expect_m1(database.authority.settingsCurrent.get()).toEqual(saved);}finally{database.close();}
    const boot=AuthorityBootStore_m1.open(f.admission,f.options,f.clock);try{expect_m1(boot.report().state).toBe("healthy");}finally{boot.close();}
  });
  it_m1.each(["wrong-links","missing-current"])("refuses contradictory saved settings at inspection/open/boot before credential effects: %s",fault=>{
    const f=fixture();applySettings(f);const raw=new DatabaseSync_m1(f.path);
    try{
      const app=readAppSettings_m1(raw);expect_m1(app?.saved).toBeDefined();if(app===undefined)throw new Error("fixture settings missing");
      if(fault==="missing-current")raw.exec("DELETE FROM settings");
      else raw.prepare("UPDATE settings SET command_id=?,audit_id=?,payload_json=json_set(payload_json,'$.saved.commandId',?,'$.saved.auditId',?) WHERE id='current'")
        .run(app.initialization.commandId,app.initialization.auditId,app.initialization.commandId,app.initialization.auditId);
    }finally{raw.close();}
    effects.credentials=0;
    expect_m1(()=>AuthorityDatabase_m1.inspectExistingReadOnly(f.admission,f.path,250)).toThrow(/settings.*failed native record validation/u);
    expect_m1(()=>AuthorityDatabase_m1.open(f.admission,f.options,f.clock)).toThrow(/settings.*failed native record validation/u);
    const boot=AuthorityBootStore_m1.open(f.admission,f.options,f.clock);
    try{expect_m1(boot.report()).toMatchObject({state:"degraded-read-only",mutationAvailability:"blocked"});expect_m1(()=>boot.requireWritable("claim")).toThrow(/unavailable/u);}finally{boot.close();}
    expect_m1(effects.credentials).toBe(0);
  });

});
}
