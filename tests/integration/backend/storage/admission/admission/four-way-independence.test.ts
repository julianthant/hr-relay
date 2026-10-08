import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { PositiveIntSchema, ConfigSnapshotIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { resolutionKernel, resolutionCommand } from "../../../../../support/helpers/failure-resolution/fixtures.js";
import { ConfigSchema } from "../../../../../../src/models/config/schema.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { createAdmittedProviderClient } from "../../../../../../src/backend/runs/start/provider-admission.js";
import { createDeterministicProviderHarness } from "../../../../../../src/backend/processing/providers/deterministic-provider.js";
import { ProviderAdmissionIdSchema, IsoInstantSchema, FingerprintSchema } from "../../../../../../src/rules/identity/ids.js";
import { composeFailureResolution } from "../../../../../../src/backend/app/composition/dashboard/failure-resolution.js";
import { bindFailureCapture } from "../../../../../../src/backend/runs/lifecycle/failure-resolution.js";
import { createDiagnosticCaptureService } from "../../../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createRunDiagnosticCapture } from "../../../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { createContentAddressedArtifactWriter } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createArtifactSinkProjector } from "../../../../../../src/backend/storage/artifacts/artifact-sink-projector.js";
import { createXlsxRetentionSink } from "../../../../../../src/backend/storage/artifacts/xlsx-retention-sink.js";
import { projectGeneratedUpdates } from "../../../../../../src/backend/logs/generated-artifact-projection.js";
import { selectRunRuntime,selectNewRunIdentity } from "../../../../../../src/backend/runs/settings/run-settings.js";
import { runRuntimeMatches } from "../../../../../../src/backend/runs/lifecycle/run-claim-admission.js";
import { createRunResourcesFactory } from "../../../../../../src/backend/app/composition/worker/run-resources.js";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { foundationFixture,failure,terminalizeFixtureFailure,update,NOW,HASH,id } from "../../../../../support/helpers/database-foundation/fixtures.js";

