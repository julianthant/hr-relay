import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { it, vi } from "vitest";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { readStoppedCredentialConversion } from "../../../../src/backend/storage/configuration/credential-conversion.js";
import { releaseStoppedMachineControlUpgrade } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { scaledMs } from "../../../support/time-scale.js";

async function stoppedFixture() {
  const f = await createHistoricalIncompleteProfileFixture({ archivedAuthorityVersion: 7 });
  const archive = f.archive; assert.ok(archive);
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const control = maintenance.beginStoppedMachineControlUpgrade(maintenance.maintenanceOperation()), claim = control.profileInventory(f.profileId);
  const inventories: ReturnType<typeof composeStoppedControlCredentialInventory>[] = [];
  return { archive,
    inspect() { const inventory = composeStoppedControlCredentialInventory({ claim, clock: systemClock, hostFacts: { primaryDisplay: null } }); inventories.push(inventory); return inventory; },
    revalidate(inventory: ReturnType<typeof composeStoppedControlCredentialInventory>) { return readStoppedCredentialConversion(inventory.proof, claim); },
    async cleanup() { releaseStoppedMachineControlUpgrade(control, maintenance.maintenanceOperation(), false, { inventories, admission: maintenance }); maintenance.release(); await f.close(); },
  };
}

function causeHas(error: unknown, message: string): boolean {
  return error instanceof Error && (error.message === message || causeHas(error.cause, message)
    || error instanceof AggregateError && error.errors.some((nested: unknown) => causeHas(nested, message)));
}

function watchBackup(path: string) {
  const head = readFileSync(path).subarray(0, 100), password = Buffer.from(historicalIncompleteProfileFields.password);
  const seen = { searches: 0, digestProofs: 0 };
  const includes = Buffer.prototype.includes, verify = RuntimeAdmission.prototype.verifiedReadOnlyCopy;
  const searching = vi.spyOn(Buffer.prototype, "includes").mockImplementation(function (this: Buffer, ...args: Parameters<Buffer["includes"]>) {
    if (args[0] instanceof Uint8Array && password.equals(args[0]) && this.length >= head.length && this.subarray(0, head.length).equals(head)) seen.searches += 1;
    return includes.apply(this, args);
  });
  const proving = vi.spyOn(RuntimeAdmission.prototype, "verifiedReadOnlyCopy").mockImplementation(function (this: RuntimeAdmission, ...args: Parameters<RuntimeAdmission["verifiedReadOnlyCopy"]>) {
    if (args[0] === path) seen.digestProofs += 1;
    return verify.apply(this, args);
  });
  return { seen, restore() { searching.mockRestore(); proving.mockRestore(); } };
}

it("searches an unchanged retained backup once per inspection and still proves its digest on every pass", async () => {
  const f = await stoppedFixture();
  const watch = watchBackup(f.archive.path);
  try {
    const inventory = f.inspect();
    // Four passes each prove the backup against its manifest; the one row scan opens its own proved copy.
    assert.deepEqual(watch.seen, { searches: 1, digestProofs: 5 });
    f.revalidate(inventory);
    assert.deepEqual(watch.seen, { searches: 1, digestProofs: 8 });
    f.inspect();
    assert.equal(watch.seen.searches, 2);
  } finally { watch.restore(); await f.cleanup(); }
}, scaledMs(30000));

it("searches a backup again after its bytes change under the same inode, size, modified time and a matching manifest", async () => {
  const f = await stoppedFixture();
  try {
    const { path, manifestPath, manifest } = f.archive, inventory = f.inspect();
    f.revalidate(inventory);
    const before = lstatSync(path), bytes = readFileSync(path), unallocated = bytes.indexOf(Buffer.alloc(256));
    assert.ok(unallocated >= 0);
    bytes.write(historicalIncompleteProfileFields.password, unallocated + 128, "utf8");
    writeFileSync(path, bytes);
    utimesSync(path, before.atime, before.mtime);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, sha256: createHash("sha256").update(bytes).digest("hex") }));
    const after = lstatSync(path);
    assert.deepEqual([after.ino, after.size, after.mtime], [before.ino, before.size, before.mtime]);
    assert.throws(() => f.revalidate(inventory), error => causeHas(error, "credential-maintenance-copy-capture-incomplete"));
    assert.throws(() => f.inspect(), error => causeHas(error, "credential-maintenance-copy-capture-incomplete"));
  } finally { await f.cleanup(); }
}, scaledMs(30000));
