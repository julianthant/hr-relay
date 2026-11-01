import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { it, vi } from "vitest";
import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { BrowserProfileStillClosingError, onboardingProfileDirectory } from "../../../src/backend/runtime/browser/native-profile-probe.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture } from "../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { scaledMs } from "../../support/time-scale.js";

function ownedBrowserExited(pid:number):boolean {
  try{process.kill(pid,0);return false;}
  catch(error){if(error instanceof Error&&"code" in error&&error.code==="ESRCH")return true;throw error;}
}
async function requireOwnedBrowserExit(pid:number){
  await vi.waitFor(()=>assert.equal(ownedBrowserExited(pid),true,"owned fixture Chromium must exit"),{timeout:1000,interval:10});
}

it("refuses a canonical Chromium orphan after owner SIGKILL before erasure, then recovers only after native closure",async()=>{
  await runtimeLifetimeLock();
  const f=await createHistoricalIncompleteProfileFixture();
  const maintenance=RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  await maintenance.reclassifyIncompleteProfileAsDraft(f.profileId);maintenance.release();
  const machine=acquireEntrypointAdmission(f.workspace,"exclusive", f.lifetime);
  const profile=composeProfileRuntime({admission:machine,hostFacts:{primaryDisplay:null},clock:systemClock});
  const operation=SignUpOperationSchema.parse(JSON.parse(readFileSync(f.operationPath,"utf8")));
  assert.ok(operation.onboarding);
  const owner={operationId:operation.operationId,profileId:operation.profileId,accountId:operation.onboarding.accountId,generation:operation.onboarding.generation};
  const root=join(machine.stateRoot,"browsers","onboarding");mkdirSync(root,{recursive:true,mode:0o700});
  const worker=fork(join(process.cwd(),"tests/support/processes/onboarding-native-orphan-owner.ts"),[root,JSON.stringify(owner)],{execArgv:["--import","tsx"],stdio:["ignore","pipe","pipe","ipc"]});
  worker.stdout?.resume();worker.stderr?.resume();
  let browser:Browser|undefined,browserPid:number|undefined;
  let primary:{error:unknown}|undefined;
  try{
    const ready=z.strictObject({state:z.literal("ready"),directory:z.string(),endpoint:z.url(),browserPid:z.number().int().positive()}).parse((await once(worker,"message"))[0]);
    assert.equal(ready.directory,onboardingProfileDirectory(root,owner));browserPid=ready.browserPid;
    browser=await chromium.connectOverCDP(ready.endpoint);
    const exited=once(worker,"exit");worker.kill("SIGKILL");assert.deepEqual(await exited,[null,"SIGKILL"]);
    const before={operation:readFileSync(f.operationPath),key:readFileSync(f.keyPath),protected:readFileSync(f.protectedPath),database:readFileSync(f.databasePath)};
    await assert.rejects(profile.session.recoverOnboarding(),BrowserProfileStillClosingError);
    assert.deepEqual(readFileSync(f.operationPath),before.operation);assert.deepEqual(readFileSync(f.keyPath),before.key);
    assert.deepEqual(readFileSync(f.protectedPath),before.protected);assert.deepEqual(readFileSync(f.databasePath),before.database);
    assert.equal(existsSync(join(machine.stateRoot,"machine","erasures",`${f.profileId}.json`)),false);
    const ownedBrowser=browser;
    const disconnected=new Promise<void>(done=>ownedBrowser.once("disconnected",()=>done())),cdp=await ownedBrowser.newBrowserCDPSession();
    await Promise.all([cdp.send("Browser.close"),disconnected]);
    await requireOwnedBrowserExit(browserPid);browser=undefined;
    await profile.session.recoverOnboarding();
    assert.equal(existsSync(ready.directory),false);assert.equal(existsSync(f.profileRoot),false);assert.equal(existsSync(f.operationPath),false);
  }catch(error){primary={error};}
  const cleanupErrors:unknown[]=[];
  if(browser?.isConnected()){
    try{
      const ownedBrowser=browser;
      const disconnected=new Promise<void>(done=>ownedBrowser.once("disconnected",()=>done())),cdp=await ownedBrowser.newBrowserCDPSession();
      await Promise.all([cdp.send("Browser.close"),disconnected]);
    }catch(error){cleanupErrors.push(error);}
  }
  let browserClosed=false;
  try{
    if(worker.exitCode===null&&worker.signalCode===null){const exited=once(worker,"close");worker.send("stop");await exited;}
    if(browserPid===undefined)throw new Error("native-orphan-browser-exit-identity-unproved");
    await requireOwnedBrowserExit(browserPid);browserClosed=true;
  }catch(error){cleanupErrors.push(error);}
  if(browserClosed){
    try{await profile.close();machine.release();await f.close();}catch(error){cleanupErrors.push(error);}
  }else{
    console.error("[native-orphan-fixture] Chromium exit unproved; retain fixture for contained-run cleanup");
  }
  if(cleanupErrors.length!==0)throw new AggregateError(primary===undefined?cleanupErrors:[primary.error,...cleanupErrors],"native-orphan-fixture-cleanup-failed");
  if(primary!==undefined)throw primary.error;
}, scaledMs(60000));
