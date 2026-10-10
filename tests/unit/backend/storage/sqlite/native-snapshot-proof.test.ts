import { readAppSettings } from "../../../../../src/backend/storage/sqlite/settings-storage.js";
import { SettingsCurrentRecordSchema } from "../../../../../src/models/config/settings-current.js";
import { CommandRequestSchema,CommandAuditRecordSchema,deriveSettingsCommandFingerprint } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH,deriveSettingsPatchFingerprint,derivePersistedSettingsFingerprint } from "../../../../../src/models/config/settings.js";
import { mkdtempSync,realpathSync,rmSync,mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it,vi } from "vitest";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBootStore } from "../../../../../src/backend/storage/sqlite/authority-boot.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { composeWorkerRuntime } from "../../../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../../src/models/config/settings.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { capturedInstantClock } from "../../../../../src/rules/time/clock.js";
import { NOW,LATER,UUID_1,UUID_2,UUID_3 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const effects=vi.hoisted(()=>({credentials:0,browsers:0}));
vi.mock("../../../../../src/backend/storage/configuration/credential-store.js",async()=>{
  const actual=await vi.importActual<typeof import("../../../../../src/backend/storage/configuration/credential-store.js")>("../../../../../src/backend/storage/configuration/credential-store.js");
  return {...actual,createCredentialStore:(...args:Parameters<typeof actual.createCredentialStore>)=>{effects.credentials+=1;return actual.createCredentialStore(...args);}};
});
const cleanups:(()=>void)[]=[];
afterEach(()=>{effects.credentials=0;effects.browsers=0;for(const cleanup of cleanups.splice(0))cleanup();});
function fixture() {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"relay-native-snapshot-"))),stateRoot=join(root,rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot,{recursive:true,mode:0o700});const path=join(stateRoot,"state.db");
  const admission=RuntimeAdmission.syntheticFixture(path),clock=capturedInstantClock(NOW);
  const resolved=resolveConfigWithProvenance(initialSettingsFileRecord().settings,hostConfigFacts({}),clock,
    {stateRoot,artifactRoot:join(root,rebuildRuntimeIsolation.artifactRoot)});
  const snapshot={configSnapshotId:UUID_1,revision:1,fingerprint:resolved.fingerprint,capturedAt:NOW,capturedBy:"local-operator",config:resolved.config,provenance:resolved.provenance};
  const options={path,busyTimeoutMs:5000,migrationOwner:"native-snapshot-proof"};
  const database=AuthorityDatabase.open(admission,options,clock);database.authority.runtimeConfig.initialize(snapshot);database.close();
  cleanups.push(()=>{admission.release();rmSync(root,{recursive:true,force:true});});
  return {root,admission,clock,snapshot,options,path};
}
function applySettings(f:ReturnType<typeof fixture>){
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
  it("reads and reopens exact unchanged config bytes through genuine initialized command/audit/snapshot links",()=>{
    const f=fixture();const database=AuthorityDatabase.open(f.admission,f.options,f.clock);
    try {
      expect(database.authority.configSnapshots.get(UUID_1)).toEqual(f.snapshot);
      expect(database.authority.runtimeConfig.get()?.configFingerprint).toBe(sha256Hex(canonicalJsonStringify(f.snapshot.config)));
      expect(database.authority.settingsCurrent.get()).toBeUndefined();
    } finally {database.close();}
    const boot=AuthorityBootStore.open(f.admission,f.options,f.clock);try{expect(boot.report().state).toBe("healthy");}finally{boot.close();}
  });
  it("refuses an otherwise-valid changed selected body with untouched saved fingerprint/links before credentials, browser or worker admission",async()=>{
    const f=fixture();effects.credentials=0;const raw=new DatabaseSync(f.path);
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
    await expect(composeWorkerRuntime({admission:f.admission,isolation:rebuildRuntimeIsolation,args:["person-lookup","--pool-index","1","--drain"],
      repoRoot:f.root,clock:f.clock,env:{},sessionFactory:{open:async()=>{effects.browsers+=1;throw new Error("unrequested browser effect");}}})).rejects.toThrow(/config-snapshot-fingerprint-mismatch/u);
    expect(effects).toEqual({credentials:0,browsers:0});
    const read=new DatabaseSync(f.path,{readOnly:true});try {
      expect(read.prepare("SELECT * FROM worker_slots").all()).toEqual([]);expect(read.prepare("SELECT * FROM worker_leases").all()).toEqual([]);
    }finally{read.close();}
  });
  it("admits an unchanged genuine saved revision with its exact ordinary command and audit",()=>{
    const f=fixture(),saved=applySettings(f);
    const database=AuthorityDatabase.open(f.admission,f.options,f.clock);
    try{expect(database.authority.settingsCurrent.get()).toEqual(saved);}finally{database.close();}
    const boot=AuthorityBootStore.open(f.admission,f.options,f.clock);try{expect(boot.report().state).toBe("healthy");}finally{boot.close();}
  });
  it.each(["wrong-links","missing-current"])("refuses contradictory saved settings at inspection/open/boot before credential effects: %s",fault=>{
    const f=fixture();applySettings(f);const raw=new DatabaseSync(f.path);
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
