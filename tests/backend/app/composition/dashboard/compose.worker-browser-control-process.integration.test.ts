import type { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { execFileSync,spawn,type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync,existsSync,readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, onTestFailed } from "vitest";
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
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import type { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-errors.js";
import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";
import { FIXTURE_DUO_CREDENTIAL_KEY } from "../../../../support/helpers/duo-ceremony-fixtures.js";
import { scaledMs } from "../../../../support/time-scale.js";

const worker = (index: number) => `person-lookup-worker-${String(index)}`;
function groupPids(group: number): number[] {
  return execFileSync("ps",["-eo","pid=,pgid="],{encoding:"utf8"}).split("\n").flatMap(line => {
    const [pid,pgid] = line.trim().split(/\s+/).map(Number); return pgid === group && pid !== undefined ? [pid] : [];
  });
}
async function waitFor(test: () => boolean, message: string, output: () => string, milliseconds = 20_000) {
  const deadline = systemClock.monotonicMs() + scaledMs(milliseconds);
  while (!test()) { if (systemClock.monotonicMs() > deadline) throw new Error(`${message}\n${output()}`); await new Promise(resolve => setTimeout(resolve,25)); }
}

it("real ingress, two real workers and Chromium: dry-run claims, exact controls, replay, replacement and proven cleanup", async () => {
  const diagnosticStartedAt = systemClock.monotonicMs();
  const fixture = await createBoundProfileFixture();
  const root = fixture.workspace;
  fixture.admission.release(); fixture.machine.release();
  let machine: ReturnType<typeof acquireEntrypointAdmission> | undefined;
  let profile: ReturnType<typeof composeProfileRuntime> | undefined;
  let token: string | undefined;
  const children: ChildProcess[] = []; const output: string[] = []; const faults: string[] = [];
  const runIds = [randomUUID(), randomUUID()];
  type DiagnosticPhase = 'starting' | 'boot-admission' | 'boot-runtime' | 'first-boot' | 'settings-request' | 'settings-response'
    | 'worker-command-request' | 'worker-command-response' | 'paused-workers' | 'claimed-runs' | 'browser-session'
    | 'run-completion' | 'idle-workers' | 'heartbeat' | 'first-stop' | 'closed-children' | 'second-boot'
    | 'standing-recovery' | 'reset-completion' | 'removal-completion' | 'final-stop' | 'cleanup' | 'fixture-close' | 'cleanup-finished';
  let phase: DiagnosticPhase = 'starting', failedPhase: DiagnosticPhase | undefined;
  let elapsedAtFirstReceipt: number | null = null, elapsedBeforeFixtureClose: number | null = null, fixtureCloseElapsed: number | null = null;
  const commandTypes = ['plan-worker-count', 'spawn-worker', 'pause-worker', 'resume-worker', 'refresh-browser', 'reopen-browser', 'stop-worker', 'remove-worker'] as const;
  let lastCommandType: typeof commandTypes[number] | 'none' | 'other' = 'none';
  let inFlight: { commandId: string; workerId?: string; startedAt: number; basis?: { leaseGeneration: number; controlRevision: number } } | undefined;
  onTestFailed(() => {
    let queryFailed = false;
    let controlPresent = false, auditPresent = false, leasePresent = false;
    let controlPhase: string | null = null, auditState: string | null = null, leaseState: string | null = null;
    let leaseGenerationMatches: boolean | null = null, controlRevisionMatches: boolean | null = null;
    if (inFlight !== undefined && database !== undefined) {
      try {
        const control = database.authority.workerControls.get(inFlight.commandId);
        const audit = database.authority.commandAudits.findByCommand(inFlight.commandId);
        const lease = inFlight.workerId === undefined ? undefined : database.authority.workerLeases.get(inFlight.workerId);
        controlPresent = control !== undefined; auditPresent = audit !== undefined; leasePresent = lease !== undefined;
        const phase = control?.phase.state;
        controlPhase = typeof phase === 'string' && ['admitted', 'ready', 'executing', 'succeeded', 'refused', 'uncertain'].includes(phase) ? phase : null;
        const state = audit?.result.state;
        auditState = typeof state === 'string' && ['applied', 'already-applied', 'queued', 'refused', 'conflict'].includes(state) ? state : null;
        const lifecycle = lease?.lifecycle.state;
        leaseState = typeof lifecycle === 'string' && ['starting', 'idle', 'busy', 'waiting', 'paused', 'stopping', 'stopped'].includes(lifecycle) ? lifecycle : null;
        if (lease !== undefined && inFlight.basis !== undefined) {
          leaseGenerationMatches = lease.leaseGeneration === inFlight.basis.leaseGeneration;
          controlRevisionMatches = lease.controlRevision === inFlight.basis.controlRevision;
        }
      } catch (error) { queryFailed = true; failures.push(error); }
    }

    process.stderr.write(JSON.stringify({ event: 'worker-browser-control-phase', phase, failedPhase: failedPhase ?? 'none',
      commandType: lastCommandType, childCount: children.length,
      runningChildren: children.filter(child => child.exitCode === null && child.signalCode === null).length,
      exitedChildren: children.filter(child => child.exitCode !== null).length,
      signalledChildren: children.filter(child => child.signalCode !== null).length,
      faultCount: faults.length, unknownFaultCount: faults.length,
      elapsedMs: Math.max(0, Math.round(systemClock.monotonicMs() - diagnosticStartedAt)),
      elapsedAtFirstReceiptMs: elapsedAtFirstReceipt, elapsedBeforeFixtureCloseMs: elapsedBeforeFixtureClose,
      fixtureCloseElapsedMs: fixtureCloseElapsed,
      inFlightPresent: inFlight !== undefined, requestElapsedMs: inFlight === undefined ? null : Math.max(0, Math.round(systemClock.monotonicMs() - inFlight.startedAt)),
      queryFailed, controlPresent, auditPresent, leasePresent, controlPhase, auditState, leaseState,
      leaseGenerationMatches, controlRevisionMatches }) + '\n');
  });
  let runtime: DashboardRuntime | undefined; let database: AuthorityDatabase | undefined;
  const stateRoot = fixture.stateRoot;
  copyFileSync("package.json",join(root,"package.json")); copyFileSync("package-lock.json",join(root,"package-lock.json"));
  const lifetimeLock: RuntimeLifetimeLock = fixture.lifetime;
  const spawnWorker: WorkerProcessSpawner = request => {
    const child = spawn(request.command,[...request.args,"--fixture-lock-port",String(lifetimeLock.port)],{cwd:request.cwd,stdio:["ignore","pipe","pipe","ipc"],detached:true});
    void lifetimeLock.share(child).catch(error => { child.emit("error", error); child.kill("SIGTERM"); });
    children.push(child); child.stdout?.on("data",chunk => output.push(String(chunk))); child.stderr?.on("data",chunk => output.push(String(chunk)));
    return { pid:child.pid, kill:signal => child.kill(signal), onExit:listener => {child.on("exit",listener);}, onError:listener => {child.on("error",listener);} };
  };
  const diagnostics = () => output.join("") + JSON.stringify({ leases: database?.authority.workerLeases.listLive(), runs: runIds.map(runId => ({
    state: database?.authority.runs.get(runId)?.lifecycle.state ?? "absent",
    failureCodes: database?.authority.failures.listByRun(runId).map(failure => failure.code) ?? [],
  })), duoLease: database?.authority.duoCeremonyLeases.get(FIXTURE_DUO_CREDENTIAL_KEY),
  browsers: [1, 2].map(index => database?.authority.workerControls.browsers(worker(index)).map(({ system, health }) => ({ system, health }))),
  traces: readdirSync(root).filter(name => /^browser-\d+\.jsonl$/u.test(name)).map(name => readFileSync(join(root, name), "utf8").trim().split("\n")) });
  phase = 'boot-admission';
  const boot = async () => {
    const bootMachine = acquireEntrypointAdmission(root, "shared", lifetimeLock);
    machine = bootMachine;
    profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock });
    const active = profile.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() });
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("browser-control-profile-sign-in-refused");
    token = active.token;
    assert.equal(profile.selectedContext(token).admission.stateRoot, stateRoot);
    assert.equal(existsSync(join(machine.stateRoot, "state.db")), false);
    phase = 'boot-runtime';
    const dashboard = await composeDashboardRuntime({ lifetimeLock, admission: machine, profile: { runtime: profile, token }, preflightRunnerFactory: healthyRuntimePreflightRunners,isolation:rebuildRuntimeIsolation,backendPortOverride:0,frontendPortOverride:0,env:{},repoRoot:root,
    workerProcess:{launch:{environment:{},command:process.execPath,prefixArgs:["--import","tsx",join(process.cwd(),"tests/support/processes/worker-browser-control-cli.ts"),root],cwd:process.cwd()},spawn:spawnWorker,birth:{pollMs:25,timeoutMs:scaledMs(20_000)},faultSink:line=>faults.push(line)}});
    return { dashboard, machine: bootMachine };
  };
  const failures: unknown[]=[];
  try {
    phase = 'first-boot';
    const firstBoot = await boot(); runtime = firstBoot.dashboard; machine = firstBoot.machine;
    const origin = `http://127.0.0.1:${String(runtime.port)}`;
    assert.ok(profile); assert.ok(token);
    let db = profile.selectedContext(token).database; database = db;
    const baseline = readSettings(db.authority).revision;
    const patch = { "daemon.idleRepollMs": { set: 100 }, "browser.headless": { set: true }, "features.duoWebAuthn": { set: false } };
    phase = 'settings-request';
    const response = await fetch(`${origin}/api/v1/commands`, { method:"POST", headers:{"content-type":"application/json",origin},
      body:JSON.stringify({commandId:randomUUID(),family:"settings",type:"apply-settings",target:{expectedRevision:baseline},source:"dashboard",requestedBy:"local-operator",requestedAt:systemClock.now().toISOString(),
        payload:{settingsSchemaHash:SETTINGS_SCHEMA_HASH,patchFingerprint:deriveSettingsPatchFingerprint(patch),patch}}) });
    phase = 'settings-response';
    const settingsResult: unknown = await response.json(); assert.equal(CommandResultSchema.parse(settingsResult).state,"applied",JSON.stringify(settingsResult));
    const post = async (type: string, target: unknown, payload?: unknown, commandId = randomUUID()) => {
      lastCommandType = commandTypes.find(value => value === type) ?? 'other';
      const request = {commandId,family:"worker-browser",type,target,...(payload===undefined?{}:{payload}),source:"dashboard",requestedBy:"local-operator",requestedAt:systemClock.now().toISOString()};
      const send = async (body = request) => {
        phase = 'worker-command-request';
        assert.ok(runtime); const origin = `http://127.0.0.1:${String(runtime.port)}`;
        const workerId: unknown = typeof target === 'object' && target !== null ? Reflect.get(target, 'workerId') : undefined;
        const payloadWorkerId: unknown = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'workerId') : undefined;
        const basis: unknown = typeof target === 'object' && target !== null ? Reflect.get(target, 'controlBasis') : undefined;
        const leaseGeneration: unknown = typeof basis === 'object' && basis !== null ? Reflect.get(basis, 'leaseGeneration') : undefined;
        const controlRevision: unknown = typeof basis === 'object' && basis !== null ? Reflect.get(basis, 'controlRevision') : undefined;
        inFlight = { commandId: body.commandId, startedAt: systemClock.monotonicMs(),
          ...(typeof workerId === 'string' ? { workerId } : typeof payloadWorkerId === 'string' ? { workerId: payloadWorkerId } : {}),
          ...(typeof leaseGeneration === 'number' && typeof controlRevision === 'number' ? { basis: { leaseGeneration, controlRevision } } : {}) };
        const response=await fetch(`${origin}/api/v1/commands`,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(body)});
        phase = 'worker-command-response';
        const raw: unknown = await response.json();
        inFlight = undefined;
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
    phase = 'paused-workers';
    await waitFor(()=>[1,2].every(index=>db.authority.workerLeases.get(worker(index))?.lifecycle.state==="paused"),"workers did not observe pause",diagnostics);
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
      phase = 'claimed-runs';
      await waitFor(()=>db.authority.workerLeases.get(worker(index))?.lifecycle.state==="busy","worker did not claim",diagnostics);
    }
    const claims=runIds.map(id=>db.authority.runs.get(id));
    assert.equal(new Set(claims.map(run=>run!==undefined && "workerId" in run.lifecycle ? run.lifecycle.workerId : undefined)).size,2);
    assert.ok(claims.every(run=>run?.envelope.dryRun===true));
    const liveSession=()=>db.authority.workerControls.browsers(worker(1)).find(value=>value.health!=="closed");
    phase = 'browser-session';
    await waitFor(()=>liveSession()!==undefined,"browser observation missing",diagnostics);
    const busy=await post("refresh-browser",{...target(1),browserSessionId:liveSession()?.sessionId});
    assert.equal(busy.result.state,"rejected");
    if(busy.result.state==="rejected") assert.match(busy.result.message,/busy/);
    assert.equal(db.authority.workerControls.get(busy.request.commandId),undefined);
    writeFileSync(join(root,"release-drivers"),"release\n");
    phase = 'run-completion';
    await waitFor(()=>runIds.every(id=>{const state=db.authority.runs.get(id)?.lifecycle; return state?.state==="terminal"&&state.outcome==="done";}),"dry runs did not finish",diagnostics);
    phase = 'run-completion';
    await waitFor(()=>[1,2].every(index=>db.authority.workerLeases.get(worker(index))?.lifecycle.state==="idle"),"workers not idle",diagnostics);
    const original=liveSession(); assert.ok(original);
    // Heartbeat row-version drift cannot invalidate the displayed control basis.
    const displayed={...target(1),browserSessionId:original.sessionId};
    phase = 'idle-workers';
    await waitFor(()=>db.authority.workerLeases.get(worker(1))?.version!==displayed.expectedVersion,"heartbeat missing",diagnostics);
    const refresh=await post("refresh-browser",displayed); assert.equal(refresh.result.state,"applied");
    assert.equal((await refresh.send()).state,"already-applied");
    const refreshed=db.authority.workerControls.browsers(worker(1)).find(value=>value.sessionId===original.sessionId);
    assert.equal(refreshed?.health,"authenticated");
    phase = 'heartbeat';
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
    elapsedAtFirstReceipt = Math.max(0, Math.round(systemClock.monotonicMs() - diagnosticStartedAt));
    process.stdout.write(`[sessions-process-proof] ${JSON.stringify({ claims: claims.map(value => ({ runId:value?.envelope.runId, dryRun:value?.envelope.dryRun, lifecycle:value?.lifecycle })), controls:[refresh,reopen].map(value=>db.authority.workerControls.get(value.request.commandId)), original, replacement })}\n`);
    const oldGeneration = target(1);
    assert.ok(machine);
    const oldMachine = machine, oldProfile = profile, oldToken = token, oldContext = profile.selectedContext(token);
    phase = 'first-stop';
    await runtime.stop(); runtime=undefined; database=undefined;
    assert.throws(() => oldProfile.assertCurrent(oldToken), { message: "runtime-admission: missing or released admission" });
    assert.throws(() => oldContext.settings.read(), (error: unknown) => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_SESSION_STALE");
    oldMachine.release(); machine=undefined;
    assert.throws(() => oldMachine.assertLive(), /runtime-admission: missing or released admission/u);
    phase = 'first-stop';
    await waitFor(() => children.every(child => child.exitCode !== null || child.signalCode !== null),
      "dashboard shutdown did not drain owned children", diagnostics);
    for (const child of children) {
      assert.ok(child.pid);
      assert.deepEqual(JSON.parse(readFileSync(join(root, `cleanup-${String(child.pid)}.json`), "utf8")),
        { openContexts: 0, failures: 0 });
      assert.equal(groupPids(child.pid).length, 0);
    }
    const stoppedChildren = children.length;
    phase = 'closed-children';
    const secondBoot = await boot(); runtime=secondBoot.dashboard; machine=secondBoot.machine;
    assert.equal(children.length,stoppedChildren,"dashboard boot must not spawn standing workers");
    assert.ok(profile); assert.ok(token);
    assert.notEqual(token, oldToken);
    const freshProfile = profile;
    assert.throws(() => freshProfile.assertCurrent(oldToken), (error: unknown) => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_SESSION_STALE");
    db=profile.selectedContext(token).database; database=db;
    phase = 'second-boot';
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
    phase = 'standing-recovery';
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
    phase = 'reset-completion';
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
    phase = 'removal-completion';
    phase = 'final-stop';
    await runtime.stop(); runtime=undefined; database=undefined;
    assert.ok(machine); machine.release(); machine=undefined;
    phase = 'final-stop';
    await waitFor(() => children.every(child => child.exitCode !== null || child.signalCode !== null),
      "final dashboard drain did not finish every owned child", diagnostics);
    for (const child of children) {
      assert.ok(child.pid);
      assert.deepEqual(JSON.parse(readFileSync(join(root,`cleanup-${String(child.pid)}.json`),"utf8")),{openContexts:0,failures:0});
      assert.equal(groupPids(child.pid).length,0);
    }
  } catch(error) { failedPhase = phase; failures.push(error); } finally {
    phase = 'cleanup';
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
    try {await profile?.close();}catch(error){failures.push(error);}
    try {machine?.release();}catch(error){failures.push(error);}
    const lockDirectory=join(root,rebuildRuntimeIsolation.processLockRoot,"workers");
    try {if(existsSync(lockDirectory))for(const name of readdirSync(lockDirectory))if(name.endsWith(".lock.json"))assert.notEqual(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(join(lockDirectory,name),"utf8"))).releasedAt,null);}catch(error){failures.push(error);}
    try {fixture.admission.release(); fixture.machine.release();}catch(error){failures.push(error);}
    if(failures.length===0) {process.stdout.write(`[sessions-process-cleanup] ${JSON.stringify({processGroups:children.map(child=>child.pid),survivors:0,openContexts:0,workerLocks:"released"})}\n`);
      phase = 'fixture-close';
      const closingAt = systemClock.monotonicMs();
      elapsedBeforeFixtureClose = Math.max(0, Math.round(closingAt - diagnosticStartedAt));
      await fixture.close();
      fixtureCloseElapsed = Math.max(0, Math.round(systemClock.monotonicMs() - closingAt));
      phase = 'cleanup-finished';
    }
  }
  if(failures.length>0)throw new AggregateError(failures,`process proof failed; retained ${root}\n${output.join("")}`);
}, scaledMs(90_000));
