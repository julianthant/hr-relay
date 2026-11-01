import { testProcessImport } from "../../support/compiled-process.js";
import assert from "node:assert/strict";
import { execFileSync, fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import nativeFs, { writeFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes, generateKeyPairSync, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { it, vi } from "vitest";
import { z } from "zod";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { readyProfileOnboarding, syntheticOnboardingDuo } from "../../support/helpers/admission-fixture.js";
import { credentialKeyCustody } from "../../../src/backend/storage/configuration/credential-key-custody.js";
import { FakeKeyringEntry, credentialKeychainTestEnvironment } from "../../support/helpers/credential-keychain-fake.js";
import { ProfileVerifierDocumentSchema, SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { observeProcessIdentity, ProcessStartIdentitySchema } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime, RuntimeCustodyUncertainError } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { createDuoCredentialStore } from "../../../src/backend/storage/configuration/duo-credential-store.js";
import type { DraftDuoBrowserOwner, DraftDuoCapability, ProfileOnboardingDuoProvider } from "../../../src/backend/profiles/onboarding-duo.js";
import { ProfileOnboardingDuoProviderError } from "../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import { CanonicalCredentialHeadSchema } from "../../../src/backend/storage/configuration/canonical-credential-store.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { BrowserProfileStillClosingError, onboardingProfileDirectory } from "../../../src/backend/runtime/browser/native-profile-probe.js";
import { createHistoricalIncompleteProfileFixture, convertHistoricalIncompleteProfileFixture } from "../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
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
  await convertHistoricalIncompleteProfileFixture(f);
  const maintenance=RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  await maintenance.reclassifyIncompleteProfileAsDraft(f.profileId);maintenance.release();
  const machine=acquireEntrypointAdmission(f.workspace,"exclusive", f.lifetime);
  const profile=composeProfileRuntime({admission:machine,hostFacts:{primaryDisplay:null},clock:systemClock});
  const operation=SignUpOperationSchema.parse(JSON.parse(readFileSync(f.operationPath,"utf8")));
  assert.ok(operation.onboarding);
  const owner={operationId:operation.operationId,profileId:operation.profileId,accountId:operation.onboarding.accountId,generation:operation.onboarding.generation};
  const root=join(machine.stateRoot,"browsers","onboarding");mkdirSync(root,{recursive:true,mode:0o700});
  const worker=fork(join(process.cwd(),"tests/support/processes/onboarding-native-orphan-owner.ts"),[root,JSON.stringify(owner)],{execArgv:["--import",testProcessImport()],stdio:["ignore","pipe","pipe","ipc"]});
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
    assert.equal(existsSync(join(machine.stateRoot,"machine","credential-operations",`${f.profileId}.json`)),false);
    const ownedBrowser=browser;
    const disconnected=new Promise<void>(done=>ownedBrowser.once("disconnected",()=>done())),cdp=await ownedBrowser.newBrowserCDPSession();
    await Promise.all([cdp.send("Browser.close"),disconnected]);
    await requireOwnedBrowserExit(browserPid);browser=undefined;
    await profile.session.recoverOnboarding();
    assert.equal(existsSync(ready.directory),false);assert.equal(existsSync(f.profileRoot),false);assert.equal(existsSync(f.operationPath),false);
    const priorHead=CanonicalCredentialHeadSchema.parse(JSON.parse(before.key.toString("utf8")));
    const erased=CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(f.keyPath,"utf8")));
    assert.equal(erased.state,"erased");assert.ok(erased.generation>priorHead.generation);
    assert.deepEqual(erased.counters,priorHead.counters);
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

async function privateDraftFixture(onboardingDuo?: ProfileOnboardingDuoProvider) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-duo-recovery-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime), processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock,
    ...(onboardingDuo === undefined ? {} : { onboardingDuo }) });
  const draft = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
    password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
  if (draft.state !== "onboarding") throw new Error("fixture genuine draft required");
  return { root, lifetime, machine, profile, draft, processLockRoot };
}

function retainDraftBrowserDirectory(f: Awaited<ReturnType<typeof privateDraftFixture>>, operationId = f.draft.operationId) {
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "operations", `${operationId}.json`), "utf8")));
  assert.ok(operation.onboarding);
  const root = join(f.machine.stateRoot, "browsers", "onboarding");
  mkdirSync(onboardingProfileDirectory(root, { ...operation, accountId: operation.onboarding.accountId,
    generation: operation.onboarding.generation }), { recursive: true, mode: 0o700 });
}

