import assert from "node:assert/strict";
import nativeFs, { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, onTestFinished, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime, initializeRegisteredPersonStores } from "../../../src/backend/app/composition/storage-compose.js";
import { CanonicalCredentialHeadSchema } from "../../../src/backend/storage/configuration/canonical-credential-store.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { syntheticOnboardingDuo } from "../../support/helpers/admission-fixture.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { FakeKeyringEntry } from "../../support/helpers/credential-keychain-fake.js";

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "abandoned-signup-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: syntheticOnboardingDuo() });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    await profile.close(); machine.release(); await lifetime.close(); stopped = true;
  };
  onTestFinished(async () => { await stop(); rmSync(root, { recursive: true }); });
  const draft = profile.session.signUp({ email: "abandoned-fixture@ucsd.edu", firstName: "Synthetic", lastName: "Operator",
    password: "synthetic-disposable-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding");
  if (draft.state !== "onboarding") throw new Error("synthetic draft required");
  const headPath = join(machine.stateRoot, "machine", "credential-keys", `${draft.profileId}.json`);
  const profileRoot = join(machine.stateRoot, "profiles", draft.profileId);
  const operationPath = join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
  const duoPath = join(machine.stateRoot, "machine", "duo-credentials", `${draft.profileId}.json`);
  const nativeKey = new FakeKeyringEntry("Relay", `${machine.locator.installationId}:${draft.profileId}`);
  return { root, machine, profile, draft, headPath, profileRoot, operationPath, duoPath, nativeKey, stop };
}

it("cancels an unpublished sign-up without leaving a credential head that blocks the next cold start", async () => {
  const f = await fixture();
  assert.equal(existsSync(f.headPath), true); assert.ok(f.nativeKey.getPassword());
  assert.deepEqual(await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId), { state: "signed-out" });
  for (const path of [f.headPath, f.profileRoot, f.operationPath, f.duoPath]) assert.equal(existsSync(path), false, path);
  assert.equal(f.nativeKey.getPassword(), null); assert.deepEqual(f.machine.readProfileRegistry().profiles, []);
  await f.stop();
  const restart = await runtimeLifetimeLock();
  await initializeRegisteredPersonStores(f.root, restart, { primaryDisplay: null }, systemClock);
  await restart.close();
});

it("cold startup removes only a proven abandoned erased head and stays clean on a second cold start", async () => {
  const f = await fixture(), remove = nativeFs.rmSync;
  let erased: Buffer | undefined;
  const spy = vi.spyOn(nativeFs, "rmSync").mockImplementation((path, options) => {
    if (String(path) === f.profileRoot) erased = readFileSync(f.headPath);
    return remove(path, options);
  });
  syncBuiltinESMExports();
  try { await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId); }
  finally { spy.mockRestore(); syncBuiltinESMExports(); }
  assert.ok(erased); assert.equal(CanonicalCredentialHeadSchema.parse(JSON.parse(erased.toString("utf8"))).state, "erased");
  writeFileSync(f.headPath, erased, { mode: 0o600 });
  assert.equal(f.nativeKey.getPassword(), null);
  for (const path of [f.profileRoot, f.operationPath, f.duoPath]) assert.equal(existsSync(path), false);
  assert.deepEqual(f.machine.readProfileRegistry().profiles, []);
  await f.stop();
  for (let boot = 0; boot < 2; boot++) {
    const restart = await runtimeLifetimeLock();
    await initializeRegisteredPersonStores(f.root, restart, { primaryDisplay: null }, systemClock);
    assert.equal(existsSync(f.headPath), false);
    assert.equal(f.nativeKey.getPassword(), null);
    await restart.close();
  }
});

for (const remains of ["duo-record", "native-key", "stage-file"] as const) it(`cold startup holds an abandoned head whose ${remains} remains and preserves it`, async () => {
  const f = await fixture(), remove = nativeFs.rmSync;
  let erased: Buffer | undefined;
  const spy = vi.spyOn(nativeFs, "rmSync").mockImplementation((path, options) => {
    if (String(path) === f.profileRoot) erased = readFileSync(f.headPath);
    return remove(path, options);
  });
  syncBuiltinESMExports();
  try { await f.profile.session.cancelOnboarding(f.draft.token, f.draft.operationId); }
  finally { spy.mockRestore(); syncBuiltinESMExports(); }
  assert.ok(erased);
  writeFileSync(f.headPath, erased, { mode: 0o600 });
  if (remains === "duo-record") writeFileSync(f.duoPath, "{}", { mode: 0o600 });
  if (remains === "native-key") f.nativeKey.setPassword("synthetic-remaining-key");
  if (remains === "stage-file") writeFileSync(join(f.headPath, "..", `.${f.draft.profileId}.stage`), "", { mode: 0o600 });
  await f.stop();
  const restart = await runtimeLifetimeLock();
  try {
    await assert.rejects(initializeRegisteredPersonStores(f.root, restart, { primaryDisplay: null }, systemClock), error => {
      let cause: unknown = error;
      while (cause instanceof Error && (cause as { code?: unknown }).code !== "CREDENTIAL_ABANDONED_SIGNUP_HELD") cause = cause.cause;
      return cause instanceof Error;
    });
    assert.deepEqual(readFileSync(f.headPath), erased);
  } finally { await restart.close(); }
});
