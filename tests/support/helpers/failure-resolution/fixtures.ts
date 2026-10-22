import { composeActivity } from "../../../../src/backend/app/composition/dashboard/activity.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { RunIdSchema, FailureIdSchema } from "../../../../src/rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { createCommandKernel, type CommandKernelDependencies } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { FailureResolutionCommandSchema } from "../../../../src/rules/commands/commands.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER, UNSTORED_CONFIG_IDENTITY } from "../../fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { type foundationFixture, failure, terminalizeFixtureFailure, NOW } from "../database-foundation/fixtures.js";

export function resolutionKernel(db: AuthorityDatabase, clock: ReturnType<typeof foundationFixture>["clock"], overrides: Partial<CommandKernelDependencies> = {}) {
  const unused = (): never => { throw new Error("unrelated executor reached"); };
  return createCommandKernel({
    authority: db, clock, ids: { uuid: randomUUID },
    lifecycle: new RunRecordService({ database: db, clock, ids: sequentialIdFactory("e"), publishQueued: unused }),
    appVersion: "0.1.0",
    descriptors: { resolve: name => name === personLookupDescriptor.id ? personLookupDescriptor : undefined },
    configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } },
    writeResolution: { resolvePresent: unused, resolveAbsent: unused }, ...overrides,
  });
}
export function resolutionFixture(runId: string = failure().runId, failureId: string = failure().failureId,
  options: { sharedMachine?: true } = {}) {
  const f = diagnosticFoundation(options);
  const run = runId === f.run.envelope.runId ? f.run : f.createRun(runId);
  const record = { ...failure(), runId: RunIdSchema.parse(runId), failureId: FailureIdSchema.parse(failureId), traceId: run.envelope.traceId };
  terminalizeFixtureFailure(f, run, record);
  return { ...f, record, kernel: resolutionKernel(f.db, f.clock) };
}
export function resolutionCommand(overrides: Record<string, unknown> = {}) {
  const record = failure();
  return FailureResolutionCommandSchema.parse({ commandId: randomUUID(), requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", reason: "Synthetic failure follow-up",
    family: "failure-resolution", type: "annotate-failure",
    target: { runId: record.runId, failureId: record.failureId, expectedVersion: 1 },
    payload: { action: "resolve", note: "Updated page control." }, ...overrides });
}

/** The production HTTP route/admission/kernel; unrelated routes deliberately have no fixture. */
export function resolutionApp(f: ReturnType<typeof resolutionFixture>) {
  return createDashboardApp({
    ...composeActivity({ database: f.db, clock: f.clock, descriptors: { resolve: id => id === personLookupDescriptor.id ? personLookupDescriptor : undefined }, ledger: createTransactionHistory(f.db.authority) }),
    requestIdentity: createSoloRequestIdentityCheckpoint({ id: "local-operator", label: "Local operator" }),
    bootstrap: { clock: f.clock, appVersion: "0.1.0" }, commandJournal: f.db.authority.commands,
    protectedCommandAcceptedAt: () => undefined,
    bulkCommandAcceptances: { withTransaction: () => { throw new Error("unrelated bulk route reached"); } },
    intake: UNWIRED_INTAKE_SERVICE,
    commands: { submit: async (request: unknown) => f.kernel.execute(request) },
    runDetail: resolutionReadDeps(f),
  } as unknown as DashboardAppDeps);
}

export function resolutionReadDeps(f: ReturnType<typeof resolutionFixture>) {
  const reader = sqliteRunReader(f.db, f.clock);
  const trust = createReceiptService({ database: f.db, runReader: reader, descriptors: [personLookupDescriptor] });
  return { runReader: reader, trust, timeline: f.db.authority.timelineEvents } as unknown as RunDetailQueryDeps;
}

import { createDashboardApp, type DashboardAppDeps } from "../../../../src/backend/transports/http/routes/api.js";
import { createSoloRequestIdentityCheckpoint } from "../../../../src/backend/transports/http/request-identity.js";
import { UNWIRED_INTAKE_SERVICE } from "../../fixtures/intake-kernel-seams.js";
import { sqliteRunReader } from "../canonical-run-reader.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";

