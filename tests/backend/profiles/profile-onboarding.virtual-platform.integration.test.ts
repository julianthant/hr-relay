import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { createProfileSession } from "../../../src/backend/profiles/profile-session.js";
import { createCanonicalCredentials } from "../../../src/backend/storage/configuration/canonical-credential-store.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { DuoCredentialRecordSchema } from "../../../src/models/config/duo-credential-store.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { syntheticOnboardingDuo } from "../../support/helpers/admission-fixture.js";
import { ProfileSessionRefusedError } from "../../../src/backend/profiles/profile-errors.js";
import { ProfileOnboardingDuoProviderError } from "../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import type { DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "../../../src/backend/profiles/onboarding-duo.js";

for (const custody of ["ready", "retained", "missing"] as const) it(`requires ${custody} virtual platform custody before finishing sign-up`, async () => {
  const retained = custody !== "missing";
  const root = realpathSync(mkdtempSync(join(tmpdir(), "virtual-signup-"))), lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime), email = "fixture@ucsd.edu";
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const synthetic = syntheticOnboardingDuo();
  let virtualCapability: DraftDuoCapability | undefined;
  const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine, clock: systemClock,
    onboardingDuo: { ...synthetic, start(attempt, bind, failure) {
      return synthetic.start(attempt, async observed => {
        const capability = await bind(observed);
        if (attempt.method === "touch") virtualCapability = capability;
        return { ...capability, async recordCeremony(proof) {
          if (attempt.method === "touch") {
            if (retained) {
              const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
              await capability.persistPending({ credentialId: proof.credentialId,
                privateKeyPkcs8: key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
                publicKeySpki: key.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
                transport: "internal", isResidentCredential: true, initialSignCount: 1, createdAt: systemClock.now().toISOString() });
            }
            await capability.recordCeremony({ ...proof, mechanism: "chromium-platform" });
          } else await capability.recordCeremony(proof);
        } };
      }, failure);
    } } });
  try {
    const draft = session.signUp({ email, firstName: "Fixture", lastName: "Operator", password: "disposable-fixture-password", createdAt: systemClock.now().toISOString() });
    if (draft.state !== "onboarding") throw new Error("private draft required");
    for (const method of ["key", "touch"] as const) {
      if (method === "touch" && !retained) {
        await assert.rejects(session.startOnboardingDuo(draft.token, draft.operationId, method));
        assert.equal(session.readOnboarding(draft.token, draft.operationId).methods.touch.state, "unknown");
        assert.equal(session.readOnboarding(draft.token, draft.operationId).step, "duo");
        assert.deepEqual(machine.readProfileRegistry().profiles, []); return;
      }
      const started = await session.startOnboardingDuo(draft.token, draft.operationId, method), id = started.methods[method].attemptId; assert.ok(id);
      session.confirmOnboardingDuo(draft.token, draft.operationId, method, id);
    }
    const ready = session.readOnboarding(draft.token, draft.operationId);
    assert.equal(ready.step, "ready"); assert.equal(ready.methods.touch.platformAuthenticator, "chromium-platform");
    if (custody === "retained") {
      assert.ok(virtualCapability);
      await virtualCapability.retainUnknown({ kind: "unknown", causeTag: "browser-lifetime" });
      assert.equal(session.readOnboarding(draft.token, draft.operationId).methods.touch.state, "complete");
    }
    const active = await session.completeOnboarding(draft.token, draft.operationId); assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("finished signup required");
    const owner = machine.admitProfile(active.profileId);
    try {
      const frame = createCanonicalCredentials(owner).readRecord("duo"); assert.ok(frame);
      const credentials = DuoCredentialRecordSchema.parse(frame.value).credentials;
      assert.equal(credentials.length, 2); assert.ok(credentials.every(credential => credential.state === "ready"));
      assert.ok(credentials.some(credential => credential.authenticator?.transport === "internal"));
    } finally { owner.release(); }
  } finally {
    await session.closeOnboarding();
    if (retained) session.close();
    else assert.throws(() => session.close(), (error: unknown) => error instanceof AggregateError && error.message === "profile-onboarding-custody-unproved");
    machine.release(); rmSync(root, { recursive: true, force: true });
  }
});