it("viewing an actual draft creates no attempt and unknown enrollment cannot be rearmed by viewing or opening its browser", async () => {
  let browser: DraftDuoBrowserOwner | undefined, starts = 0;
  const f = await privateDraftFixture({
    async showBrowser(owner) { owner.assertCurrent(); browser = owner; },
    async openPortal(owner) { owner.assertCurrent(); },
    async closeBrowser() { return { state: "closed" }; },
    async start(_attempt, _bind, reportFailure) { starts++; await reportFailure(new ProfileOnboardingDuoProviderError("unknown", "provider")); },
    async cancel() { return { state: "closed" }; },
  });
  try {
    await f.profile.session.showOnboardingBrowser(f.draft.token, f.draft.operationId);
    await f.profile.session.openOnboardingPortal(f.draft.token, f.draft.operationId);
    assert.equal(starts, 0); assert.ok(browser);
    const pending = await f.profile.session.startOnboardingDuo(f.draft.token, f.draft.operationId, "key");
    assert.equal(pending.methods.key.state, "unknown");
    await f.profile.session.showOnboardingBrowser(f.draft.token, f.draft.operationId);
    await f.profile.session.openOnboardingPortal(f.draft.token, f.draft.operationId);
    await assert.rejects(f.profile.session.startOnboardingDuo(f.draft.token, f.draft.operationId, "key"));
    assert.equal(starts, 1); assert.equal(browser.readState().methods.key.state, "unknown");
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    await assert.rejects(f.profile.close(), error => error instanceof RuntimeCustodyUncertainError
      && error.errors.some(cause => cause instanceof AggregateError && cause.message === "profile-onboarding-custody-unproved"));
  } finally { f.machine.release(); }
});

for (const boundary of ["abort-intent", "erase-plan", "erase-stage", "head", "protected", "duo", "chatgpt", "keychain-before-delete", "keychain-after-delete", "erase-operation-unlink", "operation-unlink", "root-removal"] as const) {
  it(`resumes actual unpublished cancellation across ${boundary} without rewinding canonical custody`, async () => {
    const f = await privateDraftFixture(), operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
    const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`);
    const originalHead = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(keyPath, "utf8")));
    const eraseOperation = join(f.machine.stateRoot, "machine", "credential-operations", `${f.draft.profileId}.json`);
    const protectedPath = join(f.machine.stateRoot, "profiles", f.draft.profileId, "credentials", "protected.json");
    const duoPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${f.draft.profileId}.json`);
    const chatgptPath = join(f.machine.stateRoot, "profiles", f.draft.profileId, "credentials", "chatgpt-account.json");
    const rename = nativeFs.renameSync, unlink = nativeFs.unlinkSync, write = nativeFs.writeFileSync, remove = nativeFs.rmSync;
    const failure = new Error("fixture canonical cancel boundary"); let fired = false;
    const fail = () => { fired = true; throw failure; };
    const descriptor: TypedPropertyDescriptor<FakeKeyringEntry["deletePassword"]> | undefined = Object.getOwnPropertyDescriptor(FakeKeyringEntry.prototype, "deletePassword");
    const deletePassword = descriptor?.value; assert.ok(deletePassword);
    try {
      vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
        rename(source, destination);
        if (fired) return;
        if (boundary === "head" && String(destination) === keyPath) fail();
        if (boundary === "abort-intent" && String(destination) === operationPath
          && SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).onboarding?.abort !== undefined) fail();
      });
      vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
        write(path, data, options);
        if (!fired && (boundary === "erase-plan" && String(path) === eraseOperation
          || boundary === "erase-stage" && String(path).endsWith(".erase.tmp"))) fail();
      });
      vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
        unlink(path);
        if (!fired && (boundary === "protected" && String(path) === protectedPath || boundary === "duo" && String(path) === duoPath
          || boundary === "chatgpt" && String(path) === chatgptPath || boundary === "erase-operation-unlink" && String(path) === eraseOperation
          || boundary === "operation-unlink" && String(path) === operationPath)) fail();
      });
      vi.spyOn(nativeFs, "rmSync").mockImplementation((path, options) => {
        remove(path, options);
        if (!fired && boundary === "root-removal" && String(path) === join(f.machine.stateRoot, "profiles", f.draft.profileId)) fail();
      });
      const keychainSpy = vi.spyOn(FakeKeyringEntry.prototype, "deletePassword");
      keychainSpy.mockImplementation(function (this: FakeKeyringEntry) {
        if (!fired && boundary === "keychain-before-delete") fail();
        const deleted = deletePassword.call(this);
        if (!fired && boundary === "keychain-after-delete") fail();
        return deleted;
      });
      syncBuiltinESMExports();
      await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId));
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.equal(fired, true);
    const interruptedHead = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(keyPath, "utf8")));
    assert.ok(interruptedHead.generation >= originalHead.generation);
    await f.profile.close(); f.machine.release();
    const machine = acquireEntrypointAdmission(f.root, "exclusive", f.lifetime);
    const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock });
    await profile.session.recoverOnboarding();
    assert.deepEqual(machine.readProfileRegistry().profiles, []); assert.equal(machine.readProfileRegistry().activeProfileId, null);
    assert.equal(existsSync(operationPath), false); assert.equal(existsSync(eraseOperation), false);
    assert.equal(existsSync(protectedPath), false); assert.equal(existsSync(duoPath), false); assert.equal(existsSync(chatgptPath), false);
    const erased = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(keyPath, "utf8")));
    assert.equal(erased.state, "erased"); assert.ok(erased.generation > originalHead.generation);
    assert.deepEqual(erased.counters, originalHead.counters);
    assert.throws(() => credentialKeyCustody.read(originalHead.key), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
    assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "profile-verifiers.json"), "utf8"))).profiles.length, 0);
    await profile.close(); machine.release(); rmSync(f.root, { recursive: true });
  });
}

