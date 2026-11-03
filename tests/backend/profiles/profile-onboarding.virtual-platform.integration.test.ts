import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
import type { DraftDuoCapability } from "../../../src/backend/profiles/onboarding-duo.js";

for (const custody of ["ready", "retained", "missing"] as const) it(`requires ${custody} virtual platform custody before finishing sign-up`, async () => {
  const retained = custody !== "missing";
  const root = realpathSync(mkdtempSync(join(tmpdir(), "virtual-signup-"))), lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime), email = "fixture@ucsd.edu";
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const synthetic = syntheticOnboardingDuo(() => email);
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
                transport: "internal", isResidentCredential: true, createdAt: systemClock.now().toISOString() });
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
      const started = await session.startOnboardingDuo(draft.token, draft.operationId, method), id = started.methods[method].attemptId; assert.ok(id);
      if (method === "touch" && !retained) {
        assert.throws(() => session.confirmOnboardingDuo(draft.token, draft.operationId, method, id));
        assert.equal(session.readOnboarding(draft.token, draft.operationId).step, "duo");
        assert.deepEqual(machine.readProfileRegistry().profiles, []); return;
      }
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
  } finally { await session.closeOnboarding(); session.close(); machine.release(); rmSync(root, { recursive: true, force: true }); }
});
