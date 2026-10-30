import nativeFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { vi } from "vitest";
import childProcess from "node:child_process";
import { chromium } from "playwright";
import type { PreflightRunner } from "../../../../src/models/preflight/preflight.js";
import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { ScenarioManifestSchema } from "../../../../src/models/trust/scenario.js";
import { PREFLIGHT_SCENARIO_MANIFESTS, PreflightScenarioIdSchema } from "../../../../src/models/trust/preflight-scenarios.js";
import { FEATURE_RUNTIME_SPECS, PROVIDER_ADAPTER_SPECS, RUNTIME_DEPENDENCIES, SYSTEM_RUNTIME_SPECS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { PreflightReportWireSchema } from "../../../../src/models/preflight/preflight-contract.js";
import { runtimeFixturePool, populatedProtectedRecord } from "./runtime-fixture.js";

const FixtureSchema = z.strictObject({ schemaVersion: z.literal(2), faults: z.array(z.strictObject({scenario:PreflightScenarioIdSchema, injection:z.string().min(1)})).length(PREFLIGHT_SCENARIO_MANIFESTS.length) });
const ExecutionSchema = z.strictObject({ scenario:PreflightScenarioIdSchema, dependency:z.string().min(1), variant:z.string().min(1), check:z.string().min(1), report:PreflightReportWireSchema,
  terminal:z.enum(["failed","partial"]), actionCount:z.literal(0), externalCommitCount:z.literal(0), evidence:z.array(z.string()), reportDigest:z.string().length(64), restored:z.literal(true) });
export type CorpusExecution = z.infer<typeof ExecutionSchema>;
type Case = ReturnType<typeof preflightFaultCases>[number];
export function preflightFaultCases() {
  return RUNTIME_DEPENDENCIES.flatMap(dependency => {
    const system = SYSTEM_RUNTIME_SPECS.find(candidate=>dependency.id.startsWith(`endpoint.${candidate.system}.`));
    const feature = FEATURE_RUNTIME_SPECS.find(candidate=>candidate.dependency===dependency.id);
    const variants = dependency.secretNames !== undefined ? dependency.secretNames
      : system !== undefined ? system.routes
      : feature !== undefined ? PROVIDER_ADAPTER_SPECS.filter(provider=>provider.capabilities.includes(feature.providerCapability)).map(provider=>provider.provider)
      : dependency.id === "browser.duo-extension" ? ["extension", "duoWebauthnCredential"] : [dependency.id];
    return variants.map(variant=>({dependency, variant}));
  });
}
async function inject(f: Awaited<ReturnType<typeof runtimeFixture>>, entry: Case): Promise<() => Promise<void> | void> {
  const id = entry.dependency.id;
  const replace = (path: string, value: string): (()=>void) => { const previous = readFileSync(path); writeFileSync(path,value); return ()=>{writeFileSync(path,previous);}; };
  if (id === "runtime.node") {
    const pkgPath=join(f.root,"package.json"); const lockPath=join(f.root,"package-lock.json");
    const pkg=z.object({engines:z.object({node:z.string()})}).loose().parse(JSON.parse(readFileSync(pkgPath,"utf8")));
    const lock=z.object({packages:z.object({"":z.object({engines:z.object({node:z.string()})}).loose()}).loose()}).loose().parse(JSON.parse(readFileSync(lockPath,"utf8")));
    pkg.engines.node=">=99.0.0"; lock.packages[""].engines.node=">=99.0.0";
    const undo=[replace(pkgPath,JSON.stringify(pkg)),replace(lockPath,JSON.stringify(lock))];return()=>{for(const restore of undo)restore();};
  }
  if (id === "runtime.package-lock") return replace(join(f.root,"package-lock.json"), "{}");
  if (id === "path.state") {
    f.admission.assertLive();
    const originalAccess = nativeFs.accessSync;
    let injected = false;
    const access = vi.spyOn(nativeFs, "accessSync").mockImplementation((path, mode) => {
      if (String(path) === f.stateRoot && mode === (nativeFs.constants.R_OK | nativeFs.constants.W_OK)) {
        injected = true;
        throw Object.assign(new Error("synthetic-state-root-unavailable"), { code: "ENOENT" });
      }
      return originalAccess(path, mode);
    });
    syncBuiltinESMExports();
    return () => { access.mockRestore(); syncBuiltinESMExports(); assert.equal(injected, true); f.admission.assertLive(); };
  }
  if (id === "browser.chromium" || id === "browser.duo-extension" || id === "path.artifact") {
    const path = id === "browser.chromium" ? f.executable : id === "path.artifact" ? f.artifactRoot
      : entry.variant === "extension" ? join(f.input.config.paths.duoExtensionDir,"manifest.json") : f.input.config.paths.duoCredential;
    renameSync(path,`${path}.parked`); return()=>{renameSync(`${path}.parked`,path);};
  }
  if (id === "config.resolved") {
    const value=f.input.config.features.duoWebAuthn;Reflect.deleteProperty(f.input.config.features,"duoWebAuthn");return()=>{f.input.config.features.duoWebAuthn=value;};
  }
  if (id === "storage.disk-space") {Reflect.set(f.input.dashboard,"filesystemProbe",{availableBlocks:()=>0});return()=>{Reflect.deleteProperty(f.input.dashboard,"filesystemProbe");};}
  if (id === "storage.sqlite" || id === "storage.backup") {

    const undo=replace(f.databasePath,"corrupt synthetic authority");
    if(id === "storage.backup") {const path=join(f.stateRoot,"backups");mkdirSync(path);writeFileSync(join(path,"invalid.manifest.json"),"corrupt synthetic backup");return()=>{undo();rmSync(path,{recursive:true});};}
    return undo;
  }
  if (id === "port.backend" || id === "port.frontend") {
    const server=createServer(socket=>socket.destroy()); await new Promise<void>(resolve=>{server.listen(0,"127.0.0.1",resolve);});
    const address=server.address();assert.ok(address!==null&&typeof address!=="string");
    const field=id === "port.backend" ? "backendPort" : "frontendPort";Reflect.set(f.input.dashboard,field,address.port);
    return async()=>{Reflect.set(f.input.dashboard,field,0);await new Promise<void>((resolve,reject)=>{server.close(error=>{if(error)reject(error);else resolve();});});};
  }
  if (id === "fiscal.current") {const previous=f.input.config.annualDates;f.input.config.annualDates={};return()=>{f.input.config.annualDates=previous;};}
  if (id.startsWith("secret.")) {f.setProtected(populatedProtectedRecord(entry.variant));return()=>{f.setProtected(populatedProtectedRecord());};}
  const system=SYSTEM_RUNTIME_SPECS.find(candidate=>id.startsWith(`endpoint.${candidate.system}.`));
  if(system!==undefined) {
    const routes=f.input.config.urls[system.configKey].prod;assert.ok(routes);
    const previous:unknown=Reflect.get(routes,entry.variant);Reflect.deleteProperty(routes,entry.variant);return()=>{Reflect.set(routes,entry.variant,previous);};
  }
  const feature=FEATURE_RUNTIME_SPECS.find(candidate=>candidate.dependency===id);
  const provider=PROVIDER_ADAPTER_SPECS.find(candidate=>id===`provider.${candidate.provider}`);
  if(feature!==undefined || provider!==undefined) {
    const previous={...f.input.providerAvailability};
    for(const key of Object.keys(f.input.providerAvailability)) if(feature!==undefined?key.endsWith(`/${feature.providerCapability}`):key.startsWith(`${provider?.provider}/`)) Reflect.set(f.input.providerAvailability,key,false);
    return()=>{for(const [key,value] of Object.entries(previous))Reflect.set(f.input.providerAvailability,key,value);};
  }
  throw new Error(`No fault injector for ${id}`);
}
export function auditPreflightExecutions(raw: unknown): void {
  const executions=z.array(ExecutionSchema).parse(raw);
  const expected=preflightFaultCases();
  assert.equal(executions.length,expected.length,"missing or extra executed dependency case");
  assert.equal(new Set(executions.map(entry=>`${entry.dependency}/${entry.variant}`)).size,expected.length,"duplicate execution");
  for(const entry of expected) {
    const execution=executions.find(candidate=>candidate.dependency===entry.dependency.id&&candidate.variant===entry.variant);assert.ok(execution,"unexecuted dependency");
    const manifest=PREFLIGHT_SCENARIO_MANIFESTS.find(candidate=>candidate.id===entry.dependency.scenario);assert.ok(manifest);
    assert.equal(execution.scenario,manifest.id);assert.equal(execution.check,entry.dependency.check);
    assert.equal(execution.terminal,manifest.expect.terminal);assert.equal(execution.actionCount,manifest.expect.actionCount);assert.equal(execution.externalCommitCount,manifest.expect.externalCommitCount);
    assert.deepEqual(execution.evidence,manifest.expect.requiredEvidence);
    assert.equal(execution.reportDigest,sha256Hex(canonicalJsonStringify(execution.report)),"mismatched detector evidence");
    const outcome=execution.report.results.find(result=>result.check===entry.dependency.check);assert.ok(outcome);
    assert.equal(outcome.status,entry.dependency.requirement==="blocking"?"fail":"warning","injected fault incorrectly reported healthy");
    assert.equal(execution.terminal,execution.report.results.some(result=>result.status==="fail")?"failed":"partial");
    assert.deepEqual(manifest.expect.failureCode,execution.terminal==="failed"?{state:"present",value:"PREFLIGHT_FAILED"}:{state:"absent"});
  }
}
export async function executePreflightCorpus(transform?: (runners: readonly PreflightRunner[]) => readonly PreflightRunner[]): Promise<CorpusExecution[]> {
  const fixture=FixtureSchema.parse(JSON.parse(readFileSync(join(process.cwd(),"tests/support/fixtures/preflight/environment-doctor.json"),"utf8")));
  assert.equal(new Set(fixture.faults.map(fault=>fault.scenario)).size,PREFLIGHT_SCENARIO_MANIFESTS.length);
  for(const raw of PREFLIGHT_SCENARIO_MANIFESTS) {
    const manifest=ScenarioManifestSchema.parse(raw);
    const fault=fixture.faults.find(candidate=>candidate.scenario===manifest.id);assert.ok(fault);
    assert.equal(fault.injection,manifest.id.slice("preflight/".length));
    assert.deepEqual(manifest.input,{check:fault.injection});
    assert.equal(manifest.fixture,"fixtures/preflight/environment-doctor.json");
    assert.deepEqual(manifest.requiredAssertions,[`reports-${fault.injection}`]);
  }
  const executions:CorpusExecution[]=[];
  let actionCount=0, externalCommitCount=0;
  const launch = vi.spyOn(chromium,"launch").mockImplementation(()=>{actionCount++;throw new Error("Corpus attempted a browser launch");});
  const persistent = vi.spyOn(chromium,"launchPersistentContext").mockImplementation(()=>{actionCount++;throw new Error("Corpus attempted a persistent browser launch");});
  const spawn = vi.spyOn(childProcess,"spawn").mockImplementation(()=>{actionCount++;throw new Error("Corpus attempted a process launch");});
  const fetch = vi.spyOn(globalThis,"fetch").mockImplementation(()=>{externalCommitCount++;throw new Error("Corpus attempted an external request");});
  let pool: Awaited<ReturnType<typeof runtimeFixturePool>> | undefined;
  try {
  pool = await runtimeFixturePool();
  for(const entry of preflightFaultCases()) {
    const f=pool.fixture(entry.dependency.capabilities);let undo:(()=>Promise<void>|void)|undefined;
    try {
      const feature=FEATURE_RUNTIME_SPECS.find(candidate=>candidate.dependency===entry.dependency.id);
      if(feature!==undefined) for(const key of Object.keys(f.input.providerAvailability)) if(key.endsWith(`/${feature.providerCapability}`))Reflect.set(f.input.providerAvailability,key,key.startsWith(`${entry.variant}/`));
      const healthy=await f.report();
      assert.equal(healthy.results.every(result=>result.status==="pass"||result.status==="warning"),true,"healthy control failed");
      assert.equal(healthy.results.find(result=>result.check===entry.dependency.check)?.status,"pass");
      undo=await inject(f,entry);
      const databaseBefore=readFileSync(f.databasePath);
      const report=await f.report(transform);
      assert.deepEqual(readFileSync(f.databasePath),databaseBefore,"detectors mutated authority");
      await undo();undo=undefined;
      assert.equal((await f.report()).results.find(result=>result.check===entry.dependency.check)?.status,"pass","explicit restoration did not re-check healthy");
      executions.push(ExecutionSchema.parse({scenario:entry.dependency.scenario,dependency:entry.dependency.id,variant:entry.variant,check:entry.dependency.check,report,
        terminal:report.results.some(result=>result.status==="fail")?"failed":"partial",actionCount,externalCommitCount,evidence:[`preflight.${entry.dependency.scenario.slice("preflight/".length)}`],reportDigest:sha256Hex(canonicalJsonStringify(report)),restored:true}));
    } finally {await undo?.();}
  }
  auditPreflightExecutions(executions);return executions;
  } finally {await pool?.close();launch.mockRestore();persistent.mockRestore();spawn.mockRestore();fetch.mockRestore();}
}