for (const changed of ["registry", "continuity"] as const) {
  it(`refuses changed ${changed} after interrupted draft operation removal`, async () => {
    const f = await privateDraftFixture(), root = join(f.machine.stateRoot, "profiles", f.draft.profileId);
    const operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
    const controlPath = join(f.root, ".tracker", "control", "profile-registry.json");
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json");
    const intentPath = join(f.root, ".tracker", "control", "profile-publication.json");
    const unlink = nativeFs.unlinkSync;
    let interrupted = false;
    const spy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      unlink(path);
      if (String(path) === operationPath) { interrupted = true; throw new Error("fixture operation removed"); }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId)); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(interrupted, true);
    await f.profile.close(); f.machine.release();
    const path = changed === "registry" ? registryPath : controlPath;
    const document = JSON.parse(readFileSync(path, "utf8")) as { sessionGeneration: number; generation: number };
    if (changed === "registry") document.sessionGeneration++;
    else document.generation++;
    writeFileSync(path, JSON.stringify(document), { mode: 0o600 });
    const control = readFileSync(controlPath), intent = readFileSync(intentPath);
    try {
      assert.throws(() => acquireEntrypointAdmission(f.root, "exclusive", f.lifetime), /profile-draft-abort-control-changed/);
      assert.equal(existsSync(root), true);
      assert.deepEqual(readFileSync(controlPath), control);
      assert.deepEqual(readFileSync(intentPath), intent);
    } finally { rmSync(f.root, { recursive: true }); }
  });
}

async function readyFixture() {
  let active = false, starts = 0, cancels = 0, browserCloses = 0;
  const remoteEnrollments: string[] = [];
  const provider: ProfileOnboardingDuoProvider = {
    async showBrowser(owner) { owner.assertCurrent(); },
    async openPortal(owner) { owner.assertCurrent(); },
    async closeBrowser() { browserCloses++; return { state: "closed" }; },
    async start(attempt, bind, _reportFailure) {
      assert.equal(active, false); active = true; starts++;
      const capability = await bind({ contextId: randomBytes(16).toString("hex"), tabId: attempt.method === "key" ? 1 : 2,
        accountName: "draft-recovery", origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });
      const credentialId = randomUUID(); remoteEnrollments.push(credentialId);
      if (attempt.method === "key") {
        const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        await capability.persistPending({ credentialId, privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
          publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
          transport: "usb", isResidentCredential: false, createdAt: new Date().toISOString() });
      }
      await capability.recordCeremony({ credentialId, requestId: randomUUID(), mechanism: attempt.method === "key" ? "fast-duo" : "native-platform",
        softwareInterceptionDisabled: attempt.method === "touch" });
      if (attempt.method === "touch") await capability.recordPortalAcceptance({ credentialId, requestId: randomUUID(), acceptance: "portal-accepted" });
    },
    async cancel() { active = false; cancels++; return { state: "closed" }; },
  };
  const f = await privateDraftFixture(provider);
  for (const method of ["key", "touch"] as const) {
    const pending = await f.profile.session.startOnboardingDuo(f.draft.token, f.draft.operationId, method);
    const attemptId = pending.methods[method].attemptId; assert.ok(attemptId);
    f.profile.session.confirmOnboardingDuo(f.draft.token, f.draft.operationId, method, attemptId);
  }
  assert.equal(f.profile.session.readOnboarding(f.draft.token, f.draft.operationId).step, "ready");
  assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
  assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "profile-verifiers.json"), "utf8"))).profiles.length, 0);
  return { ...f, remoteEnrollments, providerCounts: () => ({ starts, cancels, browserCloses, active }) };
}

