import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService,requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { OfflineSpanRootRepairService } from "../../../../src/backend/runs/recovery/span-root-repair.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { SpanEventWireSchema } from "../../../../src/models/events/types.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { StartPlanRecordSchema,derivePlannedInputFingerprint } from "../../../../src/models/run/start-plan.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNSTORED_CONFIG_IDENTITY,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { appliedRunIds } from "../../../support/fixtures/operator-command-fixtures.js";
import {
NOW,
UUID_1,
CONFIG_SNAPSHOT,
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
QUEUED_RUN,
sequentialIdFactory,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { writeFixtureParallelDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(ambiguous=false) {
  const descriptor=ambiguous?writeFixtureParallelDescriptor:fixtureDescriptor;
  const profile = await createBoundProfileFixture();
  cleanups.push(async () => { await profile.close(); });
  const repoRoot = profile.workspace, stateRoot = profile.stateRoot, authorityPath = profile.path;
  const processLockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(profile.admission, {
    path: authorityPath,
    busyTimeoutMs: 500,
    migrationOwner: "span-root-repair-test",
  }, clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  cleanups.push(() => { database.close(); });
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock, profile.admission);
  database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint,
    provenance: resolved.provenance, capturedAt: clock.now().toISOString() });
  const ids=sequentialIdFactory("c"),active=database.authority.runtimeConfig.get();assert.ok(active);
  const descriptors={resolve:(workflow:string)=>workflow===descriptor.id?descriptor:undefined};
  const lifecycle=new RunRecordService({database,clock,ids:sequentialIdFactory("a"),publishQueued:()=>undefined});
  const unused=()=>{throw new Error("unrequested runtime effect");};
  const kernel=createCommandKernel({authority:database,lifecycle,clock,ids,appVersion:"0.1.0",descriptors,
    writeResolution:{recheck:unused,resolveAbsent:unused},configIdentity:UNSTORED_CONFIG_IDENTITY,intakeParser:UNWIRED_INTAKE_PARSER,intakeProjections:NO_INTAKE_PROJECTIONS,
    workerRuntime:{pool:{planPoolWorkerCount:unused,spawnPoolWorker:unused,refreshPoolBrowser:unused,reopenPoolBrowser:unused,
      stopPoolWorker:unused,pausePoolWorker:unused,resumePoolWorker:unused}}});
  const planner=createStartPlanService({authority:database,authorityRead:database,descriptors,clock,ids:sequentialIdFactory("b"),
    planTtlMs:600000,configFingerprint:active.configFingerprint,configSnapshotId:active.configSnapshotId,plannedBy:"local-operator"});
  let plan=planner.plan({workflowId:descriptor.id,submissions:ambiguous?[{eid:"10812345"}]:[{eid:"10812345",mode:"write"}],dryRun:true,selectedStepKeys:descriptor.timeline.map(step=>step.key)});
  if(ambiguous) {
    const original=database.authority.startPlans.get(plan.startPlanId);assert.ok(original && original.planned[0]);
    const planned=[original.planned[0],original.planned[0]],inputFingerprint=derivePlannedInputFingerprint(planned,
      original.ingressSchemaHash,original.canonicalInputSchemaHash,original.rerun,original.stepOmissions);
    const admitted=StartPlanRecordSchema.parse({...original,startPlanId:ids.uuid(),planned,inputFingerprint});
    assert.equal(database.authority.startPlans.create(admitted).state,"inserted");
    plan={...plan,startPlanId:admitted.startPlanId,planned:[...plan.planned,...plan.planned],fingerprints:{...plan.fingerprints,inputFingerprint:FingerprintSchema.parse(inputFingerprint)}};
  }
  const result=kernel.execute({commandId:UUID_1,requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",family:"start",type:"start-run",
    target:{workflowId:descriptor.id,startPlanId:plan.startPlanId,expectedVersion:plan.expectedVersion},payload:plan.fingerprints});
  const runIds=appliedRunIds(result);assert.equal(runIds.length,ambiguous?2:1);
  const created=database.authority.runs.get(runIds[0]);assert.ok(created);
  const slot=database.withAuthorityTransaction(repositories=>admitDirectWorker(repositories,{ commandId: ids.uuid(), workflow: descriptor.id,
    poolIndex: 1, expectedPoolVersion: 0, processId: process.pid, now: NOW },ids.uuid()));
  assert.equal(database.authority.workerLeases.start({workerId:slot.workerId,workflow:descriptor.id,browserSystems:[],processId:process.pid,requestedBy:"local-operator",now:NOW}).state,"started");
  const run=requireLifecycleApplied(lifecycle.claimNext({commandId:ids.uuid(),workflow:descriptor.id,workerId:slot.workerId,
    workerLifetime:testWorkerLifetime(database,descriptor.id,slot.poolIndex).workerLifetime,runtimeConfig:{
    generation:active.generation,settingsRevision:active.settingsRevision,settingsFingerprint:active.settingsFingerprint,configFingerprint:active.configFingerprint}}));
  database.close();
  const issueOperation = () => profile.admission.acquireOfflineMaintenance();
  const operation = issueOperation();
  const service = new OfflineSpanRootRepairService(profileBrowserClosure, profile.admission,{
    stateRoot,
    authorityPath,
    processLockRoot,
    busyTimeoutMs: 500,
  }, clock);
  return { repoRoot, stateRoot, authorityPath, processLockRoot, clock, run, plan, service, operation,issueOperation,admission:profile.admission };
}

