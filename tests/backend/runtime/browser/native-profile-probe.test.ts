import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { chromium } from "playwright";
import { assertNativeBrowserProfilesClosed, BrowserProfileStillClosingError, NativeBrowserClosureUnprovedError,
  NativeProfileProbeRequestSchema, NativeProfileProbeResultSchema, runNativeProfileProbeChild } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { runSecureEnvironmentEntrypoint } from "../../../../scripts/dev/secure-env-bootstrap.js";

const { spawn } = vi.hoisted(() => ({spawn:vi.fn()}));
vi.mock("node:child_process",async importOriginal=>({...await importOriginal<typeof import("node:child_process")>(),spawnSync:spawn}));
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();spawn.mockReset();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"relay-native-profile-"));roots.push(root);
  const directory=join(root,"w1","crm");mkdirSync(directory,{recursive:true,mode:0o700});
  const protectedPath=join(root,"protected.json"), journalPath=join(root,"erasure.json");
  writeFileSync(protectedPath,"synthetic encrypted credential bytes");writeFileSync(journalPath,"synthetic erasure identity");
  return {root,directory,protectedPath,journalPath};
}
const deadlines={launchTimeoutMs:1000,closeProofMs:1000};
function completion(stdout:string){return {pid:12345,output:[null,stdout,""],stdout,stderr:"",status:0,signal:null};}

for(const fault of ["busy","unproved","wrong-nonce","wrong-digest","wrong-directory","missing-directory","malformed","nonzero","signal","spawn-error"] as const){
  it(`keeps credential bytes, journal and replacement untouched after ${fault} child completion`,()=>{
    const f=fixture(),beforeProtected=readFileSync(f.protectedPath),beforeJournal=readFileSync(f.journalPath);
    spawn.mockImplementation((_command:unknown,_args:unknown,options:Readonly<{input:string}>)=>{
      const request=NativeProfileProbeRequestSchema.parse(JSON.parse(options.input));
      const bound={version:1,nonce:request.nonce,requestDigest:createHash("sha256").update(JSON.stringify(request)).digest("hex"),closedDirectories:[f.directory]};
      let reply:unknown={...bound,state:"closed"};
      if(fault==="busy")reply={...bound,closedDirectories:[],state:"busy",code:"BROWSER_PROFILE_STILL_CLOSING"};
      if(fault==="unproved")reply={...bound,closedDirectories:[],state:"closure-unproved",code:"BROWSER_CLOSURE_UNPROVED"};
      if(fault==="wrong-nonce")reply={...bound,state:"closed",nonce:randomUUID()};
      if(fault==="wrong-digest")reply={...bound,state:"closed",requestDigest:"f".repeat(64)};
      if(fault==="wrong-directory")reply={...bound,state:"closed",closedDirectories:[join(f.root,"other")]};
      if(fault==="missing-directory")reply={...bound,state:"closed",closedDirectories:[]};
      const result=completion(fault==="malformed"?"{}\nextra":JSON.stringify(reply));
      if(fault==="nonzero")return {...result,status:1};
      if(fault==="signal")return {...result,status:null,signal:"SIGKILL"};
      if(fault==="spawn-error")return {...result,error:new Error("synthetic child failed")};
      return result;
    });
    let replacements=0;
    const destructiveOperation=()=>{
      assertNativeBrowserProfilesClosed([{profileRoot:f.root,profileDirectory:f.directory}],deadlines);
      replacements++;writeFileSync(f.protectedPath,"erased");writeFileSync(f.journalPath,"new erasure identity");
    };
    assert.throws(destructiveOperation,fault==="busy"?BrowserProfileStillClosingError:NativeBrowserClosureUnprovedError);
    assert.equal(replacements,0);assert.deepEqual(readFileSync(f.protectedPath),beforeProtected);assert.deepEqual(readFileSync(f.journalPath),beforeJournal);
    assert.equal(spawn.mock.calls.length,1);
  });
}
it("requires exact bound full closure and one finite source child before the effect",()=>{
  const f=fixture();
  spawn.mockImplementation((command:unknown,args:unknown,options:Readonly<{input:string;timeout:number;maxBuffer:number}>)=>{
    assert.equal(command,process.execPath);assert.ok(Array.isArray(args));
    assert.equal(args[0],"--import");assert.equal(args[1],"tsx");assert.match(String(args[2]),/scripts\/dev\/secure-env-bootstrap\.ts$/u);
    assert.equal(args[3],"native-profile-probe");assert.equal(args.length,4);
    assert.equal(options.maxBuffer,65536);assert.equal(options.timeout,12000);
    const request=NativeProfileProbeRequestSchema.parse(JSON.parse(options.input));
    return completion(JSON.stringify({version:1,nonce:request.nonce,requestDigest:createHash("sha256").update(JSON.stringify(request)).digest("hex"),state:"closed",closedDirectories:[f.directory]}));
  });
  assertNativeBrowserProfilesClosed([{profileRoot:f.root,profileDirectory:f.directory}],deadlines);
  assert.equal(spawn.mock.calls.length,1);
});

for(const malformed of ["unknown-field","multiple-requests","oversize"] as const)it(`launches no browser on ${malformed} stdin`,async()=>{
  const f=fixture();const launch=vi.spyOn(chromium,"launchPersistentContext").mockRejectedValue(new Error("unexpected launch"));
  const request={version:1,nonce:randomUUID(),profiles:[{profileRoot:f.root,profileDirectory:f.directory}],...deadlines};
  const text=malformed==="unknown-field"?JSON.stringify({...request,unknown:true}):malformed==="multiple-requests"?`${JSON.stringify(request)}\n${JSON.stringify(request)}`:"x".repeat(65537);
  vi.spyOn(process.stdin,Symbol.asyncIterator).mockImplementation(async function*(){yield Buffer.from(text);return undefined;});
  let output="";const priorExit=process.exitCode;
  const write=vi.spyOn(process.stdout,"write").mockImplementation((chunk,encoding,callback)=>{
    output+=String(chunk);if(typeof encoding==="function")encoding();else callback?.();return true;
  });
  try{await runNativeProfileProbeChild();}finally{write.mockRestore();process.exitCode=priorExit;}
  const result=NativeProfileProbeResultSchema.parse(JSON.parse(output));
  assert.equal(result.state,"closure-unproved");assert.equal(result.nonce,null);assert.equal(result.requestDigest,null);assert.deepEqual(result.closedDirectories,[]);
  assert.equal(launch.mock.calls.length,0);assert.equal(spawn.mock.calls.length,0);
});
it("rejects extra native selector arguments before input, launch or controller admission",async()=>{
  const launch=vi.spyOn(chromium,"launchPersistentContext").mockRejectedValue(new Error("unexpected launch"));
  await assert.rejects(runSecureEnvironmentEntrypoint(["native-profile-probe","extra"]),/extra-arguments/u);
  assert.equal(launch.mock.calls.length,0);assert.equal(spawn.mock.calls.length,0);
});
