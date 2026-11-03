import type { DuoSigningSource } from "../../../storage/configuration/duo-signing.js";
import { preflightSessionFactory } from "../../preflight/worker-admission.js";
import type { RuntimePreflight } from "../../preflight/runtime-admission.js";
import type { ContentAddressedArtifactWriter } from "../../../../workflow-kit/artifacts.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { IdFactory } from "../../../../rules/identity/identifiers.js";
import type { RuntimeIsolation } from "../../../../models/config/define-runtime-isolation.js";
import type { CredentialStore } from "../../../../models/config/credential-store.js";
import type { Config } from "../../../../models/config/schema.js";
import { StoredConfigSchema } from "../../../../models/config/snapshot.js";
import { ConfigSnapshotRecordSchema } from "../../../../models/config/snapshot.js";
import type { RunRecord } from "../../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { type BrowserSessionFactoryOptions, BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory, ProfileCustodyUnavailableError } from "../../../runtime/browser/browser-session-factory.js";
import { lstatSync } from "node:fs";
import type { WorkerId } from "../../../../rules/identity/ids.js";
import type { DebugEvent } from "../../../../models/events/timeline.js";
import { createCensusGeocodeAdapter } from "../../../processing/providers/geocode-adapters.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../../../storage/sqlite/authority-database.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { createBrowserRoots } from "../../../storage/browser-roots.js";
import { composeDuoCeremonyGateFactory, type DuoCeremonyGateFactory } from "../../../runtime/gates/duo-ceremony-gate.js";
import type { MonotonicDeadlineScheduler } from "../../../runtime/scheduling/deadline-scheduler.js";
import type { WorkerBrowserSessionFactory } from "../../../runtime/workers/worker-sessions.js";
import type { WorkerRunResources } from "../../../runtime/workers/worker-loop.js";
import { selectRunSettings } from "../../../runs/settings/run-settings.js";
import { createWorkbookLibraryAdapter } from "../../../processing/providers/workbook-library-adapter.js";
import { createOcrCheckpointPublication, admitOcrRunResources, OcrPublicationRefusedError } from "../../../runs/lifecycle/ocr-checkpoint-publication.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import { createRunWorkbookService } from "../../../runs/workbooks.js";

export function createRunResourcesFactory(input:Readonly<{
 preflight?:RuntimePreflight;
 duo?:DuoSigningSource;
 nominatim:NonNullable<NonNullable<WorkerRunResources["providers"]>["adapters"]["geocode.nominatim"]> & { stop():Promise<void> };
 ocr:NonNullable<NonNullable<WorkerRunResources["providers"]>["adapters"]["ocr.extract"]>;
 authority:AuthorityRepositories;artifacts:ContentAddressedArtifactWriter;clock:Clock;ids:IdFactory;
 admission:RuntimeAdmission;database:AuthorityDatabase;
 runReader?:Pick<RunRecordService,"read">;
 isolation:RuntimeIsolation;protectedSecrets:Pick<CredentialStore,"read">;scheduler:MonotonicDeadlineScheduler;
 environment:Readonly<Record<string,string|undefined>>;sessionFactory?:WorkerBrowserSessionFactory;duoCeremony?:DuoCeremonyGateFactory;
 assertProfileOwner:(workerId:WorkerId)=>void;
 assertBrowserRoot:(root:string)=>void;
 createSessionFactory?:(profileAuthority:BrowserProfileAuthority)=>WorkerBrowserSessionFactory;
 onDebug?:(category:"session"|"duo",workerId:WorkerId,event:Pick<DebugEvent,"phase"|"correlationId">&Partial<Pick<DebugEvent,"code"|"durationMs"|"pinned">>)=>void;
}>) {
 if(input.sessionFactory!==undefined&&input.createSessionFactory!==undefined)throw new Error("browser-session-factory-owner-conflict");
 const profiles=createBrowserProfileAuthority(input);
 const runWorkbooks=createRunWorkbookService({database:input.database,clock:input.clock});
 const nominatim=input.nominatim;
 const compose=(config:Config)=>{
  input.assertBrowserRoot(config.paths.browserProfileRoot);
  return Object.freeze({
   sessionFactory:input.sessionFactory??input.createSessionFactory?.(profiles)??new PlaywrightWorkerSessionFactory({config,protectedSecrets:input.protectedSecrets,isolation:input.isolation,clock:input.clock,scheduler:input.scheduler,newSessionId:()=>input.ids.uuid(),
    ...profiles,...(input.onDebug===undefined?{}:{onDebug:(workerId,event)=>input.onDebug?.("session",workerId,event)})}),
   duoCeremony:input.duoCeremony??composeDuoCeremonyGateFactory({config,...(input.duo===undefined?{}:{duo:input.duo}),leases:input.authority.duoCeremonyLeases,clock:input.clock,scheduler:input.scheduler,
    ...(input.onDebug===undefined?{}:{onDebug:(workerId,event)=>input.onDebug?.("duo",workerId,event)})}),
   taskDeadlineMs:config.timeouts.taskMs,sessionAcquireMs:config.timeouts.sessionAcquireMs,
   defaultBrowserMode:config.browser.headless?"headless":"headed",
   providers:{adapters:Object.freeze({"ocr.extract":input.ocr,"geocode.census":createCensusGeocodeAdapter({clock:input.clock}),"geocode.nominatim":nominatim}),
    configSnapshots:input.authority.configSnapshots,idFactory:{next:()=>input.ids.uuid()}},
  });
 };
 const cache=new Map<string,ReturnType<typeof compose>>();
 const runCache=new Map<string,WorkerRunResources>();
 return Object.freeze({
  baseline:compose,
  stop:()=>nominatim.stop(),
  forRun(run:RunRecord):WorkerRunResources {
   if(["ocr","ocr-page"].includes(run.envelope.workflow)) {
    if(input.runReader===undefined)throw new OcrPublicationRefusedError();
    input.database.withAuthorityReadSnapshot(()=>admitOcrRunResources(input.authority,input.runReader!,run));
   }
   if (Object.values(run.envelope.resolvedInstance ?? {}).some(instance => instance === "test")) throw new Error("run-resources-retired-test-instance");
   const snapshot=ConfigSnapshotRecordSchema.parse(selectRunSettings(input.authority,run.envelope));
   input.assertBrowserRoot(snapshot.config.paths.browserProfileRoot);
   if(sha256Hex(canonicalJsonStringify(snapshot.config))!==snapshot.fingerprint)throw new Error("run-resources-retained-snapshot-unavailable");
   const previous=cache.get(snapshot.fingerprint);
   const baseline=previous??compose(StoredConfigSchema.parse(snapshot.config));cache.set(snapshot.fingerprint,baseline);
   const key=`${run.envelope.runId}:${run.envelope.attempt}:${run.claimGeneration}:${snapshot.fingerprint}`;
   const resources=runCache.get(key)??Object.freeze({...baseline,providers:{...baseline.providers,adapters:Object.freeze({...baseline.providers.adapters,
    "workbooks.library":createWorkbookLibraryAdapter({runId:run.envelope.runId,repository:input.authority.workbooks,clock:input.clock,
      references:{runId:run.envelope.runId,write:command=>runWorkbooks.write(run,command)}}),
   })},...(input.runReader===undefined?{}:{publishCheckpoint:createOcrCheckpointPublication(input.runReader,run)})});
   if(["ocr","ocr-page"].includes(run.envelope.workflow)&&resources.publishCheckpoint===undefined)throw new OcrPublicationRefusedError();
   runCache.set(key,resources);
   return input.preflight===undefined?resources:Object.freeze({...resources,sessionFactory:preflightSessionFactory(resources.sessionFactory,input.preflight,input.preflight.runScope(run.envelope))});
  },
 });
}

