import { DatabaseSync } from "node:sqlite";
import { WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";
import assert from "node:assert/strict";
import nativeFs, { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, onTestFinished, vi } from "vitest";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import * as accountDeletion from "../../../../src/backend/storage/maintenance/account-deletion.js";
import { fixedLayoutEntries } from "../../../../src/backend/storage/maintenance/fixed-layout.js";
import { ProfileVerifierDocumentSchema } from "../../../../src/models/profiles/profile.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { finishProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

async function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "account-deletion-")));
  let lifetime = await RuntimeLifetimeLock.acquire(0), machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  let email = "other@ucsd.edu";
  const runtime = composeProfileRuntime({ admission: machine, clock: systemClock, hostFacts: { primaryDisplay: null }, onboardingDuo: syntheticOnboardingDuo(() => email) });
  async function signUp(address: string) {
    email = address;
    const active = await finishProfileOnboarding(runtime.session, runtime.session.signUp({ firstName: "Fixture", lastName: "Operator", email,
      password: "disposable-fixture-password", createdAt: systemClock.now().toISOString() }));
    if (active.state !== "active") throw new Error("actual signup required"); return active;
  }
  async function logOut(active: Awaited<ReturnType<typeof signUp>>) {
    const pending = runtime.session.logOut(active.token, { at: systemClock.now().toISOString() });
    if (pending.state !== "cancelling" || pending.operationId === undefined) throw new Error("actual logout required");
    await runtime.awaitClosurePreparation(active.profileId);
    assert.equal(runtime.session.resumeLogout(pending.operationId).state, "signed-out"); return pending.operationId;
  }
  const other = await signUp("other@ucsd.edu"); await logOut(other);
  const active = await signUp("fixture@ucsd.edu");
  const root = join(machine.stateRoot, "profiles", active.profileId), otherRoot = join(machine.stateRoot, "profiles", other.profileId);
  const context = runtime.selectedContext(active.token), directory = join(root, "backups", "authority");
  const backup = await new AuthorityBackupService(context.admission, context.database, { directory }, systemClock)
    .request({ trigger: "schema-migration", requiredGeneration: context.database.getMeta().authorityGeneration });
  assert.equal(backup.state, "verified");
  const manifest = backup.manifests.at(-1); assert.ok(manifest);
  const retained = join(directory, manifest.backupFileName), operationId = await logOut(active);
  return { workspace, runtime, active, other, root, otherRoot, operationId, retained,
    get machine() { return machine; }, get lifetime() { return lifetime; },
    async restart() {
      await runtime.close(); machine.release(); await lifetime.close();
      lifetime = await RuntimeLifetimeLock.acquire(0); machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    },
    async close() { await runtime.close(); machine.release(); await lifetime.close(); rmSync(workspace, { recursive: true, force: true }); } };
}

it("deletes only the confirmed logged-out account, including native key and local backups", async () => {
  const f = await fixture();
  try {
    const other = fixedLayoutEntries(f.otherRoot), key = `Relay:${f.machine.locator.installationId}:${f.active.profileId}`;
    assert.ok(FakeKeyringEntry.snapshot().some(([account]) => account === key));
    assert.throws(() => f.runtime.session.deleteLoggedOutAccount("foreign"));
    f.runtime.session.deleteLoggedOutAccount(f.operationId);
    assert.equal(existsSync(f.root), false); assert.equal(existsSync(f.retained), false);
    for (const directory of ["credential-keys", "duo-credentials"]) assert.equal(existsSync(join(f.machine.stateRoot, "machine", directory, `${f.active.profileId}.json`)), false);
    assert.equal(FakeKeyringEntry.snapshot().some(([account]) => account === key), false);
    assert.deepEqual(fixedLayoutEntries(f.otherRoot), other);
    assert.deepEqual(f.machine.readProfileRegistry().profiles.map(row => row.profileId), [f.other.profileId]);
    const verifiers = ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "profile-verifiers.json"), "utf8")));
    assert.deepEqual(verifiers.profiles.map(row => row.profileId), [f.other.profileId]);
    assert.equal(f.runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() }).state, "refused");
    await f.restart(); assert.deepEqual(f.machine.readProfileRegistry().profiles.map(row => row.profileId), [f.other.profileId]);
  } finally { await f.close(); }
});