import assert from "node:assert/strict";
import { join } from "node:path";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { QUEUED_RUN, RUN_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { id } from "../database-foundation/fixtures.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
function diagnosticFoundation(options: { sharedMachine?: true }){
 const profile=createBoundProfileFixture(options);const root=profile.stateRoot;const path=profile.path;const clock=manualClock(new Date(NOW));
 const db=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"foundation-proof"},clock);
 const config=ConfigSchema.parse({paths:defaultRuntimePaths()});
 const snapshot=ConfigSnapshotRecordSchema.parse({configSnapshotId:id(90),revision:1,fingerprint:sha256Hex(canonicalJsonStringify(config)),capturedAt:NOW,capturedBy:"local-operator",config,provenance:{}});
 db.authority.runtimeConfig.initialize(snapshot);
 let admissionIdentity=10000;
 const createRun=(runId:string)=>{
 const workerId=db.withAuthorityTransaction(repositories=>{
  const slots=repositories.workerSlots.list("person-lookup").filter(slot=>slot.retiredAt===null);
  const free=slots.find(slot=>!repositories.runs.listByWorker(slot.workerId).some(run=>["claimed","validating","running"].includes(run.lifecycle.state)));
  const poolIndex=free?.poolIndex??[1,2,3].find(index=>!slots.some(slot=>slot.poolIndex===index));
  assert.ok(poolIndex!==undefined,"fixture exceeds genuine worker pool capacity");
  const slot=admitDirectWorker(repositories,{commandId:id(admissionIdentity++),workflow:"person-lookup",poolIndex,
    expectedPoolVersion:repositories.workerPools.get("person-lookup")?.version??0,processId:process.pid,
    processAcquisitionId:id(admissionIdentity++),authorityPath:path,processLockRoot:join(root,"locks"),now:NOW},id(admissionIdentity++));
  if(repositories.workerLeases.get(slot.workerId)===undefined)assert.equal(repositories.workerLeases.start({workerId:slot.workerId,
    workflow:"person-lookup",browserSystems:workflowProjections(personLookupDescriptor).systems,processId:process.pid,
    requestedBy:"local-operator",now:NOW}).state,"started");
  return slot.workerId;
 });
 db.authority.runs.enqueue({...QUEUED_RUN,input: { ...QUEUED_RUN.input, parsed: {
 schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"), value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
 protectedBindings: [{kind:"test-data-local",inputPath:"emplId",name:"personLookupCanaryEid",sourceId:id(89)}] } },envelope:{...QUEUED_RUN.envelope,runId, itemId:runId, descriptorVersion:personLookupDescriptor.version, contractFingerprint:personLookupDescriptor.contractFingerprint,configFingerprint:snapshot.fingerprint,configSnapshotId:snapshot.configSnapshotId}});
 const claim=db.authority.runs.claimNext({workflow:"person-lookup",workerId,now:NOW});assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("fixture claim failed");
 const validating=db.authority.runs.transition({runId,expectedVersion:claim.run.version,claim:{workerId,claimGeneration:1},lifecycle:{state:"validating",workerId,claimedAt:NOW,heartbeatAt:NOW},now:NOW});assert.equal(validating.state,"applied");if(validating.state!=="applied")throw new Error("fixture validation failed");
 const running=db.authority.runs.transition({runId,expectedVersion:validating.run.version,claim:{workerId,claimGeneration:1},lifecycle:{state:"running",workerId,claimedAt:NOW,heartbeatAt:NOW,currentNodeId:"searching"},now:NOW});assert.equal(running.state,"applied");if(running.state!=="applied")throw new Error("fixture run failed");
 return running.run;
 };
 const run=createRun(RUN_ID);
 return {root,path,clock,db,snapshot,run,createRun,dispose:()=>{db.close();profile.close();}};
}
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
export function resolutionPeer(path: string) {
  const child = fork(fileURLToPath(new URL("../backend/failure-resolution-peer.ts", import.meta.url)), [path], { execArgv: ["--import", "tsx"], silent: true });
  let failure = "";
  child.stderr?.on("data", chunk => { failure += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`diagnostic peer exit ${String(code)}: ${failure}`)));
    child.once("error", reject);
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.once("message", message => {
      if (message !== null && typeof message === "object" && "state" in message && message.state === "ready") resolve();
      else reject(new Error("diagnostic peer did not become ready"));
    });
    child.once("error", reject);
  });
  return { ready, exited, send: async (command: unknown) => {
    await ready;
    const result = new Promise<ReturnType<typeof CommandResultSchema.parse>>((resolve, reject) => {
      child.once("message", message => {
        try {
          if (message === null || typeof message !== "object" || !("result" in message)) throw new Error("peer result missing");
          resolve(CommandResultSchema.parse(message.result));
        } catch (error) { reject(error instanceof Error ? error : new Error("invalid diagnostic peer response")); }
      });
      child.once("error", reject);
    });
    child.send(FailureResolutionCommandSchema.parse(command)); const value = await result; await exited; return value;
  }, stop: () => { if (child.exitCode === null && child.signalCode === null) child.kill(); } };
}