type Fixture=ReturnType<typeof foundationFixture>;
const scheduler={schedule:()=>({cancel:()=>undefined})};
const artifacts=(f:Fixture)=>createContentAddressedArtifactWriter({admission: RuntimeAdmission.syntheticRoots(join(f.root, ".tracker"), join(f.root, ".tracker/artifacts"))});
const flows={
 async P(f:Fixture){
  const value={schemaHash:FingerprintSchema.parse(HASH),value:{synthetic:true}};
  const adapter=createDeterministicProviderHarness("ocr.extract",[{kind:"return",estimate:{maximumCostUsdMicros:0},outcome:{response:{state:"produced",value},usage:{requestCount:1,costUsdMicros:0},evidence:{summary:"synthetic",capturedAt:IsoInstantSchema.parse(NOW)}}}]);
  const client=createAdmittedProviderClient("ocr.extract",{execution:{runId:f.run.envelope.runId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,configSnapshot:f.snapshot,runSignal:new AbortController().signal,adapters:{"ocr.extract":adapter.adapter},repository:f.db.authority.providerAdmissions,accounting:f.db.authority.providerAccounting,clock:f.clock,idFactory:{next:()=>ProviderAdmissionIdSchema.parse(id(60))},deadlineScheduler:scheduler});
  assert.deepEqual(await client.call(value),{state:"produced",value});assert.equal(adapter.calls().length,1);
  assert.equal(f.db.authority.providerAdmissions.get(id(60))?.lifecycle.state,"settled");
 },
 async D(f:Fixture){
  const run=f.createRun(id(81));const record={...failure(),runId:run.envelope.runId,traceId:run.envelope.traceId};const capture=bindFailureCapture(createRunDiagnosticCapture({service:createDiagnosticCaptureService({artifacts:artifacts(f),authority:f.db.authority,clock:f.clock,ids:sequentialIdFactory("d")})}));
  const bundle=await capture.captureForFailure({failure:record,configFingerprint:f.snapshot.fingerprint,descriptorFingerprint:HASH});
  f.db.withAuthorityTransaction(()=>{terminalizeFixtureFailure(f,run,{...record,diagnosticBundleId:bundle.bundleId});capture.persist(bundle);});
  const api=composeFailureResolution(f.db.authority);assert.equal(api.query.getFailure(record.failureId)?.writeState,"unknown");assert.deepEqual(api.query.read(record.runId,record.failureId)?.resolution,{status:"unresolved",version:1});assert.equal(api.commands.capability().state,"available");
  const kernel=resolutionKernel(f.db,f.clock);
  assert.equal(kernel.execute(resolutionCommand({target:{runId:record.runId,failureId:record.failureId,expectedVersion:1}})).state,"applied");
  assert.equal(api.query.read(record.runId,record.failureId)?.resolution.status,"resolved");
  const unavailable=resolutionKernel(f.db,f.clock,{failureResolution:{capability:()=>({state:"unavailable",reason:"resolution-not-implemented"}),execute:()=>{throw new Error("unavailable executor reached");}}});
  const blocked=resolutionCommand({target:{runId:record.runId,failureId:record.failureId,expectedVersion:2},payload:{action:"reopen"}});
  const generation=f.db.getMeta().authorityGeneration;
  assert.equal(unavailable.execute(blocked).state,"rejected");assert.equal(f.db.getMeta().authorityGeneration,generation);assert.equal(f.db.authority.commands.get(blocked.commandId),undefined);
  assert.deepEqual(f.db.authority.diagnosticBundles.get(bundle.bundleId),bundle);
 },
 async G(f:Fixture){
  f.db.authority.artifactOutbox.insert(update());const workbookPath=join(f.root,"retention.xlsx");
  const projector=createArtifactSinkProjector({authority:f.db.authority,withAuthorityTransaction:work=>f.db.withAuthorityTransaction(work),sinks:{"xlsx-retention":createXlsxRetentionSink({workbookPath,artifacts:artifacts(f)})},lockDir:join(f.root,"locks"),clock:f.clock});
  await projectGeneratedUpdates(projector,[id(1)]);assert.equal(f.db.authority.artifactOutbox.get(id(1))?.state,"projected");assert.ok(readFileSync(workbookPath).length>0);assert.equal(f.db.authority.generatedArtifacts.get("sink:xlsx-retention")?.state,"ready");
 },
 async S(f:Fixture){
  f.db.authority.runtimeConfig.activate({settingsRevision:1,settingsFingerprint:HASH,configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,activatedAt:NOW});
  const token=selectRunRuntime(f.db.authority);assert.ok(runRuntimeMatches(f.db.authority,token));assert.equal(runRuntimeMatches(f.db.authority,{...token,generation:PositiveIntSchema.parse(token.generation+1)}),false);
  assert.deepEqual(selectNewRunIdentity(f.db.authority,f.run.envelope),f.run.envelope);
  const writer=artifacts(f);await writer.ready;
  const factory=createRunResourcesFactory({authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("b"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>{throw new Error("unexpected credential read");}},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("synthetic proof must not open a browser");}}});
  const resources=factory.forRun(f.run);assert.equal(resources.taskDeadlineMs,f.snapshot.config.timeouts.taskMs);assert.equal(resources.sessionAcquireMs,f.snapshot.config.timeouts.sessionAcquireMs);assert.equal(resources.defaultBrowserMode,f.snapshot.config.browser.headless?"headless":"headed");assert.equal(resources.providers?.accounting,f.db.authority.providerAccounting);
  assert.equal(factory.forRun(f.run),resources);
 },
};
describe("F actual four-way baseline independence",()=>{
 const owners=["P","D","G","S"] as const;
 for(const [i,a] of owners.entries())for(const b of owners.slice(i+1))for(const order of [[a,b],[b,a]])it(`${order.join(" then ")} operates independently on one real authority`,async()=>{
  const f=foundationFixture();try{for(const owner of order)await flows[owner](f);for(const owner of order){if(owner==="P")assert.equal(f.db.authority.providerAdmissions.get(id(60))?.lifecycle.state,"settled");if(owner==="D")assert.equal(f.db.authority.failures.get(id(80))?.writeState,"unknown");if(owner==="G")assert.equal(f.db.authority.generatedArtifacts.get("sink:xlsx-retention")?.state,"ready");if(owner==="S")assert.ok(runRuntimeMatches(f.db.authority,selectRunRuntime(f.db.authority)));}}finally{f.dispose();}
 });
 it("selects actual resources from each retained snapshot and preserves the first run after a newer selection",async()=>{
  const f=foundationFixture();try{
   const writer=artifacts(f);await writer.ready;
   const factory=createRunResourcesFactory({authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("c"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>{throw new Error("unexpected credential read");}},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("no browser in snapshot proof");}}});
   const first=factory.forRun(f.run);
   const config=ConfigSchema.parse({...f.snapshot.config,timeouts:{...f.snapshot.config.timeouts,taskMs:f.snapshot.config.timeouts.taskMs+1000,sessionAcquireMs:1000+PositiveIntSchema.parse(f.snapshot.config.timeouts.sessionAcquireMs)},browser:{...f.snapshot.config.browser,headless:!f.snapshot.config.browser.headless}});
   const snapshot={...f.snapshot,configSnapshotId:ConfigSnapshotIdSchema.parse(id(91)),config,fingerprint:FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config)))};f.db.authority.configSnapshots.insert(snapshot);
   const next=factory.forRun({...f.run,envelope:{...f.run.envelope,configSnapshotId:snapshot.configSnapshotId,configFingerprint:snapshot.fingerprint}});
   assert.equal(next.taskDeadlineMs,config.timeouts.taskMs);assert.equal(next.sessionAcquireMs,config.timeouts.sessionAcquireMs);assert.notEqual(next.defaultBrowserMode,first.defaultBrowserMode);assert.notEqual(next.sessionFactory,first.sessionFactory);
   assert.equal(factory.forRun(f.run),first);assert.equal(first.taskDeadlineMs,f.snapshot.config.timeouts.taskMs);
   assert.throws(()=>factory.forRun({...f.run,envelope:{...f.run.envelope,configFingerprint:FingerprintSchema.parse(HASH)}}),/snapshot-mismatch/u);
  }finally{f.dispose();}
 });
 it("freezes four distinct existing source sets with no cross-owner mutable imports",()=>{
  const scopes:Record<string,string[]>={P:["src/backend/storage/sqlite/provider-accounting.ts","src/backend/runs/start/provider-admission.ts"],D:["src/backend/runs/lifecycle/failure-resolution.ts","src/backend/storage/sqlite/failure-resolution.ts","src/backend/runs/queries/failure-resolution.ts","src/backend/runs/commands/failure-resolution.ts","src/backend/app/composition/dashboard/failure-resolution.ts","src/backend/runs/queries/run-trust.ts","src/dashboard/surfaces/trust.tsx","src/dashboard/surfaces/trust-model.ts"],G:["src/backend/logs/generated-artifact-projection.ts","src/backend/storage/sqlite/generated-artifacts.ts","src/backend/storage/artifacts/artifact-sink-projector.ts","src/backend/storage/artifacts/xlsx-retention-sink.ts","src/backend/runs/exports/operator-xlsx-export-service.ts","src/backend/app/composition/dashboard/generated-exports.ts"],S:["src/backend/runs/settings/run-settings.ts","src/backend/runs/lifecycle/run-claim-admission.ts","src/backend/storage/sqlite/settings-activation.ts","src/backend/app/composition/worker/run-resources.ts","src/backend/runtime/settings/settings-runtime.ts","src/backend/runs/commands/settings-service.ts","src/backend/runs/commands/start-plan-service.ts","src/backend/runs/queries/settings.ts","src/backend/runs/queries/settings-editor.ts","src/dashboard/surfaces/settings/settings.tsx","src/dashboard/surfaces/settings/settings-model.ts"]};
  const all=Object.values(scopes).flat();assert.equal(new Set(all).size,all.length);for(const path of all)assert.ok(existsSync(path),path);
  for(const [owner,files] of Object.entries(scopes))for(const file of files)for(const [peer,others] of Object.entries(scopes))if(owner!==peer)for(const other of others){const name=other.split("/").at(-1)?.replace(/\.tsx?$/u,"");assert.ok(name);assert.equal(readFileSync(file,"utf8").includes(`/${name}.js"`),false,`${owner} imports mutable ${peer}: ${file}`);}
 });
});
