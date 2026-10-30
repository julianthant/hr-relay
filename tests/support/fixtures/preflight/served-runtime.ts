import { ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { renameSync } from "node:fs";
import { runtimeFixture, populatedProtectedRecord } from "./runtime-fixture.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { composeRuntimePreflight } from "../../../../src/backend/app/preflight/runtime-admission.js";
import { createRuntimePreflightRunners } from "../../../../src/backend/app/preflight/runtime-runners.js";
import { createPreflightAuthority } from "../../../../src/models/preflight/preflight.js";
import { createPreflightReportService } from "../../../../src/backend/runtime/preflight/report-service.js";
import { createTimeoutDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../../src/models/config/settings.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { buildSettingsEditor } from "../../../../src/backend/runs/queries/settings-editor.js";
import { createProtectedSettingsRuntimeReader } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { FIXTURE_DESCRIPTOR_HASH, FIXTURE_NOW } from "../dashboard/fixture-identity.js";

export type SetupScene = "healthy" | "browser-missing" | "secret-missing" | "optional-warning" | "unavailable" | "stale";
/** Production admission/report services and detector inputs; synthetic workflow, assets and credentials. */
export async function servedPreflightRuntime(scene: SetupScene) {
  const f=await runtimeFixture(scene==="optional-warning"?["dashboard.serve","provider.nominatim"]:["dashboard.serve"]);f.clock.setWall(new Date(FIXTURE_NOW));
  const database=AuthorityDatabase.open({path:f.databasePath,busyTimeoutMs:250,migrationOwner:"setup-ui"},f.clock);
  const fingerprint=FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(f.input.config)));
  const resolved={...resolveConfigWithProvenance({},hostConfigFacts({}),f.clock),config:f.input.config,fingerprint};
  const settings=initialSettingsFileRecord();
  const identity={configSnapshotId:f.input.scope.configSnapshotId,configFingerprint:fingerprint};
  database.authority.runtimeConfig.initialize({configSnapshotId:identity.configSnapshotId,fingerprint,config:resolved.config,provenance:resolved.provenance,revision:1,capturedAt:f.clock.now().toISOString(),capturedBy:"local-operator"});
  if(scene==="browser-missing")renameSync(f.executable,`${f.executable}.parked`);
  if(scene==="secret-missing")f.setProtected(populatedProtectedRecord("ucpathPassword"));
  if(scene==="optional-warning")Reflect.set(f.input.providerAvailability,"nominatim/geocode.nominatim",false);
  const runtime=composeRuntimePreflight({admission:f.admission,credentials:f.credentials,database,clock:f.clock,repoRoot:f.root,isolation:rebuildRuntimeIsolation,
    descriptors:{resolve:id=>id===personLookupDescriptor.id?personLookupDescriptor:undefined},descriptorSetHash:FIXTURE_DESCRIPTOR_HASH,protectedSecrets:f.input.protectedSecrets,environment:{},
    runnerFactory:input=>createRuntimePreflightRunners({...input,dashboard:f.input.dashboard,browserExecutablePath:()=>f.executable})});
  const scope={...identity,descriptorFingerprint:FIXTURE_DESCRIPTOR_HASH,requestedCapabilities:f.input.scope.requestedCapabilities};
  const dashboard=createPreflightAuthority({...scope,clock:f.clock,scheduler:createTimeoutDeadlineScheduler(f.clock),runners:createRuntimePreflightRunners({...f.input,scope:{...scope,requestedCapabilities:[...scope.requestedCapabilities]}})});
  const service=createPreflightReportService({dashboard,runtime,clock:f.clock});
  await dashboard.refresh(new AbortController().signal);
  if(scene!=="unavailable") await runtime.admission.prepare(runtime.currentScope(personLookupDescriptor.id),new AbortController().signal);
  if(scene==="stale"){f.clock.advanceWall(60_000);f.clock.advanceMonotonic(60_000);}
  const document=()=>buildSettingsEditor({settings:{read:()=>({record:settings,runtimeStatus:{state:"current",identity:settingsRuntimeIdentity(settings,fingerprint)}})},protectedSettings:createProtectedSettingsRuntimeReader({read:()=>ProtectedStoreRecordSchema.parse(f.input.protectedSecrets.read())}),environment:{},clock:f.clock,resolve:()=>resolved});
  return {clock:f.clock,service,document,scope:personLookupDescriptor.id,database,runtime,identity,fixture:f,async close(){database.close();await f.close();},provenance:{detectors:"createRuntimePreflightRunners",admission:"composeRuntimePreflight",report:"createPreflightReportService",effects:"Synthetic private files and SQLite; no workflow execution, browser launch or external requests."}};
}
