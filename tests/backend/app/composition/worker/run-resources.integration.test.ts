import assert from "node:assert/strict";
import { existsSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { createRunResourcesFactory } from "../../../../../src/backend/app/composition/worker/run-resources.js";
import { assertProfileBrowserRoot } from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import { findProfileFixtureAdmission } from "../../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { ConfigSchema } from "../../../../../src/models/config/schema.js";
import { ConfigSnapshotIdSchema,FingerprintSchema,PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { foundationFixture,HASH,id } from "../../../../support/helpers/database-foundation/fixtures.js";

type Fixture=ReturnType<typeof foundationFixture>;
const scheduler={schedule:()=>({cancel:()=>undefined})};
const artifacts=(f:Fixture)=>createContentAddressedArtifactWriter({admission: RuntimeAdmission.syntheticRoots(join(f.root, ".tracker"), join(f.root, ".tracker/data/artifacts"))});
describe("F actual four-way baseline independence",()=>{
 const _owners=["P","D","G","S"] as const;
 it("selects actual resources from each retained snapshot and preserves the first run after a newer selection",async()=>{
  const f=foundationFixture();try{
   const admission=findProfileFixtureAdmission(f.root);assert.ok(admission);
   const writer=artifacts(f);await writer.ready;
   const factory=createRunResourcesFactory({assertBrowserRoot:root=>assertProfileBrowserRoot(admission,root),assertProfileOwner:()=>{throw new Error("snapshot proof must not acquire a browser profile");},processLockRoot:join(f.root,"locks"),authority:f.db.authority,artifacts:writer,clock:f.clock,ids:sequentialIdFactory("c"),isolation:rebuildRuntimeIsolation,protectedSecrets:{read:()=>{throw new Error("unexpected credential read");}},scheduler,environment:{},duoCeremony:{openGate:()=>{throw new Error("no browser in snapshot proof");}}});
   const first=factory.forRun(f.run);
   const config=ConfigSchema.parse({...f.snapshot.config,timeouts:{...f.snapshot.config.timeouts,taskMs:f.snapshot.config.timeouts.taskMs+1000,sessionAcquireMs:1000+PositiveIntSchema.parse(f.snapshot.config.timeouts.sessionAcquireMs)},browser:{...f.snapshot.config.browser,headless:!f.snapshot.config.browser.headless}});
   const snapshot={...f.snapshot,configSnapshotId:ConfigSnapshotIdSchema.parse(id(91)),config,fingerprint:FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config)))};f.db.authority.configSnapshots.insert(snapshot);
   const next=factory.forRun({...f.run,envelope:{...f.run.envelope,configSnapshotId:snapshot.configSnapshotId,configFingerprint:snapshot.fingerprint}});
   assert.equal(next.taskDeadlineMs,config.timeouts.taskMs);assert.equal(next.sessionAcquireMs,config.timeouts.sessionAcquireMs);assert.notEqual(next.defaultBrowserMode,first.defaultBrowserMode);assert.notEqual(next.sessionFactory,first.sessionFactory);assert.equal(next.providers?.adapters["geocode.nominatim"],first.providers?.adapters["geocode.nominatim"]);
   assert.equal(factory.forRun(f.run),first);assert.equal(first.taskDeadlineMs,f.snapshot.config.timeouts.taskMs);
   assert.throws(()=>factory.forRun({...f.run,envelope:{...f.run.envelope,configFingerprint:FingerprintSchema.parse(HASH)}}),/snapshot-mismatch/u);
  }finally{f.dispose();}
 });
 it("freezes four distinct existing source sets with no cross-owner mutable imports",()=>{
  const scopes:Record<string,string[]>={P:["src/backend/processing/providers/provider-client.ts","src/backend/processing/providers/nominatim-owner.ts"],D:["src/backend/runs/lifecycle/failure-resolution.ts","src/backend/storage/sqlite/failure-resolution.ts","src/backend/runs/queries/failure-resolution.ts","src/backend/runs/commands/failure-resolution.ts","src/backend/app/composition/dashboard/failure-resolution.ts","src/backend/runs/queries/run-trust.ts"],G:["src/backend/logs/generated-artifact-projection.ts","src/backend/storage/sqlite/generated-artifacts.ts","src/backend/storage/artifacts/artifact-sink-projector.ts","src/backend/storage/artifacts/xlsx-retention-sink.ts","src/backend/runs/exports/operator-xlsx-export-service.ts","src/backend/app/composition/dashboard/generated-exports.ts"],S:["src/backend/runs/settings/run-settings.ts","src/backend/runs/lifecycle/run-claim-admission.ts","src/backend/storage/sqlite/settings-activation.ts","src/backend/app/composition/worker/run-resources.ts","src/backend/runtime/settings/settings-runtime.ts","src/backend/runs/commands/settings-service.ts","src/backend/runs/commands/start-plan-service.ts","src/backend/runs/queries/settings.ts","src/backend/runs/queries/settings-editor.ts","src/dashboard/surfaces/settings/settings.tsx","src/dashboard/surfaces/settings/settings-model.ts"]};
  assert.ok(readFileSync("src/backend/app/composition/worker/run-resources.ts","utf8").includes("/geocode-adapters.js\""));
  for (const paths of Object.values(scopes)) assert.ok(paths.length > 0);
  const all=Object.values(scopes).flat();assert.equal(new Set(all).size,all.length);for(const path of all)assert.ok(existsSync(path),path);
  for(const [owner,files] of Object.entries(scopes))for(const file of files)for(const [peer,others] of Object.entries(scopes))if(owner!==peer)for(const other of others){const name=other.split("/").at(-1)?.replace(/\.tsx?$/u,"");assert.ok(name);assert.equal(readFileSync(file,"utf8").includes(`/${name}.js"`),false,`${owner} imports mutable ${peer}: ${file}`);}
 });
});
