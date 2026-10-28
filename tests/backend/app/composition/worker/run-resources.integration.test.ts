import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { existsSync,readFileSync } from "node:fs";

import { describe,it } from "vitest";
import { duoCeremonyGatesOver } from "../../../../support/helpers/duo-ceremony-fixtures.js";
import { createRunResourcesFactory } from "../../../../../src/backend/app/composition/worker/run-resources.js";
import { assertProfileBrowserRoot } from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import { boundProfileAdmission, findProfileFixtureAdmission } from "../../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { ConfigSchema } from "../../../../../src/models/config/schema.js";
import { ConfigSnapshotIdSchema,FingerprintSchema,PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { foundationFixture,HASH,id } from "../../../../support/helpers/database-foundation/fixtures.js";

import { chatGptFixture,completedOcrStream } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { CHATGPT_OCR_MODEL,createChatGptOcrAdapter } from "../../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";

import { createCapabilityWiringTestWorld } from "../../../../support/helpers/backend/capability-wiring-world.js";
import { testRunLifecycle } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../../../support/helpers/phase1f-executor-harness.js";
import { executeClaimedRun } from "../../../../../src/backend/runtime/execution/run-executor.js";
import { WorkerSessionManager } from "../../../../../src/backend/runtime/workers/worker-sessions.js";
import { extractFormPageTask } from "../../../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { ExtractFormPage } from "../../../../../src/models/processing/ocr/extract-form-page.js";
import { AdmittedExtractionSchema } from "../../../../../src/models/ocr/extraction.js";
import { defineServiceStore,defineTaskStoreRegistry } from "../../../../../src/workflow-kit/task-registry.js";
import { defineWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../../src/workflow-kit/flow.js";
import { WorkerIdSchema,WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";

type Fixture=Awaited<ReturnType<typeof foundationFixture>>;
const scheduler={schedule:()=>({cancel:()=>undefined})};
const artifacts=(f:Fixture)=>createContentAddressedArtifactWriter({admission: boundProfileAdmission(f.path)});
describe("F actual four-way baseline independence",()=>{
 const _owners=["P","D","G","S"] as const;
 it("selects actual resources from each retained snapshot and preserves the first run after a newer selection",async()=>{
  const f=await foundationFixture();let account:Awaited<ReturnType<typeof chatGptFixture>>|undefined;try{
   const admission=findProfileFixtureAdmission(f.root);assert.ok(admission);
   const writer=artifacts(f);await writer.ready;
   account=await chatGptFixture(admission);
   const ocr=createChatGptOcrAdapter({account:account.service,artifacts:writer,clock:f.clock,model:CHATGPT_OCR_MODEL,assertCurrent:()=>admission.assertProfileRuntime()});
   const factory=createRunResourcesFactory({ocr,assertBrowserRoot:root=>assertProfileBrowserRoot(admission,root),assertProfileOwner:()=>{throw new Error("snapshot proof must not acquire a browser profile");},authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("c"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>{throw new Error("unexpected credential read");}},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("no browser in snapshot proof");}}});
   const first=factory.forRun(f.run);
   const config=ConfigSchema.parse({...f.snapshot.config,timeouts:{...f.snapshot.config.timeouts,taskMs:f.snapshot.config.timeouts.taskMs+1000,sessionAcquireMs:1000+PositiveIntSchema.parse(f.snapshot.config.timeouts.sessionAcquireMs)},browser:{...f.snapshot.config.browser,headless:!f.snapshot.config.browser.headless}});
   const snapshot={...f.snapshot,configSnapshotId:ConfigSnapshotIdSchema.parse(id(91)),config,fingerprint:FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config)))};f.db.authority.configSnapshots.insert(snapshot);
   const next=factory.forRun({...f.run,envelope:{...f.run.envelope,configSnapshotId:snapshot.configSnapshotId,configFingerprint:snapshot.fingerprint}});
   assert.equal(next.taskDeadlineMs,config.timeouts.taskMs);assert.equal(next.sessionAcquireMs,config.timeouts.sessionAcquireMs);assert.notEqual(next.defaultBrowserMode,first.defaultBrowserMode);assert.notEqual(next.sessionFactory,first.sessionFactory);assert.equal(next.providers?.adapters["geocode.nominatim"],first.providers?.adapters["geocode.nominatim"]);
   assert.equal(first.providers?.adapters["ocr.extract"],ocr);assert.equal(next.providers?.adapters["ocr.extract"],ocr);
   assert.equal(factory.forRun(f.run),first);assert.equal(first.taskDeadlineMs,f.snapshot.config.timeouts.taskMs);
   assert.throws(()=>factory.forRun({...f.run,envelope:{...f.run.envelope,configFingerprint:FingerprintSchema.parse(HASH)}}),/snapshot-mismatch/u);
  }finally{await account?.cleanup();await f.dispose();}
 });
 it("freezes four distinct existing source sets with no cross-owner mutable imports",()=>{
  const scopes:Record<string,string[]>={P:["src/backend/processing/providers/provider-client.ts","src/backend/processing/providers/nominatim-owner.ts"],D:["src/backend/runs/lifecycle/failure-resolution.ts","src/backend/storage/sqlite/failure-resolution.ts","src/backend/runs/queries/failure-resolution.ts","src/backend/runs/commands/failure-resolution.ts","src/backend/app/composition/dashboard/failure-resolution.ts","src/backend/runs/queries/run-trust.ts"],G:["src/backend/logs/generated-artifact-projection.ts","src/backend/storage/sqlite/generated-artifacts.ts","src/backend/storage/artifacts/artifact-sink-projector.ts","src/backend/storage/artifacts/xlsx-retention-sink.ts","src/backend/runs/exports/operator-xlsx-export-service.ts","src/backend/app/composition/dashboard/generated-exports.ts"],S:["src/backend/runs/settings/run-settings.ts","src/backend/runs/lifecycle/run-claim-admission.ts","src/backend/storage/sqlite/settings-activation.ts","src/backend/app/composition/worker/run-resources.ts","src/backend/runtime/settings/settings-runtime.ts","src/backend/runs/commands/settings-service.ts","src/backend/runs/commands/start-plan-service.ts","src/backend/runs/queries/settings.ts","src/backend/runs/queries/settings-editor.ts","src/dashboard/surfaces/settings/settings.tsx","src/dashboard/surfaces/settings/settings-model.ts"]};
  assert.ok(readFileSync("src/backend/app/composition/worker/run-resources.ts","utf8").includes("/geocode-adapters.js\""));
  for (const paths of Object.values(scopes)) assert.ok(paths.length > 0);
  const all=Object.values(scopes).flat();assert.equal(new Set(all).size,all.length);for(const path of all)assert.ok(existsSync(path),path);
  for(const [owner,files] of Object.entries(scopes))for(const file of files)for(const [peer,others] of Object.entries(scopes))if(owner!==peer)for(const other of others){const name=other.split("/").at(-1)?.replace(/\.tsx?$/u,"");assert.ok(name);assert.equal(readFileSync(file,"utf8").includes(`/${name}.js"`),false,`${owner} imports mutable ${peer}: ${file}`);}
 });
});

