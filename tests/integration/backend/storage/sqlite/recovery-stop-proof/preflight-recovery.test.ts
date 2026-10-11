import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { runtimeFixture } from "../../../../../support/fixtures/preflight/runtime-fixture.js";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { backupStoppedAuthority } from "../../../../../../src/backend/storage/maintenance/upgrade.js";
import { composeStorageCommand } from "../../../../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityHealthPreflightRunner } from "../../../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { doctorAuthorityStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";

it("fresh private authority is healthy without creating a backup",async()=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {const report=await doctorAuthorityStorage(f.doctorOptions,f.clock);assert.equal(report.authority.state,"healthy");assert.equal(report.backup.state,"missing");assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"pass");}
  finally {f.close();}
});
it.each(["wrong","newer","unsupported"] as const)("%s authority refuses read-only inspection without automatic migration",async kind=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {
    const database=new DatabaseSync(f.databasePath);
    try {if(kind==="wrong")database.exec("DROP TABLE runs");else {const version=kind==="newer"?999:2;database.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}}
    finally {database.close();}
    const before=readFileSync(f.databasePath);const report=await doctorAuthorityStorage(f.doctorOptions,f.clock);
    assert.equal(report.authority.state,"degraded");if(report.authority.state!=="degraded")throw new Error("unhealthy authority passed");
    assert.equal(report.authority.cause.code,"authority-schema-mismatch");
    assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"fail");assert.deepEqual(readFileSync(f.databasePath),before);
  }finally {f.close();}
});

it("supported single-authority restore re-checks healthy without inventing repair or substitute authority",async()=>{
  const workspace=mkdtempSync(join(realpathSync(tmpdir()),"native-preflight-restore-"));
  const admission=acquireEntrypointAdmission(workspace,"exclusive"), stateRoot=admission.stateRoot;
  const clock=manualClock(new Date("2026-09-19T12:00:00.000Z")), authorityPath=join(stateRoot,"state.db");
  try {
    copyFileSync(join(process.cwd(),"package.json"),join(workspace,"package.json"));
    AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"preflight-restore"},clock).close();
    const backup=await backupStoppedAuthority(admission,stateRoot,clock,join(workspace,rebuildRuntimeIsolation.processLockRoot));
    const manifest=backup.manifests.at(-1);assert.ok(manifest);
    const path=join(stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const restored=await composeStorageCommand(rebuildRuntimeIsolation,["restore","--from",path,"--json"],clock,workspace,admission);
    assert.equal(restored.exitCode,0,restored.output);
    const runner=new AuthorityHealthPreflightRunner(admission,{stateRootTrustAnchor:workspace,stateRoot,authorityPath,
      backupDirectory:join(stateRoot,"backups","authority"),busyTimeoutMs:100},clock);
    const observed=await runner.run({signal:new AbortController().signal,timeoutMs:1000,deadlineMonotonicMs:clock.monotonicMs()+1000,redaction:"safe-summary"});
    assert.equal(observed.state,"healthy",JSON.stringify(observed));
  }finally{admission.release();rmSync(workspace,{recursive:true,force:true});}
});
