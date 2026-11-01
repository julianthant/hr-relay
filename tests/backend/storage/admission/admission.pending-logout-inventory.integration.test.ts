import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createChatGptCredentialRepository } from "../../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

async function pending() {
  const f = await createBoundProfileFixture();
  const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
    prepareLogout(_profileId, owner) {
      const database = AuthorityDatabase.open(owner, { path: join(owner.stateRoot, "state.db"), busyTimeoutMs: 250 });
      let source: ReturnType<typeof database.capturePendingLogoutSource>;
      try { source = database.capturePendingLogoutSource(); } finally { database.close(); }
      return { source, intentFailed(error): never { throw error; } };
    }, activity: { hasUnquiescedWork: () => true } });
  const active = session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
  assert.ok(active.state === "active");
  const result = session.logOut(active.token, { at: "2026-10-21T12:01:00.000Z" });
  assert.ok(result.state === "cancelling" && result.operationId !== undefined);
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${result.operationId}.json`);
  const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  session.close();
  const owner = f.machine.admitProfileSettlement(operation.operationId);
  const sibling = f.machine.admitProfileSettlement(operation.operationId);
  const restore = f.machine.beginOfflineMaintenance();
  const stopped = f.machine.forStoppedLogoutSettlement(owner, operation, restore);
  return { f, operation, operationPath, owner, sibling, restore, stopped,
    async close() { stopped.release(); restore.release(); sibling.release(); owner.release(); await f.close(); } };
}

it("issues only actual stopped Logout2 source access while ordinary credential and runtime effects remain refused", async () => {
  const w = await pending();
  try {
    const before = readFileSync(w.f.path), operationBytes = readFileSync(w.operationPath);
    assert.deepEqual(w.stopped.assertPendingLogoutSettlementDatabase(w.f.path), w.operation);
    const facts = AuthorityDatabase.readProfileMaintenanceInventory(w.stopped);
    assert.equal(facts.authorityGeneration, AuthorityDatabase.readProfileMaintenanceInventory(w.stopped).authorityGeneration);
    for (const refuse of [() => w.stopped.assertProfileRuntime(), () => w.stopped.assertCredentialRead(),
      () => w.stopped.assertWritable(), () => w.stopped.assertAuthorityDatabase(w.f.path),
      () => w.stopped.assertPendingLogoutSettlementDatabase(":memory:"),
      () => w.stopped.assertPendingLogoutSettlementDatabase(join(w.f.stateRoot, "foreign.sqlite")),
      () => w.stopped.assertArtifactRoot(w.stopped.artifactRoot),
      () => AuthorityDatabase.open(w.stopped, { path: w.f.path, busyTimeoutMs: 250 }),
      () => createCredentialStore({ admission: w.stopped, stateRoot: w.f.stateRoot }).read(),
      () => createChatGptCredentialRepository({ admission: w.stopped, stateRoot: w.f.stateRoot }).read()]) assert.throws(refuse);
    assert.deepEqual(readFileSync(w.f.path), before);
    assert.deepEqual(readFileSync(w.operationPath), operationBytes);
    assert.equal("commandId" in w.operation || "writeId" in w.operation || "expectedRevision" in w.operation, false);
  } finally { await w.close(); }
});

for (const mutation of ["operation", "selection", "owner", "parent", "native-operation"] as const)
  it(`keeps stopped Logout2 authority fenced against ${mutation} changes`, async () => {
    const w = await pending();
    try {
      if (mutation === "operation") assert.throws(() => w.f.machine.publishProfileOperation({ ...w.operation, phase: "incomplete" }));
      else if (mutation === "selection") assert.throws(() => createProfileRegistry(w.f.machine).advanceSession(null));
      else if (mutation === "owner") w.owner.release();
      else if (mutation === "parent") w.f.machine.release();
      else w.restore.release();
      if (mutation === "operation" || mutation === "selection") {
        assert.deepEqual(w.stopped.assertPendingLogoutSettlementDatabase(w.f.path), w.operation);
      } else {
        assert.throws(() => w.stopped.assertPendingLogoutSettlementDatabase(w.f.path));
        assert.throws(() => AuthorityDatabase.readProfileMaintenanceInventory(w.stopped));
      }
    } finally { await w.close(); }
  });

for (const mutation of ["copy-bytes", "copy-release", "owner", "native-operation"] as const)
  it(`keeps a genuine digest copy readonly and refuses it after ${mutation}`, async () => {
    const w = await pending(), inspection = w.stopped.capturePendingLogoutSnapshot();
    const path = inspection.snapshot.path, copy = inspection.admission;
    const bytes = readFileSync(path), sourceBytes = readFileSync(w.f.path);
    try {
      const observed = withAuthorityDatabaseReadOnly(copy, path, database => database.prepare("SELECT installation_id AS installationId, profile_id AS profileId FROM database_states WHERE id=1").get());
      assert.equal(observed?.installationId, w.owner.profileBinding.installationId);
      assert.equal(observed?.profileId, w.operation.profileId);
      for (const refuse of [() => copy.assertWritable(), () => copy.assertProfileRuntime(), () => copy.assertCredentialRead(),
        () => copy.assertAuthorityDatabase(path), () => copy.assertReadOnlyAuthorityDatabase(w.f.path),
        () => copy.verifiedReadOnlyCopy(path, createHash("sha256").update(bytes).digest("hex")),
        () => copy.assertPendingLogoutSettlementDatabase(w.f.path)]) assert.throws(refuse);
      assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readFileSync(w.f.path), sourceBytes);
      if (mutation === "copy-bytes") appendFileSync(path, "changed-copy");
      else if (mutation === "copy-release") copy.release();
      else if (mutation === "owner") w.owner.release();
      else w.restore.release();
      assert.throws(() => copy.assertReadOnlyAuthorityDatabase(path));
    } finally { inspection.dispose(); await w.close(); }
  });

for (const access of ["state-root", "readonly-database"] as const)
  it(`revalidates physical profile privacy during current stopped ${access} inspection`, async () => {
    const w = await pending(), mode = lstatSync(w.f.stateRoot).mode & 0o777;
    const before = readFileSync(w.f.path), operationBytes = readFileSync(w.operationPath);
    try {
      chmodSync(w.f.stateRoot, 0o777);
      assert.throws(() => access === "state-root" ? w.stopped.assertStateRoot(w.f.stateRoot) : w.stopped.assertReadOnlyAuthorityDatabase(w.f.path));
      assert.deepEqual(readFileSync(w.f.path), before); assert.deepEqual(readFileSync(w.operationPath), operationBytes);
    } finally { chmodSync(w.f.stateRoot, mode); await w.close(); }
  });

it("rejects wrong operation, profile, native operation and forged stopped owners before effects", async () => {
  const w = await pending(), foreign = await pending();
  const databaseBytes = readFileSync(w.f.path), operationBytes = readFileSync(w.operationPath);
  try {
    assert.throws(() => w.f.machine.forStoppedLogoutSettlement(w.owner, { ...w.operation, operationId: randomUUID() }, w.restore));
    assert.throws(() => w.f.machine.forStoppedLogoutSettlement(w.owner, { ...w.operation, profileId: foreign.operation.profileId }, w.restore));
    assert.throws(() => w.f.machine.forStoppedLogoutSettlement(foreign.owner, w.operation, w.restore));
    assert.throws(() => w.f.machine.forStoppedLogoutSettlement(w.owner, w.operation, foreign.restore));
    assert.throws(() => Reflect.apply(w.f.machine.forStoppedLogoutSettlement.bind(w.f.machine), w.f.machine, [{ ...w.owner }, w.operation, w.restore]));
    assert.deepEqual(readFileSync(w.f.path), databaseBytes); assert.deepEqual(readFileSync(w.operationPath), operationBytes);
  } finally { await foreign.close(); await w.close(); }
});

it("owns its fixed-source temporary readonly snapshot without granting arbitrary external copy authority", async () => {
  const w = await pending(), sourceBytes = readFileSync(w.f.path), operationBytes = readFileSync(w.operationPath);
  const inspection = w.stopped.capturePendingLogoutSnapshot();
  try {
    for (const path of [join(w.f.stateRoot, `unrelated-${randomUUID()}`), join(w.f.workspace, `unrelated-${randomUUID()}`)]) {
      const bytes = Buffer.from("safe unrelated state file");
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      assert.throws(() => w.stopped.verifiedReadOnlyCopy(path, createHash("sha256").update(bytes).digest("hex")), /profile-pending-logout-copy-delegation-refused/u);
      assert.deepEqual(readFileSync(path), bytes);
    }
    inspection.snapshot.assertUnchanged();
    const observed = withAuthorityDatabaseReadOnly(inspection.admission, inspection.snapshot.path, database =>
      database.prepare("SELECT installation_id AS installationId, profile_id AS profileId FROM database_states WHERE id=1").get());
    assert.equal(observed?.installationId, w.owner.profileBinding.installationId);
    assert.equal(observed?.profileId, w.operation.profileId);
    assert.throws(() => w.stopped.verifiedReadOnlyCopy(inspection.snapshot.path, createHash("sha256").update(readFileSync(inspection.snapshot.path)).digest("hex")));
    assert.throws(() => inspection.admission.capturePendingLogoutSnapshot());
    assert.throws(() => w.owner.capturePendingLogoutSnapshot()); assert.throws(() => w.f.machine.capturePendingLogoutSnapshot());
    assert.deepEqual(readFileSync(w.f.path), sourceBytes); assert.deepEqual(readFileSync(w.operationPath), operationBytes);
  } finally { inspection.dispose(); await w.close(); }
  assert.equal(existsSync(inspection.snapshot.path), false);
  assert.throws(() => inspection.admission.assertLive()); inspection.dispose();
});

for (const suffix of ["", "-wal", "-shm", "-journal"] as const)
  it(`refuses its actual owned snapshot after ${suffix === "" ? "main" : suffix.slice(1)} source mutation without rewriting the changed evidence`, async () => {
    const w = await pending(), inspection = w.stopped.capturePendingLogoutSnapshot(), path = w.f.path + suffix;
    const operationBytes = readFileSync(w.operationPath);
    try {
      if (existsSync(path)) appendFileSync(path, "synthetic changed source");
      else writeFileSync(path, "synthetic formerly absent source", { mode: 0o600, flag: "wx" });
      const retained = readFileSync(path);
      assert.throws(() => inspection.snapshot.assertUnchanged());
      assert.throws(() => inspection.admission.assertReadOnlyAuthorityDatabase(inspection.snapshot.path));
      assert.throws(() => inspection.admission.assertReadOnlyAuthorityDatabase(inspection.snapshot.path));
      assert.deepEqual(readFileSync(path), retained); assert.deepEqual(readFileSync(w.operationPath), operationBytes);
    } finally { inspection.dispose(); await w.close(); }
  });
