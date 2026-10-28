import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import nativeFs, { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { it, vi } from "vitest";
import { acquireDashboardEntrypointAdmission, acquireStorageBackupEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { FlatProfileClaimReceiptSchema } from "../../../../src/backend/storage/maintenance/flat-profile-claim.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime, composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { captureExistingDataOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { readyProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { createHistoricalFlatProfileFixture, historicalFlatFields } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

type Fixture = ReturnType<typeof createHistoricalFlatProfileFixture>;
async function claimBackedFlat(f: Fixture, finished: boolean) {
  const backup = await acquireStorageBackupEntrypointAdmission(f.workspace);
  try {
    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], systemClock, f.workspace, backup);
    assert.equal(outcome.exitCode, 0);
  } finally { backup.release(); }
  const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  let operation: Awaited<ReturnType<typeof stopped.claimExistingProfileData>>;
  try {
    const owner = captureExistingDataOwner(stopped, historicalFlatFields);
    operation = await stopped.claimExistingProfileData(owner, randomUUID(), systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() });
    assert.ok(operation.ownerClaim); assert.equal(stopped.readProfileRegistry().profiles.length, 0);
  } finally { stopped.release(); }
  const reference = operation.ownerClaim; assert.ok(reference);
  if (finished) {
    const machine = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
    const runtime = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock,
      processLockRoot: f.processLockRoot, onboardingDuo: syntheticOnboardingDuo(() => historicalFlatFields.email) });
    try {
      const draft = runtime.session.claimExistingData({ ...historicalFlatFields, claimId: randomUUID(), claimExistingData: true, createdAt: systemClock.now().toISOString() });
      assert.equal(draft.state, "onboarding");
      if (draft.state !== "onboarding") throw new Error("actual claimed private draft required");
      assert.equal(draft.operationId, operation.operationId);
      await readyProfileOnboarding(runtime.session, draft);
      const active = await runtime.session.completeOnboarding(draft.token, draft.operationId);
      assert.equal(active.state, "active"); assert.equal(active.profileId, operation.profileId);
      assert.equal(machine.readProfileRegistry().profiles[0]?.registration.operationId, operation.operationId);
      assert.equal(existsSync(join(f.stateRoot, "machine", "operations", `${operation.operationId}.json`)), false);
    } finally { await runtime.close(); machine.release(); }
  }
  const control = join(f.workspace, ".tracker/control"), allocations = join(control, "storage-backups");
  const names = readdirSync(allocations); assert.equal(names.length, 1);
  return { operation, control, root: join(allocations, names[0] ?? ""), claim: dirname(reference.backupPath) };
}

function loseBoundMutex(f: Fixture) {
  const module = JSON.stringify(pathToFileURL(join(process.cwd(), "src/backend/storage/admission/installation.ts")).href);
  const script = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    import { acquireInstallation } from ${module};
    const workspace = ${JSON.stringify(f.workspace)}, rename = fs.renameSync.bind(fs);
    fs.renameSync = (source, target) => {
      rename(source, target);
      if (String(target) === join(workspace, '.tracker/control/admission-mutex')) process.exit(73);
    };
    syncBuiltinESMExports();
    acquireInstallation(workspace, 'exclusive');
    throw new Error('fixture did not lose its mutex');
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });
  assert.equal(child.status, 73, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
  const mutex = join(f.workspace, ".tracker/control/admission-mutex"), ownerPath = join(mutex, "owner.json");
  const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { acquisitionId: string; pid: number };
  assert.equal(owner.pid, child.pid); assert.equal(observeProcessIdentity(owner.pid).state, "gone");
  return { mutex, ownerPath, owner, bytes: readFileSync(ownerPath) };
}

async function recover(f: Fixture) {
  const admission = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
  try { return admission.readProfileRegistry(); }
  finally { admission.release(); }
}

for (const finished of [false, true]) {
  it(`recovers a genuinely abandoned bound mutex after real flat backup and ${finished ? "completed fixture onboarding" : "private owner claim"}`, async () => {
    const f = createHistoricalFlatProfileFixture();
    try {
      const claimed = await claimBackedFlat(f, finished), lost = loseBoundMutex(f);
      const paths = [join(claimed.root, "source.json"), join(claimed.root, "backup.json"), join(claimed.root, "files/profile/credentials/protected.json"),
        join(claimed.claim, "flat.json"), join(claimed.claim, "backup.json"), join(f.stateRoot, "profiles", claimed.operation.profileId, "state.db"),
        join(f.stateRoot, "profiles", claimed.operation.profileId, "files/reports/historical-report.csv"), join(f.stateRoot, "machine/profiles.json")];
      const before = paths.map(path => ({ path, bytes: readFileSync(path), stat: statSync(path) }));
      const document = await recover(f);
      assert.equal(document.profiles.length, finished ? 1 : 0);
      if (finished) assert.equal(document.profiles[0]?.registration.operationId, claimed.operation.operationId);
      else assert.equal(existsSync(join(f.stateRoot, "machine/operations", `${claimed.operation.operationId}.json`)), true);
      assert.equal(existsSync(lost.mutex), false);
      assert.deepEqual(readFileSync(join(claimed.control, "admission-mutex-recovery", lost.owner.acquisitionId, "owner.json")), lost.bytes);
      for (const entry of before) {
        assert.deepEqual(readFileSync(entry.path), entry.bytes); assert.equal(statSync(entry.path).ino, entry.stat.ino);
        assert.equal(statSync(entry.path).dev, entry.stat.dev); assert.equal(statSync(entry.path).mode, entry.stat.mode);
      }
    } finally { f.close(); }
  });
}

