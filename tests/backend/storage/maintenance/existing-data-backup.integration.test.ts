import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nativeFs, { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { retainedHistoricalData } from "../../../support/fixtures/storage/retained-historical-data.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeProfileCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { consumeAuthenticatedProfileOwnerClaim } from "../../../../src/backend/profiles/profile-session.js";
import { captureExistingDataOwner, verifyExistingDataOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ownerClaimRecoveryCopies, backupExistingData, verifyExistingDataBackup } from "../../../../src/backend/storage/maintenance/existing-data-backup.js";
import { readyProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";


it("requires genuine existing credential ownership and rejects structural witnesses without changing source data", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  retainedHistoricalData(f);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const paths = [f.protectedPath, f.databasePath, f.registryPath, f.verifierPath, f.keyPath], before = paths.map(path => readFileSync(path));
  try {
    assert.throws(() => captureExistingDataOwner(machine, { ...historicalIncompleteProfileFields, password: "wrong-owner" }, f.profileId), /existing-data-owner-refused/u);
    assert.throws(() => captureExistingDataOwner(machine, { ...historicalIncompleteProfileFields, email: "another-owner@ucsd.edu" }, f.profileId), /existing-data-owner-refused/u);
    assert.throws(() => verifyExistingDataOwner({ profileId: f.profileId }, machine), /existing-data-owner-unissued/u);
    const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
    assert.equal(verifyExistingDataOwner(owner, machine).profileId, f.profileId);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  } finally { machine.release(); await f.close(); }
});

it("refuses valid UNKNOWN historical custody without submitting, retrying or altering its evidence", async () => {
  const f = await createHistoricalIncompleteProfileFixture(); retainedHistoricalData(f, true);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const paths = [f.databasePath, f.protectedPath, f.keyPath, f.registryPath, f.verifierPath], before = paths.map(path => readFileSync(path));
  try {
    const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
    await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock), /credential-maintenance-custody-unproved/u);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    assert.equal(existsSync(f.operationPath), false); assert.equal(existsSync(join(f.profileRoot, "backups")), false);
  } finally { machine.release(); await f.close(); }
});

it("backs up the exact database, profile and independent machine authority, reusing completed backups", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
  const admission = await machine.forStoppedExistingDataBackup(owner), claimId = randomUUID();
  const paths = [f.protectedPath, f.databasePath, f.registryPath, f.verifierPath, f.keyPath], before = paths.map(path => readFileSync(path));
  try {
    const backup = await backupExistingData(machine, admission, owner, claimId, systemClock);
    const verified = verifyExistingDataBackup(backup, owner, machine);
    assert.deepEqual(ownerClaimRecoveryCopies(machine, f.profileId), [join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId)]);
    assert.equal(verified.profileId, f.profileId);
    for (const name of ["machine/profile-pepper", `machine/credential-keys/${f.profileId}.json`, "machine/profiles.json", "machine/profile-verifiers.json", "profile/credentials/protected.json", "control/installation.json", "control/profile-registry.json"]) {
      assert.ok(verified.files.some(entry => entry.path === name), name);
    }
    const backupNames = readdirSync(join(f.profileRoot, "backups", "authority"));
    const replay = await backupExistingData(machine, admission, owner, claimId, systemClock);
    assert.deepEqual(replay, backup);
    assert.deepEqual(readdirSync(join(f.profileRoot, "backups", "authority")), backupNames);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    writeFileSync(join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId, "files", "profile", "credentials", "protected.json"), "substituted");
    assert.throws(() => verifyExistingDataBackup(backup, owner, machine), /existing-data-backup-changed/u);
  } finally { admission.release(); machine.release(); await f.close(); }
});

it("revokes an owner witness when the authenticated source changes", async () => {
  const f = await createHistoricalIncompleteProfileFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
  try {
    writeFileSync(f.protectedPath, "substituted");
    assert.throws(() => verifyExistingDataOwner(owner, machine), /existing-data-owner-source-changed/u);
  } finally { machine.release(); await f.close(); }
});

it("resumes interrupted backup copying while retaining completed copy identities and the verified SQLite backup", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  let machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  let owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId), admission = await machine.forStoppedExistingDataBackup(owner);
  const claimId = randomUUID();
  const target = join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId, "files", "profile", "credentials", "protected.json");
  const write = nativeFs.writeFileSync.bind(nativeFs); let fired = false;
  const spy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
    write(path, data, options);
    if (!fired && path === target) { fired = true; throw new Error("fixture backup interruption"); }
  });
  syncBuiltinESMExports();
  try {
    try { await assert.rejects(backupExistingData(machine, admission, owner, claimId, systemClock), /fixture backup interruption/u); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); const inode = nativeFs.statSync(target).ino;
    const before = readdirSync(join(f.profileRoot, "backups", "authority"));
    admission.release(); machine.release();
    machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
    admission = await machine.forStoppedExistingDataBackup(owner);
    const backup = await backupExistingData(machine, admission, owner, randomUUID(), systemClock);
    verifyExistingDataBackup(backup, owner, machine);
    assert.equal(backup.claimId, claimId);
    assert.equal(nativeFs.statSync(target).ino, inode);
    assert.deepEqual(readdirSync(join(f.profileRoot, "backups", "authority")), before);
    assert.equal(existsSync(f.operationPath), false);
  } finally { admission.release(); machine.release(); await f.close(); }
});

