import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nativeFs, { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireDashboardEntrypointAdmission, acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { captureExistingDataOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { backupExistingData, verifyExistingDataBackup } from "../../../../src/backend/storage/maintenance/existing-data-backup.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { readyProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture, historicalFlatFields } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

it("holds flat data behind explicit ownership while ordinary startup and signup cannot create a profile", async () => {
  const f = createHistoricalFlatProfileFixture();
  chmodSync(f.databasePath, 0o644);
  const databaseIdentity = statSync(f.databasePath);
  const before = [f.databasePath, f.protectedPath, f.artifact].map(path => readFileSync(path));
  assert.throws(() => acquireEntrypointAdmission(f.workspace, "shared"));
  const machine = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    assert.equal(machine.requiresExistingDataClaim(), true);
    assert.equal(statSync(f.databasePath).mode, databaseIdentity.mode);
    assert.equal(statSync(f.databasePath).ino, databaseIdentity.ino);
    assert.throws(() => machine.assertAuthorityDatabase(f.databasePath), /profile-bound-authority-required/u);
    application = await composeDashboardApplication({ admission: machine, isolation: rebuildRuntimeIsolation, repoRoot: f.workspace,
      backendPortOverride: 0, frontendPortOverride: 0, env: {} });
    const base = `http://127.0.0.1:${String(application.port)}`;
    const post = (path: string, body: unknown) => fetch(`${base}/api/v1/profile/${path}`, { method: "POST",
      headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const path of ["sign-up", "sign-in"]) {
      const response = await post(path, path === "sign-in" ? { email: historicalFlatFields.email, password: historicalFlatFields.password } : historicalFlatFields);
      assert.deepEqual(await response.json(), { state: "refused", code: "PROFILE_OWNER_CLAIM_REQUIRED" });
      assert.equal(response.headers.get("set-cookie"), null);
    }
    const response = await post("claim-existing-data", { ...historicalFlatFields, password: "wrong-owner", claimId: randomUUID(), claimExistingData: true });
    assert.deepEqual(await response.json(), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    assert.equal(existsSync(join(f.stateRoot, "machine")), false);
    assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
    assert.equal(existsSync(join(f.stateRoot, "browsers")), false);
    for (const [index, path] of [f.databasePath, f.protectedPath, f.artifact].entries()) assert.deepEqual(readFileSync(path), before[index]);
  } finally { await application?.stop(); machine.release(); f.close(); }
});

for (const privateSource of ["credential", "control"] as const) {
  it(`refuses a 0644 ${privateSource} source without moving retained data`, async () => {
    const f = createHistoricalFlatProfileFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    const path = privateSource === "credential" ? f.protectedPath : join(f.workspace, ".tracker", "control", "installation.json");
    const before = readFileSync(path), identity = statSync(path);
    try {
      const owner = captureExistingDataOwner(machine, historicalFlatFields);
      chmodSync(path, 0o644);
      await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock,
        { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }), /permissions or identity|private regular file|unsafe file/u);
      assert.deepEqual(readFileSync(path), before); assert.equal(statSync(path).ino, identity.ino);
      assert.equal(statSync(path).mode & 0o7777, 0o644);
      assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
    } finally { chmodSync(path, 0o600); machine.release(); f.close(); }
  });
}

it("refuses valid UNKNOWN flat custody before backup or data movement", async () => {
  const f = createHistoricalFlatProfileFixture({ unknownWrite: true }), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const paths = [f.databasePath, f.protectedPath, f.artifact, f.reportPath], before = paths.map(path => readFileSync(path));
  try {
    const owner = captureExistingDataOwner(machine, historicalFlatFields);
    await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }), /credential-maintenance-custody-unproved/u);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
  } finally { machine.release(); f.close(); }
});

it("refuses unretired flat worker custody before backup or movement", async () => {
  const f = createHistoricalFlatProfileFixture({ closedBrowser: true, unretiredWorker: true });
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const before = readFileSync(f.databasePath);
  try {
    const owner = captureExistingDataOwner(machine, historicalFlatFields);
    await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock,
      { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }), /existing-data-flat-worker-custody-unsupported/u);
    assert.deepEqual(readFileSync(f.databasePath), before);
    assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
  } finally { machine.release(); f.close(); }
});