for (const finished of [false, true]) for (const change of ["copy", "partial", "reference", "stale-registration", "foreign", "unowned", "extra-directory", "pending", "configuration-missing", "configuration-binding"] as const) {
  it(`retains the abandoned ${finished ? "registered" : "draft"} mutex for ${change} retained backup evidence`, async () => {
    const f = createHistoricalFlatProfileFixture();
    try {
      const claimed = await claimBackedFlat(f, finished), lost = loseBoundMutex(f), flatPath = join(claimed.claim, "flat.json");
      if (change === "copy") writeFileSync(join(claimed.root, "files/profile/credentials/protected.json"), "changed");
      if (change === "partial") nativeFs.unlinkSync(join(claimed.root, "backup.json"));
      if (change === "reference" || change === "stale-registration") {
        const receipt = FlatProfileClaimReceiptSchema.parse(JSON.parse(readFileSync(flatPath, "utf8")));
        assert.ok(receipt.operation.ownerClaim);
        if (change === "reference") receipt.operation.ownerClaim.backupDigest = "f".repeat(64);
        else receipt.operation.commandId = randomUUID();
        writeFileSync(flatPath, JSON.stringify(receipt));
      }
      if (change === "foreign") {
        const path = join(claimed.root, "backup.json");
        const receipt: unknown = JSON.parse(readFileSync(path, "utf8"));
        assert.ok(receipt !== null && typeof receipt === "object" && "installationId" in receipt);
        receipt.installationId = randomUUID(); writeFileSync(path, JSON.stringify(receipt));
      }
      if (change === "unowned") nativeFs.mkdirSync(join(dirname(claimed.claim), randomUUID()), { mode: 0o700 });
      if (change === "extra-directory") nativeFs.mkdirSync(join(claimed.root, "files/unowned"), { mode: 0o700 });
      if (change === "configuration-missing") nativeFs.unlinkSync(join(claimed.claim, "configured.json"));
      if (change === "configuration-binding") {
        const path = join(claimed.claim, "configured.json");
        const receipt: unknown = JSON.parse(readFileSync(path, "utf8"));
        assert.ok(receipt !== null && typeof receipt === "object" && "configSnapshotId" in receipt);
        receipt.configSnapshotId = randomUUID(); writeFileSync(path, JSON.stringify(receipt));
      }
      if (change === "pending") writeFileSync(join(claimed.control, "profile-publication.json"), "{}", { mode: 0o600 });
      const source = join(f.stateRoot, "profiles", claimed.operation.profileId, "state.db"), bytes = readFileSync(source);
      await assert.rejects(recover(f));
      assert.deepEqual(readFileSync(lost.ownerPath), lost.bytes); assert.deepEqual(readFileSync(source), bytes);
      assert.equal(existsSync(join(claimed.control, "admission-mutex-recovery", lost.owner.acquisitionId)), false);
    } finally { f.close(); }
  });
}

for (const substitution of ["copy", "receipt", "membership"] as const) {
  it(`pins bound retained ${substitution} through the final mutex recovery custody barrier`, async () => {
    const f = createHistoricalFlatProfileFixture(), write = nativeFs.writeFileSync.bind(nativeFs), rename = nativeFs.renameSync.bind(nativeFs); let changed = false;
    try {
      const claimed = await claimBackedFlat(f, true), lost = loseBoundMutex(f);
      const target = join(claimed.root, substitution === "receipt" ? "backup.json" : "files/profile/credentials/protected.json");
      const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
        rename(source, destination);
        if (!changed && String(destination) === join(claimed.control, "admission-mutex-recovery", `${lost.owner.acquisitionId}.json`)) {
          changed = true;
          if (substitution === "membership") nativeFs.mkdirSync(join(claimed.root, "files/unowned"), { mode: 0o700 });
          else { const temporary = `${target}.replacement`; write(temporary, readFileSync(target), { mode: 0o600 }); rename(temporary, target); }
        }
      });
      syncBuiltinESMExports();
      try { await assert.rejects(recover(f)); assert.equal(changed, true); assert.deepEqual(readFileSync(lost.ownerPath), lost.bytes); }
      finally { spy.mockRestore(); syncBuiltinESMExports(); }
    } finally { f.close(); }
  });
}
