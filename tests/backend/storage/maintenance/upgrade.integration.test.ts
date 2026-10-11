import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { backupStoppedAuthority,upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
const owners: {workspace:string;admission:RuntimeAdmission}[] = [];
afterEach(() => {for(const owner of owners.splice(0).reverse()){owner.admission.release();rmSync(owner.workspace,{recursive:true,force:true});}});
function fixture(){
 const workspace=mkdtempSync(join(realpathSync(tmpdir()),"native-upgrade-admission-"));
 const admission=acquireEntrypointAdmission(workspace,"exclusive");owners.push({workspace,admission});
 const root=admission.stateRoot,path=join(root,"state.db"),input={stateRoot:root,processLockRoot:join(root,"locks"),plan:false};
 return {admission,root,path,input,run:(plan=false)=>upgradeStorage(admission,{...input,plan},clock)};
}
function initialize(f:ReturnType<typeof fixture>){const database=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"admission-fixture"},clock);database.close();}

describe("stopped native upgrade admission",()=>{
 it("refuses schema-valid journal column corruption during read-only preflight without effects",async()=>{
  const f=fixture();const database=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"journal-corruption-fixture"},clock);
  const commandId=randomUUID();
  try{database.authority.commands.insert({commandId,family:"worker-browser",type:"refresh-browser",target:{workerId:"person-lookup-worker-1",browserSessionId:randomUUID(),expectedVersion:1,controlBasis:{leaseGeneration:1,controlRevision:1}},source:"dashboard",requestedBy:"local-operator",requestedAt:clock.now().toISOString()});}finally{database.close();}
  const raw=new DatabaseSync(f.path);
  try{
   const triggers=raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='commands'").all();
   for(const trigger of triggers)raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
   try{assert.equal(raw.prepare("UPDATE commands SET family='settings' WHERE id=?").run(commandId).changes,1);}finally{for(const trigger of triggers)raw.exec(String(trigger.sql));}
  }finally{raw.close();}
  const bytes=readFileSync(f.path);
  await assert.rejects(backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot),/command-row-identity-mismatch/u);
  assert.deepEqual(readFileSync(f.path),bytes);
  const before=storageTree(f.root);
  for(const plan of [true,false])await assert.rejects(f.run(plan),/command-row-identity-mismatch/u);
  assert.deepEqual(storageTree(f.root),before);
 });
 it("plans the bootstrapped native authority without writes and verifies unchanged current authority",async()=>{
  const f=fixture(),before=storageTree(f.root);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:1,toSchemaVersion:1,credentials:"unchanged"});assert.deepEqual(storageTree(f.root),before);
  assert.equal((await f.run()).state,"already-upgraded");const current=readFileSync(f.path);
  assert.equal((await f.run(true)).state,"planned");assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),current);
 });
 it.each([2,19,46,999])("refuses unsupported schema %s without conversion or repair",async version=>{
  const f=fixture();initialize(f);const raw=new DatabaseSync(f.path);
  try{raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}finally{raw.close();}
  const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/authority-schema-mismatch/u);assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses a divergent native schema without effects",async()=>{
  const f=fixture();initialize(f);const raw=new DatabaseSync(f.path);try{raw.exec("CREATE TABLE divergent_authority(id TEXT PRIMARY KEY) STRICT");}finally{raw.close();}
  const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/schema/u);assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses an active runtime lock before backup or upgrade effects",async()=>{
  const f=fixture();initialize(f);const server=acquireRuntimeProcessLock({processLockRoot:f.input.processLockRoot,name:"server",pid:process.pid},clock);
  try{const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/runtime-active/u);await assert.rejects(backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot),/runtime-active/u);assert.deepEqual(storageTree(f.root),before);}finally{server.release();}
 });
 it("verifies an explicit native backup without changing authority or credentials",async()=>{
  const f=fixture();initialize(f);const bytes=readFileSync(f.path);
  const report=await backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot);assert.equal(report.state,"verified");assert.equal(report.manifests.length,1);
  const manifest=report.manifests[0];assert.ok(manifest);
  const verified=await verifyBackupManifestAtPath(f.admission,join(f.root,"backups","authority",manifest.backupFileName+".manifest.json"),AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion,1);assert.deepEqual(readFileSync(f.path),bytes);
  const before=storageTree(f.root);assert.equal((await f.run(true)).state,"planned");assert.deepEqual(storageTree(f.root),before);assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),bytes);
 });
 it("leaves current authority untouched after failed restore admission and admits exact retry",async()=>{
  const f=fixture(),before=storageTree(f.root);
  await assert.rejects(upgradeStorage(f.admission,f.input,clock,()=>{throw new Error("injected-admission-failure");}),/injected-admission-failure/u);
  assert.deepEqual(storageTree(f.root),before);assert.equal((await f.run()).state,"already-upgraded");
 });
});