export type BrowserProfileAuthority = Pick<BrowserSessionFactoryOptions, "slotOrdinal" | "admitProfile" | "duo" | "assertCurrent" | "browserRoots" | "browserOwner">;
export function createBrowserProfileAuthority(input: Readonly<{duo?:DuoSigningSource;authority:AuthorityRepositories;admission:RuntimeAdmission;database:AuthorityDatabase;assertProfileOwner:(workerId:WorkerId)=>void}>): BrowserProfileAuthority {
 return {
    browserRoots:createBrowserRoots(input.admission),browserOwner:{database:input.database,profileId:input.admission.profileBinding.profileId},
    ...(input.duo===undefined?{}:{duo:input.duo}),assertCurrent:workerId=>input.assertProfileOwner(workerId),
    slotOrdinal:(workerId,system)=>{
     input.assertProfileOwner(workerId);
     const slot=input.authority.workerSlots.get(workerId);
     if(slot===undefined||slot.retiredAt!==null)throw new ProfileCustodyUnavailableError();
     if(input.authority.workerControls.pending(`worker-pool:${slot.workflow}`).some(control=>control.request.type==="plan-worker-count"))throw new ProfileCustodyUnavailableError();
     if(input.authority.workerControls.browsers(workerId).some(browser=>browser.system===system&&browser.health!=="closed"))throw new ProfileCustodyUnavailableError();
     return slot.ordinal;
    },
    admitProfile:profile=>{
     input.assertProfileOwner(profile.workerId);
     const slot=input.authority.workerSlots.get(profile.workerId);
     if(slot===undefined||slot.retiredAt!==null)throw new ProfileCustodyUnavailableError();
     if(input.authority.workerControls.pending(`worker-pool:${slot.workflow}`).some(control=>control.request.type==="plan-worker-count"))throw new ProfileCustodyUnavailableError();
     const observations=input.authority.workerControls.browsers(profile.workerId).filter(value=>value.system===profile.system);
     if(observations.some(value=>value.health!=="closed"))throw new ProfileCustodyUnavailableError();
     const previous=observations.at(-1);
     const unobservedProfile=previous===undefined&&lstatSync(profile.profileDirectory,{throwIfNoEntry:false})!==undefined;
     if(previous!==undefined&&previous.profileDirectory!==profile.profileDirectory)throw new ProfileCustodyUnavailableError();
     const resetRequired=unobservedProfile||previous!==undefined&&(previous.instance!==profile.instance||previous.signInFingerprint!==profile.signInFingerprint);
     return Promise.resolve(BrowserProfileAdmissionSchema.parse({...profile,profileRevision:previous===undefined?1:previous.profileRevision+(resetRequired?1:0),resetRequired}));
    },
 };
}