describe("offline missing run.queued recovery", () => {
  it("appends one authority-derived marked SQLite root without changing prior records", async () => {
    const f = await fixture();
    const read = () => {
      const db = AuthorityDatabase.open(f.admission, { path: f.authorityPath, busyTimeoutMs: 500, migrationOwner: "repair-verifier" }, f.clock);
      try { return db.authority.timelineEvents.page({}); } finally { db.close(); }
    };
    const before = read();
    const report = f.service.repair({ runId: f.run.envelope.runId }, f.operation);
    assert.equal(report.state, "repaired");
    const after = read();
    assert.deepEqual(after.slice(0, before.length), before);
    assert.equal(after.length, before.length + 1);
    const payload = after.at(-1)?.payload;
    if (payload?.kind !== "span") throw new Error("missing repaired span");
    const appended = SpanEventWireSchema.parse(payload.event);
    if (appended.t !== "run.queued" || appended.repair?.kind !== "timeline-authority-reconstruction") {
      throw new Error("timeline root repair did not append its marked run.queued event");
    }
    assert.equal(appended.pid, process.pid);
    assert.equal(appended.repair.priorCursor, before.at(-1)?.cursor);
    assert.equal(appended.title, f.plan.planned[0]?.title);
    const replay=f.service.repair({ runId:f.run.envelope.runId }, f.issueOperation());
    assert.equal(replay.state,"already-repaired");assert.deepEqual(read(),after);

    const doctor = await doctorAuthorityStorage(f.admission, {
      stateRootTrustAnchor: f.repoRoot,
      stateRoot: f.stateRoot,
      authorityPath: f.authorityPath,
      backupDirectory: join(f.stateRoot, "backups", "authority"),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 500,
    }, f.clock);
    assert.equal(doctor.spanAuthority.state, "reconciled");
  });

  it("refuses multiple exact admitted candidates without publishing a root",async()=>{
    const f=await fixture(true);
    const database=AuthorityDatabase.open(f.admission,{path:f.authorityPath,busyTimeoutMs:500,migrationOwner:"repair-ambiguity-verifier"},f.clock);
    let before;try{before=database.authority.timelineEvents.page({});}finally{database.close();}
    assert.throws(()=>f.service.repair({ runId:f.run.envelope.runId }, f.operation),/2 matching planned entries/u);
    const reopened=AuthorityDatabase.open(f.admission,{path:f.authorityPath,busyTimeoutMs:500,migrationOwner:"repair-ambiguity-verifier"},f.clock);
    try{assert.deepEqual(reopened.authority.timelineEvents.page({}),before);}finally{reopened.close();}
  });

  it.each(["input-mismatch","audit-mismatch"])("refuses altered current %s without publishing a root",async fault=>{
    const f=await fixture(),raw=new DatabaseSync(f.authorityPath);
    const before=raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all();
    try {
      if(fault==="input-mismatch")raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.input.raw.eid',?,'$.input.parsed.value.eid',?) WHERE id=?").run("10812346","10812346",f.run.envelope.runId);
      else raw.prepare("UPDATE commands SET request_digest=? WHERE id=?").run("a".repeat(64),UUID_1);
    }finally{raw.close();}
    assert.throws(()=>f.service.repair({ runId:f.run.envelope.runId }, f.issueOperation()),/0 matching planned entries|identity-mismatch/u);
    const reopened=new DatabaseSync(f.authorityPath,{readOnly:true});
    try{assert.deepEqual(reopened.prepare("SELECT * FROM timeline_events ORDER BY cursor").all(),before);}finally{reopened.close();}
  });

  it("refuses when a required start-plan authority binding is absent", async () => {
    const f = await fixture();
    const database = AuthorityDatabase.open(f.admission, {
      path: f.authorityPath,
      busyTimeoutMs: 500,
      migrationOwner: "span-root-repair-test-mutate",
    }, f.clock);
    try {
      // A different run has no session/plan chain. The repair must not infer a
      // title or actor from the span stream.
      const orphan = RunRecordSchema.parse({
        ...QUEUED_RUN,
        envelope: {
          ...QUEUED_RUN.envelope,
          configSnapshotId: f.run.envelope.configSnapshotId,
          configFingerprint: f.run.envelope.configFingerprint,
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          itemId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          traceId: "pl-170001-aaaa",
        },
      });
      database.authority.runs.enqueue(orphan);
    } finally {
      database.close();
    }
    // The stopped proof excludes runtime writers; reconstruction still refuses
    // because no authoritative session/plan chain can supply actor and title.
    assert.throws(
      () => f.service.repair({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, f.operation),
      /has no durable run session/u,
    );
  });
});