it("refuses a foreign credential-directory alias before opening its protected values", () => {
  const f = createHistoricalFlatProfileFixture(), foreign = createHistoricalFlatProfileFixture();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace), directory = join(f.stateRoot, "credentials"), held = `${directory}-held`;
  renameSync(directory, held); symlinkSync(join(foreign.stateRoot, "credentials"), directory, "dir");
  const open = nativeFs.openSync.bind(nativeFs); let secretOpened = false;
  const spy = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === f.protectedPath) secretOpened = true;
    return open(...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => captureExistingDataOwner(machine, historicalFlatFields), /symbolic link/u);
    assert.equal(secretOpened, false);
    assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
  } finally {
    spy.mockRestore(); syncBuiltinESMExports(); unlinkSync(directory); renameSync(held, directory);
    machine.release(); f.close(); foreign.close();
  }
});

for (const source of ["corrupt-artifact", "unverified-backup"] as const) {
  it(`preserves and refuses ${source} evidence before creating a transition backup`, async () => {
    const f = createHistoricalFlatProfileFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    const paths = [f.databasePath, f.protectedPath, f.reportPath], before = paths.map(path => readFileSync(path));
    let evidence = f.artifact;
    if (source === "corrupt-artifact") {
      const stored: unknown = JSON.parse(readFileSync(f.artifact, "utf8"));
      assert.ok(typeof stored === "object" && stored !== null && "ref" in stored);
      writeFileSync(f.artifact, JSON.stringify({ ...stored, payloadBase64: Buffer.from("corrupt").toString("base64") }), { mode: 0o600 });
    } else {
      const directory = join(f.stateRoot, "backups", "authority"); mkdirSync(directory, { recursive: true, mode: 0o700 });
      evidence = join(directory, "unverified.sqlite"); writeFileSync(evidence, "retained recovery evidence", { mode: 0o600 });
    }
    const retained = readFileSync(evidence);
    try {
      const owner = captureExistingDataOwner(machine, historicalFlatFields);
      await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }),
        source === "corrupt-artifact" ? /content digest/u : /backup-source-membership-unproved/u);
      for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
      assert.deepEqual(readFileSync(evidence), retained);
      assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-owner-claims")), false);
    } finally { machine.release(); f.close(); }
  });
}

it("recovers an empty interrupted backup allocation without treating it as a completed backup or owner claim", async () => {
  const f = createHistoricalFlatProfileFixture(), claimId = randomUUID(), first = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const write = nativeFs.writeFileSync.bind(nativeFs); let fired = false;
  const spy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
    if (!fired && String(path).endsWith(`/${claimId}/intent.json`)) { fired = true; throw new Error("fixture allocation interruption"); }
    write(path, data, options);
  });
  syncBuiltinESMExports();
  try {
    const owner = captureExistingDataOwner(first, historicalFlatFields);
    await assert.rejects(first.claimExistingProfileData(owner, claimId, systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }), /fixture allocation interruption/u);
    assert.equal(fired, true);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); first.release(); }
  const allocation = join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId);
  assert.deepEqual(readdirSync(allocation), []);
  const recovered = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  try {
    const owner = captureExistingDataOwner(recovered, historicalFlatFields);
    const operation = await recovered.claimExistingProfileData(owner, randomUUID(), systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() });
    assert.deepEqual(readdirSync(allocation), []);
    assert.equal(recovered.readProfileRegistry().profiles.length, 0);
    assert.equal(readdirSync(join(f.stateRoot, "profiles", operation.profileId, "backups", "authority")).filter(name => name.endsWith(".manifest.json")).length, 1);
  } finally { recovered.release(); f.close(); }
});

