import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { BrowserRootsSchema, StoppedBrowserRootsV1Schema, type BrowserRoot } from "../../../../src/backend/storage/browser-root-contract.js";
import { admitCommandBrowser, commandProfileDirectory, createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { AccountDeletionSchema } from "../../../../src/backend/storage/maintenance/account-deletion.js";
import { fixedLayoutEntries } from "../../../../src/backend/storage/maintenance/fixed-layout.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { finishProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

vi.mock("../../../../src/backend/storage/maintenance/process-closure.js", async load => ({
  ...await load<typeof import("../../../../src/backend/storage/maintenance/process-closure.js")>(),
  proveProfileRootsUnused() {},
}));

function predecessor(document: ReturnType<typeof BrowserRootsSchema.parse>) {
  const { nextHandle: _nextHandle, ...prior } = document;
  return StoppedBrowserRootsV1Schema.parse({ ...prior, schemaVersion: 1,
    roots: prior.roots.map(({ handle: _handle, ...row }) => row) });
}

async function fixture(commands = false) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "deletion-browser-format-")));
  let lifetime = await RuntimeLifetimeLock.acquire(0), machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const stateRoot = machine.stateRoot, runtime = composeProfileRuntime({ admission: machine, clock: systemClock,
    hostFacts: { primaryDisplay: null }, onboardingDuo: syntheticOnboardingDuo() });
  const retainedBrowsers: BrowserRoot[] = [];
  async function signup(email: string) {
    const active = await finishProfileOnboarding(runtime.session, runtime.session.signUp({ firstName: "Fixture", lastName: "Operator", email,
      password: "disposable-fixture-password", createdAt: systemClock.now().toISOString() }));
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("actual signup required");
    if (commands) {
      const context = runtime.selectedContext(active.token), profileRoot = join(context.admission.stateRoot, "browsers");
      const capability = admitCommandBrowser(context.admission, { profileRoot, commandId: randomUUID(), requestDigest: "a".repeat(64) });
      const directory = commandProfileDirectory(profileRoot), roots = createBrowserRoots(context.admission);
      const input = { profileId: active.profileId, profileRoot, profileDirectory: directory,
        owner: { kind: "command" as const, capability }, credentialFingerprint: null };
      const launch = roots.beginLaunch(input);
      mkdirSync(directory, { recursive: true, mode: 0o700 }); launch.closing(); launch.closed();
      const captured = roots.inventory().roots.find(row => row.directory.endsWith("commands/sharepoint") && row.profileId === active.profileId);
      assert.ok(captured); retainedBrowsers.push(captured);
      await roots.withUnused(directory, { signal: new AbortController().signal, async probe() {} }, async ({ remove }) => { remove(); }, input);
      fs.rmdirSync(join(profileRoot, "commands"));
    }
    await runtime.drainForLogout(active.token);
    const pending = runtime.session.logOut(active.token, { at: systemClock.now().toISOString() });
    if (pending.state !== "cancelling" || pending.operationId === undefined) throw new Error("actual logout required");
    await runtime.awaitClosurePreparation(active.profileId);
    assert.equal(runtime.session.resumeLogout(pending.operationId).state, "signed-out");
    return { profileId: active.profileId, operationId: pending.operationId };
  }
  const other = await signup("other@ucsd.edu"), target = await signup("fixture@ucsd.edu");
  let closed = false;
  const stop = async () => { if (!closed) { await runtime.close(); machine.release(); closed = true; } };
  return { workspace, stateRoot, runtime, other, target, root: join(stateRoot, "profiles", target.profileId), otherRoot: join(stateRoot, "profiles", other.profileId),
    retainedBrowsers, browserPath: join(stateRoot, "machine", "browser-roots.json"), journal: join(workspace, ".tracker", "control", "account-deletion.json"),
    get machine() { return machine; }, stop,
    async restart() {
      await stop(); await lifetime.close(); lifetime = await RuntimeLifetimeLock.acquire(0);
      const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
      try { await stopped.upgradeBrowserRoots(input => ({ signal: input.signal, async probe() {} }), systemClock); }
      finally { stopped.release(); }
      machine = RuntimeAdmission.acquireMachine(workspace, "exclusive", lifetime); closed = false;
    },
    async close() { await stop(); await lifetime.close(); rmSync(workspace, { recursive: true, force: true }); },
  };
}

