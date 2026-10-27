import nativeFs, { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDraftDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

function draftFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-duo-recovery-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const machine = acquireEntrypointAdmission(root, "exclusive"), processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const profile = composeProfileRuntime({ admission: machine, processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock });
  const draft = profile.session.signUp({ firstName: "Recovery", lastName: "Fixture", email: "draft-recovery@ucsd.edu",
    password: "disposable-draft-recovery", createdAt: new Date().toISOString() });
  if (draft.state !== "onboarding") throw new Error("fixture genuine draft required");
  const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(draft.profileId));
  const store = createDraftDuoCredentialStore(admission, machine, draft.operationId, 1, systemClock), pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const input = { credentialId: randomUUID(), scope: { armId: randomUUID(), contextId: randomUUID(), tabId: 1, accountId: randomUUID(),
    origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com", armedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() },
    privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  store.enroll(input); store.confirm(input.credentialId, input.scope);
  return { root, machine, profile, draft, admission, store, input, async close() { admission.release(); await profile.close(); machine.release(); rmSync(root, { recursive: true }); } };
}

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
    assert.equal(recovered.credentials[0]?.highWater, recovered.reservations.at(-1)?.count);
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
