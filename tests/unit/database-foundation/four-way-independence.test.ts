import { ConfigSchema } from "../../../src/domain/config/schema.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { createAdmittedProviderClient } from "../../../src/core/provider-admission.js";
import { createDeterministicProviderHarness } from "../../../src/infra/providers/deterministic-provider.js";
import { ProviderAdmissionIdSchema, IsoInstantSchema, FingerprintSchema } from "../../../src/domain/ids.js";
import { composeFailureResolution } from "../../../src/server/dashboard/compose/failure-resolution.js";
import { bindFailureCapture } from "../../../src/core/failure-resolution.js";
import { createDiagnosticCaptureService } from "../../../src/services/trust/diagnostic-capture.js";
import { createRunDiagnosticCapture } from "../../../src/services/trust/run-diagnostic-capture.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createArtifactSinkProjector } from "../../../src/infra/artifacts/artifact-sink-projector.js";
import { createXlsxRetentionSink } from "../../../src/infra/artifacts/xlsx-retention-sink.js";
import { projectGeneratedUpdates } from "../../../src/core/generated-artifact-projection.js";
import { selectRunRuntime,selectNewRunIdentity } from "../../../src/core/run-settings.js";
import { runRuntimeMatches } from "../../../src/core/run-claim-admission.js";
import { createRunResourcesFactory } from "../../../src/server/worker/run-resources.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { foundationFixture,failure,update,NOW,HASH,id } from "./fixtures.js";