it("claims only explicitly authenticated historical data, preserving source identity and resuming the same private operation", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  const artifact = retainedHistoricalData(f);
  const claimId = randomUUID(), request = { ...historicalIncompleteProfileFields, claimId, claimExistingData: true as const, createdAt: new Date().toISOString() };
  const shared = acquireEntrypointAdmission(f.workspace, "shared"), profile = composeProfileRuntime({ admission: shared,
    processLockRoot: f.processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock });
  const paths = [f.protectedPath, f.databasePath, f.keyPath, artifact], before = paths.map(path => readFileSync(path));
  assert.deepEqual(profile.session.signIn({ ...historicalIncompleteProfileFields, at: request.createdAt }).state, "refused");
  assert.equal(profile.session.signUp(request).state, "refused");
  assert.equal(profile.session.claimExistingData({ ...request, password: "wrong-owner" }).state, "refused");
  const accepted = profile.session.claimExistingData(request);
  assert.equal(accepted.state, "refused"); assert.ok("upgrade" in accepted);
  await profile.close(); shared.release();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const authorization = consumeAuthenticatedProfileOwnerClaim(accepted.upgrade, machine);
  const operation = await machine.claimExistingProfileData(authorization.owner, authorization.claimId, systemClock);
  assert.equal(operation.profileId, f.profileId); assert.equal(operation.operationId, f.operation.operationId);
  assert.equal(operation.ownerClaim?.claimId, claimId);
  assert.equal(operation.onboarding?.finish, undefined);
  assert.equal(machine.readProfileRegistry().profiles.length, 0);
  for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  assert.throws(() => consumeAuthenticatedProfileOwnerClaim(accepted.upgrade, machine), /PROFILE_OWNER_CLAIM_UNAVAILABLE|Ownership/u);
  machine.release();
  const resumed = acquireEntrypointAdmission(f.workspace, "shared"), resumedProfile = composeProfileRuntime({ admission: resumed,
    processLockRoot: f.processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: syntheticOnboardingDuo(() => historicalIncompleteProfileFields.email) });
  try {
    assert.equal(resumedProfile.session.signUp(request).state, "refused");
    const draft = resumedProfile.session.claimExistingData({ ...request, claimId: randomUUID() });
    assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("same private claim required");
    assert.equal(draft.operationId, operation.operationId); assert.equal(draft.profileId, f.profileId);
    await assert.rejects(resumedProfile.session.cancelOnboarding(draft.token, draft.operationId));
    assert.equal(resumed.readProfileRegistry().profiles.length, 0);
    await readyProfileOnboarding(resumedProfile.session, draft);
    const active = await resumedProfile.session.completeOnboarding(draft.token, draft.operationId);
    assert.equal(active.state, "active"); assert.equal(active.profileId, f.profileId);
    const context = resumedProfile.selectedContext(active.token);
    const inventory = composeProfileCredentialInventory({ ...context, machine: resumed, clock: systemClock, hostFacts: { primaryDisplay: null } });
    await inventory.prepare();
    const assessment = inventory.assess({ admission: context.admission, credentials: context.credentials,
      capturedSecrets: [request.email, request.password], capturedSecretsComplete: true });
    assert.ok(assessment.unknownFormats.includes(join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId)));
    assert.equal(assessment.logoutComplete, false);
    const claimed = resumed.readProfileRegistry().profiles[0]; assert.ok(claimed?.registration.onboardingCompletion);
    assert.equal(claimed.lastSignedInAt, claimed.registration.onboardingCompletion.finishedAt);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  } finally { await resumedProfile.close(); resumed.release(); await f.close(); }
});

for (const boundary of ["intent", "operation", "verifier", "registry", "continuity", "unlink"] as const) {
  it(`recovers an authenticated backed-up claim after ${boundary} without repeating completed effects`, async () => {
    const f = await createHistoricalIncompleteProfileFixture(), artifact = retainedHistoricalData(f);
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId), claimId = randomUUID();
    const paths = [f.protectedPath, f.databasePath, f.keyPath, artifact], before = paths.map(path => readFileSync(path));
    const intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json"), rename = nativeFs.renameSync.bind(nativeFs), unlink = nativeFs.unlinkSync.bind(nativeFs);
    let fired = false;
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      const target = String(destination), intent = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string } : undefined;
      const expected = boundary === "intent" ? intentPath : boundary === "operation" ? f.operationPath : boundary === "verifier" ? f.verifierPath : boundary === "registry" ? f.registryPath : f.controlPath;
      if (!fired && boundary !== "unlink" && target === expected && intent?.kind === "incomplete-profile-draft") { fired = true; throw new Error("fixture claim interruption"); }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      if (!fired && boundary === "unlink" && String(path) === intentPath) { fired = true; throw new Error("fixture claim interruption"); }
      unlink(path);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(machine.claimExistingProfileData(owner, claimId, systemClock), /fixture claim interruption/u); }
    finally { renameSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); machine.release();
    const recovered = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    try {
      assert.equal(recovered.readProfileRegistry().profiles.length, 0);
      const operation = JSON.parse(readFileSync(f.operationPath, "utf8")) as { ownerClaim: { claimId: string }; operationId: string };
      assert.equal(operation.ownerClaim.claimId, claimId); assert.equal(operation.operationId, f.operation.operationId);
      assert.equal(existsSync(intentPath), false);
      const settled = readFileSync(f.operationPath);
      recovered.readProfileRegistry(); assert.deepEqual(readFileSync(f.operationPath), settled);
      for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
      assert.equal(readdirSync(join(f.profileRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json")).length, 1);
    } finally { recovered.release(); await f.close(); }
  });
}
