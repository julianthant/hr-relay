import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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

/** Counts the password searches over the backup's first bytes, and the reads of a table only the backup's schema still has. */
function watchBackup(path: string) {
  const head = readFileSync(path).subarray(0, 100), password = Buffer.from(historicalIncompleteProfileFields.password);
  const buffers: unknown = Buffer.prototype;
  assert.ok(buffers instanceof Uint8Array);
  let byteSearches = 0;
  // Invoked below with its original receiver; a spy would retain every searched buffer.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const includes = buffers.includes;
  buffers.includes = function (this: Uint8Array, ...args: Parameters<Uint8Array["includes"]>) {
    const sought: unknown = args[0];
    if (sought instanceof Uint8Array && password.equals(sought) && head.equals(this.subarray(0, head.length))) byteSearches += 1;
    return includes.apply(this, args);
  };
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  return {
    scans: () => ({ bytes: byteSearches, rows: prepare.mock.calls.filter(([sql]) => sql === "SELECT * FROM explorer_overrides").length }),
    restore() { buffers.includes = includes; prepare.mockRestore(); },
  };
}

it("scans an unchanged retained backup once per inspection, across its preparation and every revalidation", async () => {
  const f = await stoppedFixture();
  const watch = watchBackup(f.archive.path);
  try {
    const inventory = f.inspect();
    assert.deepEqual(watch.scans(), { bytes: 1, rows: 1 });
    f.revalidate(inventory); f.revalidate(inventory);
    assert.deepEqual(watch.scans(), { bytes: 1, rows: 1 });
    f.inspect();
    assert.deepEqual(watch.scans(), { bytes: 2, rows: 2 });
  } finally { watch.restore(); await f.cleanup(); }
}, scaledMs(30000));

it("scans a backup again after its bytes change under the same inode, size, modified time and a matching manifest", async () => {
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
