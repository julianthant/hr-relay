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
import { runClaim, type RunRecord } from "../../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { type BrowserSessionFactoryOptions, BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory, ProfileCustodyUnavailableError } from "../../../runtime/browser/browser-session-factory.js";
import { lstatSync } from "node:fs";
import { join } from "node:path";
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
import { createOcrReviewAdapter } from "../../../processing/providers/ocr-review-adapter.js";
import { createApprovedOcrRecordReader } from "../../../runs/lifecycle/approved-ocr-records.js";
import { WORKFLOW_MODULES, CHILD_ONLY_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { searchPartitionDay } from "../../../../models/dashboard/search-calendar.js";
import { WorkbookLibraryError } from "../../../workbooks/workbook-library-error.js";
import { createOcrApprovedSnapshotAdapter } from "../../../processing/providers/ocr-approved-snapshot-adapter.js";
import type { AnyWorkflowDescriptor } from "../../../../workflow-kit/workflow.js";

export function createRunResourcesFactory(input:Readonly<{
 preflight?:RuntimePreflight;
 duo?:DuoSigningSource;
 nominatim:NonNullable<NonNullable<WorkerRunResources["providers"]>["adapters"]["geocode.nominatim"]> & { stop():Promise<void> };
 ocr:NonNullable<NonNullable<WorkerRunResources["providers"]>["adapters"]["ocr.extract"]>;
 authority:AuthorityRepositories;artifacts:ContentAddressedArtifactWriter;clock:Clock;ids:IdFactory;
 admission:RuntimeAdmission;database:AuthorityDatabase;
 runReader?:Pick<RunRecordService,"read">;
 resolveDescriptor?:(workflowId:string)=>AnyWorkflowDescriptor|undefined;
 isolation:RuntimeIsolation;protectedSecrets:Pick<CredentialStore,"read">;scheduler:MonotonicDeadlineScheduler;
 environment:Readonly<Record<string,string|undefined>>;sessionFactory?:WorkerBrowserSessionFactory;duoCeremony?:DuoCeremonyGateFactory;
 assertProfileOwner:(workerId:WorkerId)=>void;
 assertBrowserRoot:(root:string)=>void;
 createSessionFactory?:(profileAuthority:BrowserProfileAuthority)=>WorkerBrowserSessionFactory;
 onDebug?:(category:"session"|"duo",workerId:WorkerId,event:Pick<DebugEvent,"phase"|"correlationId">&Partial<Pick<DebugEvent,"code"|"durationMs"|"pinned"|"message"|"stack"|"reason">>)=>void;
}>) {
 if(input.sessionFactory!==undefined&&input.createSessionFactory!==undefined)throw new Error("browser-session-factory-owner-conflict");
 const profiles=createBrowserProfileAuthority(input);
 const descriptors=new Map([...WORKFLOW_MODULES,...CHILD_ONLY_WORKFLOW_MODULES].map(module=>[String(module.descriptor.id),module.descriptor]));
 const resolveDescriptor=input.resolveDescriptor??((workflowId:string)=>descriptors.get(workflowId));
 const runWorkbooks=createRunWorkbookService({database:input.database,clock:input.clock,resolveDescriptor});
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
   const approvedOcr=input.runReader===undefined?undefined:createApprovedOcrRecordReader({database:input.database,reader:input.runReader,run,resolveDescriptor,assertCurrent:()=>{
    input.admission.assertProfileRuntime();const claim=runClaim(run);if(claim===undefined)throw new OcrPublicationRefusedError();
    input.assertProfileOwner(claim.workerId);
   }});
   const resources=runCache.get(key)??Object.freeze({...baseline,providers:{...baseline.providers,adapters:Object.freeze({...baseline.providers.adapters,
    ...(approvedOcr===undefined?{}:{"ocr.review":createOcrReviewAdapter({reader:approvedOcr,clock:input.clock})}),
    "workbooks.library":createWorkbookLibraryAdapter({runId:run.envelope.runId,repository:input.authority.workbooks,clock:input.clock,
     publicationSource:()=>{
      const module=[...WORKFLOW_MODULES,...CHILD_ONLY_WORKFLOW_MODULES].find(module=>module.descriptor.id===run.envelope.workflow);
      if(module===undefined)throw new WorkbookLibraryError("WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE");
      return {workflowId:module.descriptor.id,workflowLabel:module.descriptor.label,partitionDay:searchPartitionDay(new Date(run.envelope.enqueuedAt))};
     },
      references:{runId:run.envelope.runId,read:command=>runWorkbooks.read(run,command),write:command=>runWorkbooks.write(run,command)}}),
    "ocr.approved-snapshot":createOcrApprovedSnapshotAdapter({clock:input.clock,...(approvedOcr===undefined?{}:{reader:approvedOcr})}),
   })},...(input.runReader===undefined?{}:{publishCheckpoint:createOcrCheckpointPublication(input.runReader,run,resolveDescriptor)})});
   if(["ocr","ocr-page"].includes(run.envelope.workflow)&&resources.publishCheckpoint===undefined)throw new OcrPublicationRefusedError();
   runCache.set(key,resources);
   return input.preflight===undefined?resources:Object.freeze({...resources,sessionFactory:preflightSessionFactory(resources.sessionFactory,input.preflight,input.preflight.runScope(run.envelope))});
  },
 });
}

export type BrowserProfileAuthority = Pick<BrowserSessionFactoryOptions, "slotOrdinal" | "admitProfile" | "duo" | "assertCurrent" | "browserRoots" | "browserOwner">;
export function createBrowserProfileAuthority(input: Readonly<{duo?:DuoSigningSource;authority:AuthorityRepositories;admission:RuntimeAdmission;database:AuthorityDatabase;assertProfileOwner:(workerId:WorkerId)=>void}>): BrowserProfileAuthority {
 const browserRoots=createBrowserRoots(input.admission),profileId=input.admission.profileBinding.profileId;
 // The registry row says whether the directory was last signed in with this identity; the revision counts resets in this process.
 const revisions=new Map<string,number>();
 return {
    browserRoots,browserOwner:{database:input.database,profileId},
    ...(input.duo===undefined?{}:{duo:input.duo}),assertCurrent:workerId=>input.assertProfileOwner(workerId),
    slotOrdinal:workerId=>{
     input.assertProfileOwner(workerId);
     const slot=input.authority.workerSlots.get(workerId);
     if(slot===undefined||slot.retiredAt!==null)throw new ProfileCustodyUnavailableError();
     return slot.ordinal;
    },
    admitProfile:profile=>{
     input.assertProfileOwner(profile.workerId);
     const slot=input.authority.workerSlots.get(profile.workerId);
     if(slot===undefined||slot.retiredAt!==null)throw new ProfileCustodyUnavailableError();
     const machineRoot=input.admission.captureBrowserRegistryContext().machineRoot;
     const row=browserRoots.inventory().roots.find(value=>value.profileId===profileId&&join(machineRoot,value.directory)===profile.profileDirectory);
     const resetRequired=row===undefined?lstatSync(profile.profileDirectory,{throwIfNoEntry:false})!==undefined
      :row.credentialFingerprint!==profile.signInFingerprint;
     const profileRevision=(revisions.get(profile.profileDirectory)??1)+(resetRequired?1:0);
     revisions.set(profile.profileDirectory,profileRevision);
     return Promise.resolve(BrowserProfileAdmissionSchema.parse({...profile,profileRevision,resetRequired}));
    },
 };
}
