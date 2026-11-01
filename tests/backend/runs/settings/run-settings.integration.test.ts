import { default as assert } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { selectActiveRunSettings } from "../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

{

const cleanups: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); };

describe("ordinary browser paths", () => {
afterEach(_afterEachFixture0);

  it("activates valid browser paths for new runs while old runs retain their snapshot", async () => {
    const f = await settingsFixture(); cleanups.push(f.close);
    const old = f.create();
    const oldActive = selectActiveRunSettings(f.database.authority);
    const profile = join(f.root, "new-profile"); mkdirSync(profile);
    const credential = join(f.root, "new-duo.json");
    writeFileSync(credential, '{"rpId":"synthetic.example","credentialId":"synthetic-id","privateKey":"synthetic-key","signCount":0,"transport":"internal"}', { mode: 0o600 });
    const extension = join(f.root, "new-extension"); mkdirSync(extension);
    writeFileSync(join(extension, "workflow-manifest.json"), '{"manifest_version":3,"name":"Synthetic Duo"}');
    const patch = { "paths.browserProfileRoot": { set: profile },
      "paths.duoCredential": { set: credential }, "paths.duoExtensionDir": { set: extension } };
    const saved = f.save(patch); assert.equal(saved.state, "applied");
    if (saved.state !== "applied") return;
    assert.equal(saved.restartRequired, false);
    const active = selectActiveRunSettings(f.database.authority);
    assert.equal(active.config.paths.browserProfileRoot, profile);
    assert.equal(active.config.paths.duoCredential, credential);
    assert.equal(active.config.paths.duoExtensionDir, extension);
    assert.equal(active.configSnapshotId === oldActive.configSnapshotId, false);
    assert.deepEqual(f.database.authority.configSnapshots.get(old.envelope.configSnapshotId), oldActive);
    assert.equal(f.create().envelope.configSnapshotId, active.configSnapshotId);
  });

  it("refuses a changed invalid path before any settings activation", async () => {
    const f = await settingsFixture(); cleanups.push(f.close);
    const before = selectActiveRunSettings(f.database.authority);
    const invalid = f.save({ "paths.duoCredential": { set: join(f.root, "missing.json") } });
    assert.deepEqual(invalid, { state: "rejected", commandId: invalid.commandId, code: "invalid-value",
      message: "paths.duoCredential: private-file-unavailable" });
    assert.deepEqual(selectActiveRunSettings(f.database.authority), before);
  });
});
}

{

const cleanups: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const close of cleanups.splice(0).reverse()) await close(); };
async function fixture() { const f = await settingsFixture(); cleanups.push(f.close); return f; }
it("independent connections observe complete before/after selections and exclude competing writers", async () => {
try {

  const f = await fixture(); const other = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 1, migrationOwner: "contender" }, f.clock);
  try {
    const old = f.create(); const original = selectActiveRunSettings(other.authority);
    f.database.withAuthorityTransaction(() => {
      assert.equal(f.save({ "timeouts.taskMs": { set: 90_000 } }).state, "applied");
      assert.deepEqual(selectActiveRunSettings(other.authority), original, "uncommitted activation stays invisible");
      assert.throws(() => other.withAuthorityTransaction(() => {}), /locked/u);
    });
    const selected = other.withAuthorityTransaction((repos) => selectActiveRunSettings(repos));
    const next = f.create(); assert.notEqual(selected.configSnapshotId, old.envelope.configSnapshotId);
    assert.equal(next.envelope.configSnapshotId, selected.configSnapshotId);
    other.withAuthorityTransaction(() => {}); // Valid positive control after lock release.
  } finally { other.close(); }

} finally {
await _afterEachFixture0();
}
});
}
