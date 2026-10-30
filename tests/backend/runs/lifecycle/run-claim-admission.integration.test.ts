import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { composeFailureResolution } from "../../../../src/backend/app/composition/dashboard/failure-resolution.js";
import { createRunResourcesFactory } from "../../../../src/backend/app/composition/worker/run-resources.js";
import { assertProfileBrowserRoot } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { boundProfileAdmission, findProfileFixtureAdmission } from "../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createRunDiagnosticCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { projectGeneratedUpdates } from "../../../../src/backend/logs/generated-artifact-projection.js";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { createProviderClient } from "../../../../src/backend/processing/providers/provider-client.js";
import { bindFailureCapture } from "../../../../src/backend/runs/lifecycle/failure-resolution.js";
import { runRuntimeMatches } from "../../../../src/backend/runs/lifecycle/run-claim-admission.js";
import { selectNewRunIdentity,selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createArtifactSinkProjector } from "../../../../src/backend/storage/artifacts/artifact-sink-projector.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createXlsxRetentionSink } from "../../../../src/backend/storage/artifacts/xlsx-retention-sink.js";
import { FingerprintSchema,IsoInstantSchema,PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { failure,foundationFixture,HASH,id,NOW,terminalizeFixtureFailure,update } from "../../../support/helpers/database-foundation/fixtures.js";
import { resolutionCommand,resolutionKernel } from "../../../support/helpers/failure-resolution/fixtures.js";

import { chatGptFixture } from "../../../support/helpers/chatgpt-account-fixtures.js";
import { CHATGPT_OCR_MODEL,createChatGptOcrAdapter } from "../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";

type Fixture=Awaited<ReturnType<typeof foundationFixture>>;
const scheduler={schedule:()=>({cancel:()=>undefined})};
const artifacts=(f:Fixture)=>createContentAddressedArtifactWriter({admission: boundProfileAdmission(f.path)});
const flows={
 async P(f:Fixture){
  const value={schemaHash:FingerprintSchema.parse(HASH),value:{synthetic:true}};
  const adapter=createDeterministicProviderHarness("geocode.census",[{kind:"return",outcome:{response:{state:"produced",value},evidence:{summary:"synthetic",capturedAt:IsoInstantSchema.parse(NOW)}}}]);
  const client=createProviderClient("geocode.census",{execution:{runId:f.run.envelope.runId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,configSnapshot:f.snapshot,runSignal:new AbortController().signal,adapters:{"geocode.census":adapter.adapter},clock:f.clock,idFactory:{next:()=>id(60)},deadlineScheduler:scheduler});
  assert.deepEqual(await client.call(value),{state:"produced",value});assert.equal(adapter.calls().length,1);
  assert.equal(adapter.calls()[0]?.options.requestId,id(60));
 },
 async D(f:Fixture){
  const run=f.createRun(id(81));const record={...failure(),runId:run.envelope.runId,traceId:run.envelope.traceId};const writer=artifacts(f);await writer.ready;const capture=bindFailureCapture(createRunDiagnosticCapture({service:createDiagnosticCaptureService({artifacts:writer,authority:f.db.authority,clock:f.clock,ids:sequentialIdFactory("d")})}));
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
  const admission=findProfileFixtureAdmission(f.root);assert.ok(admission);
  f.db.authority.runtimeConfig.requireSettingsCurrent();
  const token=selectRunRuntime(f.db.authority);assert.ok(runRuntimeMatches(f.db.authority,token));assert.equal(runRuntimeMatches(f.db.authority,{...token,generation:PositiveIntSchema.parse(token.generation+1)}),false);
  assert.deepEqual(selectNewRunIdentity(f.db.authority,f.run.envelope),f.run.envelope);
  const writer=artifacts(f);await writer.ready;
  const account=await chatGptFixture(admission);try{
  const ocr=createChatGptOcrAdapter({account:account.service,artifacts:writer,clock:f.clock,model:CHATGPT_OCR_MODEL,assertCurrent:()=>admission.assertProfileRuntime()});
  const factory=createRunResourcesFactory({ocr,assertBrowserRoot:root=>assertProfileBrowserRoot(admission,root),assertProfileOwner:()=>{throw new Error("snapshot proof must not acquire a browser profile");},authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("b"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>{throw new Error("unexpected credential read");}},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("synthetic proof must not open a browser");}}});
  const resources=factory.forRun(f.run);assert.equal(resources.taskDeadlineMs,f.snapshot.config.timeouts.taskMs);assert.equal(resources.sessionAcquireMs,f.snapshot.config.timeouts.sessionAcquireMs);assert.equal(resources.defaultBrowserMode,f.snapshot.config.browser.headless?"headless":"headed");assert.ok(resources.providers?.adapters["geocode.nominatim"]);
  assert.equal(factory.forRun(f.run),resources);
  }finally{await account.cleanup();}
 },
};
describe("F actual four-way baseline independence",()=>{
 const owners=["P","D","G","S"] as const;
 for(const [i,a] of owners.entries())for(const b of owners.slice(i+1))for(const order of [[a,b],[b,a]])it(`${order.join(" then ")} operates independently on one real authority`,async()=>{
  const f=await foundationFixture();try{for(const owner of order)await flows[owner](f);for(const owner of order){if(owner==="D")assert.equal(f.db.authority.failures.get(id(80))?.writeState,"unknown");if(owner==="G")assert.equal(f.db.authority.generatedArtifacts.get("sink:xlsx-retention")?.state,"ready");if(owner==="S")assert.ok(runRuntimeMatches(f.db.authority,selectRunRuntime(f.db.authority)));}}finally{await f.dispose();}
 });
});
