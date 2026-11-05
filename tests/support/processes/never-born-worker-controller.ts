import { assertStoppedProfileResourcesClosed } from "../../../src/backend/storage/maintenance/profile-custody.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { neverBornFixture, refusedStart, nativeWorkerBytes } from "../helpers/backend/never-born-worker-world.js";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { systemClock } from "../../../src/rules/time/clock.js";

const [workspace, profileId, path] = process.argv.slice(2);
if (workspace === undefined) {
  const f = await neverBornFixture(true);
  const started = await refusedStart(f);
  assert.equal(f.spawns(), 0); assert.equal(f.context.database.hasWorkerNonBirth(started.slot), true);
  process.send?.({ workspace: f.profile.workspace, profileId: f.context.admission.profileBinding.profileId,
    path: f.profile.path, keychain: FakeKeyringEntry.snapshot() });
  await once(process, "disconnect");
} else {
  assert.ok(profileId); assert.ok(path);
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const admission = machine.admitProfile(profileId);
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
  const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "never-born-successor" }, systemClock,
    undefined, undefined, undefined, credentials);
  try {
    const before = nativeWorkerBytes(path), slot = db.authority.workerSlots.list("person-lookup")[0]; assert.ok(slot);
    assert.equal(db.hasWorkerNonBirth(slot), false);
    db.settleNeverSpawnedWorkers();
    assert.deepEqual(nativeWorkerBytes(path), before);
    assert.equal(slot.retiredAt, null);
    assert.throws(() => assertStoppedProfileResourcesClosed(db.readProfileResourceCustody()), /credential-maintenance-custody-unproved/);
    process.send?.({ observed: true });
  } finally { db.close(); admission.release(); machine.release(); await lifetime.close(); }
}
