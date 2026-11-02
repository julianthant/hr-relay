import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { it, vi } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withPrivateFileLock } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { CanonicalCredentialHeadSchema, createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { NOTIFICATION } from "../../../support/fixtures/phase1c-contract-fixtures.js";

type ProfileFixture = Awaited<ReturnType<typeof createBoundProfileFixture>>;

function rewrite(path: string): () => void {
  const bytes = fs.readFileSync(path);
  fs.appendFileSync(path, "\n");
  return () => fs.writeFileSync(path, bytes);
}

function addFile(directory: string, name: string): () => void {
  const existed = fs.existsSync(directory);
  if (!existed) fs.mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, name);
  fs.writeFileSync(path, "{}", { mode: 0o600, flag: "wx" });
  return () => {
    fs.unlinkSync(path);
    if (!existed) fs.rmdirSync(directory);
  };
}

function symlinkDirectory(path: string): () => void {
  const held = `${path}.held`;
  fs.renameSync(path, held);
  fs.symlinkSync(held, path, "dir");
  return () => { fs.unlinkSync(path); fs.renameSync(held, path); };
}

const changes: readonly [string, (fixture: ProfileFixture) => () => void][] = [
  ["registry evidence", f => rewrite(join(f.machine.stateRoot, "machine", "profiles.json"))],
  ["registry evidence followed by a reread", f => {
    const restore = rewrite(join(f.machine.stateRoot, "machine", "profiles.json"));
    f.machine.readProfileRegistry();
    return restore;
  }],
  ["registry evidence followed by another connection", f => {
    const reader = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "precommit-reader" });
    try {
      const restore = rewrite(join(f.machine.stateRoot, "machine", "profiles.json"));
      reader.withAuthorityReadSnapshot(() => undefined);
      return restore;
    } finally { reader.close(); }
  }],
  ["registry ctime", f => {
    const path = join(f.machine.stateRoot, "machine", "profile-verifiers.json");
    fs.chmodSync(path, 0o644);
    fs.chmodSync(path, 0o600);
    return () => {};
  }],
  ["registry control", f => rewrite(join(f.workspace, ".tracker", "control", "profile-registry.json"))],
  ["verifier evidence", f => rewrite(join(f.machine.stateRoot, "machine", "profile-verifiers.json"))],
  ["verifier pepper", f => rewrite(join(f.machine.stateRoot, "machine", "profile-pepper"))],
  ["registry version", f => rewrite(join(f.machine.stateRoot, "machine", "profile-registry-version.json"))],
  ["operations entry", f => addFile(join(f.machine.stateRoot, "machine", "operations"), "unexpected.json")],
  ["receipts entry", f => addFile(join(f.workspace, ".tracker", "control", "relocation-receipts"), "unexpected.json")],
  ["journal appearance", f => addFile(join(f.workspace, ".tracker", "control"), "journal.json")],
  ["control upgrade", f => addFile(join(f.workspace, ".tracker", "control"), "profile-control-upgrade.json")],
  ["device recertification", f => addFile(join(f.workspace, ".tracker", "control"), "device-recertification.json")],
  ["source fence", f => addFile(f.machine.stateRoot, ".runtime-source-fence.json")],
  ["control permissions", f => {
    const path = join(f.workspace, ".tracker", "control");
    fs.chmodSync(path, 0o744);
    return () => fs.chmodSync(path, 0o700);
  }],
  ["control symlink", f => symlinkDirectory(join(f.workspace, ".tracker", "control"))],
  ["profile root symlink", f => symlinkDirectory(f.stateRoot)],
  ["profile ancestor symlink", f => symlinkDirectory(dirname(f.stateRoot))],
  ["artifact root symlink", f => symlinkDirectory(f.machine.artifactRoot)],
];

