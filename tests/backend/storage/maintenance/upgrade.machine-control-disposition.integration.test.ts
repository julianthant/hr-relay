import assert from "node:assert/strict";
import nativeFs, { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";

const hostFacts = { primaryDisplay: null };

async function priorFormatFixture() {
  const f = await createHistoricalIncompleteProfileFixture();
  const current = z.looseObject({ schemaVersion: z.number().int(), duo: z.array(z.looseObject({ state: z.string() })) }).parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
  assert.equal(current.schemaVersion, 2); assert.equal(current.duo.length, 1);
  assert.equal(current.duo[0]?.state, "never-initialized");
  const { duo: _duo, ...prior } = current;
  writeFileSync(f.controlPath, JSON.stringify({ ...prior, schemaVersion: 1 }));
  writeFileSync(f.markerPath, JSON.stringify({ schemaVersion: 2 }));
  return f;
}

function sourceBytes(f: Awaited<ReturnType<typeof priorFormatFixture>>) {
  return [f.registryPath, f.verifierPath, f.keyPath, f.protectedPath, f.databasePath].map(path => ({ path, bytes: readFileSync(path) }));
}

it("converts only stopped machine-control format while keeping an incomplete historical profile held", async () => {
  const f = await priorFormatFixture(), original = sourceBytes(f);
  const controlBytes = readFileSync(f.controlPath), markerBytes = readFileSync(f.markerPath);
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const plan = await upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(plan, { state: "planned", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.equal(readFileSync(f.controlPath).equals(controlBytes), true); assert.equal(readFileSync(f.markerPath).equals(markerBytes), true);
  const upgraded = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.equal(upgraded.state, "upgraded"); assert.equal(upgraded.runtimeAccess, "onboarding-incomplete"); assert.equal(upgraded.profileCount, 1);
  assert.equal(typeof upgraded.receiptId, "string");
  const backup = join(f.workspace, ".tracker", "control", "profile-control-upgrades");
  assert.equal(readFileSync(join(backup, `${upgraded.receiptId}.control.before.json`)).equals(controlBytes), true);
  assert.equal(readFileSync(join(backup, `${upgraded.receiptId}.marker.before.json`)).equals(markerBytes), true);
  assert.equal(readdirSync(backup).filter(name => name.endsWith(".receipt.json")).length, 1);
  assert.equal(z.looseObject({ schemaVersion: z.number() }).parse(JSON.parse(readFileSync(f.controlPath, "utf8"))).schemaVersion, 2);
  assert.equal(z.strictObject({ schemaVersion: z.number() }).parse(JSON.parse(readFileSync(f.markerPath, "utf8"))).schemaVersion, 3);
  const current = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(current, { state: "current", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.throws(() => maintenance.admitProfile(maintenance.issueRegisteredProfileClaim(f.profileId)), /profile-storage-claim-unavailable/u);
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  maintenance.release();
  const machine = acquireEntrypointAdmission(f.workspace, "exclusive");
  const profile = composeProfileRuntime({ admission: machine,  hostFacts, clock: systemClock });
  const signed = profile.session.signIn({ email: historicalIncompleteProfileFields.email, password: historicalIncompleteProfileFields.password,
    at: new Date().toISOString() });
  assert.equal(signed.state, "refused");
  if (signed.state !== "refused") throw new Error("fixture historical runtime hold required");
  assert.equal(signed.code, "PROFILE_TRANSITION_BLOCKED");
  await profile.close(); machine.release();
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  await f.close();
});

it("retains the runtime hold through a cold machine-control format publication recovery", async () => {
  const f = await priorFormatFixture(), original = sourceBytes(f), maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const rename = nativeFs.renameSync; let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    if (!fired && String(target) === f.controlPath) { fired = true; throw new Error("fixture stopped format publication boundary"); }
  });
  syncBuiltinESMExports();
  try { await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true);
  assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-control-upgrade.json")), true);
  maintenance.release();
  const cold = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const recovered = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.equal(recovered.state, "upgraded"); assert.equal(recovered.runtimeAccess, "onboarding-incomplete"); assert.equal(recovered.profileCount, 1);
  const current = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(current, { state: "current", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.throws(() => cold.admitProfile(cold.issueRegisteredProfileClaim(f.profileId)), /profile-storage-claim-unavailable/u);
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  cold.release(); await f.close();
});
