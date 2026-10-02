import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { runtimeFixture } from "../../fixtures/preflight/runtime-fixture.js";
import { ArchiveDatabase } from "../../helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { backupStoppedAuthority } from "../../helpers/synthetic-storage-admission.js";
import { composeStorageCommand } from "../../helpers/synthetic-storage-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { restoreLifecyclePair } from "../../helpers/synthetic-storage-admission.js";
import { RecoveryStopProofStore } from "../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AuthorityHealthPreflightRunner } from "../../helpers/synthetic-storage-admission.js";
import { doctorAuthorityStorage } from "../../helpers/synthetic-storage-admission.js";

it("fresh private authority is healthy without creating a backup",async()=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {const report=await doctorAuthorityStorage(f.doctorOptions,f.clock);assert.equal(report.authority.state,"healthy");assert.equal(report.backup.state,"missing");assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"pass");}
  finally {f.close();}
});
it("paired restore clears its marker but retained custody keeps the doctor fail-closed",async()=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {
    new ArchiveDatabase(join(f.stateRoot,"archive.sqlite")).close();
    const backup=await backupStoppedAuthority(f.stateRoot,f.clock);assert.ok("pairedManifestPath" in backup);
    const processLockRoot=join(f.stateRoot,"locks"),sourceDatabaseIdentity=AuthorityDatabase.sourceDatabaseIdentity(f.databasePath);
    const store=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000},f.clock);
    store.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity},f.clock));
    const proof=store.issue({observedBy:"local-operator",sourceDatabaseIdentity});
    await assert.rejects(restoreLifecyclePair({authorityPath:f.databasePath,suspectDirectory:join(f.stateRoot,"suspects"),busyTimeoutMs:500,processLockRoot,stoppedProofMaxAgeMs:60000},
      {manifestPath:backup.pairedManifestPath,stoppedSystemProof:proof},async()=>{},f.clock,step=>{if(step==="archive")throw new Error("synthetic-pair-interruption");}),/lifecycle-restore-incomplete/u);
    const runner=new AuthorityHealthPreflightRunner(f.doctorOptions,f.clock);const run=()=>runner.run({signal:new AbortController().signal,timeoutMs:15000,deadlineMonotonicMs:15000,redaction:"safe-summary"});
    assert.equal((await run()).state,"unhealthy");assert.equal((await doctorAuthorityStorage(f.doctorOptions,f.clock)).recovery.state,"interrupted");
    assert.equal((await run()).state,"unhealthy","inspection must not repair storage");
    const restored=await composeStorageCommand(rebuildRuntimeIsolation,["restore","--from",backup.pairedManifestPath,"--json"],f.clock,f.root);
    assert.equal(restored.exitCode,0,restored.output);
    const after=await doctorAuthorityStorage(f.doctorOptions,f.clock);
    assert.equal(after.recovery.state,"clear");assert.equal(after.authority.state,"healthy");
    assert.equal(after.spanAuthority.state,"unavailable");if(after.spanAuthority.state!=="unavailable")throw new Error("expected retained-custody refusal");
    assert.equal(after.spanAuthority.cause.summary,"preserved authority directory contains an unexpected entry");
    assert.equal((await run()).state,"unhealthy","restore completion must not suppress a remaining authoritative refusal");
  }finally {f.close();}
});

it.each(["wrong","newer","below-floor"] as const)("%s authority refuses read-only inspection without automatic migration",async kind=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {
    const database=new DatabaseSync(f.databasePath);
    try {if(kind==="wrong")database.exec("DROP TABLE workflow_runs");else {const version=kind==="newer"?999:1;database.exec(`UPDATE database_state SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}}
    finally {database.close();}
    const before=readFileSync(f.databasePath);const report=await doctorAuthorityStorage(f.doctorOptions,f.clock);
    assert.equal(report.authority.state,"degraded");if(report.authority.state!=="degraded")throw new Error("unhealthy authority passed");
    assert.equal(report.authority.cause.code,kind === "newer" ? "authority-schema-newer" : "authority-schema-mismatch");
    assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"fail");assert.deepEqual(readFileSync(f.databasePath),before);
  }finally {f.close();}
});

it("supported single-authority restore re-checks healthy without inventing repair or substitute authority",async()=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {
    const backup=await backupStoppedAuthority(f.stateRoot,f.clock);const manifest=backup.manifests.at(-1);assert.ok(manifest);
    const path=join(f.stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const restored=await composeStorageCommand(rebuildRuntimeIsolation,["restore","--from",path,"--json"],f.clock,f.root);assert.equal(restored.exitCode,0,restored.output);
    const report=await f.report();assert.equal(report.results.find(check=>check.check==="authority.health")?.status,"pass",JSON.stringify(report));
  }finally{f.close();}
});