for (const boundary of ["intent", "backups", "credentials", "database", "registry", "continuity", "claim-receipt", "unlink", "schema", "activation", "configured"] as const) {
  it(`recovers flat transition after ${boundary} without repeating completed movement, schema or activation effects`, async () => {
    const f = createHistoricalFlatProfileFixture(), claimId = randomUUID(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    const control = join(f.workspace, ".tracker", "control"), journal = join(control, "profile-flat-claim.json"), target = join(f.stateRoot, "profiles", claimId);
    const artifactName = f.artifact.slice(f.artifact.lastIndexOf("/") + 1), artifactInode = statSync(f.artifact).ino, protectedInode = statSync(f.protectedPath).ino;
    let fired = false, dataMoves = 0;
    const rename = nativeFs.renameSync.bind(nativeFs), unlink = nativeFs.unlinkSync.bind(nativeFs), write = nativeFs.writeFileSync.bind(nativeFs);
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      if ([join(f.stateRoot, "backups"), join(f.stateRoot, "credentials"), f.databasePath, f.artifact, join(f.workspace, "data", "reports")].includes(String(source))) dataMoves++;
      const expected = boundary === "intent" ? journal : boundary === "backups" ? join(target, "backups") : boundary === "credentials" ? join(target, "credentials")
        : boundary === "database" ? join(target, "state.db") : boundary === "registry" ? join(f.stateRoot, "machine", "profiles.json")
          : boundary === "continuity" ? join(control, "profile-registry.json") : undefined;
      if (!fired && expected !== undefined && String(destination) === expected) { fired = true; throw new Error("fixture flat interruption"); }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      unlink(path);
      if (!fired && boundary === "unlink" && String(path) === journal) { fired = true; throw new Error("fixture flat interruption"); }
    });
    const writeSpy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
      write(path, data, options);
      if (!fired && (boundary === "claim-receipt" && String(path).endsWith("/flat.json") || boundary === "configured" && String(path).endsWith("/configured.json"))) {
        fired = true; throw new Error("fixture flat interruption");
      }
    });
    const upgrade = AuthorityDatabase.upgradeStopped.bind(AuthorityDatabase), activate = AuthorityDatabase.rebaseClaimedProfileConfiguration.bind(AuthorityDatabase);
    const upgradeSpy = vi.spyOn(AuthorityDatabase, "upgradeStopped").mockImplementation((...args) => {
      const result = upgrade(...args);
      if (!fired && boundary === "schema") { fired = true; throw new Error("fixture flat interruption"); }
      return result;
    });
    const activationSpy = vi.spyOn(AuthorityDatabase, "rebaseClaimedProfileConfiguration").mockImplementation(async (...args) => {
      await activate(...args);
      if (!fired && boundary === "activation") { fired = true; throw new Error("fixture flat interruption"); }
    });
    syncBuiltinESMExports();
    try {
      const owner = captureExistingDataOwner(machine, historicalFlatFields);
      await assert.rejects(machine.claimExistingProfileData(owner, claimId, systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }), /fixture flat interruption/u);
      assert.equal(fired, true);
    } finally {
      renameSpy.mockRestore(); unlinkSpy.mockRestore(); writeSpy.mockRestore(); upgradeSpy.mockRestore(); activationSpy.mockRestore(); syncBuiltinESMExports(); machine.release();
    }
    const movedBeforeRecovery = dataMoves;
    const repeated: string[] = [], recoveryRenameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      if (String(source).startsWith(`${target}/`)) repeated.push(String(source));
      rename(source, destination);
    });
    syncBuiltinESMExports();
    let recovered: RuntimeAdmission | undefined;
    try {
      recovered = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
      assert.equal(recovered.requiresExistingDataClaim(), false); assert.equal(recovered.readProfileRegistry().profiles.length, 0);
      assert.equal(statSync(join(target, "credentials", "protected.json")).ino, protectedInode);
      assert.equal(statSync(join(target, "artifacts", artifactName)).ino, artifactInode);
      const database = new DatabaseSync(join(target, "state.db"), { readOnly: true });
      try {
        assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 9);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM settings_snapshots").get()?.count, 2);
        assert.equal(database.prepare("SELECT authority_generation FROM database_states WHERE id=1").get()?.authority_generation, 2);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM database_upgrades WHERE phase='settled'").get()?.count, 1);
      } finally { database.close(); }
      assert.equal(readdirSync(join(target, "backups", "authority")).filter(name => name.endsWith(".manifest.json")).length, 1);
      assert.equal(existsSync(journal), false); assert.deepEqual(repeated, []);
      assert.ok(movedBeforeRecovery <= 5);
    } finally { recoveryRenameSpy.mockRestore(); syncBuiltinESMExports(); recovered?.release(); f.close(); }
  });
}