for (const boundary of ["phase", "intent", "verifier", "registry", "continuity", "unlink", "operation-consume"] as const) {
  it(`recovers exact explicit Finish across ${boundary} with a coupled verifier and registration`, async () => {
    const f = await readyFixture(), operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
    const verifierPath = join(f.machine.stateRoot, "machine", "profile-verifiers.json"), registryPath = join(f.machine.stateRoot, "machine", "profiles.json");
    const intentPath = join(f.root, ".tracker", "control", "profile-publication.json"), continuityPath = join(f.root, ".tracker", "control", "profile-registry.json");
    const rename = nativeFs.renameSync, unlink = nativeFs.unlinkSync, failure = new Error("fixture Finish boundary");
    let fired = false, finishId: string | undefined;
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      const target = String(destination), op = existsSync(operationPath) ? JSON.parse(readFileSync(operationPath, "utf8")) as { phase: string; onboarding?: { finish?: { finishId: string } } } : undefined;
      const intent = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string } : undefined;
      if (op?.onboarding?.finish !== undefined) finishId = op.onboarding.finish.finishId;
      const hit = boundary === "phase" && target === operationPath && op?.phase === "publishing"
        || boundary === "intent" && target === intentPath && intent?.kind === "onboarding-finish"
        || intent?.kind === "onboarding-finish" && (boundary === "verifier" && target === verifierPath || boundary === "registry" && target === registryPath || boundary === "continuity" && target === continuityPath);
      if (!fired && hit) { fired = true; throw failure; }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      const target = String(path), intent = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string } : undefined;
      if (!fired && boundary === "unlink" && target === intentPath && intent?.kind === "onboarding-finish") { fired = true; throw failure; }
      unlink(path);
      if (!fired && boundary === "operation-consume" && target === operationPath) { fired = true; throw failure; }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)); }
    finally { renameSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); assert.ok(finishId);
    await f.profile.close(); f.machine.release();
    const machine = acquireEntrypointAdmission(f.root, "exclusive", f.lifetime), profile = composeProfileRuntime({ admission: machine,
       hostFacts: { primaryDisplay: null }, clock: systemClock });
    const published = machine.readProfileRegistry().profiles.find(row => row.profileId === f.draft.profileId);
    if (published === undefined) {
      assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(verifierPath, "utf8"))).profiles.length, 0);
    }
    await profile.session.recoverOnboarding();
    const signedIn = profile.session.signIn({ email: "draft-recovery@ucsd.edu", password: "disposable-draft-recovery", at: new Date().toISOString() });
    assert.equal(signedIn.state, "active");
    const row = machine.readProfileRegistry().profiles.find(entry => entry.profileId === f.draft.profileId);
    assert.equal(row?.registration.onboardingCompletion?.finishId, finishId);
    assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(verifierPath, "utf8"))).profiles.length, 1);
    assert.equal(existsSync(operationPath), false); assert.equal(existsSync(intentPath), false);
    await profile.close(); machine.release(); rmSync(f.root, { recursive: true });
  });
}

it("holds tampered canonical abort source and preserves exact head and operation until its source is restored", async () => {
  const f = await privateDraftFixture();
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`);
  const sourcePath = join(f.machine.stateRoot, "profiles", f.draft.profileId, "credentials", "protected.json");
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
  const rename = nativeFs.renameSync; let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    if (!fired && String(destination) === keyPath && String(source).endsWith(".erase.tmp")) {
      fired = true; throw new Error("fixture before canonical erased head publication");
    }
    rename(source, destination);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true);
  const original = readFileSync(sourcePath), operation = readFileSync(operationPath), key = readFileSync(keyPath);
  writeFileSync(sourcePath, "invalid encrypted source", { mode: 0o600 });
  await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId));
  assert.deepEqual(readFileSync(operationPath), operation); assert.deepEqual(readFileSync(keyPath), key);
  writeFileSync(sourcePath, original, { mode: 0o600 });
  assert.deepEqual(await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId), { state: "signed-out" });
  assert.equal(existsSync(operationPath), false); assert.equal(existsSync(sourcePath), false);
  assert.equal(CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(keyPath, "utf8"))).state, "erased");
  await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true });
});

it("keeps Finish unpublished when the ready canonical Duo credential cannot be verified", async () => {
  const f = await readyFixture(), operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
  const duoPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${f.draft.profileId}.json`);
  await f.profile.session.closeOnboarding();
  const operation = readFileSync(operationPath), credential = readFileSync(duoPath);
  writeFileSync(duoPath, "invalid encrypted credential", { mode: 0o600 });
  try {
    await assert.rejects(f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId));
    assert.deepEqual(readFileSync(operationPath), operation);
    assert.equal(SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).onboarding?.finish, undefined);
    assert.deepEqual(f.machine.readProfileRegistry().profiles, []);
  } finally { writeFileSync(duoPath, credential, { mode: 0o600 }); }
  assert.equal((await f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)).state, "active");
  await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true });
});