const observedContext = (method: "key" | "touch"): DraftDuoObservedContext => ({ contextId: randomBytes(16).toString("hex"), tabId: method === "key" ? 1 : 2,
  origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });

async function withDraft(onboardingDuo: ProfileOnboardingDuoProvider, run: (input: { session: ReturnType<typeof createProfileSession>; token: string; operationId: string }) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "virtual-signup-"))), lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine, clock: systemClock, onboardingDuo });
  try {
    const draft = session.signUp({ email: "fixture@ucsd.edu", firstName: "Fixture", lastName: "Operator", password: "disposable-fixture-password", createdAt: systemClock.now().toISOString() });
    if (draft.state !== "onboarding") throw new Error("private draft required");
    await run({ session, token: draft.token, operationId: draft.operationId });
  } finally { await session.closeOnboarding(); session.close(); machine.release(); rmSync(root, { recursive: true, force: true }); }
}

for (const kind of ["unknown", "unavailable"] as const) it(`keeps a manually confirmed Touch ID complete and finishable after a later ${kind} provider failure`, async () => {
  const synthetic = syntheticOnboardingDuo();
  let touchFailure: ((error: Error) => Promise<void>) | undefined;
  await withDraft({ ...synthetic, async start(attempt, bind, failure) {
    if (attempt.method === "key") return synthetic.start(attempt, bind, failure);
    touchFailure = failure;
    const capability = await bind(observedContext("touch")), key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), credentialId = randomBytes(32).toString("base64url");
    await capability.persistPending({ credentialId, privateKeyPkcs8: key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      publicKeySpki: key.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      transport: "internal", isResidentCredential: true, initialSignCount: 1, createdAt: systemClock.now().toISOString() });
    await capability.recordCeremony({ credentialId, requestId: randomUUID(), mechanism: "chromium-platform", softwareInterceptionDisabled: true });
  } }, async ({ session, token, operationId }) => {
    for (const method of ["key", "touch"] as const) {
      const id = (await session.startOnboardingDuo(token, operationId, method)).methods[method].attemptId; assert.ok(id);
      session.confirmOnboardingDuo(token, operationId, method, id);
    }
    assert.equal(session.readOnboarding(token, operationId).step, "ready");
    assert.ok(touchFailure);
    await touchFailure(new ProfileOnboardingDuoProviderError(kind, "browser-lifetime"));
    const after = session.readOnboarding(token, operationId);
    assert.equal(after.methods.touch.state, "complete");
    assert.equal(after.step, "ready");
    assert.equal((await session.completeOnboarding(token, operationId)).state, "active");
  });
});

it("refuses a manual confirm before the ceremony and does not let the ceremony complete it later", async () => {
  const synthetic = syntheticOnboardingDuo();
  let capability: DraftDuoCapability | undefined;
  await withDraft({ ...synthetic, async start(attempt, bind) { capability = await bind(observedContext(attempt.method)); } }, async ({ session, token, operationId }) => {
    const id = (await session.startOnboardingDuo(token, operationId, "touch")).methods.touch.attemptId; assert.ok(id);
    assert.throws(() => session.confirmOnboardingDuo(token, operationId, "touch", id), (error: unknown) => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.equal(session.readOnboarding(token, operationId).methods.touch.operatorConfirmed, false);
    assert.ok(capability);
    const credentialId = randomBytes(32).toString("base64url"), key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    await capability.persistPending({ credentialId, privateKeyPkcs8: key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      publicKeySpki: key.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      transport: "internal", isResidentCredential: true, initialSignCount: 1, createdAt: systemClock.now().toISOString() });
    await capability.recordCeremony({ credentialId, requestId: randomUUID(), mechanism: "chromium-platform", softwareInterceptionDisabled: true });
    assert.equal(session.readOnboarding(token, operationId).methods.touch.state, "pending");
    session.confirmOnboardingDuo(token, operationId, "touch", id);
    assert.equal(session.readOnboarding(token, operationId).methods.touch.state, "complete");
  });
});