type Fixture=ReturnType<typeof foundationFixture>;
const scheduler={schedule:()=>({cancel:()=>undefined})};
const artifacts=(f:Fixture)=>createContentAddressedArtifactWriter({workspaceRoot:f.root,artifactRoot:".tracker/artifacts"});
const flows={
 async P(f:Fixture){
  const value={schemaHash:FingerprintSchema.parse(HASH),value:{synthetic:true}};
  const adapter=createDeterministicProviderHarness("ocr.extract",[{kind:"return",estimate:{maximumCostUsdMicros:0},outcome:{response:{state:"produced",value},usage:{requestCount:1,costUsdMicros:0},evidence:{summary:"synthetic",capturedAt:IsoInstantSchema.parse(NOW)}}}]);
  const client=createAdmittedProviderClient("ocr.extract",{execution:{runId:f.run.envelope.runId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,configSnapshot:f.snapshot,runSignal:new AbortController().signal,adapters:{"ocr.extract":adapter.adapter},repository:f.db.authority.providerAdmissions,accounting:f.db.authority.providerAccounting,clock:f.clock,idFactory:{next:()=>ProviderAdmissionIdSchema.parse(id(60))},deadlineScheduler:scheduler});
  assert.deepEqual(await client.call(value),{state:"produced",value});assert.equal(adapter.calls().length,1);
  assert.equal(f.db.authority.providerAdmissions.get(id(60))?.lifecycle.state,"settled");
 },
 async D(f:Fixture){
  const record=failure();const capture=bindFailureCapture(createRunDiagnosticCapture({service:createDiagnosticCaptureService({artifacts:artifacts(f),authority:f.db.authority,clock:f.clock,ids:sequentialIdFactory("d")})}));
  const bundle=await capture.captureForFailure({failure:record,configFingerprint:f.snapshot.fingerprint,descriptorFingerprint:HASH});
  const seed=new DatabaseSync(f.path);
  try{seed.prepare("INSERT INTO run_failures(record_key,run_id,fingerprint,record_json,created_at) VALUES(?,?,?,?,?)").run(record.failureId,record.runId,record.fingerprint,JSON.stringify({...record,diagnosticBundleId:bundle.bundleId}),record.occurredAt);}finally{seed.close();}
  f.db.withAuthorityTransaction(()=>capture.persist(bundle));
  const api=composeFailureResolution(f.db.authority);assert.equal(api.query.getFailure(record.failureId)?.writeState,"unknown");assert.deepEqual(api.query.read(record.runId,record.failureId)?.resolution,{status:"unresolved",version:1});assert.equal(api.commands.capability().state,"unavailable");
  assert.deepEqual(f.db.authority.diagnosticBundles.get(bundle.bundleId),bundle);
 },
 async G(f:Fixture){
  f.db.authority.artifactOutbox.insert(update());const workbookPath=join(f.root,"retention.xlsx");
  const projector=createArtifactSinkProjector({authority:f.db.authority,withAuthorityTransaction:work=>f.db.withAuthorityTransaction(work),sinks:{"xlsx-retention":createXlsxRetentionSink({workbookPath,artifacts:artifacts(f)})},lockDir:join(f.root,"locks"),clock:f.clock});
  await projectGeneratedUpdates(projector,[id(1)]);assert.equal(f.db.authority.artifactOutbox.get(id(1))?.state,"projected");assert.ok(readFileSync(workbookPath).length>0);assert.equal(f.db.authority.generatedArtifacts.get("sink:xlsx-retention")?.state,"ready");
 },
 async S(f:Fixture){
  f.db.authority.runtimeConfig.activate({settingsRevision:1,settingsFingerprint:HASH,configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,activatedAt:NOW});
  const token=selectRunRuntime(f.db.authority);assert.ok(runRuntimeMatches(f.db.authority,token));assert.equal(runRuntimeMatches(f.db.authority,{...token,generation:token.generation+1}),false);
  assert.deepEqual(selectNewRunIdentity(f.db.authority,f.run.envelope),f.run.envelope);
  const writer=artifacts(f);await writer.ready;
  const factory=createRunResourcesFactory({authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("b"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>undefined},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("synthetic proof must not open a browser");}}});
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
   const factory=createRunResourcesFactory({authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("c"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>undefined},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("no browser in snapshot proof");}}});
   const first=factory.forRun(f.run);
   const config=ConfigSchema.parse({...f.snapshot.config,timeouts:{...f.snapshot.config.timeouts,taskMs:f.snapshot.config.timeouts.taskMs+1000,sessionAcquireMs:f.snapshot.config.timeouts.sessionAcquireMs+1000},browser:{...f.snapshot.config.browser,headless:!f.snapshot.config.browser.headless}});
   const snapshot={...f.snapshot,configSnapshotId:id(91),config,fingerprint:sha256Hex(canonicalJsonStringify(config))};f.db.authority.configSnapshots.insert(snapshot);
   const next=factory.forRun({...f.run,envelope:{...f.run.envelope,configSnapshotId:snapshot.configSnapshotId,configFingerprint:snapshot.fingerprint}});
   assert.equal(next.taskDeadlineMs,config.timeouts.taskMs);assert.equal(next.sessionAcquireMs,config.timeouts.sessionAcquireMs);assert.notEqual(next.defaultBrowserMode,first.defaultBrowserMode);assert.notEqual(next.sessionFactory,first.sessionFactory);
   assert.equal(factory.forRun(f.run),first);assert.equal(first.taskDeadlineMs,f.snapshot.config.timeouts.taskMs);
   assert.throws(()=>factory.forRun({...f.run,envelope:{...f.run.envelope,configFingerprint:HASH}}),/snapshot-mismatch/u);
  }finally{f.dispose();}
 });
 it("freezes four distinct existing source sets with no cross-owner mutable imports",()=>{
  const scopes:Record<string,string[]>={P:["src/infra/sqlite/provider-accounting.ts","src/core/provider-admission.ts"],D:["src/core/failure-resolution.ts","src/infra/sqlite/failure-resolution.ts","src/server/dashboard/queries/failure-resolution.ts","src/server/dashboard/commands/failure-resolution.ts","src/server/dashboard/compose/failure-resolution.ts","src/server/dashboard/queries/run-trust.ts","src/dashboard/surfaces/trust.tsx","src/dashboard/surfaces/trust-model.ts"],G:["src/core/generated-artifact-projection.ts","src/infra/sqlite/generated-artifacts.ts","src/infra/artifacts/artifact-sink-projector.ts","src/infra/artifacts/xlsx-retention-sink.ts","src/server/dashboard/exports/operator-xlsx-export-service.ts","src/server/dashboard/compose/generated-exports.ts"],S:["src/core/run-settings.ts","src/core/run-claim-admission.ts","src/infra/sqlite/settings-activation.ts","src/server/worker/run-resources.ts","src/server/settings-runtime.ts","src/server/dashboard/commands/settings-service.ts","src/server/dashboard/commands/start-plan-service.ts","src/server/dashboard/queries/settings.ts","src/server/dashboard/queries/settings-editor.ts","src/dashboard/surfaces/settings.tsx","src/dashboard/surfaces/settings-model.ts"]};
  const all=Object.values(scopes).flat();assert.equal(new Set(all).size,all.length);for(const path of all)assert.ok(existsSync(path),path);
  for(const [owner,files] of Object.entries(scopes))for(const file of files)for(const [peer,others] of Object.entries(scopes))if(owner!==peer)for(const other of others){const name=other.split("/").at(-1)?.replace(/\.tsx?$/u,"");assert.ok(name);assert.equal(readFileSync(file,"utf8").includes(`/${name}.js"`),false,`${owner} imports mutable ${peer}: ${file}`);}
 });
});