for (const change of ["none", "unknown-member"] as const) it(`resumes interrupted erasure at startup with ${change}`, async () => {
  const f = await fixture(), original = nativeFs.unlinkSync;
  let stopped = false;
  const spy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
    if (!stopped && String(path) === f.retained) { stopped = true; throw new Error("synthetic erasure interruption"); }
    return original(path);
  }); syncBuiltinESMExports();
  try {
    assert.throws(() => f.runtime.session.deleteLoggedOutAccount(f.operationId)); assert.equal(stopped, true);
    spy.mockRestore(); syncBuiltinESMExports();
    const journal = join(f.workspace, ".tracker", "control", "account-deletion.json");
    const plan = accountDeletion.AccountDeletionSchema.parse(JSON.parse(readFileSync(journal, "utf8"))); assert.equal(plan.pending, true);
    assert.throws(() => f.machine.readProfileRegistry(), /account-deletion-pending/u);
    if (change === "unknown-member") {
      const unknown = join(f.root, "unknown.txt"); writeFileSync(unknown, "unowned", { mode: 0o600 });
      await assert.rejects(f.restart(), error => error instanceof Error && error.cause instanceof Error && error.cause.message === "account-deletion-membership-changed");
      assert.equal(readFileSync(unknown, "utf8"), "unowned"); assert.equal(existsSync(journal), true);
    } else {
      await f.restart(); assert.equal(existsSync(journal), false); assert.equal(existsSync(f.root), false);
      assert.deepEqual(f.machine.readProfileRegistry().profiles.map(row => row.profileId), [f.other.profileId]);
    }
  } finally { spy.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

it("serves confirmed account deletion through the guarded dashboard route and signals an empty machine", async () => {
  const f = await fixture();
  onTestFinished(() => f.close());
  let deletionError: unknown;
  const resumeAccountDeletion = accountDeletion.resumeAccountDeletion;
  const deletion = vi.spyOn(accountDeletion, "resumeAccountDeletion").mockImplementation((...args) => {
    try { resumeAccountDeletion(...args); }
    catch (error) { deletionError = error; throw error; }
  });
  onTestFinished(() => { deletion.mockRestore(); });
  await f.runtime.close();
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation,
    repoRoot: f.workspace, backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
  onTestFinished(() => application.stop());
  const base = `http://127.0.0.1:${application.port}`;
  const post = (path: string, body: unknown, cookie?: string, origin = base) => fetch(`${base}/api/v1/profile/${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body),
  });
  for (const email of ["fixture@ucsd.edu", "other@ucsd.edu"]) {
    const login = await post("sign-in", { email, password: "disposable-fixture-password" });
    assert.equal(PublicProfileStateSchema.parse(await login.json()).state, "active");
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    assert.equal((await post("delete-account", { confirmed: true }, cookie, "http://foreign.invalid")).status, 403);
    assert.equal((await post("delete-account", { confirmed: false }, cookie)).status, 400);
    assert.equal(f.machine.readProfileRegistry().profiles.length, email === "fixture@ucsd.edu" ? 2 : 1);
    const response = await post("delete-account", { confirmed: true }, cookie);
    assert.ifError(deletionError);
    assert.equal(response.status, 200);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "signed-out", signUpRequired: email === "other@ucsd.edu" });
    assert.equal((await post("delete-account", { confirmed: true }, cookie)).status, 409);
  }
  assert.deepEqual(PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`)).json()), { state: "signed-out", signUpRequired: true });
});

it("refuses deletion before effects when a shared installation upgrade backup retains the person", async () => {
  const f = await fixture();
  try {
    const archive = join(f.workspace, ".tracker", "control", "profile-control-upgrades", `00000000-0000-4000-8000-000000000001.${f.active.profileId}.authority`);
    mkdirSync(archive, { recursive: true, mode: 0o700 });
    const head = join(f.machine.stateRoot, "machine", "credential-keys", `${f.active.profileId}.json`), before = readFileSync(head);
    assert.throws(() => f.runtime.session.deleteLoggedOutAccount(f.operationId));
    assert.deepEqual(readFileSync(head), before); assert.equal(existsSync(f.retained), true);
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "account-deletion.json")), false);
    assert.equal(f.machine.readProfileRegistry().profiles.length, 2);
  } finally { await f.close(); }
});

it("keeps UNKNOWN write evidence and credentials instead of deleting an unresolved account", async () => {
  const f = await fixture();
  try {
    const database = new DatabaseSync(join(f.root, "state.db"));
    try {
      const intent = WRITE_INTENT_ATTEMPTING;
      database.prepare("INSERT INTO write_intents (id,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(intent.writeIntentId, intent.system, intent.idempotencyKey, intent.idempotencyKeyDigest, intent.status, intent.generation, intent.runId, JSON.stringify(intent), intent.createdAt, intent.updatedAt);
    } finally { database.close(); }
    const head = join(f.machine.stateRoot, "machine", "credential-keys", `${f.active.profileId}.json`), before = readFileSync(head);
    assert.throws(() => f.runtime.session.deleteLoggedOutAccount(f.operationId), error => error instanceof Error && error.cause instanceof Error && error.cause.message === "account-deletion-unresolved-write");
    assert.deepEqual(readFileSync(head), before); assert.equal(existsSync(f.retained), true);
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "account-deletion.json")), false);
  } finally { await f.close(); }
});
