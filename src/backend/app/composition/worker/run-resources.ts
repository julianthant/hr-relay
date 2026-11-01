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
import type { AuthorityRepositories } from "../../../storage/sqlite/authority-database.js";
import { composeDuoCeremonyGateFactory, type DuoCeremonyGateFactory } from "../../../runtime/gates/duo-ceremony-gate.js";
import type { MonotonicDeadlineScheduler } from "../../../runtime/scheduling/deadline-scheduler.js";
import type { WorkerBrowserSessionFactory } from "../../../runtime/workers/worker-sessions.js";
import type { WorkerRunResources } from "../../../runtime/workers/worker-loop.js";
import { selectRunSettings } from "../../../runs/settings/run-settings.js";

export function createRunResourcesFactory(input:Readonly<{
 preflight?:RuntimePreflight;
 duo?:DuoSigningSource;
 nominatim:NonNullable<NonNullable<WorkerRunResources["providers"]>["adapters"]["geocode.nominatim"]> & { stop():Promise<void> };
 ocr:NonNullable<NonNullable<WorkerRunResources["providers"]>["adapters"]["ocr.extract"]>;
 authority:AuthorityRepositories;artifacts:ContentAddressedArtifactWriter;clock:Clock;ids:IdFactory;
 isolation:RuntimeIsolation;protectedSecrets:Pick<CredentialStore,"read">;scheduler:MonotonicDeadlineScheduler;
 environment:Readonly<Record<string,string|undefined>>;sessionFactory?:WorkerBrowserSessionFactory;duoCeremony?:DuoCeremonyGateFactory;
 assertProfileOwner:(workerId:WorkerId)=>void;
 assertBrowserRoot:(root:string)=>void;
 createSessionFactory?:(profileAuthority:BrowserProfileAuthority)=>WorkerBrowserSessionFactory;
 onDebug?:(category:"session"|"duo",workerId:WorkerId,event:Pick<DebugEvent,"phase"|"correlationId">&Partial<Pick<DebugEvent,"code"|"durationMs"|"pinned">>)=>void;
}>) {
 if(input.sessionFactory!==undefined&&input.createSessionFactory!==undefined)throw new Error("browser-session-factory-owner-conflict");
 const profiles=createBrowserProfileAuthority(input);
 const nominatim=input.nominatim;
 const compose=(config:Config):WorkerRunResources=>{
  input.assertBrowserRoot(config.paths.browserProfileRoot);
  return Object.freeze({
   sessionFactory:input.sessionFactory??input.createSessionFactory?.(profiles)??new PlaywrightWorkerSessionFactory({config,protectedSecrets:input.protectedSecrets,isolation:input.isolation,clock:input.clock,scheduler:input.scheduler,newSessionId:()=>input.ids.uuid(),
    ...(input.duo===undefined?{}:{duo:input.duo}),assertCurrent:input.assertProfileOwner,
    ...profiles,...(input.onDebug===undefined?{}:{onDebug:(workerId,event)=>input.onDebug?.("session",workerId,event)})}),
   duoCeremony:input.duoCeremony??composeDuoCeremonyGateFactory({config,...(input.duo===undefined?{}:{duo:input.duo}),leases:input.authority.duoCeremonyLeases,clock:input.clock,scheduler:input.scheduler,
    ...(input.onDebug===undefined?{}:{onDebug:(workerId,event)=>input.onDebug?.("duo",workerId,event)})}),
   taskDeadlineMs:config.timeouts.taskMs,sessionAcquireMs:config.timeouts.sessionAcquireMs,
   defaultBrowserMode:config.browser.headless?"headless":"headed",
   providers:{adapters:Object.freeze({"ocr.extract":input.ocr,"geocode.census":createCensusGeocodeAdapter({clock:input.clock}),"geocode.nominatim":nominatim}),
    configSnapshots:input.authority.configSnapshots,idFactory:{next:()=>input.ids.uuid()}},
  });
 };
 const cache=new Map<string,WorkerRunResources>();
 return Object.freeze({
  baseline:compose,
  stop:()=>nominatim.stop(),
  forRun(run:RunRecord):WorkerRunResources {
   if (Object.values(run.envelope.resolvedInstance ?? {}).some(instance => instance === "test")) throw new Error("run-resources-retired-test-instance");
   const snapshot=ConfigSnapshotRecordSchema.parse(selectRunSettings(input.authority,run.envelope));
   input.assertBrowserRoot(snapshot.config.paths.browserProfileRoot);
   if(sha256Hex(canonicalJsonStringify(snapshot.config))!==snapshot.fingerprint)throw new Error("run-resources-retained-snapshot-unavailable");
   const previous=cache.get(snapshot.fingerprint);
   const resources=previous??compose(StoredConfigSchema.parse(snapshot.config));cache.set(snapshot.fingerprint,resources);
   return input.preflight===undefined?resources:Object.freeze({...resources,sessionFactory:preflightSessionFactory(resources.sessionFactory,input.preflight,input.preflight.runScope(run.envelope))});
  },
 });
}

export type BrowserProfileAuthority = Pick<BrowserSessionFactoryOptions, "slotOrdinal" | "admitProfile" | "duo" | "assertCurrent">;
export function createBrowserProfileAuthority(input: Readonly<{duo?:DuoSigningSource;authority:AuthorityRepositories;assertProfileOwner:(workerId:WorkerId)=>void}>): BrowserProfileAuthority {
 return {
    ...(input.duo===undefined?{}:{duo:input.duo}),assertCurrent:input.assertProfileOwner,
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