it("limits finished publishing to value-free metadata and refuses key provisioning or mutation before exact Finish recovery", async () => {
  const f = await readyFixture(), operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`), rename = nativeFs.renameSync;
  let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    rename(source, destination);
    if (!fired && String(destination) === operationPath && SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).phase === "publishing") {
      fired = true; throw new Error("fixture publishing before registry intent");
    }
  });
  syncBuiltinESMExports();
  try { await assert.rejects(f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true); assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))), draft = operation.onboarding;
  assert.ok(draft?.finish);
  const key = draft.attempts.find(entry => entry.method === "key"); assert.ok(key?.scope); assert.ok(key.ceremony);
  const scope = key.scope, credentialId = key.ceremony.credentialId;
  const metadata = f.profile.session.readOnboarding(f.draft.token, f.draft.operationId);
  assert.equal(metadata.step, "ready"); assert.equal(metadata.methods.key.state, "complete");
  assert.equal(metadata.methods.key.attemptId, key.attemptId);
  assert.equal(metadata.methods.key.ceremonyObserved, true);
  assert.equal(/privateKey|publicKeySpki|authenticatorData|signature/.test(JSON.stringify(metadata)), false);
  const paths = [join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`),
    join(f.machine.stateRoot, "machine", "duo-credentials", `${f.draft.profileId}.json`),
    ...["protected.json", "chatgpt-account.json"].map(name => join(f.machine.stateRoot, "profiles", f.draft.profileId, "credentials", name))];
  const before = paths.map(path => readFileSync(path)), keychain = FakeKeyringEntry.snapshot();
  const admission = f.machine.admitProfile(f.draft.profileId), store = createDuoCredentialStore(admission, systemClock);
  const refused = (error: unknown) => {
    const pending: unknown[] = [error], seen = new Set<unknown>();
    while (pending.length > 0) {
      const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
      if (value instanceof Error && value.message === "profile-setup-operation-not-current") return true;
      if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
      if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    }
    return false;
  };
  const signingRequest = { credentialId, requestId: randomUUID(), rpId: "duosecurity.com" as const, origin: scope.origin, challenge: "AQID" };
  assert.throws(() => store.readForScope(scope), refused);
  assert.throws(() => store.provision(credentialId, scope), refused);
  assert.throws(() => store.reserveForAttempt(credentialId, randomUUID(), scope), refused);
  await assert.rejects(store.signForScope(signingRequest, scope), refused);
  await assert.rejects(store.sign({ ...signingRequest, requestId: randomUUID() }), refused);
  assert.throws(() => store.confirm(credentialId, scope), refused);
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.throws(() => store.enroll({ credentialId: randomUUID(), scope,
    privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") }), refused);
  assert.deepEqual(paths.map(path => readFileSync(path)), before); assert.deepEqual(FakeKeyringEntry.snapshot(), keychain);
  admission.release();
  assert.equal((await f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)).state, "active");
  assert.equal(f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion?.finishId, draft.finish.finishId);
  await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true });
});

