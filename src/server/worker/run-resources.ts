import { preflightSessionFactory } from "../../backend/app/preflight/worker-admission.js";
import type { RuntimePreflight } from "../../backend/app/preflight/runtime-admission.js";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { Clock } from "../../domain/clock.js";
import type { IdFactory } from "../../domain/identifiers.js";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import type { CredentialStore } from "../../domain/config/credential-store.js";
import type { Config } from "../../domain/config/schema.js";
import { configSnapshotAbsentLeaves, executionConfigFromStored } from "../../domain/config/snapshot-generations.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import type { RunRecord } from "../../domain/run/record.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { ProviderAdmissionIdSchema } from "../../domain/ids.js";
import { optionalSecretFamily, providerModelChain } from "../../domain/secrets.js";
import { PlaywrightWorkerSessionFactory } from "../../infra/browser/browser-session-factory.js";
import { createGeminiOcrExtractAdapter } from "../../infra/providers/gemini-ocr-extract.js";
import { createCensusGeocodeAdapter, createNominatimGeocodeAdapter } from "../../infra/providers/geocode-adapters.js";
import { createProviderPool } from "../../infra/providers/provider-pool.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";
import { composeDuoCeremonyGateFactory, type DuoCeremonyGateFactory } from "../../core/duo-ceremony-gate.js";
import type { MonotonicDeadlineScheduler } from "../../core/deadline-scheduler.js";
import type { WorkerBrowserSessionFactory } from "../../core/worker-sessions.js";
import type { WorkerRunResources } from "../../core/worker-loop.js";
import { selectRunSettings } from "../../core/run-settings.js";

export function createRunResourcesFactory(input:Readonly<{
 preflight?:RuntimePreflight;
 authority:AuthorityRepositories;artifacts:ContentAddressedArtifactWriter;clock:Clock;ids:IdFactory;
 isolation:RuntimeIsolation;protectedSecrets:Pick<CredentialStore,"read">;scheduler:MonotonicDeadlineScheduler;
 environment:Readonly<Record<string,string|undefined>>;sessionFactory?:WorkerBrowserSessionFactory;duoCeremony?:DuoCeremonyGateFactory;
}>) {
 const compose=(config:Config):WorkerRunResources=>{
  const keys=optionalSecretFamily("geminiApiKeys",input.environment);
  const models=providerModelChain("geminiApiKeys",config);
  const children=models.flatMap(modelId=>keys.map((apiKey,index)=>({label:`gemini-key${String(index+1)}/${modelId}`,adapter:createGeminiOcrExtractAdapter({apiKey,modelId,artifacts:input.artifacts,clock:input.clock})})));
  return Object.freeze({
   sessionFactory:input.sessionFactory??new PlaywrightWorkerSessionFactory({config,protectedSecrets:input.protectedSecrets,isolation:input.isolation,clock:input.clock,scheduler:input.scheduler,newSessionId:()=>input.ids.uuid()}),
   duoCeremony:input.duoCeremony??composeDuoCeremonyGateFactory({config,leases:input.authority.duoCeremonyLeases,clock:input.clock,scheduler:input.scheduler}),
   taskDeadlineMs:config.timeouts.taskMs,sessionAcquireMs:config.timeouts.sessionAcquireMs,
   defaultBrowserMode:config.browser.headless?"headless":"headed",
   providers:{adapters:Object.freeze({...children.length===0?{}:{"ocr.extract":createProviderPool("ocr.extract",children)},"geocode.census":createCensusGeocodeAdapter({clock:input.clock}),"geocode.nominatim":createNominatimGeocodeAdapter({clock:input.clock})}),
    repository:input.authority.providerAdmissions,accounting:input.authority.providerAccounting,configSnapshots:input.authority.configSnapshots,idFactory:{next:()=>ProviderAdmissionIdSchema.parse(input.ids.uuid())}},
  });
 };
 const cache=new Map<string,WorkerRunResources>();
 return Object.freeze({
  baseline:compose,
  forRun(run:RunRecord):WorkerRunResources {
   if (Object.values(run.envelope.resolvedInstance ?? {}).some(instance => instance === "test")) throw new Error("run-resources-retired-test-instance");
   const snapshot=ConfigSnapshotRecordSchema.parse(selectRunSettings(input.authority,run.envelope));
   if(sha256Hex(canonicalJsonStringify(snapshot.config))!==snapshot.fingerprint||configSnapshotAbsentLeaves(snapshot.config).length>0)throw new Error("run-resources-retained-snapshot-unavailable");
   const previous=cache.get(snapshot.fingerprint);
   const resources=previous??compose(executionConfigFromStored(snapshot.config));cache.set(snapshot.fingerprint,resources);
   return input.preflight===undefined?resources:Object.freeze({...resources,sessionFactory:preflightSessionFactory(resources.sessionFactory,input.preflight,input.preflight.runScope(run.envelope))});
  },
 });
}