for (const partial of [false, true]) it(`continues a captured predecessor deletion journal at stopped startup after ${partial ? "partial erasure" : "native-key erasure"}`, async () => {
  const f = await fixture(), unlink = fs.unlinkSync, other = fixedLayoutEntries(f.otherRoot);
  let boundary: string | undefined;
  const spy = vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
    if (boundary === undefined && String(path).startsWith(`${f.root}/`)) {
      boundary = String(path); if (partial) unlink(path); throw new Error("fixture captured erasure interruption");
    }
    return unlink(path);
  }); syncBuiltinESMExports();
  try {
    assert.throws(() => f.runtime.session.deleteLoggedOutAccount(f.target.operationId)); assert.ok(boundary);
    spy.mockRestore(); syncBuiltinESMExports();
    const captured = AccountDeletionSchema.parse(JSON.parse(readFileSync(f.journal, "utf8")));
    assert.equal(captured.pending, true); assert.equal(captured.cursor, 0); assert.equal(existsSync(boundary), !partial);
    assert.equal(FakeKeyringEntry.snapshot().some(([account]) => account === `Relay:${captured.installationId}:${f.target.profileId}`), false);
    await f.stop();
    const priorBrowsers = predecessor(captured.priorBrowsers), browsers = predecessor(captured.browsers);
    const priorJournal = { ...captured, priorBrowsers, browsers };
    assert.equal(AccountDeletionSchema.safeParse(priorJournal).success, false);
    writeFileSync(f.browserPath, JSON.stringify(priorBrowsers), { mode: 0o600 });
    writeFileSync(f.journal, JSON.stringify(priorJournal), { mode: 0o600 });
    await f.restart();
    assert.equal(existsSync(f.journal), false); assert.equal(existsSync(f.root), false);
    assert.deepEqual(f.machine.readProfileRegistry().profiles.map(row => row.profileId), [f.other.profileId]);
    assert.deepEqual(fixedLayoutEntries(f.otherRoot), other);
    assert.equal(BrowserRootsSchema.parse(JSON.parse(readFileSync(f.browserPath, "utf8"))).schemaVersion, 2);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

it("refuses deletion after migration retains a shared browser-root archive, before erasing either person or key", async () => {
  const f = await fixture(true);
  try {
    await f.stop();
    const current = BrowserRootsSchema.parse(JSON.parse(readFileSync(f.browserPath, "utf8")));
    assert.equal(current.roots.length, 0); assert.equal(f.retainedBrowsers.length, 2);
    const prior = predecessor({ ...current, roots: f.retainedBrowsers });
    for (const row of prior.roots) mkdirSync(join(f.stateRoot, row.directory), { recursive: true, mode: 0o700 });
    assert.equal(prior.roots.length, 2);
    writeFileSync(f.browserPath, JSON.stringify(prior), { mode: 0o600 });
    await f.restart();
    const keyWitnesses = () => FakeKeyringEntry.snapshot().map(([account, secret]) => [account, createHash("sha256").update(secret).digest("hex")]);
    const root = fixedLayoutEntries(f.root), other = fixedLayoutEntries(f.otherRoot), keys = keyWitnesses();
    const archives = join(f.workspace, ".tracker", "control", "browser-root-upgrades");
    const archiveNames = fs.readdirSync(archives); assert.equal(archiveNames.length, 1); assert.ok(archiveNames[0]);
    const archive = join(archives, archiveNames[0]), bytes = readFileSync(archive), live = readFileSync(f.browserPath);
    const epoch = f.machine.readProfileRegistry().sessionGeneration;
    assert.throws(() => f.machine.deleteProfileAccount(f.target.profileId, epoch), /account-deletion-retained-installation-backup/u);
    assert.deepEqual(fixedLayoutEntries(f.root), root); assert.deepEqual(fixedLayoutEntries(f.otherRoot), other);
    assert.deepEqual(keyWitnesses(), keys); assert.deepEqual(readFileSync(archive), bytes); assert.deepEqual(readFileSync(f.browserPath), live);
    assert.equal(existsSync(f.journal), false); assert.equal(f.machine.readProfileRegistry().profiles.length, 2);
  } finally { await f.close(); }
});