const retainedProcessLossFixtures = new Set<unknown>();
for (const boundary of ["erase-plan-fsync", "erase-head-stage"] as const) {
  it(`recovers actual dead-writer process loss after ${boundary} without treating owned abort source as a writer stage`, async () => {
    const f = await privateDraftFixture(); retainDraftBrowserDirectory(f); await f.profile.close(); f.machine.release();
    const port = f.lifetime.port; await f.lifetime.close();
    const child = fork(fileURLToPath(new URL("../../support/processes/profile-onboarding-abort-worker.ts", import.meta.url)), [f.root, boundary, String(port)],
      { env: credentialKeychainTestEnvironment(process.env), execArgv: ["--import", testProcessImport()], detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const retained: { root: string; child: typeof child; recoveryLifetime?: RuntimeLifetimeLock } = { root: f.root, child }; retainedProcessLossFixtures.add(retained);
    const closed = once(child, "close"); let stderrBytes = 0; child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
    const ready = z.object({ type: z.literal("ready"), pid: z.number().int().positive(), keychain: z.array(z.tuple([z.string(), z.string()])) }).parse((await once(child, "message"))[0]);
    FakeKeyringEntry.import(ready.keychain);
    assert.equal(ready.pid, child.pid);
    const identity = observeProcessIdentity(ready.pid); assert.equal(identity.state, "alive");
    if (identity.state !== "alive") throw new Error("fixture owned child identity required");
    const processRow = execFileSync("/bin/ps", ["-p", String(ready.pid), "-o", "pid=,ppid=,pgid="], { encoding: "utf8" }).trim().split(/\s+/u).map(Number);
    assert.deepEqual(processRow, [ready.pid, process.pid, ready.pid]);
    child.send("cancel");
    const [code, signal] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(await closed); assert.equal(code, 97); assert.equal(signal, null); assert.equal(child.connected, false); assert.equal(stderrBytes, 0);
    const proof = z.object({ boundary: z.literal(boundary), pid: z.number(), identity: ProcessStartIdentitySchema }).parse(JSON.parse(readFileSync(join(f.root, "onboarding-process-loss.json"), "utf8")));
    assert.equal(proof.pid, ready.pid); assert.deepEqual(proof.identity, identity.identity); assert.equal(observeProcessIdentity(ready.pid).state, "gone");
    const groups = execFileSync("/bin/ps", ["-axo", "pgid="], { encoding: "utf8" }).trim().split(/\s+/u);
    assert.equal(groups.includes(String(ready.pid)), false);
    const fds = spawnSync("lsof", ["-nP", "-a", "-p", String(ready.pid)], { encoding: "utf8" });
    assert.equal(fds.error, undefined); assert.equal(fds.signal, null); assert.equal(fds.status, 1); assert.equal(fds.stdout.trim(), "");
    const recoveryLifetime = await RuntimeLifetimeLock.acquire(port); retained.recoveryLifetime = recoveryLifetime;
    const machine = acquireEntrypointAdmission(f.root, "exclusive", recoveryLifetime), profile = composeProfileRuntime({ admission: machine,
      hostFacts: { primaryDisplay: null }, clock: systemClock });
    await profile.session.recoverOnboarding();
    const credentials = join(machine.stateRoot, "profiles", f.draft.profileId, "credentials");
    assert.equal(existsSync(credentials), false);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    await profile.close(); machine.release(); await recoveryLifetime.close(); rmSync(f.root, { recursive: true }); retainedProcessLossFixtures.delete(retained);
  });
}

for (const change of ["same-length", "replacement"] as const) {
  it(`holds coupled Finish when its pepper has ${change} drift and resumes only the exact original`, async () => {
    const f = await readyFixture(), intentPath = join(f.root, ".tracker", "control", "profile-publication.json");
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), verifierPath = join(f.machine.stateRoot, "machine", "profile-verifiers.json");
    const registry = readFileSync(registryPath), verifiers = readFileSync(verifierPath), rename = nativeFs.renameSync;
    let fired = false;
    const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      if (!fired && String(destination) === intentPath && (JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string }).kind === "onboarding-finish") {
        fired = true; throw new Error("fixture durable Finish before verifier publication");
      }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)); }
    finally { fault.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true);
    const pepperPath = join(f.machine.stateRoot, "machine", "profile-pepper"), original = readFileSync(pepperPath), retained = join(f.root, "fixture-original-pepper");
    if (change === "same-length") { const changed = Buffer.from(original); changed[0] = (changed[0] ?? 0) ^ 1; writeFileSync(pepperPath, changed, { mode: 0o600 }); }
    else { nativeFs.renameSync(pepperPath, retained); writeFileSync(pepperPath, original, { mode: 0o600, flag: "wx" }); }
    assert.throws(() => f.machine.readProfileRegistry(), /profile-onboarding-finish-pepper-changed/u);
    assert.equal(readFileSync(registryPath).equals(registry), true); assert.equal(readFileSync(verifierPath).equals(verifiers), true); assert.equal(existsSync(intentPath), true);
    if (change === "same-length") writeFileSync(pepperPath, original, { mode: 0o600 });
    else { nativeFs.unlinkSync(pepperPath); nativeFs.renameSync(retained, pepperPath); }
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`), "utf8")));
    assert.equal((await f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)).state, "active");
    assert.equal(f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion?.finishId, operation.onboarding?.finish?.finishId);
    assert.equal(existsSync(intentPath), false);
    await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true });
  });
}

it("removes an unfinished sign-up at startup through the existing cancellation path", async () => {
  const f = await privateDraftFixture(); retainDraftBrowserDirectory(f); await f.profile.close(); f.machine.release();
  const machine = acquireEntrypointAdmission(f.root, "exclusive", f.lifetime);
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock });
  try {
    await profile.session.recoverOnboarding();
    assert.equal(existsSync(join(machine.stateRoot, "profiles", f.draft.profileId)), false);
    assert.equal(existsSync(join(machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`)), false);
    assert.deepEqual(machine.readProfileRegistry().profiles, []);
  } finally { await profile.close(); machine.release(); rmSync(f.root, { recursive: true }); }
});

