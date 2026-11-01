import { writeStoppedProfileControlPredecessor } from "../../../support/fixtures/storage/stopped-profile-control-predecessor.js";
import assert from "node:assert/strict";
import nativeFs, { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const hostFacts = { primaryDisplay: null };

async function priorFormatFixture(version: 1 | 2 | 3 = 1) {
  const f = await createHistoricalIncompleteProfileFixture();
  const currentRegistryBytes = writeStoppedProfileControlPredecessor(f, version);
  return { ...f, currentRegistryBytes };
}

function sourceBytes(f: Awaited<ReturnType<typeof priorFormatFixture>>) {
  return [f.registryPath, f.verifierPath, f.keyPath, f.protectedPath, f.databasePath].map(path => ({ path, bytes: path === f.registryPath ? f.currentRegistryBytes : readFileSync(path) }));
}

it("converts only stopped machine-control format while keeping an incomplete historical profile held", async () => {
  const f = await priorFormatFixture(), original = sourceBytes(f);
  const controlBytes = readFileSync(f.controlPath), markerBytes = readFileSync(f.markerPath);
  let maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const plan = await upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(plan, { state: "planned", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.equal(readFileSync(f.controlPath).equals(controlBytes), true); assert.equal(readFileSync(f.markerPath).equals(markerBytes), true);
  maintenance.release();
  maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const upgraded = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.equal(upgraded.state, "upgraded"); assert.equal(upgraded.runtimeAccess, "onboarding-incomplete"); assert.equal(upgraded.profileCount, 1);
  assert.equal(typeof upgraded.receiptId, "string");
  const backup = join(f.workspace, ".tracker", "control", "profile-control-upgrades");
  assert.equal(readFileSync(join(backup, `${upgraded.receiptId}.control.before.json`)).equals(controlBytes), true);
  assert.equal(readFileSync(join(backup, `${upgraded.receiptId}.marker.before.json`)).equals(markerBytes), true);
  assert.equal(readdirSync(backup).filter(name => name.endsWith(".receipt.json")).length, 1);
  assert.equal(z.looseObject({ schemaVersion: z.number() }).parse(JSON.parse(readFileSync(f.controlPath, "utf8"))).schemaVersion, 4);
  assert.equal(z.strictObject({ schemaVersion: z.number() }).parse(JSON.parse(readFileSync(f.markerPath, "utf8"))).schemaVersion, 5);
  maintenance.release();
  maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const current = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(current, { state: "current", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.throws(() => maintenance.admitProfile(f.profileId), /profile-storage-claim-unavailable/u);
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  maintenance.release();
  const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
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

it("converts stopped schema2 only with authenticated empty suspect membership and preserves Duo and source bytes", async () => {
  const f = await priorFormatFixture(2), original = sourceBytes(f);
  const prior = z.looseObject({ duo: z.array(z.unknown()) }).parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  let primary: { error: unknown } | undefined;
  try {
    assert.throws(() => RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime));
    const result = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
    assert.equal(result.state, "upgraded"); assert.equal(result.runtimeAccess, "onboarding-incomplete");
    const current = z.looseObject({ schemaVersion: z.literal(4), duo: z.array(z.unknown()), completedRestores: z.array(z.unknown()) })
      .parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
    assert.deepEqual(current.duo, prior.duo); assert.deepEqual(current.completedRestores, []);
    assert.deepEqual(JSON.parse(readFileSync(f.markerPath, "utf8")), { schemaVersion: 5 });
    for (const source of original) assert.deepEqual(readFileSync(source.path), source.bytes);
  } catch (error) { primary = { error }; }
  try { maintenance.release(); await f.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "schema2-conversion-fixture-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
});

it("retains unbound schema2 suspect files and refuses conversion before control or key effects", async () => {
  const f = await priorFormatFixture(2);
  const suspects = join(f.profileRoot, "backups", "suspects");
  mkdirSync(suspects, { recursive: true, mode: 0o700 });
  writeFileSync(join(suspects, "unbound.sqlite"), "synthetic-unbound-suspect", { mode: 0o600 });
  try {
    const before = storageTree(f.workspace);
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime), /profile-control-upgrade-suspect-custody-unproved/u);
    assert.deepEqual(storageTree(f.workspace), before);
  } finally { await f.close(); }
});

for (const boundary of ["registry", "control", "marker"] as const) it(`retains the runtime hold through cold machine-control ${boundary} publication recovery`, async () => {
  const f = await priorFormatFixture(), original = sourceBytes(f), maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const rename = nativeFs.renameSync; let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    if (!fired && String(target) === (boundary === "registry" ? f.registryPath : boundary === "control" ? f.controlPath : f.markerPath)) { fired = true; throw new Error("fixture stopped format publication boundary"); }
  });
  syncBuiltinESMExports();
  try { await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true);
  assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-control-upgrade.json")), true);
  maintenance.release();
  let cold = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const recovered = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.equal(recovered.state, "upgraded"); assert.equal(recovered.runtimeAccess, "onboarding-incomplete"); assert.equal(recovered.profileCount, 1);
  cold.release();
  cold = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const current = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(current, { state: "current", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.throws(() => cold.admitProfile(f.profileId), /profile-storage-claim-unavailable/u);
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  cold.release(); await f.close();
});

it("converts settled control3 and preserves exact completed historical upgrade artifacts", async () => {
  const f = await priorFormatFixture(3), original = sourceBytes(f);
  const directory = join(f.workspace, ".tracker", "control", "profile-control-upgrades");
  mkdirSync(directory, { mode: 0o700 });
  const operationId = "7e48de5d-7292-419b-afc2-32a363106b38";
  const retained = ["control.before.json", "marker.before.json", "receipt.json"].map(suffix => {
    const path = join(directory, `${operationId}.${suffix}`), bytes = Buffer.from(`retained historical ${suffix}`);
    writeFileSync(path, bytes, { mode: 0o600 }); return { path, bytes };
  });
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  try {
    const result = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
    assert.equal(result.state, "upgraded");
    for (const source of [...original, ...retained]) assert.deepEqual(readFileSync(source.path), source.bytes);
    const document = z.looseObject({ installationId: z.string(), revision: z.literal(1) }).parse(JSON.parse(readFileSync(f.registryPath, "utf8")));
    assert.equal(document.installationId, maintenance.locator.installationId);
  } finally { maintenance.release(); await f.close(); }
});

for (const journal of ["profile-publication.json", "device-recertification.json", "profile-control-upgrade.json", "journal.json"]) {
  it(`refuses an unsupported old ${journal} before any source mutation`, async () => {
    const f = await priorFormatFixture(3);
    try {
      writeFileSync(join(f.workspace, ".tracker", "control", journal), JSON.stringify({ schemaVersion: 1 }), { mode: 0o600 });
      const before = storageTree(f.workspace);
      assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime));
      assert.deepEqual(storageTree(f.workspace), before);
    } finally { await f.close(); }
  });
}
