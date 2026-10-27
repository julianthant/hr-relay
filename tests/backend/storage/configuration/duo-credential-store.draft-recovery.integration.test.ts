import { ProfileVerifierDocumentSchema } from "../../../../src/models/profiles/profile.js";
import { execFileSync, fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { observeProcessIdentity, ProcessStartIdentitySchema } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { z } from "zod";
import nativeFs, { readdirSync, writeFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes, generateKeyPairSync, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDraftDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import type { DraftDuoBrowserOwner, ProfileOnboardingDuoProvider } from "../../../../src/backend/profiles/onboarding-duo.js";
import { ProfileOnboardingDuoProviderError } from "../../../../src/backend/profiles/onboarding-duo-provider.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

function privateDraftFixture(onboardingDuo?: ProfileOnboardingDuoProvider) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-duo-recovery-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const machine = acquireEntrypointAdmission(root, "exclusive"), processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const profile = composeProfileRuntime({ admission: machine, processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock,
    ...(onboardingDuo === undefined ? {} : { onboardingDuo }) });
  const draft = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
    password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
  if (draft.state !== "onboarding") throw new Error("fixture genuine draft required");
  return { root, machine, profile, draft, processLockRoot };
}

function draftFixture() {
  const base = privateDraftFixture(), { root, machine, profile, draft } = base;
  const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(draft.profileId));
  const store = createDraftDuoCredentialStore(admission, machine, draft.operationId, 1, systemClock), pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const armedAt = systemClock.nowMs();
  const input = { credentialId: randomUUID(), scope: { armId: randomUUID(), contextId: randomBytes(16).toString("hex"), tabId: 1, accountId: randomUUID(),
    origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com", armedAt: new Date(armedAt).toISOString(), expiresAt: new Date(armedAt + 600_000).toISOString() },
    privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  store.enroll(input); store.confirm(input.credentialId, input.scope);
  return { ...base, admission, store, input, async close() { admission.release(); await profile.close(); machine.release(); rmSync(root, { recursive: true }); } };
}

it("viewing an actual draft creates no attempt and unknown enrollment cannot be rearmed by viewing or opening its browser", async () => {
  let browser: DraftDuoBrowserOwner | undefined, starts = 0;
  const f = privateDraftFixture({
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

for (const boundary of ["intent", "rename", "operation", "continuity", "unlink"] as const) {
  it(`recovers the exact draft Duo transaction after ${boundary} without publishing a profile`, async () => {
    const f = draftFixture(), control = join(f.root, ".tracker", "control"), intent = join(control, "profile-publication.json");
    const canonical = join(f.machine.stateRoot, "machine", "duo-credentials", `${f.draft.profileId}.json`);
    const operation = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
    const registry = readFileSync(join(f.machine.stateRoot, "machine", "profiles.json")), injected = new Error("fixture publication boundary");
    let fired = false;
    const rename = nativeFs.renameSync, unlink = nativeFs.unlinkSync;
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      const target = boundary === "intent" ? intent : boundary === "rename" ? canonical : boundary === "operation" ? operation : join(control, "profile-registry.json");
      if (!fired && boundary !== "unlink" && String(destination) === target) { fired = true; throw injected; }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      if (!fired && boundary === "unlink" && String(path) === intent) { fired = true; throw injected; }
      unlink(path);
    });
    syncBuiltinESMExports();
    try { assert.throws(() => f.store.reserve(f.input.credentialId), /Duo credential commit|uncertain/u); }
    finally { renameSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); assert.equal(existsSync(intent), true);
    f.store.recoverInterruptedPublication();
    assert.equal(existsSync(intent), false);
    const recovered = f.store.read();
    assert.ok((recovered.credentials[0]?.highWater ?? 0) > 0);
    const highWater = recovered.credentials[0]?.highWater; assert.ok(highWater !== undefined);
    assert.ok(f.store.reserve(f.input.credentialId).count >= highWater + 1);
    assert.equal(readFileSync(join(f.machine.stateRoot, "machine", "profiles.json")).equals(registry), true);
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    await f.close();
  });
}

it("recovers a draft's durable counter intent through stopped authenticated maintenance", async () => {
  const f = draftFixture(), profileId = f.draft.profileId;
  assert.throws(() => f.store.interruptReserve(f.input.credentialId), /Duo credential commit|uncertain/u);
  f.admission.release(); await f.profile.close(); f.machine.release();
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
  const recovered = maintenance.recoverInterruptedDuoPublication();
  assert.equal(recovered.revision, 3);
  assert.equal(maintenance.readProfileRegistry().profiles.length, 0);
  const admission = maintenance.admitProfile(maintenance.issueRegisteredProfileClaim(profileId));
  const fresh = createDraftDuoCredentialStore(admission, maintenance, f.draft.operationId, 1, systemClock);
  assert.equal(fresh.read().credentials[0]?.credentialId, f.input.credentialId);
  assert.ok((fresh.read().credentials[0]?.highWater ?? 0) > 0);
  admission.release(); maintenance.release(); rmSync(f.root, { recursive: true });
});

for (const boundary of ["source", "journal", "erase", "intent", "source-unlink", "key-unlink", "operation-unlink"] as const) {
  it(`resumes actual unpublished cancellation across ${boundary} with original encrypted custody retained`, async () => {
    const f = privateDraftFixture(), operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`);
    const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`);
    const protectedPath = join(f.machine.stateRoot, "profiles", f.draft.profileId, "credentials", "protected.json");
    const intentPath = join(f.root, ".tracker", "control", "profile-publication.json");
    const failure = new Error("fixture draft abort boundary"), rename = nativeFs.renameSync, unlink = nativeFs.unlinkSync, write = nativeFs.writeFileSync;
    let fired = false;
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      const target = String(destination);
      const kind = target === intentPath ? JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string } : undefined;
      if (!fired && (boundary === "erase" && target === protectedPath || boundary === "intent" && kind?.kind === "draft-abort"
        || boundary === "journal" && target === join(f.machine.stateRoot, "machine", "erasures", `${f.draft.profileId}.json`))) { fired = true; throw failure; }
    });
    const writeSpy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
      write(path, data, options);
      if (!fired && boundary === "source" && String(path).includes(`.protected.${f.draft.operationId}.`) && String(path).endsWith(".tmp")) { fired = true; throw failure; }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      unlink(path);
      const target = String(path);
      if (!fired && (boundary === "source-unlink" && target.includes(`.protected.${f.draft.operationId}.`) && target.endsWith(".tmp")
        || boundary === "key-unlink" && target === keyPath || boundary === "operation-unlink" && target === operationPath)) { fired = true; throw failure; }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId)); }
    finally { renameSpy.mockRestore(); writeSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true);
    await f.profile.close(); f.machine.release();
    const machine = acquireEntrypointAdmission(f.root, "exclusive");
    const profile = composeProfileRuntime({ admission: machine, processLockRoot: f.processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock });
    const registry = machine.readProfileRegistry(); assert.equal(registry.profiles.length, 0); assert.equal(registry.activeProfileId, null);
    if (existsSync(operationPath)) {
      const resumed = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
        password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
      if (resumed.state !== "onboarding") throw new Error("fixture exact abort authentication required");
      assert.equal(resumed.operationId, f.draft.operationId);
      assert.deepEqual(await profile.session.cancelOnboarding(resumed.token, resumed.operationId), { state: "signed-out" });
    }
    assert.equal(existsSync(operationPath), false); assert.equal(existsSync(keyPath), false); assert.equal(existsSync(intentPath), false);
    assert.equal(existsSync(protectedPath), true);
    assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "profile-verifiers.json"), "utf8"))).profiles.length, 0);
    await profile.close(); machine.release(); rmSync(f.root, { recursive: true });
  });
}