it("holds an interrupted flat claim when unjournaled artifact membership appears", async () => {
  const f = createHistoricalFlatProfileFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const rename = nativeFs.renameSync.bind(nativeFs);
  let interrupted = false;
  const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    rename(source, destination);
    if (!interrupted && String(source) === join(f.stateRoot, "backups")) {
      interrupted = true; throw new Error("fixture interrupted move");
    }
  });
  syncBuiltinESMExports();
  try {
    const owner = captureExistingDataOwner(machine, historicalFlatFields);
    await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock,
      { ...historicalFlatFields, createdAt: systemClock.now().toISOString() }), /fixture interrupted move/u);
    assert.equal(interrupted, true);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); machine.release(); }
  const unexpected = join(f.artifactRoot, "unplanned.artifact"); writeFileSync(unexpected, "unverified recovery evidence", { mode: 0o600 });
  let recovered: RuntimeAdmission | undefined;
  try {
    await assert.rejects(acquireDashboardEntrypointAdmission(f.workspace, "shared"), /existing-data-flat-artifact-membership-changed/u);
    assert.equal(readFileSync(unexpected, "utf8"), "unverified recovery evidence");
    assert.equal(existsSync(f.protectedPath), true);
    unlinkSync(unexpected);
    recovered = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
    assert.equal(recovered.readProfileRegistry().profiles.length, 0);
    assert.equal(existsSync(f.protectedPath), false);
  } finally { recovered?.release(); f.close(); }
});

it("backs up native6 records and retained 0644 data into private copies without changing source identity", async () => {
  const f = createHistoricalFlatProfileFixture({ closedBrowser: true }), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const browserPath = join(f.stateRoot, "browsers", "w1", "ucpath", "Default", "Preferences");
  const paths = [f.databasePath, f.reportPath, f.artifact, browserPath];
  for (const path of paths) chmodSync(path, 0o644);
  const before = paths.map(path => ({ bytes: readFileSync(path), identity: statSync(path) }));
  let child: RuntimeAdmission | undefined;
  try {
    const owner = captureExistingDataOwner(machine, historicalFlatFields), claimId = randomUUID();
    child = await machine.forStoppedExistingDataBackup(owner, claimId);
    assert.throws(() => child?.assertWritable(), /runtime-refused/u);
    const reference = await backupExistingData(machine, child, owner, claimId, systemClock);
    const backup = verifyExistingDataBackup(reference, owner, machine);
    assert.equal(backup.profileId, claimId);
    assert.equal(backup.sourceStateRoot, f.stateRoot);
    assert.ok(backup.files.some(entry => entry.path === "profile/credentials/protected.json"));
    assert.ok(backup.files.some(entry => entry.path === "profile/.runtime-owner.json"));
    for (const [index, path] of paths.entries()) {
      assert.deepEqual(readFileSync(path), before[index]?.bytes);
      assert.equal(statSync(path).mode, before[index]?.identity.mode);
      assert.equal(statSync(path).ino, before[index]?.identity.ino);
    }
    const copyRoot = join(reference.backupPath, "..", "files");
    for (const entry of backup.files) assert.equal(statSync(join(copyRoot, entry.path)).mode & 0o7777, 0o600);
    const copiedReport = join(copyRoot, "workspace-data", "reports", "historical-report.csv");
    chmodSync(copiedReport, 0o644);
    assert.throws(() => verifyExistingDataBackup(reference, owner, machine), /permissions or identity/u);
    chmodSync(copiedReport, 0o600);
    verifyExistingDataBackup(reference, owner, machine);
    assert.equal(existsSync(join(f.stateRoot, "machine")), false);
    assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
  } finally { child?.release(); machine.release(); f.close(); }
});

