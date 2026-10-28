import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { it } from "vitest";
import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { BrowserProfileStillClosingError, onboardingProfileDirectory } from "../../../src/backend/runtime/browser/native-profile-probe.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture } from "../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";

it("refuses a canonical Chromium orphan after owner SIGKILL before erasure, then recovers only after native closure",async()=>{
  await runtimeLifetimeLock();
  const f=await createHistoricalIncompleteProfileFixture();
  const maintenance=RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  await maintenance.reclassifyIncompleteProfileAsDraft(f.profileId);maintenance.release();
  const machine=acquireEntrypointAdmission(f.workspace,"exclusive");
  const profile=composeProfileRuntime({admission:machine,hostFacts:{primaryDisplay:null},clock:systemClock});
  const operation=SignUpOperationSchema.parse(JSON.parse(readFileSync(f.operationPath,"utf8")));
  assert.ok(operation.onboarding);
  const owner={operationId:operation.operationId,profileId:operation.profileId,accountId:operation.onboarding.accountId,generation:operation.onboarding.generation};
  const root=join(machine.stateRoot,"browsers","onboarding");mkdirSync(root,{recursive:true,mode:0o700});
  const worker=fork(join(process.cwd(),"tests/support/processes/onboarding-native-orphan-owner.ts"),[root,JSON.stringify(owner)],{execArgv:["--import","tsx"],stdio:["ignore","pipe","pipe","ipc"]});
  worker.stdout?.resume();worker.stderr?.resume();
  let browser:Browser|undefined;
  try{
    const ready=z.strictObject({state:z.literal("ready"),directory:z.string(),endpoint:z.url()}).parse((await once(worker,"message"))[0]);
    assert.equal(ready.directory,onboardingProfileDirectory(root,owner));
    browser=await chromium.connectOverCDP(ready.endpoint);
    const exited=once(worker,"exit");worker.kill("SIGKILL");assert.deepEqual(await exited,[null,"SIGKILL"]);
    const before={operation:readFileSync(f.operationPath),key:readFileSync(f.keyPath),protected:readFileSync(f.protectedPath),database:readFileSync(f.databasePath)};
    await assert.rejects(profile.session.recoverOnboarding(),BrowserProfileStillClosingError);
    assert.deepEqual(readFileSync(f.operationPath),before.operation);assert.deepEqual(readFileSync(f.keyPath),before.key);
    assert.deepEqual(readFileSync(f.protectedPath),before.protected);assert.deepEqual(readFileSync(f.databasePath),before.database);
    assert.equal(existsSync(join(machine.stateRoot,"machine","erasures",`${f.profileId}.json`)),false);
    const disconnected=once(browser,"disconnected"),cdp=await browser.newBrowserCDPSession();
    await Promise.allSettled([cdp.send("Browser.close"),disconnected]);browser=undefined;
    await profile.session.recoverOnboarding();
    assert.equal(existsSync(ready.directory),false);assert.equal(existsSync(f.profileRoot),false);assert.equal(existsSync(f.operationPath),false);
  }finally{
    if(browser?.isConnected()){
      const disconnected=once(browser,"disconnected"),cdp=await browser.newBrowserCDPSession();
      await Promise.allSettled([cdp.send("Browser.close"),disconnected]);
    }
    if(worker.exitCode===null&&worker.signalCode===null){const exited=once(worker,"exit");worker.send("stop");await exited;}
    await profile.close();machine.release();await f.close();
  }
},60000);
