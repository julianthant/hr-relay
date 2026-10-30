import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityBootStore } from "../../../../src/backend/storage/sqlite/authority-boot.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { SettingsCurrentRecordSchema } from "../../../../src/models/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, deriveSettingsPatchFingerprint, initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { CommandAuditRecordSchema, CommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT, LATER, NOW, UUID_1, UUID_2, UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const effects=vi.hoisted(()=>({credentials:0,browsers:0}));
vi.mock("../../../../src/backend/storage/configuration/credential-store.js",async()=>{
  const actual=await vi.importActual<typeof import("../../../../src/backend/storage/configuration/credential-store.js")>("../../../../src/backend/storage/configuration/credential-store.js");
  return {...actual,createCredentialStore:(...args:Parameters<typeof actual.createCredentialStore>)=>{effects.credentials+=1;return actual.createCredentialStore(...args);}};
});

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

  it("creates the current native schema and reopens with genuine baseline evidence",()=>{
    const f=fixture();const authority=f.open();
    expect(authority.getMeta()).toMatchObject({schemaVersion:6,authorityGeneration:0});
    expect(authority.readUpgradePhases()).toMatchObject({state:"available",phases:[{phase:"baseline",fromSchemaVersion:0,toSchemaVersion:6}]});
    authority.close();
    const reopened=f.open();expect(reopened.getMeta().schemaVersion).toBe(6);reopened.close();
    const db=new DatabaseSync(f.path,{readOnly:true});
    try { expect(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).toHaveLength(36); }
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
  it("refuses a current header whose index or immutable-evidence trigger is missing",()=>{
    for(const object of ["DROP INDEX run_search_workflow_idx","DROP TRIGGER write_attempts_immutable"]) {
      const f=fixture();f.open().close();const db=new DatabaseSync(f.path);db.exec(object);db.close();
      expect(f.open).toThrow(/authority-native-schema-shape-mismatch/u);
    }
  });
});

describe("real native authority boot", () => {
afterEach(_afterEachFixture0);

  it("boots an absent native path and reopens the exact initialized owner without mocks", () => {
    const f = fixture();
    const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-boot-positive" };
    expect(existsSync(f.path)).toBe(false);
    const fresh = AuthorityBootStore.open(f.admission, options);
    try {
      expect(fresh.report()).toMatchObject({ state: "healthy", mutationAvailability: "available" });
      const authority = fresh.requireWritable("enqueue");
      expect(authority.getMeta()).toMatchObject({ schemaVersion: 6, authorityGeneration: 0 });
      authority.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      expect(authority.getMeta().authorityGeneration).toBe(1);
    } finally { fresh.close(); }
    expect(existsSync(f.path)).toBe(true);
    const existing = AuthorityBootStore.open(f.admission, options);
    try {
      expect(existing.report()).toMatchObject({ state: "healthy", mutationAvailability: "available" });
      const authority = existing.requireWritable("claim");
      expect(authority.getMeta()).toMatchObject({ schemaVersion: 6, authorityGeneration: 1 });
      expect(authority.authority.configSnapshots.get(CONFIG_SNAPSHOT.configSnapshotId)).toEqual(CONFIG_SNAPSHOT);
      expect(authority.authority.runtimeConfig.get()?.configFingerprint).toBe(CONFIG_SNAPSHOT.fingerprint);
    } finally { existing.close(); }
  });
});

describe("authority boot handle ownership after second inspection",()=>{
afterEach(_afterEachFixture0);

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
}

{
const cleanups:(()=>Promise<void>)[]=[];
const _afterEachFixture0 = async()=>{effects.credentials=0;effects.browsers=0;for(const cleanup of cleanups.splice(0))await cleanup();};
async function fixture() {
  const profile=await createBoundProfileFixture(),root=profile.workspace,stateRoot=profile.stateRoot;
  cleanups.push(()=>profile.close());
  copyFileSync("package.json",join(root,"package.json"));
  const path=profile.path;
  const admission=profile.admission,clock=capturedInstantClock(NOW);
  const resolved=resolveConfigWithProvenance(initialSettingsFileRecord().settings,hostConfigFacts({}),clock,
    {stateRoot,artifactRoot:profile.admission.artifactRoot});
  const snapshot={configSnapshotId:UUID_1,revision:1,fingerprint:resolved.fingerprint,capturedAt:NOW,capturedBy:"local-operator",config:resolved.config,provenance:resolved.provenance};
  const options={path,busyTimeoutMs:5000,migrationOwner:"native-snapshot-proof"};
  const database=AuthorityDatabase.open(admission,options,clock);
  try{database.authority.runtimeConfig.initialize(snapshot);}finally{database.close();}
  effects.credentials=0;
  return {root,admission,machine:profile.machine,lifetime:profile.lifetime,clock,snapshot,options,path};
}
function applySettings(f:Awaited<ReturnType<typeof fixture>>){
  const database=AuthorityDatabase.open(f.admission,f.options,f.clock);
  try{return database.withAuthorityTransaction(repositories=>{
    const patch={"browser.headless":{set:false}};
    const command=CommandRequestSchema.parse({commandId:UUID_2,requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",family:"settings",type:"apply-settings",
      target:{expectedRevision:1},payload:{settingsSchemaHash:SETTINGS_SCHEMA_HASH,patchFingerprint:deriveSettingsPatchFingerprint(patch),patch}});
    const settings={browser:{headless:false}},settingsFingerprint=derivePersistedSettingsFingerprint(settings),target={family:"settings",revision:2};
    const audit=CommandAuditRecordSchema.parse({auditId:UUID_3,request:command,result:{state:"applied",commandId:UUID_2,affectedTargets:[target],restartRequired:true,settingsRevision:2,settingsFingerprint},
      completedAt:LATER,versionChanges:[{target,before:1,after:2}],affectedDependencyIds:[]});
    repositories.commands.insert(command);repositories.commandAudits.insert(audit);
    const saved=SettingsCurrentRecordSchema.parse({revision:2,settings,settingsFingerprint,commandId:UUID_2,commandFingerprint:deriveSettingsCommandFingerprint(command),auditId:UUID_3,committedAt:LATER});
    expect(repositories.settingsCurrent.advance(saved)).toEqual(saved);return saved;
  });}finally{database.close();}
}
describe("native selected configuration proof",()=>{
afterEach(_afterEachFixture0);

  it("reads and reopens exact unchanged config bytes through genuine initialized command/audit/snapshot links",async()=>{
    const f=await fixture();const database=AuthorityDatabase.open(f.admission,f.options,f.clock);
    try {
      expect(database.authority.configSnapshots.get(UUID_1)).toEqual(f.snapshot);
      expect(database.authority.runtimeConfig.get()?.configFingerprint).toBe(sha256Hex(canonicalJsonStringify(f.snapshot.config)));
      expect(database.authority.settingsCurrent.get()).toBeUndefined();
    } finally {database.close();}
    const boot=AuthorityBootStore.open(f.admission,f.options,f.clock);try{expect(boot.report().state).toBe("healthy");}finally{boot.close();}
  });
  it("refuses an otherwise-valid changed selected body with untouched saved fingerprint/links before credentials, browser or worker admission",async()=>{
    const f=await fixture();effects.credentials=0;const raw=new DatabaseSync(f.path);
    try {
      const trigger=raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='settings_snapshots_immutable'").get();
      expect(typeof trigger?.sql).toBe("string");
      raw.exec("DROP TRIGGER settings_snapshots_immutable");
      raw.prepare("UPDATE settings_snapshots SET payload_json=json_set(payload_json,'$.config.browser.headless',json(?))").run(JSON.stringify(!f.snapshot.config.browser.headless));
      if(typeof trigger?.sql!=="string")throw new Error("missing immutable snapshot trigger");
      raw.exec(trigger.sql);
    } finally {raw.close();}
    const boot=AuthorityBootStore.open(f.admission,f.options,f.clock);
    try {expect(boot.report()).toMatchObject({state:"degraded-read-only",mutationAvailability:"blocked",cause:{code:"authority-record-invalid"}});
      expect(()=>boot.requireWritable("claim")).toThrow(/unavailable/u);
    }finally{boot.close();}
    expect(effects.credentials).toBe(0);
    await expect(composeWorkerRuntime({ lifetimeLock:f.lifetime,admission:f.machine,isolation:rebuildRuntimeIsolation,args:["person-lookup","--pool-index","1","--drain"],
      repoRoot:f.root,clock:f.clock,env:{},sessionFactory:{ probeProfile: async () => undefined,open:async()=>{effects.browsers+=1;throw new Error("unrequested browser effect");}}})).rejects.toThrow(/config-snapshot-fingerprint-mismatch/u);
    expect(effects).toEqual({credentials:0,browsers:0});
    const read=new DatabaseSync(f.path,{readOnly:true});try {
      expect(read.prepare("SELECT * FROM worker_slots").all()).toEqual([]);expect(read.prepare("SELECT * FROM worker_leases").all()).toEqual([]);
    }finally{read.close();}
  });
  it("admits an unchanged genuine saved revision with its exact ordinary command and audit",async()=>{
    const f=await fixture(),saved=applySettings(f);
    const database=AuthorityDatabase.open(f.admission,f.options,f.clock);
    try{expect(database.authority.settingsCurrent.get()).toEqual(saved);}finally{database.close();}
    const boot=AuthorityBootStore.open(f.admission,f.options,f.clock);try{expect(boot.report().state).toBe("healthy");}finally{boot.close();}
  });
  it.each(["wrong-links","missing-current"])("refuses contradictory saved settings at inspection/open/boot before credential effects: %s",async fault=>{
    const f=await fixture();applySettings(f);const raw=new DatabaseSync(f.path);
    try{
      const app=readAppSettings(raw);expect(app?.saved).toBeDefined();if(app===undefined)throw new Error("fixture settings missing");
      if(fault==="missing-current")raw.exec("DELETE FROM settings");
      else raw.prepare("UPDATE settings SET command_id=?,audit_id=?,payload_json=json_set(payload_json,'$.saved.commandId',?,'$.saved.auditId',?) WHERE id='current'")
        .run(app.initialization.commandId,app.initialization.auditId,app.initialization.commandId,app.initialization.auditId);
    }finally{raw.close();}
    effects.credentials=0;
    expect(()=>AuthorityDatabase.inspectExistingReadOnly(f.admission,f.path,250)).toThrow(/settings.*failed native record validation/u);
    expect(()=>AuthorityDatabase.open(f.admission,f.options,f.clock)).toThrow(/settings.*failed native record validation/u);
    const boot=AuthorityBootStore.open(f.admission,f.options,f.clock);
    try{expect(boot.report()).toMatchObject({state:"degraded-read-only",mutationAvailability:"blocked"});expect(()=>boot.requireWritable("claim")).toThrow(/unavailable/u);}finally{boot.close();}
    expect(effects.credentials).toBe(0);
  });

});
}
