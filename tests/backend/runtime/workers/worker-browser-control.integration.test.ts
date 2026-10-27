import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { createWorkerBrowserControl } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { WorkerSessionManager,type WorkerBrowserSessionFactory } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import type { WorkerBrowserObservation } from "../../../../src/models/run/worker-control.js";
import { BrowserSessionIdSchema,FingerprintSchema,WorkerIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const NOW = "2026-09-18T18:00:00.000Z";
const WORKER = WorkerIdSchema.parse("person-lookup-worker-1");
const WORKFLOW = WorkflowIdSchema.parse("person-lookup");
const HASH = FingerprintSchema.parse("a".repeat(64));
const SIGNAL = new AbortController().signal;
async function harness() {
  const clock = manualClock(new Date(NOW));
  const observations: Omit<WorkerBrowserObservation, "leaseGeneration">[] = [];
  const opened: Parameters<WorkerBrowserSessionFactory["open"]>[0][] = [];
  const closed: string[] = [];
  let resetFails = false, closeFails = false, loginFails = false;
  let resetHold: Promise<void> | undefined;
  const factory: WorkerBrowserSessionFactory = { async open(input) {
    opened.push(input);
    const sessionId = BrowserSessionIdSchema.parse(randomUUID());
    return { sessionId, system: input.system, instance: input.instance, configFingerprint: input.configFingerprint, signInFingerprint: input.configFingerprint, profileRevision: 1,
      browserMode: input.browserMode, profileDirectory: `/fixture/${input.system}/${input.configFingerprint}`, acceptDownloads: input.acceptDownloads, exclusive: input.exclusive,
      driver: { system: input.system }, authentication: { async authenticate() { if (loginFails) throw new Error("fixture-authentication-failed"); return "already-authenticated"; } },
      async reset() { await resetHold; if (resetFails) throw new Error("fixture-reset-failed"); },
      async close() { if (closeFails) throw new Error("fixture-close-unproven"); closed.push(sessionId); return { sessionId, system: input.system, pagesClosed: true, contextClosed: true }; },
    };
  } };
  const sessions = new WorkerSessionManager({ workerId: WORKER, workflowId: WORKFLOW, stores: taskStoreRegistry, factory, clock,
    scheduler: new ManualScheduler(clock), acquireDeadlineMs: 10_000, duoCeremony: await fixtureDuoCeremonyGates(clock), onObservation: value => observations.push(value) });
  const warm = async (system: "crm" | "ucpath" = "crm", fingerprint = HASH) => {
    sessions.bindRunConfigFingerprint(fingerprint, "headed");
    try { await sessions.withDriver({ system, session: "reuse-worker", access: "read" }, "prod", SIGNAL, async () => undefined); }
    finally { sessions.releaseRunConfigFingerprint(); }
    const observation = observations.at(-1); assert.ok(observation); return observation.sessionId;
  };
  return { clock, observations, opened, closed, sessions, warm, failReset: () => { resetFails = true; }, failClose: () => { closeFails = true; }, failLogin: () => { loginFails = true; }, holdReset: (hold: Promise<void>) => { resetHold = hold; } };
}

describe("exact worker browser controls", () => {
  it("refreshes the same idle session and reopens only after closure with its retained configuration", async () => {
    const h = await harness();
    try {
      const first = await h.warm();
      const other = await h.warm("ucpath", FingerprintSchema.parse("b".repeat(64)));
      h.sessions.configureRunResources({ sessionFactory: { open: async () => { throw new Error("new-settings-must-not-open-retained-resource"); } }, sessionAcquireMs: 100,
        duoCeremony: await fixtureDuoCeremonyGates(h.clock), defaultBrowserMode: "headless" });
      assert.equal((await h.sessions.controlBrowser("refresh-browser", first, SIGNAL)).sessionId, first);
      const replacement = await h.sessions.controlBrowser("reopen-browser", first, SIGNAL);
      assert.notEqual(replacement.sessionId, first);
      assert.deepEqual(h.closed, [first]);
      assert.equal(replacement.configFingerprint, HASH);
      assert.equal(replacement.browserMode, "headed");
      assert.equal(replacement.instance, "prod");
      assert.equal(h.opened.length, 3);
      assert.equal(h.sessions.assertControlTarget(other).sessionId, other);
      assert.equal(h.observations.at(-1)?.health, "authenticated");
      await assert.rejects(h.sessions.controlBrowser("refresh-browser", first, SIGNAL), /session-unavailable/);
    } finally { await h.sessions.closeAll("worker-stop"); }
  });

  it("refuses a whole active run between driver steps without retaining a later action", async () => {
    const h = await harness();
    try {
      const id = await h.warm();
      h.sessions.bindRunConfigFingerprint(HASH);
      await assert.rejects(h.sessions.controlBrowser("reopen-browser", id, SIGNAL), /worker-browser-busy/);
      h.sessions.releaseRunConfigFingerprint();
      assert.equal(h.opened.length, 1);
      assert.equal(h.sessions.assertControlTarget(id).sessionId, id);
    } finally { await h.sessions.closeAll("worker-stop"); }
  });

  it("excludes a new run and second control while refresh owns the resource", async () => {
    const h = await harness();
    let release!: () => void;
    try {
      const id = await h.warm();
      h.holdReset(new Promise<void>(resolve => { release = resolve; }));
      const refreshing = h.sessions.controlBrowser("refresh-browser", id, SIGNAL);
      assert.throws(() => h.sessions.bindRunConfigFingerprint(HASH), /control-in-progress/);
      await assert.rejects(h.sessions.controlBrowser("reopen-browser", id, SIGNAL), /busy/);
      release();
      await refreshing;
      assert.equal(h.opened.length, 1);
    } finally { release?.(); await h.sessions.closeAll("worker-stop"); }
  });

  it("keeps failed reset poisoned and never creates a replacement after unproven closure", async () => {
    const h = await harness();
    const id = await h.warm();
    h.failReset();
    await assert.rejects(h.sessions.controlBrowser("refresh-browser", id, SIGNAL), /reset-failed/);
    assert.equal(h.observations.at(-1)?.health, "failed");
    await assert.rejects(h.sessions.controlBrowser("reopen-browser", id, SIGNAL), /unproven-close/);
    assert.equal(h.opened.length, 1);
    await h.sessions.closeAll("worker-stop");
    const h2 = await harness(); const id2 = await h2.warm(); h2.failClose();
    await assert.rejects(h2.sessions.controlBrowser("reopen-browser", id2, SIGNAL), /close-unproven/);
    assert.equal(h2.opened.length, 1);
    await assert.rejects(h2.sessions.closeAll("worker-stop"), /failed to close/);
  });

  it("retains failed authentication after reopening and proves the failed replacement closed", async () => {
    const h = await harness();
    try {
      const id = await h.warm(); h.failLogin();
      await assert.rejects(h.sessions.controlBrowser("reopen-browser", id, SIGNAL), /authentication-failed/);
      assert.equal(h.closed.length, 2);
      assert.equal(h.sessions.activeSystems().length, 0);
    } finally { await h.sessions.closeAll("worker-stop"); }
  });
});

describe("durable worker control admission", () => {
  it("survives heartbeat changes, consumes a basis once across connections, and retains exact request/outcome", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "worker-control-"));
    const clock = manualClock(new Date(NOW));
    const first = AuthorityDatabase.open({ path: join(root, "authority.db"), busyTimeoutMs: 250, migrationOwner: "test" }, clock);
    const second = AuthorityDatabase.open({ path: join(root, "authority.db"), busyTimeoutMs: 250, migrationOwner: "test" }, clock);
    try {
      seedSyntheticRuntimeConfig(first);
      first.authority.workerPools.plan({workflow:WORKFLOW,expectedVersion:0,desiredWorkers:1,requestedBy:"local-operator",now:NOW});
      first.authority.workerSlots.allocate({workflow:WORKFLOW,poolIndex:1,commandId:null,now:NOW});
      first.authority.workerLeases.start({ workerId: WORKER, workflow: WORKFLOW, browserSystems: ["crm"], processId: 42, requestedBy: "local-operator", now: NOW });
      first.authority.workerLeases.reportLifecycle({ workerId: WORKER, leaseGeneration: 1, lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
      const commandId = randomUUID();
      const request = { commandId, family: "worker-browser", type: "pause-worker", source: "dashboard", requestedAt: NOW, requestedBy: "local-operator",
        target: { workerId: WORKER, expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } };
      first.withAuthorityTransaction(r => {
        r.commands.insert(request); r.workerLeases.reserveControl(WORKER, request.target.controlBasis, commandId, NOW);
        r.workerControls.admit({ commandId, request, scope: "worker-pool:person-lookup", executorId: randomUUID(), admittedAt: NOW, expiresAt: "2026-09-18T18:03:00.000Z", basisVersion: 2, phase: { state: "admitted" } });
      });
      assert.throws(() => second.authority.workerLeases.reserveControl(WORKER, request.target.controlBasis, randomUUID(), NOW), /basis-conflict/);
      assert.equal(second.authority.workerLeases.get(WORKER)?.controlRevision, 2);
      second.withAuthorityTransaction(r => assert.throws(() => r.commands.assertIdentity({ ...request, type: "resume-worker" }), /different|divergent|identity|reused/i));
      second.authority.workerControls.transition(commandId, "admitted", { state: "executing", startedAt: NOW });
      first.authority.workerControls.transition(commandId, "executing", { state: "uncertain", startedAt: NOW, observedAt: NOW, message: "lost owner" });
      assert.equal(second.authority.workerControls.get(commandId)?.phase.state, "uncertain");
      assert.deepEqual(second.authority.workerControls.get(commandId)?.request, request);
      assert.throws(() => second.authority.workerControls.transition(commandId, "uncertain", { state: "executing", startedAt: NOW }), /invalid-transition/);
    } finally { second.close(); first.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("executes a ready exact-session request once and retains its result after another connection loses acknowledgement", async () => {
    const h = await harness(); const root = mkdtempSync(join(realpathSync(tmpdir()), "worker-channel-"));
    const db = AuthorityDatabase.open({ path: join(root, "authority.db"), busyTimeoutMs: 250, migrationOwner: "test" }, h.clock);
    try {
      const sessionId = await h.warm();
      seedSyntheticRuntimeConfig(db);
      db.authority.workerPools.plan({workflow:WORKFLOW,expectedVersion:0,desiredWorkers:1,requestedBy:"local-operator",now:NOW});
      db.authority.workerSlots.allocate({workflow:WORKFLOW,poolIndex:1,commandId:null,now:NOW});
      db.authority.workerLeases.start({ workerId: WORKER, workflow: WORKFLOW, browserSystems: ["crm"], processId: 42, requestedBy: "local-operator", now: NOW });
      db.authority.workerLeases.reportLifecycle({ workerId: WORKER, leaseGeneration: 1, lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
      const commandId = randomUUID();
      const request = { commandId, family: "worker-browser", type: "reopen-browser", source: "dashboard", requestedAt: NOW, requestedBy: "local-operator",
        target: { workerId: WORKER, browserSessionId: sessionId, expectedVersion: 2, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } };
      db.withAuthorityTransaction(r => { r.commands.insert(request); r.workerLeases.reserveControl(WORKER, request.target.controlBasis, commandId, NOW);
        r.workerControls.admit({ commandId, request, scope: "worker-pool:person-lookup", executorId: randomUUID(), admittedAt: NOW, expiresAt: "2026-09-18T18:03:00.000Z", basisVersion: 2, phase: { state: "admitted" } });
        r.workerControls.transition(commandId, "admitted", { state: "ready" }); });
      const consume = createWorkerBrowserControl({ database: db, workerId: WORKER, leaseGeneration: 1, clock: h.clock, signal: SIGNAL });
      await consume(h.sessions); await consume(h.sessions);
      assert.equal(h.opened.length, 2); assert.deepEqual(h.closed, [sessionId]);
      assert.equal(db.authority.workerControls.get(commandId)?.phase.state, "succeeded");
    } finally { await h.sessions.closeAll("worker-stop"); db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});

describe("worker delivery fencing", () => {
  it.each(["expired", "generation", "revision", "busy", "replaced", "effect-failure"] as const)("retains %s evidence and cannot deliver a deferred or duplicate effect", async scenario => {
    const h=await harness(); let bound = false; const root=mkdtempSync(join(realpathSync(tmpdir()),"worker-fence-"));
    const db=AuthorityDatabase.open({path:join(root,"authority.db"),busyTimeoutMs:250,migrationOwner:"test"},h.clock);
    try {
      const sessionId=await h.warm();
      seedSyntheticRuntimeConfig(db);
      db.authority.workerPools.plan({workflow:WORKFLOW,expectedVersion:0,desiredWorkers:1,requestedBy:"local-operator",now:NOW});
      db.authority.workerSlots.allocate({workflow:WORKFLOW,poolIndex:1,commandId:null,now:NOW});
      db.authority.workerLeases.start({workerId:WORKER,workflow:WORKFLOW,browserSystems:["crm"],processId:42,requestedBy:"local-operator",now:NOW});
      db.authority.workerLeases.reportLifecycle({workerId:WORKER,leaseGeneration:1,lifecycle:{state:"idle",startedAt:NOW,heartbeatAt:NOW},now:NOW});
      const commandId=randomUUID();
      const request={commandId,family:"worker-browser",type:"refresh-browser",source:"dashboard",requestedAt:NOW,requestedBy:"local-operator",
        target:{workerId:WORKER,browserSessionId:scenario==="replaced"?randomUUID():sessionId,expectedVersion:2,controlBasis:{leaseGeneration:1,controlRevision:1}}};
      db.withAuthorityTransaction(r=>{
        r.commands.insert(request);r.workerLeases.reserveControl(WORKER,request.target.controlBasis,commandId,NOW);
        r.workerControls.admit({commandId,request,scope:"worker-pool:person-lookup",executorId:randomUUID(),admittedAt:NOW,expiresAt:scenario==="expired"?NOW:"2026-09-18T18:03:00.000Z",basisVersion:2,phase:{state:"admitted"}});
        r.workerControls.transition(commandId,"admitted",{state:"ready"});
      });
      if(scenario==="busy") { h.sessions.bindRunConfigFingerprint(HASH); bound = true; }
      if(scenario==="revision") db.authority.workerLeases.control({workerId:WORKER,expectedVersion:3,control:{directive:"pause",requestedBy:"local-operator",requestedAt:NOW},now:NOW});
      if(scenario==="effect-failure") h.failReset();
      const observedBefore=h.observations.length;
      const consume=createWorkerBrowserControl({database:db,workerId:WORKER,leaseGeneration:scenario==="generation"?2:1,clock:h.clock,signal:SIGNAL});
      await consume(h.sessions); await consume(h.sessions);
      const phase=db.authority.workerControls.get(commandId)?.phase; assert.ok(phase);
      assert.equal(phase.state,scenario==="generation"?"ready":scenario==="effect-failure"?"uncertain":"refused");
      if(scenario!=="effect-failure")assert.equal(h.observations.length,observedBefore,"no browser operation ran");
      if(scenario==="busy") {h.sessions.releaseRunConfigFingerprint(); bound = false; await consume(h.sessions); assert.equal(h.observations.length,observedBefore);}
      assert.equal(h.opened.length,1);
    } finally { if (bound) h.sessions.releaseRunConfigFingerprint(); await h.sessions.closeAll("worker-stop"); db.close();rmSync(root,{recursive:true,force:true}); }
  });
});