async function readyFixture() {
  let active = false;
  const provider: ProfileOnboardingDuoProvider = {
    async showBrowser(owner) { owner.assertCurrent(); },
    async openPortal(owner) { owner.assertCurrent(); },
    async closeBrowser() { return { state: "closed" }; },
    async start(attempt, bind, _reportFailure) {
      assert.equal(active, false); active = true;
      const capability = await bind({ contextId: randomBytes(16).toString("hex"), tabId: attempt.method === "key" ? 1 : 2,
        accountName: "draft-recovery", origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });
      const credentialId = randomUUID();
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
    async cancel() { active = false; return { state: "closed" }; },
  };
  const f = privateDraftFixture(provider);
  for (const method of ["key", "touch"] as const) {
    const pending = await f.profile.session.startOnboardingDuo(f.draft.token, f.draft.operationId, method);
    const attemptId = pending.methods[method].attemptId; assert.ok(attemptId);
    f.profile.session.confirmOnboardingDuo(f.draft.token, f.draft.operationId, method, attemptId);
  }
  assert.equal(f.profile.session.readOnboarding(f.draft.token, f.draft.operationId).step, "ready");
  assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
  assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "profile-verifiers.json"), "utf8"))).profiles.length, 0);
  return f;
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
    const machine = acquireEntrypointAdmission(f.root, "exclusive"), profile = composeProfileRuntime({ admission: machine,
      processLockRoot: f.processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock });
    const published = machine.readProfileRegistry().profiles.find(row => row.profileId === f.draft.profileId);
    if (published === undefined) {
      assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(verifierPath, "utf8"))).profiles.length, 0);
      const resumed = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
        password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
      if (resumed.state !== "onboarding") throw new Error("fixture genuine Finish resume required");
      assert.equal(resumed.operationId, f.draft.operationId);
      assert.equal((await profile.session.completeOnboarding(resumed.token, resumed.operationId)).state, "active");
    } else {
      const signedIn = profile.session.signIn({ email: "draft-recovery@ucsd.edu", password: "disposable-draft-recovery", at: new Date().toISOString() });
      assert.equal(signedIn.state, "active");
    }
    const row = machine.readProfileRegistry().profiles.find(entry => entry.profileId === f.draft.profileId);
    assert.equal(row?.registration.onboardingCompletion?.finishId, finishId);
    assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(verifierPath, "utf8"))).profiles.length, 1);
    assert.equal(existsSync(operationPath), false); assert.equal(existsSync(intentPath), false);
    await profile.close(); machine.release(); rmSync(f.root, { recursive: true });
  });
}

