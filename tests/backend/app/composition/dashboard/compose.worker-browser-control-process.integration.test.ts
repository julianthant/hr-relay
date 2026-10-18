import assert from "node:assert/strict";
import { execFileSync,spawn,type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { composeDashboardRuntime,type DashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import type { WorkerProcessSpawner } from "../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { WorkerProcessLockFileSchema } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { SETTINGS_SCHEMA_HASH,deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { deriveTraceId } from "../../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { AuthorityDatabase,installationAdmission,releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

const worker = (index: number) => `person-lookup-worker-${String(index)}`;
function groupPids(group: number): number[] {
  return execFileSync("ps",["-eo","pid=,pgid="],{encoding:"utf8"}).split("\n").flatMap(line => {
    const [pid,pgid] = line.trim().split(/\s+/).map(Number); return pgid === group && pid !== undefined ? [pid] : [];
  });
}
async function waitFor(test: () => boolean, message: string, output: () => string, milliseconds = 20_000) {
  const deadline = systemClock.monotonicMs() + milliseconds;
  while (!test()) { if (systemClock.monotonicMs() > deadline) throw new Error(`${message}\n${output()}`); await new Promise(resolve => setTimeout(resolve,25)); }
}

it("real ingress, two real workers and Chromium: dry-run claims, exact controls, replay, replacement and proven cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(),"hrauto-control-process-"));
  const children: ChildProcess[] = []; const output: string[] = []; const faults: string[] = [];
  let runtime: DashboardRuntime | undefined; let database: AuthorityDatabase | undefined;
  const stateRoot = join(root,rebuildRuntimeIsolation.stateRoot); mkdirSync(stateRoot,{recursive:true});
  copyFileSync("package.json",join(root,"package.json")); copyFileSync("package-lock.json",join(root,"package-lock.json"));
  const spawnWorker: WorkerProcessSpawner = request => {
    const child = spawn(request.command,[...request.args],{cwd:request.cwd,stdio:["ignore","pipe","pipe"],detached:true});
    children.push(child); child.stdout?.on("data",chunk => output.push(String(chunk))); child.stderr?.on("data",chunk => output.push(String(chunk)));
    return { pid:child.pid, kill:signal => child.kill(signal), onExit:listener => {child.on("exit",listener);}, onError:listener => {child.on("error",listener);} };
  };
  const diagnostics = () => output.join("") + JSON.stringify({ leases: database?.authority.workerLeases.listLive(), runs: [1,2].flatMap(index => database?.authority.runs.listByWorker(worker(index)) ?? []) });
  const boot = () => composeDashboardRuntime({ admission: installationAdmission(root), preflightRunnerFactory: healthyRuntimePreflightRunners,isolation:rebuildRuntimeIsolation,backendPortOverride:0,frontendPortOverride:0,env:{},repoRoot:root,
    workerProcess:{launch:{environment:{},command:process.execPath,prefixArgs:["--import","tsx",join(process.cwd(),"tests/support/processes/worker-browser-control-cli.ts"),root],cwd:process.cwd()},spawn:spawnWorker,birth:{pollMs:25,timeoutMs:20_000},faultSink:line=>faults.push(line)}});
  const failures: unknown[]=[];
  try {
    runtime = await boot();
    const origin = `http://127.0.0.1:${String(runtime.port)}`;
    const patch = { "daemon.idleRepollMs": { set: 100 } };
    const response = await fetch(`${origin}/api/v1/commands`, { method:"POST", headers:{"content-type":"application/json",origin},
      body:JSON.stringify({commandId:randomUUID(),family:"settings",type:"apply-settings",target:{expectedRevision:1},source:"dashboard",requestedBy:"local-operator",requestedAt:systemClock.now().toISOString(),
        payload:{settingsSchemaHash:SETTINGS_SCHEMA_HASH,patchFingerprint:deriveSettingsPatchFingerprint(patch),patch}}) });
    const settingsResult: unknown = await response.json(); assert.equal(CommandResultSchema.parse(settingsResult).state,"applied",JSON.stringify(settingsResult));
    let db = AuthorityDatabase.open({path:join(stateRoot,"state.db"),busyTimeoutMs:5000,migrationOwner:"control-process-proof"},systemClock); database=db;
    const post = async (type: string, target: unknown, payload?: unknown, commandId = randomUUID()) => {
      const request = {commandId,family:"worker-browser",type,target,...(payload===undefined?{}:{payload}),source:"dashboard",requestedBy:"local-operator",requestedAt:systemClock.now().toISOString()};
      const send = async (body = request) => {
        assert.ok(runtime); const origin = `http://127.0.0.1:${String(runtime.port)}`;
        const response=await fetch(`${origin}/api/v1/commands`,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(body)});
        const raw: unknown = await response.json();
        if (response.status >= 500) throw new Error(`fixture command ${type} failed: ${JSON.stringify(raw)}; ${diagnostics()}`);
        const result = CommandResultSchema.parse(raw);
        assert.equal(response.status,result.state === "rejected" ? 422 : result.state === "conflict" ? 409 : 200,JSON.stringify(raw)); return result;
      };
      return {result:await send(),request,send};
    };
    const target = (index:number) => {
      const lease=db.authority.workerLeases.get(worker(index)); assert.ok(lease?.controlRevision);
      return {workerId:lease.workerId,expectedVersion:lease.version,controlBasis:{leaseGeneration:lease.leaseGeneration,controlRevision:lease.controlRevision}};
    };
    assert.equal((await post("plan-worker-count",{workflowId:"person-lookup",expectedVersion:0},{desiredWorkers:2})).result.state,"applied");
    for (const index of [1,2]) {
      assert.equal((await post("spawn-worker",{workflowId:"person-lookup",expectedVersion:1},{workerId:worker(index)})).result.state,"applied");
      assert.equal((await post("pause-worker",target(index))).result.state,"applied");
    }
    await waitFor(()=>[1,2].every(index=>db.authority.workerLeases.get(worker(index))?.lifecycle.state==="paused"),"workers did not observe pause",diagnostics);
    const runIds=[randomUUID(),randomUUID()];
    const active=db.authority.runtimeConfig.get(); assert.ok(active);
    for (const runId of runIds) {
      const candidate=RunRecordSchema.parse(personLookupQueuedRun({runId,itemId:randomUUID(),dryRun:true}));
      const enqueuedAt = systemClock.now().toISOString();
      const run = RunRecordSchema.parse({...candidate,createdAt:enqueuedAt,updatedAt:enqueuedAt,envelope:{...candidate.envelope,traceId:deriveTraceId("pl",runId,systemClock),enqueuedAt,configSnapshotId:active.configSnapshotId,configFingerprint:active.configFingerprint}});
      db.withAuthorityTransaction(r => {
        assert.equal(r.runs.enqueue(run).state,"inserted");
        createTimelineEmitter({repository:r.timelineEvents,clock:systemClock}).emit(runQueuedSpanEvent({run,actorId:ActorIdSchema.parse("local-operator"),title:"Synthetic session proof"}));
      });
    }
    for (const index of [1,2]) {
      assert.equal((await post("resume-worker",target(index))).result.state,"applied");
      await waitFor(()=>db.authority.workerLeases.get(worker(index))?.lifecycle.state==="busy","worker did not claim",diagnostics);
    }
    const claims=runIds.map(id=>db.authority.runs.get(id));
    assert.equal(new Set(claims.map(run=>run!==undefined && "workerId" in run.lifecycle ? run.lifecycle.workerId : undefined)).size,2);
    assert.ok(claims.every(run=>run?.envelope.dryRun===true));
    const liveSession=()=>db.authority.workerControls.browsers(worker(1)).find(value=>value.health!=="closed");
    await waitFor(()=>liveSession()!==undefined,"browser observation missing",diagnostics);
    const busy=await post("refresh-browser",{...target(1),browserSessionId:liveSession()?.sessionId});
    assert.equal(busy.result.state,"rejected");
    if(busy.result.state==="rejected") assert.match(busy.result.message,/busy/);
    assert.equal(db.authority.workerControls.get(busy.request.commandId),undefined);
    writeFileSync(join(root,"release-drivers"),"release\n");
    await waitFor(()=>runIds.every(id=>{const state=db.authority.runs.get(id)?.lifecycle; return state?.state==="terminal"&&state.outcome==="done";}),"dry runs did not finish",diagnostics);
    await waitFor(()=>[1,2].every(index=>db.authority.workerLeases.get(worker(index))?.lifecycle.state==="idle"),"workers not idle",diagnostics);
    const original=liveSession(); assert.ok(original);
    // Heartbeat row-version drift cannot invalidate the displayed control basis.
    const displayed={...target(1),browserSessionId:original.sessionId};
    await waitFor(()=>db.authority.workerLeases.get(worker(1))?.version!==displayed.expectedVersion,"heartbeat missing",diagnostics);
    const refresh=await post("refresh-browser",displayed); assert.equal(refresh.result.state,"applied");
    assert.equal((await refresh.send()).state,"already-applied");
    const refreshed=db.authority.workerControls.browsers(worker(1)).find(value=>value.sessionId===original.sessionId);
    assert.equal(refreshed?.health,"authenticated");
    const reopen=await post("reopen-browser",{...target(1),browserSessionId:original.sessionId}); assert.equal(reopen.result.state,"applied");
    assert.equal((await reopen.send()).state,"already-applied");
    const replacement=db.authority.workerControls.browsers(worker(1)).find(value=>value.system===original.system&&value.health==="authenticated"); assert.ok(replacement);
    assert.notEqual(replacement.sessionId,original.sessionId); assert.equal(replacement.profileDirectory,original.profileDirectory);
    assert.equal(db.authority.workerControls.browsers(worker(1)).find(value=>value.sessionId===original.sessionId)?.health,"closed");
    const stale=await post("refresh-browser",{...target(1),browserSessionId:original.sessionId}); assert.equal(stale.result.state,"rejected");
    for (const command of [refresh,reopen]) assert.equal(db.authority.commandAudits.findByCommand(command.request.commandId)?.result.state,"applied");
    const raw=new DatabaseSync(join(stateRoot,"state.db"),{readOnly:true});
    try {
      for(const table of ["write_intents","write_attempts"]) assert.equal(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.["n"],0);

      assert.equal(raw.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='operation_outbox'").get()?.["n"],0);
    }finally{raw.close();}
    process.stdout.write(`[sessions-process-proof] ${JSON.stringify({ claims: claims.map(value => ({ runId:value?.envelope.runId, dryRun:value?.envelope.dryRun, lifecycle:value?.lifecycle })), controls:[refresh,reopen].map(value=>db.authority.workerControls.get(value.request.commandId)), original, replacement })}\n`);
    const oldGeneration = target(1);
    db.close(); database=undefined;
    await runtime.stop(); runtime=undefined;
    await waitFor(() => children.every(child => child.exitCode !== null || child.signalCode !== null),
      "dashboard shutdown did not drain owned children", diagnostics);
    for (const child of children) {
      assert.ok(child.pid);
      assert.deepEqual(JSON.parse(readFileSync(join(root, `cleanup-${String(child.pid)}.json`), "utf8")),
        { openContexts: 0, failures: 0 });
      assert.equal(groupPids(child.pid).length, 0);
    }
    const stoppedChildren = children.length;
    runtime=await boot();
    assert.equal(children.length,stoppedChildren,"dashboard boot must not spawn standing workers");
    db=AuthorityDatabase.open({path:join(stateRoot,"state.db"),busyTimeoutMs:5000,migrationOwner:"control-process-proof-restarted"},systemClock); database=db;
    assert.equal((await reopen.send()).state,"already-applied");
    assert.equal(children.length,stoppedChildren,"replaying a settled browser control must not spawn workers");
    for (const index of [1,2]) {
      const stopped = db.authority.workerLeases.get(worker(index)); assert.ok(stopped);
      assert.equal(stopped.leaseGeneration,1); assert.equal(stopped.lifecycle.state,"stopped");
      assert.equal((await post("spawn-worker",{workflowId:"person-lookup",expectedVersion:db.authority.workerPools.get("person-lookup")?.version},
        {workerId:worker(index)})).result.state,"applied");
    }
    await waitFor(() => [1,2].every(index => {
      const lease = db.authority.workerLeases.get(worker(index));
      return lease?.leaseGeneration === 2 && lease.lifecycle.state === "idle";
    }) && db.authority.workerSlots.recoveries("person-lookup").length === 0,
    "explicit Spawn did not finalize exact browserless idle owners", diagnostics);
    assert.equal(target(1).controlBasis.leaseGeneration,2);
    assert.equal((await post("pause-worker",oldGeneration)).result.state,"conflict");
    const member = db.authority.workerSlots.get(worker(1)); assert.ok(member);
    const stop = await post("stop-worker",{...target(1),membershipRevision:member.membershipRevision});
    assert.equal(stop.result.state,"pending");
    await waitFor(() => db.authority.workerControls.get(stop.request.commandId)?.phase.state === "succeeded",
      "replacement worker did not settle its exact reset", diagnostics);
    const reset = db.authority.workerControls.get(stop.request.commandId); assert.ok(reset?.phase.state === "succeeded");
    assert.equal(reset.phase.acknowledgement.kind,"reset");
    assert.equal(db.authority.commandAudits.findByCommand(stop.request.commandId)?.result.state,"applied");
    assert.equal((await stop.send()).state,"already-applied");
    const resetLease = db.authority.workerLeases.get(worker(1)); assert.ok(resetLease);
    assert.equal(resetLease.lifecycle.state,"idle"); assert.equal(resetLease.leaseGeneration,2);
    assert.equal(db.authority.workerControls.browsers(worker(1)).filter(value => value.leaseGeneration === 2 && value.health !== "closed").length,0);
    const replacementChild = children.find(child => child.pid === resetLease.processId); assert.ok(replacementChild);
    assert.equal(replacementChild.exitCode,null); assert.equal(replacementChild.signalCode,null);
    assert.equal(existsSync(join(root,`browser-${String(replacementChild.pid)}.jsonl`)),false,"browserless recovery and Stop must not acquire or authenticate");
    const removal = await post("remove-worker",{...target(1),workflowId:"person-lookup",membershipRevision:member.membershipRevision,
      expectedVersion:db.authority.workerPools.get("person-lookup")?.version});
    assert.equal(removal.result.state,"pending");
    await waitFor(() => db.authority.workerControls.get(removal.request.commandId)?.phase.state === "succeeded",
      "selected replacement did not prove retirement", diagnostics);
    assert.notEqual(db.authority.workerSlots.get(worker(1))?.retiredAt,null);
    assert.equal(db.authority.commandAudits.findByCommand(removal.request.commandId)?.result.state,"applied");
    await waitFor(() => replacementChild.exitCode !== null || replacementChild.signalCode !== null,
      "removed replacement process did not finish admission cleanup", diagnostics);
    assert.deepEqual(JSON.parse(readFileSync(join(root,`cleanup-${String(replacementChild.pid)}.json`),"utf8")),{openContexts:0,failures:0});
    assert.equal(groupPids(resetLease.processId).length,0);
    const resize = (await post("plan-worker-count",{workflowId:"person-lookup",expectedVersion:db.authority.workerPools.get("person-lookup")?.version},{desiredWorkers:1})).result;
    assert.equal(resize.state,"applied");
    assert.equal(db.authority.workerPools.get("person-lookup")?.desiredWorkers, 1);
    db.close(); database=undefined;
    await runtime.stop(); runtime=undefined;
    await waitFor(() => children.every(child => child.exitCode !== null || child.signalCode !== null),
      "final dashboard drain did not finish every owned child", diagnostics);
    for (const child of children) {
      assert.ok(child.pid);
      assert.deepEqual(JSON.parse(readFileSync(join(root,`cleanup-${String(child.pid)}.json`),"utf8")),{openContexts:0,failures:0});
      assert.equal(groupPids(child.pid).length,0);
    }
  } catch(error) { failures.push(error); } finally {
    writeFileSync(join(root,"release-drivers"),"cleanup release\n");
    for(const child of children) if(child.exitCode===null&&child.signalCode===null) {child.kill("SIGCONT");child.kill("SIGTERM");}
    for(const child of children) {
      try {await waitFor(()=>child.exitCode!==null||child.signalCode!==null,"owned child did not exit",diagnostics,10_000);}
      catch(error){failures.push(error);if(child.pid!==undefined)try{process.kill(-child.pid,"SIGKILL");}catch(killError){failures.push(killError);}}
      if(child.pid!==undefined)try{
        await waitFor(()=>groupPids(child.pid!).length===0,"owned process group survived",diagnostics,5000);
        const cleanup=JSON.parse(readFileSync(join(root,`cleanup-${String(child.pid)}.json`),"utf8")) as unknown;
        assert.deepEqual(cleanup,{openContexts:0,failures:0});
      }catch(error){failures.push(error);}
    }
    try {await runtime?.stop();}catch(error){failures.push(error);}
    try {database?.close();}catch(error){failures.push(error);}
    const lockDirectory=join(root,rebuildRuntimeIsolation.processLockRoot,"workers");
    try {if(existsSync(lockDirectory))for(const name of readdirSync(lockDirectory))if(name.endsWith(".lock.json"))assert.notEqual(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(join(lockDirectory,name),"utf8"))).releasedAt,null);}catch(error){failures.push(error);}
    releaseAdmissionFixtures();
    if(failures.length===0) {process.stdout.write(`[sessions-process-cleanup] ${JSON.stringify({processGroups:children.map(child=>child.pid),survivors:0,openContexts:0,workerLocks:"released"})}\n`);rmSync(root,{recursive:true,force:true});}
  }
  if(failures.length>0)throw new AggregateError(failures,`process proof failed; retained ${root}\n${output.join("")}`);
},90_000);