it("moves retained 0644 files with their original identities into one private profile without publishing an account", async () => {
  const f = createHistoricalFlatProfileFixture({ closedBrowser: true }), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const browserPath = join(f.stateRoot, "browsers", "w1", "ucpath", "Default", "Preferences");
  const ordinary = [f.databasePath, f.artifact, f.reportPath, browserPath];
  for (const path of ordinary) chmodSync(path, 0o644);
  const identities = ordinary.map(path => statSync(path));
  const source = [f.protectedPath, f.artifact, browserPath], before = source.map(path => readFileSync(path));
  const original = new DatabaseSync(f.databasePath, { readOnly: true });
  const runs = original.prepare("SELECT * FROM runs ORDER BY id").all(); original.close();
  try {
    const owner = captureExistingDataOwner(machine, historicalFlatFields), claimId = randomUUID();
    const operation = await machine.claimExistingProfileData(owner, claimId, systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() });
    assert.equal(operation.ownerClaim?.claimId, claimId);
    assert.equal(operation.commandId, f.request.commandId); assert.equal(operation.writeId, f.request.writeId);
    assert.equal(operation.onboarding?.finish, undefined);
    assert.equal(machine.requiresExistingDataClaim(), false);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    const root = join(f.stateRoot, "profiles", operation.profileId);
    const database = new DatabaseSync(join(root, "state.db"), { readOnly: true });
    try {
      assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 9);
      assert.deepEqual(database.prepare("SELECT * FROM runs ORDER BY id").all(), runs);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM settings_snapshots").get()?.count, 2);
    } finally { database.close(); }
    for (const [index, path] of source.entries()) {
      const moved = join(root, path.slice(f.stateRoot.length + 1));
      assert.deepEqual(readFileSync(moved), before[index]); assert.equal(existsSync(path), false);
    }
    assert.equal(readFileSync(join(root, "files", "reports", "historical-report.csv"), "utf8"), "status\nretained\n");
    assert.equal(existsSync(f.reportPath), false);
    for (const [index, path] of ordinary.entries()) {
      const moved = path === f.reportPath ? join(root, "files", "reports", "historical-report.csv") : join(root, path.slice(f.stateRoot.length + 1));
      assert.equal(statSync(moved).mode, identities[index]?.mode);
      assert.equal(statSync(moved).ino, identities[index]?.ino);
    }
    assert.equal(existsSync(join(f.artifactRoot, ".runtime-owner.json")), true);
    assert.equal(existsSync(join(f.stateRoot, ".runtime-owner.json")), true);
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-flat-claim.json")), false);
  } finally { machine.release(); f.close(); }
});

it("authenticates the preserved source before conversion and completes only through the current private onboarding flow", async () => {
  const f = createHistoricalFlatProfileFixture({ laterProtectedChange: true, closedBrowser: true });
  const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace), claimId = randomUUID();
  const owner = captureExistingDataOwner(stopped, historicalFlatFields);
  const operation = await stopped.claimExistingProfileData(owner, claimId, systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() });
  stopped.release();
  const machine = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
  const runtime = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock,
    processLockRoot: f.processLockRoot, onboardingDuo: syntheticOnboardingDuo(() => historicalFlatFields.email) });
  const fields = { ...historicalFlatFields, claimId: randomUUID(), claimExistingData: true as const, createdAt: systemClock.now().toISOString() };
  const protectedPath = join(machine.stateRoot, "profiles", operation.profileId, "credentials", "protected.json"), before = readFileSync(protectedPath);
  try {
    assert.equal(runtime.session.signUp(fields).state, "refused");
    assert.equal(runtime.session.claimExistingData({ ...fields, password: "wrong-owner" }).state, "refused");
    assert.deepEqual(readFileSync(protectedPath), before);
    const draft = runtime.session.claimExistingData(fields);
    assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("actual claimed private draft required");
    assert.equal(draft.profileId, operation.profileId); assert.equal(draft.operationId, operation.operationId);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    const pending = machine.admitProfile(machine.issueRegisteredProfileClaim(draft.profileId));
    const credentials = createCredentialStore({ admission: pending, stateRoot: pending.stateRoot, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${draft.profileId}.json`) });
    assert.deepEqual(credentials.read(), f.record); pending.release();
    await readyProfileOnboarding(runtime.session, draft);
    const active = await runtime.session.completeOnboarding(draft.token, draft.operationId);
    assert.equal(active.state, "active"); assert.equal(active.profileId, operation.profileId);
    assert.equal(machine.readProfileRegistry().profiles[0]?.migratedFromLegacy, true);
    const context = runtime.selectedContext(active.token);
    assert.deepEqual(context.credentials.read(), f.record);
    const settings = context.settings.read(); assert.equal(settings.runtimeStatus.state, "current");
    const config = context.resolveSettings(settings.record.settings).config;
    assert.equal(config.paths.reportsDir, join(context.admission.stateRoot, "files", "reports"));
    assert.equal(config.paths.downloadsDir, join(context.admission.stateRoot, "files", "downloads"));
    const browser = context.database.authority.workerControls.browsers("person-lookup-worker-1")[0];
    assert.ok(browser);
    assert.deepEqual(browser, { ...f.browser, profileDirectory: join(context.admission.stateRoot, "browsers", "w1", "ucpath") });
    assert.equal(readFileSync(join(browser.profileDirectory ?? "", "Default", "Preferences"), "utf8"), '{"profile":{"name":"Historical fixture"}}');
    assert.equal(context.database.authority.runs.listByWorkflow("person-lookup").length, 1);
  } finally { await runtime.close(); machine.release(); f.close(); }
});