for (const mode of ["transaction", "read snapshot"] as const) {
  for (const kind of ["head", "Duo"] as const) it(`keeps authenticated ${kind} publication independent of ${mode} commit`, async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "independent-credential-test" });
    const owner = createCanonicalCredentials(f.admission), id = f.admission.profileBinding.profileId;
    const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${id}.json`);
    const duoPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${id}.json`);
    try {
      const beforeHead = fs.readFileSync(headPath), beforeDuo = fs.readFileSync(duoPath);
      const prior = owner.readRecord("duo"); assert.ok(prior);
      const credential = DuoCredentialRecordSchema.parse(prior.value).credentials.find(entry => entry.state === "ready"); assert.ok(credential);
      const requestId = randomUUID(), generation = database.getMeta().authorityGeneration;
      const work = () => {
        if (mode === "transaction") database.authority.notifications.create(NOTIFICATION);
        if (kind === "head") owner.reserveDuoCounter(credential.credentialId, requestId);
        else owner.replaceRecord("duo", prior.revision, prior.value);
      };
      if (mode === "transaction") database.withAuthorityTransaction(work);
      else database.withAuthorityReadSnapshot(work);
      assert.equal(database.getMeta().authorityGeneration, generation + (mode === "transaction" ? 1 : 0));
      assert.equal(database.authority.notifications.get(NOTIFICATION.notificationId) !== undefined, mode === "transaction");
      if (kind === "head") {
        assert.notDeepEqual(fs.readFileSync(headPath), beforeHead);
        assert.deepEqual(fs.readFileSync(duoPath), beforeDuo);
        assert.deepEqual(owner.readRecord("duo"), prior);
        const head = CanonicalCredentialHeadSchema.parse(JSON.parse(fs.readFileSync(headPath, "utf8"))); assert.equal(head.state, "active");
        assert.ok(head.counters.some(counter => counter.credentialId === credential.credentialId && counter.requests.some(request => request.requestId === requestId)));
      } else {
        assert.deepEqual(fs.readFileSync(headPath), beforeHead);
        assert.notDeepEqual(fs.readFileSync(duoPath), beforeDuo);
        assert.deepEqual(owner.readRecord("duo"), { revision: prior.revision + 1, value: prior.value });
      }
    } finally { database.close(); await f.close(); }
  });

  for (const [name, change] of changes) it(`refuses changed ${name} before ${mode} commit`, async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "precommit-test" });
    let restore: (() => void) | undefined;
    let reached = false;
    try {
      const generation = database.getMeta().authorityGeneration;
      const work = () => {
        if (mode === "transaction") database.authority.notifications.create(NOTIFICATION);
        restore = change(f);
        reached = true;
      };
      try {
        assert.throws(() => mode === "transaction"
          ? database.withAuthorityTransaction(work)
          : database.withAuthorityReadSnapshot(work), /profile-registry-observation-changed|directory-integrity|symlink/u);
      } finally { restore?.(); }
      assert.equal(reached, true);
      assert.equal(database.getMeta().authorityGeneration, generation);
      assert.equal(database.authority.notifications.get(NOTIFICATION.notificationId), undefined);
    } finally { database.close(); await f.close(); }
  });

  for (const replacement of [false, true]) it(`refuses ${replacement ? "replaced" : "lost"} installation lock before ${mode} commit`, async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "precommit-test" });
    const control = join(f.workspace, ".tracker", "control"), path = join(control, ".installation-mutation.lock"), held = `${path}.held`;
    try {
      const generation = database.getMeta().authorityGeneration;
      withPrivateFileLock(control, ".installation-mutation.lock", () => {
        const bytes = fs.readFileSync(path);
        const work = () => {
          if (mode === "transaction") database.authority.notifications.create(NOTIFICATION);
          fs.renameSync(path, held);
          if (replacement) fs.writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
        };
        try {
          assert.throws(() => mode === "transaction"
            ? database.withAuthorityTransaction(work)
            : database.withAuthorityReadSnapshot(work), /private lock changed/u);
        } finally {
          if (fs.existsSync(path)) fs.unlinkSync(path);
          fs.renameSync(held, path);
        }
      });
      assert.equal(database.getMeta().authorityGeneration, generation);
      assert.equal(database.authority.notifications.get(NOTIFICATION.notificationId), undefined);
    } finally { database.close(); await f.close(); }
  });

  it(`reuses unchanged registry evidence before ${mode} commit`, async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "precommit-test" });
    const path = join(f.machine.stateRoot, "machine", "profiles.json"), open = fs.openSync;
    let reads = 0;
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, permissions) => {
      if (target === path) reads++;
      return open(target, flags, permissions);
    });
    syncBuiltinESMExports();
    try {
      const work = () => {
        if (mode === "transaction") database.authority.notifications.create(NOTIFICATION);
        assert.ok(reads > 0);
        return reads;
      };
      const beforeCommit = mode === "transaction" ? database.withAuthorityTransaction(work) : database.withAuthorityReadSnapshot(work);
      assert.equal(reads, beforeCommit);
      assert.equal(beforeCommit, 1);
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports();
      database.close(); await f.close();
    }
  });
}