it.each([false, true])("removes an uninitialized sign-up only after native key absence is proved (unexpected key: %s)", async unexpectedKey => {
  const f = await privateDraftFixture();
  const original = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`), "utf8")));
  await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId);
  const draft = f.machine.beginProfileSignUp({ emailKey: original.emailKey, firstName: original.firstName, lastName: original.lastName,
    createdAt: original.createdAt, commandFingerprint: original.commandFingerprint });
  assert.equal(existsSync(join(f.machine.stateRoot, "profiles", draft.profileId)), false);
  retainDraftBrowserDirectory(f, draft.operationId);
  await f.profile.close(); f.machine.release();
  const machine = acquireEntrypointAdmission(f.root, "exclusive", f.lifetime);
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock });
  try {
    if (unexpectedKey) {
      const entry = new FakeKeyringEntry("Relay", `${machine.locator.installationId}:${draft.profileId}`), key = randomBytes(32).toString("base64");
      entry.setPassword(key);
      await assert.rejects(profile.session.recoverOnboarding(), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
      assert.equal(existsSync(join(machine.stateRoot, "profiles", draft.profileId)), false);
      assert.equal(existsSync(join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`)), true);
      assert.equal(entry.getPassword(), key);
      entry.deletePassword();
    }
    await profile.session.recoverOnboarding();
    assert.equal(existsSync(join(machine.stateRoot, "profiles", draft.profileId)), false);
    assert.equal(existsSync(join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`)), false);
    assert.equal(existsSync(join(machine.stateRoot, "machine", "credential-keys", `${draft.profileId}.json`)), false);
    assert.deepEqual(machine.readProfileRegistry().profiles, []);
  } finally { await profile.close(); machine.release(); rmSync(f.root, { recursive: true }); }
});

it("cancels a ready sign-up, deleting local Duo material while preserving the remote enrollment", async () => {
  const f = await readyFixture();
  try {
    const remote = [...f.remoteEnrollments];
    assert.equal(remote.length, 2);
    assert.deepEqual(await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId), { state: "signed-out" });
    assert.equal(existsSync(join(f.machine.stateRoot, "profiles", f.draft.profileId)), false);
    assert.equal(existsSync(join(f.machine.stateRoot, "machine", "duo-credentials", `${f.draft.profileId}.json`)), false);
    assert.deepEqual(f.machine.readProfileRegistry().profiles, []);
    assert.deepEqual(f.remoteEnrollments, remote);
    assert.deepEqual(f.providerCounts(), { starts: 2, cancels: 2, browserCloses: 1, active: false });
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`), "utf8")));
    assert.equal(head.state, "erased");
    assert.ok(remote.some(credentialId => head.retired.includes(credentialId)));
  } finally { await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true }); }
});