it("holds tampered abort source and preserves exact key/operation until authenticated source is restored", async () => {
  const f = privateDraftFixture(), intentPath = join(f.root, ".tracker", "control", "profile-publication.json");
  const credentials = join(f.machine.stateRoot, "profiles", f.draft.profileId, "credentials");
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`), keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.draft.profileId}.json`);
  const rename = nativeFs.renameSync; let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    if (!fired && String(destination) === intentPath && (JSON.parse(readFileSync(String(source), "utf8")) as { kind: string }).kind === "draft-abort") {
      fired = true; throw new Error("fixture before final abort intent");
    }
    rename(source, destination);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true);
  const sourceName = readdirSync(credentials).find(name => name.startsWith(`.protected.${f.draft.operationId}.`)); assert.ok(sourceName);
  const sourcePath = join(credentials, sourceName), original = readFileSync(sourcePath), operation = readFileSync(operationPath), key = readFileSync(keyPath);
  writeFileSync(sourcePath, "invalid encrypted source", { mode: 0o600 });
  await assert.rejects(f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId));
  assert.equal(readFileSync(operationPath).equals(operation), true); assert.equal(readFileSync(keyPath).equals(key), true);
  writeFileSync(sourcePath, original, { mode: 0o600 });
  assert.deepEqual(await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId), { state: "signed-out" });
  assert.equal(existsSync(operationPath), false); assert.equal(existsSync(keyPath), false);
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
  const admission = f.machine.admitProfile(f.machine.issueRegisteredProfileClaim(f.draft.profileId));
  const store = createDraftDuoCredentialStore(admission, f.machine, operation.operationId, draft.generation, systemClock);
  assert.deepEqual(store.readForScope(scope).map(entry => entry.credentialId), [credentialId]);
  assert.throws(() => store.provision(credentialId, scope), /duo-finished-draft-purpose-refused/u);
  assert.throws(() => store.reserveForAttempt(credentialId, randomUUID(), scope), /duo-finished-draft-purpose-refused/u);
  assert.throws(() => store.confirm(credentialId, scope), /duo-finished-draft-purpose-refused/u);
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.throws(() => store.enroll({ credentialId: randomUUID(), scope: scope,
    privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") }), /duo-finished-draft-purpose-refused/u);
  admission.release();
  assert.equal((await f.profile.session.completeOnboarding(f.draft.token, f.draft.operationId)).state, "active");
  assert.equal(f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion?.finishId, draft.finish.finishId);
  await f.profile.close(); f.machine.release(); rmSync(f.root, { recursive: true });
});

const retainedProcessLossFixtures = new Set<unknown>();
for (const boundary of ["source-fsync", "protected-stage"] as const) {
  it(`recovers actual dead-writer process loss after ${boundary} without treating owned abort source as a writer stage`, async () => {
    const f = privateDraftFixture(); await f.profile.close(); f.machine.release();
    const child = fork(fileURLToPath(new URL("../../../support/processes/profile-onboarding-abort-worker.ts", import.meta.url)), [f.root, boundary],
      { execArgv: ["--disable-warning=ExperimentalWarning", "--import", "tsx"], detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const retained = { root: f.root, child }; retainedProcessLossFixtures.add(retained);
    const closed = once(child, "close"); let stderrBytes = 0; child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
    const ready = z.object({ type: z.literal("ready"), pid: z.number().int().positive() }).parse((await once(child, "message"))[0]);
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
    const fds = spawnSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(ready.pid)], { encoding: "utf8" });
    assert.equal(fds.error, undefined); assert.equal(fds.signal, null); assert.equal(fds.status, 1); assert.equal(fds.stdout.trim(), "");
    const machine = acquireEntrypointAdmission(f.root, "exclusive"), profile = composeProfileRuntime({ admission: machine, processLockRoot: f.processLockRoot,
      hostFacts: { primaryDisplay: null }, clock: systemClock });
    const resumed = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
      password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
    if (resumed.state !== "onboarding") throw new Error("fixture actual dead-writer resume required");
    assert.equal(resumed.operationId, f.draft.operationId);
    assert.deepEqual(await profile.session.cancelOnboarding(resumed.token, resumed.operationId), { state: "signed-out" });
    const credentials = join(machine.stateRoot, "profiles", f.draft.profileId, "credentials");
    assert.equal(existsSync(join(credentials, ".protected.lock")), false); assert.equal(readdirSync(credentials).some(name => name.endsWith(".tmp")), false);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    await profile.close(); machine.release(); rmSync(f.root, { recursive: true }); retainedProcessLossFixtures.delete(retained);
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