it("registers the real account adapter in run resources and persists canonical admitted extraction through the executor",async()=>{
 const f=await foundationFixture(), world=createCapabilityWiringTestWorld();
 const admission=boundProfileAdmission(f.path), account=await chatGptFixture(admission);
 let resources:ReturnType<typeof createRunResourcesFactory>|undefined;
 let sessions:WorkerSessionManager|undefined;
 try{
  await account.connected();
  const writer=artifacts(f);await writer.ready;
  const page=await writer.put(Buffer.from("synthetic composed OCR page"),{mediaType:"image/png"});
  account.setSse(completedOcrStream(JSON.stringify({formType:"oath",sourcePage:1,sourceSha256:page.sha256,
   source:{kind:"provider",providerId:"chatgpt-subscription",modelId:CHATGPT_OCR_MODEL},readAt:f.clock.now().toISOString(),pageKind:"blank",record:null})));
  const base=world.fixtureDescriptor("ocr-composed-proof","oc",world.providersOnlyContract);
  const descriptor=defineWorkflowDescriptor({id:base.id,version:base.version,contractFingerprint:base.contractFingerprint,
   code:base.code,label:base.label,icon:base.icon,category:base.category,canonicalInput:base.canonicalInput,
   inputSubject:base.inputSubject,surface:base.surface,enqueue:base.enqueue,actions:base.actions,surfaces:{},details:[],
   identity:base.identity,presentation:base.presentation,scenarios:base.scenarios,flow:flow(base.canonicalInput)
   .step("extract",ExtractFormPage,{dependsOn:[],replay:"checkpoint",bind:()=>({formType:"oath",page,sourcePage:1})})
   .build({schema:z.strictObject({done:z.boolean()}),dependsOn:["extract"],derive:()=>({done:true})})});
  const stores=defineTaskStoreRegistry([defineServiceStore("ocr",{extract:extractFormPageTask})],{
   scenarioIds:ExtractFormPage.scenarios,tasks:[{id:ExtractFormPage.id,effect:ExtractFormPage.effect}]});
  const originalQueued=world.queuedRunFor(descriptor);
  const runId=randomUUID();
  const queued={...originalQueued,envelope:{...originalQueued.envelope,runId,itemId:runId}};
  const inserted=f.db.authority.runs.enqueue({...queued,envelope:{...queued.envelope,configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint}});
  assert.equal(inserted.state,"inserted");
  const claimed=world.claim({database:f.db,clock:f.clock,path:f.path},descriptor);
  const ocr=createChatGptOcrAdapter({account:account.service,artifacts:writer,clock:f.clock,model:CHATGPT_OCR_MODEL,assertCurrent:()=>admission.assertProfileRuntime()});
  resources=createRunResourcesFactory({ocr,authority:f.db.authority,artifacts:writer,clock:f.clock,ids:{uuid:randomUUID},isolation:rebuildRuntimeIsolation,
   protectedSecrets:{read:()=>{throw new Error("OCR cannot read HR credentials");}},scheduler,environment:{},
   duoCeremony:duoCeremonyGatesOver(f.db,f.clock,new ManualScheduler(f.clock)),
   assertProfileOwner:()=>{throw new Error("OCR cannot acquire a browser profile");},assertBrowserRoot:root=>assertProfileBrowserRoot(admission,root)});
  const selected=resources.forRun(claimed.run);assert.equal(selected.providers?.adapters["ocr.extract"],ocr);
  assert.ok(selected.duoCeremony);
  const deadlines=new ManualScheduler(f.clock,0);
  sessions=new WorkerSessionManager({workerId:WorkerIdSchema.parse(claimed.claim.workerId),workflowId:WorkflowIdSchema.parse(descriptor.id),stores,
   factory:selected.sessionFactory,clock:f.clock,scheduler:deadlines,acquireDeadlineMs:selected.sessionAcquireMs,duoCeremony:selected.duoCeremony});
  const events=recordingEmitter();
  const outcome=await executeClaimedRun({lifecycle:testRunLifecycle(f.db,f.clock),descriptor,stores,authority:f.db,sessions,emitter:events.emitter,
   clock:f.clock,ids:sequentialIdFactory("e"),scheduler:deadlines,taskDeadlineMs:selected.taskDeadlineMs,log:recordingLogger().log,providers:selected.providers,artifacts:writer},
   {...claimed,signal:new AbortController().signal});
  assert.equal(outcome.state,"done");
  const checkpoint=f.db.authority.runCheckpoints.latest(descriptor.id,claimed.run.envelope.itemId,"extract");assert.ok(checkpoint);
  const extraction=AdmittedExtractionSchema.parse(checkpoint.output.value);
  assert.equal(extraction.pageKind,"blank");assert.equal(extraction.record,null);assert.equal(extraction.sourceSha256,page.sha256);
  assert.equal(checkpoint.runId,claimed.run.envelope.runId);assert.equal(checkpoint.claimGeneration,claimed.claim.claimGeneration);
  assert.equal(checkpoint.contractFingerprint,descriptor.contractFingerprint);
  assert.ok(events.events().some(event=>event.t==="data.observed"));
  const calls=account.calls.filter(call=>call.url.endsWith("/responses"));assert.equal(calls.length,1);
 }finally{await sessions?.closeAll("worker-stop");await resources?.stop();await account.cleanup();await f.dispose();await world.cleanup();}
});
