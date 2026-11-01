import { linkSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,expect,it,vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectStorageRecovery } from "../../../../src/backend/storage/sqlite/storage-recovery-status.js";
const faults=vi.hoisted(()=>({root:"",listings:0,onList:undefined as (()=>void) | undefined,onFstat:undefined as (()=>void) | undefined}));
vi.mock("node:fs",async()=>{
  const actual=await vi.importActual<typeof import("node:fs")>("node:fs");
  return {...actual,readdirSync:(...args:Parameters<typeof actual.readdirSync>)=>{
    if(String(args[0]) === faults.root && ++faults.listings === 2)faults.onList?.();
    return Reflect.apply(actual.readdirSync,actual,args);
  },fstatSync:(...args:Parameters<typeof actual.fstatSync>)=>{
    const result=Reflect.apply(actual.fstatSync,actual,args);faults.onFstat?.();return result;
  }};
});
const cleanups:(()=>void)[]=[];
afterEach(()=>{faults.root="";faults.listings=0;faults.onList=undefined;faults.onFstat=undefined;for(const cleanup of cleanups.splice(0))cleanup();});
function fixture() {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"relay-recovery-inventory-")));
  const admission=RuntimeAdmission.syntheticFixture(join(root,"state.db"));
  const source = { kind: "profile" as const, binding: {
    installationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002" } };
  const observer = { stateRoot: admission.stateRoot, assertLive: () => admission.assertLive(), authorityBackupExpectedSource: () => source };
  const identity=AuthorityDatabase.sourceDatabaseIdentity(source);
  cleanups.push(()=>{admission.release();rmSync(root,{recursive:true,force:true});});
  const staged=join(root,".restore-11111111-1111-4111-8111-111111111111.sqlite.tmp");
  return {root,admission,observer,identity,staged,read:()=>inspectStorageRecovery(observer,identity)};
}
describe("native recovery evidence inventory",()=>{
  it("reports clear only behind admitted live ownership and exact source identity",()=>{
    const f=fixture();expect(f.read().report.state).toBe("clear");
    expect(inspectStorageRecovery(f.observer,"b".repeat(64)).report.state).toBe("unavailable");
    f.admission.release();expect(()=>f.read()).toThrow(/released/u);
  });
  it("detects genuine staging and displaced companions as interrupted, binds identities, and never treats them as readiness",()=>{
    const f=fixture();writeFileSync(f.staged,Buffer.from("unacknowledged staging bytes"),{mode:0o600});
    const first=f.read();expect(first.report).toEqual({state:"interrupted",findings:[{marker:"authority-restore",state:"interrupted"}]});
    expect(f.read()).toEqual(first);
    writeFileSync(`${f.staged}-wal.live-companion`,Buffer.from("displaced companion bytes"),{mode:0o600});
    expect(f.read().identity).not.toBe(first.identity);expect(f.read().report).toEqual({state:"interrupted",findings:[
      {marker:"authority-restore",state:"interrupted"},{marker:"authority-restore",state:"interrupted"}]});
  });
  it.each([".unknown-recovery.json","unowned.sqlite",".restore-not-an-acquisition.sqlite.tmp"])("preserves and refuses unowned evidence without parsing or adopting its bytes: %s",name=>{
    const f=fixture();const path=join(f.root,name);writeFileSync(path,"not-json",{mode:0o600});
    expect(f.read().report).toMatchObject({state:"unavailable",findings:[{marker:"unowned-recovery-entry",state:"unavailable"}]});
  });
  it.each(["symlink","hardlink","directory"])("refuses unsafe actual staging shape: %s",shape=>{
    const f=fixture();const source=join(f.root,"source");writeFileSync(source,"preserved bytes",{mode:0o600});
    if(shape === "symlink")symlinkSync(source,f.staged);else if(shape === "hardlink")linkSync(source,f.staged);else mkdirSync(f.staged);
    expect(f.read().report).toMatchObject({state:"unavailable",findings:[{marker:"authority-restore",state:"unavailable"}]});
  });
  it("refuses changing native evidence during no-follow observation",()=>{
    const f=fixture();writeFileSync(f.staged,"before",{mode:0o600});
    faults.onFstat=()=>{faults.onFstat=undefined;writeFileSync(f.staged,"changed evidence",{mode:0o600});};
    expect(f.read().report).toMatchObject({state:"unavailable",findings:[{marker:"authority-restore",state:"unavailable"}]});
  });
  it("refuses inventory change across directory observations instead of inferring clear",()=>{
    const f=fixture();faults.root=f.root;faults.onList=()=>writeFileSync(f.staged,"interrupted bytes",{mode:0o600});
    expect(f.read().report.state).toBe("unavailable");
  });
});
