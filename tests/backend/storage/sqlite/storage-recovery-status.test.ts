import { AuthorityRestoreJournalSchema } from "../../../../src/backend/storage/admission/installation.js";
import { linkSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,expect,it,vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectRestoreEligibility,inspectStorageRecovery } from "../../../../src/backend/storage/sqlite/storage-recovery-status.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
const faults=vi.hoisted(()=>({root:"",listings:0,onList:undefined as (()=>void) | undefined,onFstat:undefined as (()=>void) | undefined,stageDescriptor:undefined as number | undefined}));
vi.mock("node:fs",async()=>{
  const actual=await vi.importActual<typeof import("node:fs")>("node:fs");
  return {...actual,openSync:(...args:Parameters<typeof actual.openSync>)=>{const descriptor=Reflect.apply(actual.openSync,actual,args);if(String(args[0]).endsWith(".sqlite.tmp"))faults.stageDescriptor=descriptor;return descriptor;},readdirSync:(...args:Parameters<typeof actual.readdirSync>)=>{
    if(String(args[0]) === faults.root && ++faults.listings === 2)faults.onList?.();
    return Reflect.apply(actual.readdirSync,actual,args);
  },fstatSync:(...args:Parameters<typeof actual.fstatSync>)=>{
    const result=Reflect.apply(actual.fstatSync,actual,args);if(args[0]===faults.stageDescriptor)faults.onFstat?.();return result;
  }};
});
const cleanups:(()=>void)[]=[];
afterEach(()=>{faults.root="";faults.listings=0;faults.onList=undefined;faults.onFstat=undefined;faults.stageDescriptor=undefined;for(const cleanup of cleanups.splice(0))cleanup();});
function fixture(ownedOperation = false) {
  const workspace=realpathSync(mkdtempSync(join(tmpdir(),"relay-recovery-inventory-"))), installationId="00000000-0000-4000-8000-000000000001", profileId="00000000-0000-4000-8000-000000000002";
  const machineRoot=join(workspace,".tracker","data"),root=join(machineRoot,"profiles",profileId),operationId="11111111-1111-4111-8111-111111111111";
  mkdirSync(root,{recursive:true,mode:0o700});
  const admission=RuntimeAdmission.syntheticFixture(join(root,"state.db"));
  const source = { kind: "profile" as const, binding: {installationId,profileId} };
  const locator={schemaVersion:3 as const,installationId,generation:0 as const,stateRoot:machineRoot,artifactRoot:join(machineRoot,"artifacts")};
  const observer = { stateRoot: admission.stateRoot, assertLive: () => admission.assertLive(), authorityBackupExpectedSource: () => source,
    readInstallationContext:()=>({workspace,locator}) };
  const identity=AuthorityDatabase.sourceDatabaseIdentity(source),staged=join(root,`.restore-${operationId}.sqlite.tmp`),digest="a".repeat(64),file={byteSize:1,sha256:digest};
  if(ownedOperation){
    const control=join(workspace,".tracker","control");mkdirSync(control,{recursive:true,mode:0o700});
    const journal=AuthorityRestoreJournalSchema.parse({schemaVersion:3,phase:"restoring",installationId,source:locator,restoreAdmissionId:operationId,
      restore:{operationId,profile:{binding:source.binding,continuity:{schemaVersion:7,installationId,digest,revision:0,generation:0,operations:[]},
        credentials:{binding:source.binding,generation:1,keyId:operationId,digest,counters:[],retired:[]}},authorityPath:join(root,"state.db"),stagedPath:staged,
        suspectPath:join(root,"backups","suspects",`suspect-20261102000000000-${operationId}.sqlite`),manifestPath:join(root,"backups","authority","authority.sqlite.manifest.json"),
        manifestSha256:digest,backupPath:join(root,"backups","authority","authority.sqlite"),backupSha256:digest,sourceDatabaseIdentity:identity,authorityGeneration:0,
        authorityContentFingerprint:digest,browserMembershipDigest:digest,retainedFilesDigest:digest,unresolvedWriteDigest:digest,
        backupTime:"2026-11-01T00:00:00.000Z",restoredAt:"2026-11-02T00:00:00.000Z",live:file,staged:file,suspect:file,
        companions:[{suffix:"-wal",binding:file,suspect:file},{suffix:"-shm",binding:file,suspect:file}]}});
    writeFileSync(join(control,"journal.json"),JSON.stringify(journal),{mode:0o600});
  }
  cleanups.push(()=>{admission.release();rmSync(workspace,{recursive:true,force:true});});
  return {root,admission,observer,identity,staged,read:()=>inspectStorageRecovery(observer,identity)};
}
describe("native recovery evidence inventory",()=>{
  it.each([8,9,10,11,12,13,14,15,CURRENT_AUTHORITY_SCHEMA_VERSION])("keeps supported person backup schema %s eligible behind current authority",schemaVersion=>{
    const f=fixture();
    const input={schemaVersion,backupPath:join(f.root,"backup.sqlite"),backupSha256:"a".repeat(64),stateRoot:f.root,authorityAvailable:true};
    expect(inspectRestoreEligibility(f.admission,input)).toEqual({state:"eligible"});
    expect(inspectRestoreEligibility(f.admission,{...input,authorityAvailable:false}).state).toBe("unavailable");
    f.admission.release();expect(()=>inspectRestoreEligibility(f.admission,input)).toThrow(/released/u);
  });
  it.each([1,6,7,CURRENT_AUTHORITY_SCHEMA_VERSION+1])("keeps unsupported backup schema %s ineligible",schemaVersion=>{
    const f=fixture();
    expect(inspectRestoreEligibility(f.admission,{schemaVersion,backupPath:join(f.root,"backup.sqlite"),backupSha256:"a".repeat(64),stateRoot:f.root,authorityAvailable:true}).state).toBe("unsupported");
  });
  it("reports clear only behind admitted live ownership and exact source identity",()=>{
    const f=fixture();expect(f.read().report.state).toBe("clear");
    expect(inspectStorageRecovery(f.observer,"b".repeat(64)).report.state).toBe("unavailable");
    f.admission.release();expect(()=>f.read()).toThrow(/released/u);
  });
  it("projects the current external operation and its owned staging without granting readiness",()=>{
    const f=fixture(true);writeFileSync(f.staged,Buffer.from("unacknowledged staging bytes"),{mode:0o600});
    const first=f.read();expect(first.report).toEqual({state:"interrupted",findings:[{marker:"authority-restore",state:"interrupted"},{marker:"authority-restore",state:"interrupted"}]});
    expect(f.read()).toEqual(first);
    writeFileSync(`${f.staged}-wal.live-companion`,Buffer.from("displaced companion bytes"),{mode:0o600});
    expect(f.read().identity).not.toBe(first.identity);expect(f.read().report).toEqual({state:"interrupted",findings:[
      {marker:"authority-restore",state:"interrupted"},{marker:"authority-restore",state:"interrupted"},{marker:"authority-restore",state:"interrupted"}]});
  });
  it.each([".unknown-recovery.json","unowned.sqlite",".restore-not-an-acquisition.sqlite.tmp"])("preserves and refuses unowned evidence without parsing or adopting its bytes: %s",name=>{
    const f=fixture();const path=join(f.root,name);writeFileSync(path,"not-json",{mode:0o600});
    expect(f.read().report).toMatchObject({state:"unavailable",findings:[{marker:"unowned-recovery-entry",state:"unavailable"}]});
  });
  it.each(["symlink","hardlink","directory"])("refuses unsafe actual staging shape: %s",shape=>{
    const f=fixture(true);const source=join(f.root,"source");writeFileSync(source,"preserved bytes",{mode:0o600});
    if(shape === "symlink")symlinkSync(source,f.staged);else if(shape === "hardlink")linkSync(source,f.staged);else mkdirSync(f.staged);
    expect(f.read().report).toMatchObject({state:"unavailable",findings:[{marker:"authority-restore",state:"interrupted"},{marker:"authority-restore",state:"unavailable"}]});
  });
  it("refuses changing native evidence during no-follow observation",()=>{
    const f=fixture(true);writeFileSync(f.staged,"before",{mode:0o600});
    faults.onFstat=()=>{faults.onFstat=undefined;writeFileSync(f.staged,"changed evidence",{mode:0o600});};
    expect(f.read().report).toMatchObject({state:"unavailable",findings:[{marker:"authority-restore",state:"interrupted"},{marker:"authority-restore",state:"unavailable"}]});
  });
  it("refuses inventory change across directory observations instead of inferring clear",()=>{
    const f=fixture();faults.root=f.root;faults.onList=()=>writeFileSync(f.staged,"interrupted bytes",{mode:0o600});
    expect(f.read().report.state).toBe("unavailable");
  });
});
