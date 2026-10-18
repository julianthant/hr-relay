import assert from "node:assert/strict";
import { spawn,spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync,statfsSync } from "node:fs";
import { availableParallelism,cpus,freemem,loadavg,totalmem } from "node:os";
import { basename,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import config from "../../vitest.config.js";

const suites = {
  architecture: [
    "tests/architecture/storage/native-doctor-limits.test.ts",
    "tests/architecture/storage/no-lifecycle-sql-outside-the-adapter.test.ts",
    "tests/architecture/workflow-kit/task-contract-sealing.test.ts",
  ],
  integration: [
    "tests/backend/runs/queries/search.metadata-index.integration.test.ts",
    "tests/backend/storage/admission/admission.storage-relocation-offline.integration.test.ts",
    "tests/backend/storage/sqlite/authority-database.storage-backup-location.integration.test.ts",
    "tests/backend/storage/sqlite/relocation-restore-candidate.integration.test.ts",
    "tests/backend/storage/sqlite/transaction-history.integration.test.ts",
    "tests/backend/app/composition/dashboard/compose.worker-browser-control-process.integration.test.ts",
  ],
};
const Suite = z.enum(["architecture","integration"]);
const TestConfig = z.object({ test: z.object({ pool:z.string(),isolate:z.boolean(),maxWorkers:z.number(),testTimeout:z.number(),hookTimeout:z.number(),execArgv:z.array(z.string()),projects:z.array(z.object({ test:z.object({ name:z.string(),fileParallelism:z.boolean() }) })) }) });
const root = resolve(import.meta.dirname,"../..");
function emit(value: object): void { process.stdout.write(`${JSON.stringify(value)}\n`); }
function command(file: string,args: string[]): string {
  const result=spawnSync(file,args,{cwd:root,encoding:"utf8",timeout:5000});
  if(result.error || result.status!==0) throw new Error(`Diagnostic command failed: ${basename(file)} (${result.status})`);
  return result.stdout.trim();
}
function digest(path: string): string { return createHash("sha256").update(readFileSync(resolve(root,path))).digest("hex"); }
function testTimeoutOverrides(path: string): {line:number;milliseconds:number}[] {
  const source=ts.createSourceFile(path,readFileSync(resolve(root,path),"utf8"),ts.ScriptTarget.Latest,true), overrides: {line:number;milliseconds:number}[]=[];
  const visit=(node: ts.Node): void=>{
    if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["it","test"].includes(node.expression.text)) {
      const timeout=node.arguments[2];
      if(timeout && ts.isNumericLiteral(timeout)) overrides.push({line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,milliseconds:Number(timeout.text)});
    }
    ts.forEachChild(node,visit);
  };
  visit(source);return overrides;
}
function metadata(suite: z.infer<typeof Suite>): void {
  const test=TestConfig.parse(config).test, project=test.projects.find(p=>p.test.name===suite);
  if(!project) throw new Error("Diagnostic project missing from committed config");
  const shared={pool:test.pool,isolate:test.isolate,maxWorkers:test.maxWorkers,testTimeout:test.testTimeout,hookTimeout:test.hookTimeout,execArgv:test.execArgv};
  emit({kind:"native-host",suite,checkout:command("git",["rev-parse","HEAD"]),tree:command("git",["rev-parse","HEAD^{tree}"]),parents:command("git",["show","-s","--format=%P","HEAD"]).split(" "),node:process.version,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,TZ:process.env.TZ??null,offset:new Date().getTimezoneOffset(),os:command("sw_vers",["-productVersion"]),osBuild:command("sw_vers",["-buildVersion"]),imageOS:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null,cpuCount:cpus().length,availableParallelism:availableParallelism(),physicalBytes:totalmem(),effectiveConfig:{...shared,...project.test},testTimeoutOverrides:Object.fromEntries(suites[suite].map(p=>[p,testTimeoutOverrides(p)])),sourceDigests:Object.fromEntries(["vitest.config.ts","scripts/test/runner.ts","package.json",...suites[suite]].map(p=>[p,digest(p)]))});
}
function descendants(parent: number): number[] {
  const found=[parent];
  for(let i=0;i<found.length;i++) {
    const result=spawnSync("pgrep",["-P",String(found[i])],{encoding:"utf8",timeout:5000});
    if(result.error || (result.status!==0 && result.status!==1)) throw new Error("Diagnostic process traversal failed");
    for(const pid of result.stdout.trim().split(/\s+/).filter(Boolean).map(Number)) if(!found.includes(pid)) found.push(pid);
  }
  return found;
}
function sample(parent: number): void {
  const disk=statfsSync(root), ids=descendants(parent), rows=command("ps",["-p",ids.join(","),"-o","pid=,ppid=,pcpu=,rss=,comm="]).split("\n");
  const processes=rows.map(row=>{
    const match=row.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if(!match) throw new Error("Diagnostic process fields malformed");
    return {pid:Number(match[1]),ppid:Number(match[2]),cpuPercentPs:Number(match[3]),rssKiB:Number(match[4]),executable:basename(match[5])};
  });
  const vm=command("vm_stat",[]), pageSize=vm.match(/page size of (\d+) bytes/), pressure=command("memory_pressure",["-Q"]).match(/System-wide memory free percentage:\s*(\d+)%/);
  if(!pageSize || !pressure) throw new Error("Diagnostic memory fields unavailable");
  const pages=Object.fromEntries(vm.split("\n").flatMap(line=>{const m=line.match(/^([A-Za-z -]+):\s+(\d+)\./);return m?[[m[1],Number(m[2])]]:[];}));
  emit({kind:"native-resource",at:new Date().toISOString(),freeBytes:freemem(),diskAvailableBytes:disk.bavail*disk.bsize,load:loadavg(),memoryFreePercent:Number(pressure[1]),pageSize:Number(pageSize[1]),pages,processes});
}
function telemetryError(error: unknown): void { emit({kind:"native-telemetry-error",errorName:error instanceof Error?error.name:"unknown"}); }
function childResult(child: ReturnType<typeof spawn>): Promise<{code:number|null;signal:string|null;spawnError:boolean}> {
  return new Promise(done=>{child.once("error",()=>done({code:null,signal:null,spawnError:true}));child.once("close",(code,signal)=>done({code,signal,spawnError:false}));});
}
async function reproduce(suite: z.infer<typeof Suite>): Promise<number> {
  let failed=false;
  for(const file of suites[suite]) {
    let telemetryFailed=false;
    const tick=():void=>{try {sample(process.pid);}catch(error){telemetryFailed=true;telemetryError(error);}};
    try {metadata(suite);}catch(error){telemetryFailed=true;telemetryError(error);}
    tick();const timer=setInterval(tick,5000),started=performance.now();
    const result=await childResult(spawn("npm",["run",`test:${suite}`,"--",file],{cwd:root,env:process.env,stdio:"inherit"}));
    clearInterval(timer);
    emit({kind:"native-reproduction",suite,file,...result,telemetryFailed,milliseconds:Math.round(performance.now()-started),fileSha256:digest(file),diagnosticOnly:true});
    failed ||= result.code!==0 || result.signal!==null || result.spawnError || telemetryFailed;
  }
  return failed?1:0;
}
async function main(): Promise<void> {
  const [mode,rawSuite,rawPid]=process.argv.slice(2);
  if(mode==="self-check") {
    const settings=TestConfig.parse(config).test;
    assert.equal(settings.pool,"forks");assert.equal(settings.isolate,true);assert.equal(settings.testTimeout,30000);
    assert.ok(settings.maxWorkers>0 && settings.maxWorkers<=4);
    for(const code of [0,7]) assert.deepEqual(await childResult(spawn(process.execPath,["-e",`process.exit(${code})`],{stdio:"ignore"})),{code,signal:null,spawnError:false});
    for(const suite of Suite.options) {
      metadata(suite);
      const keys=Object.keys(suites[suite]);assert.equal(keys.length,suite==="architecture"?3:6);
    }
    sample(process.pid);emit({kind:"native-diagnostic-self-check",passed:true});return;
  }
  const suite=Suite.parse(rawSuite);
  if(mode==="observe") {
    const parent=z.coerce.number().int().positive().parse(rawPid);metadata(suite);sample(parent);
    const timer=setInterval(()=>{try{sample(parent);}catch(error){clearInterval(timer);telemetryError(error);process.exitCode=1;}},5000);
    process.once("SIGTERM",()=>{clearInterval(timer);});
  } else if(mode==="reproduce") process.exitCode=await reproduce(suite);
  else throw new Error("Unknown hosted diagnostic mode");
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{telemetryError(error);process.exitCode=1;});