it("completes a recorded Finish at startup without reopening its draft", async () => {
  const f = await privateDraftFixture(syntheticOnboardingDuo(() => "draft-recovery@ucsd.edu"));
  await readyProfileOnboarding(f.profile.session, f.draft);
  const rename = nativeFs.renameSync, operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
  let interrupted = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    rename(source, destination);
    if (!interrupted && String(destination) === operationPath && SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).phase === "publishing") {
      interrupted = true; throw new Error("fixture Finish publication interrupted");
    }
  });
  syncBuiltinESMExports();
  try { await assert.rejects(f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(interrupted, true);
  const recorded = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  assert.ok(recorded.onboarding?.finish);
  const finishId = recorded.onboarding.finish.finishId;
  const duoPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${f.draft.profileId}.json`), duoBytes = readFileSync(duoPath);
  const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`), headBytes = readFileSync(headPath);
  await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId));
  assert.deepEqual(readFileSync(duoPath), duoBytes); assert.deepEqual(readFileSync(headPath), headBytes);
  await f.profile.close(); f.machine.release();
  const machine = acquireEntrypointAdmission(f.root, "exclusive", f.lifetime);
  let reopened = 0;
  const refuseReopen = async () => { reopened++; throw new Error("recorded Finish must not reopen onboarding"); };
  const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: { showBrowser: refuseReopen, openPortal: refuseReopen, start: refuseReopen,
      async cancel() { throw new Error("recorded Finish must not cancel enrollment"); }, async closeBrowser() { return { state: "closed" }; } } });
  try {
    await profile.session.recoverOnboarding();
    assert.equal(reopened, 0);
    const row = machine.readProfileRegistry().profiles.find(row => row.profileId === f.draft.profileId); assert.ok(row?.registration.onboardingCompletion);
    assert.equal(row.registration.onboardingCompletion.finishId, finishId);
    assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "profile-verifiers.json"), "utf8"))).profiles.length, 1);
    assert.equal(existsSync(join(machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`)), false);
    assert.equal(existsSync(join(machine.stateRoot, "profiles", f.draft.profileId, "credentials", "protected.json")), true);
  } finally { await profile.close(); machine.release(); rmSync(f.root, { recursive: true }); }
});

it("keeps a pending signup key unsigned until exact scoped proof confirms it, then burns failed signatures without undoing readiness", async () => {
  let capability: DraftDuoCapability | undefined;
  const credentialId = randomBytes(24).toString("base64url"), enrollmentId = randomUUID();
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const provider: ProfileOnboardingDuoProvider = {
    async showBrowser(owner) { owner.assertCurrent(); }, async openPortal(owner) { owner.assertCurrent(); },
    async closeBrowser() { return { state: "closed" }; }, async cancel() { return { state: "closed" }; },
    async start(attempt, bind) {
      capability = await bind({ contextId: randomBytes(16).toString("hex"), tabId: 1, accountName: "draft-recovery",
        origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });
      await capability.persistPending({ credentialId, privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
        publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), transport: "usb", isResidentCredential: true,
        userHandle: "AQID", createdAt: new Date().toISOString() });
      await capability.recordCeremony({ credentialId, requestId: enrollmentId, mechanism: "fast-duo", softwareInterceptionDisabled: false });
      assert.equal(attempt.method, "key");
    },
  };
  const f = await privateDraftFixture(provider);
  const admission = f.machine.admitProfile(f.draft.profileId);
  try {
    await f.profile.session.startOnboardingDuo(f.draft.token, f.draft.operationId, "key");
    assert.ok(capability);
    const request = { requestId: randomUUID(), credentialId, rpId: "duosecurity.com" as const, origin: capability.scope.origin, challenge: "AQID" };
    await assert.rejects(capability.signAssertion(request), /duo-ready-credential-required/u);
    const store = createDuoCredentialStore(admission, systemClock);
    assert.deepEqual(store.readForScope(capability.scope).map(row => row.state), ["pending"]);
    const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`);
    assert.equal(CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(headPath, "utf8"))).counters.some(row => row.credentialId === credentialId), false);
    await capability.recordPortalAcceptance({ credentialId, requestId: enrollmentId, acceptance: "exact-credential-request" });
    assert.equal(f.profile.session.readOnboarding(f.draft.token, f.draft.operationId).methods.key.state, "complete");
    assert.equal(store.readForScope(capability.scope)[0]?.state, "ready");
    const signed = await capability.signAssertion(request);
    const failed = { ...request, requestId: randomUUID(), challenge: Buffer.alloc(4097).toString("base64") };
    await assert.rejects(capability.signAssertion(failed), /duo-challenge-invalid/u);
    assert.equal(CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(headPath, "utf8"))).counters.find(row => row.credentialId === credentialId)?.count, signed.signCount + 1);
    await assert.rejects(capability.signAssertion({ ...failed, challenge: "AQID" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "DUO_CREDENTIAL_CONFLICT");
    await capability.retainUnknown();
    assert.equal(f.profile.session.readOnboarding(f.draft.token, f.draft.operationId).methods.key.state, "complete");
    assert.equal(store.readForScope(capability.scope)[0]?.state, "ready");
  } finally { admission.release(); await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true }); }
});
