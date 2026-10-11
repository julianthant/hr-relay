import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { mkdirSync as mkdirSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { syncBuiltinESMExports as syncBuiltinESMExports_m0 } from "node:module";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,it as it_m1,vi } from "vitest";
import { selectActiveRunSettings as selectActiveRunSettings_m0,selectActiveRunSettings as selectActiveRunSettings_m1 } from "../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture as settingsFixture_m0,settingsFixture as settingsFixture_m1 } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { vi.restoreAllMocks(); syncBuiltinESMExports_m0(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };

describe_m0("ordinary browser paths", () => {
afterEach_m0(_afterEachFixture0);


  it_m0("activates valid browser paths for new runs while old runs retain their snapshot", () => {
    const f = settingsFixture_m0(); cleanups.push(f.close);
    const old = f.create();
    const oldActive = selectActiveRunSettings_m0(f.database.authority);
    const profile = join_m0(f.root, "new-profile"); mkdirSync_m0(profile);
    const credential = join_m0(f.root, "new-duo.json");
    writeFileSync_m0(credential, '{"rpId":"synthetic.example","credentialId":"synthetic-id","privateKey":"synthetic-key","signCount":0,"transport":"internal"}', { mode: 0o600 });
    const extension = join_m0(f.root, "new-extension"); mkdirSync_m0(extension);
    writeFileSync_m0(join_m0(extension, "manifest.json"), '{"manifest_version":3,"name":"Synthetic Duo"}');
    const patch = { "paths.browserProfileRoot": { set: profile },
      "paths.duoCredential": { set: credential }, "paths.duoExtensionDir": { set: extension } };
    const saved = f.save(patch); assert_m0.equal(saved.state, "applied");
    if (saved.state !== "applied") return;
    assert_m0.equal(saved.restartRequired, false);
    const active = selectActiveRunSettings_m0(f.database.authority);
    assert_m0.equal(active.config.paths.browserProfileRoot, profile);
    assert_m0.equal(active.config.paths.duoCredential, credential);
    assert_m0.equal(active.config.paths.duoExtensionDir, extension);
    assert_m0.equal(active.configSnapshotId === oldActive.configSnapshotId, false);
    assert_m0.deepEqual(f.database.authority.configSnapshots.get(old.envelope.configSnapshotId), oldActive);
    assert_m0.equal(f.create().envelope.configSnapshotId, active.configSnapshotId);
  });

  it_m0("refuses a changed invalid path before any settings activation", () => {
    const f = settingsFixture_m0(); cleanups.push(f.close);
    const before = selectActiveRunSettings_m0(f.database.authority);
    const invalid = f.save({ "paths.duoCredential": { set: join_m0(f.root, "missing.json") } });
    assert_m0.deepEqual(invalid, { state: "rejected", commandId: invalid.commandId, code: "invalid-value",
      message: "paths.duoCredential: private-file-unavailable" });
    assert_m0.deepEqual(selectActiveRunSettings_m0(f.database.authority), before);
  });
});
}

{

const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const close of cleanups.splice(0).reverse()) close(); };
function fixture() { const f = settingsFixture_m1(); cleanups.push(f.close); return f; }
it_m1("independent connections observe complete before/after selections and exclude competing writers", async () => {
try {


  const f = fixture(); const other = AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 1, migrationOwner: "contender" }, f.clock);
  try {
    const old = f.create(); const original = selectActiveRunSettings_m1(other.authority);
    f.database.withAuthorityTransaction(() => {
      assert_m1.equal(f.save({ "timeouts.taskMs": { set: 90_000 } }).state, "applied");
      assert_m1.deepEqual(selectActiveRunSettings_m1(other.authority), original, "uncommitted activation stays invisible");
      assert_m1.throws(() => other.withAuthorityTransaction(() => {}), /locked/u);
    });
    const selected = other.withAuthorityTransaction((repos) => selectActiveRunSettings_m1(repos));
    const next = f.create(); assert_m1.notEqual(selected.configSnapshotId, old.envelope.configSnapshotId);
    assert_m1.equal(next.envelope.configSnapshotId, selected.configSnapshotId);
    other.withAuthorityTransaction(() => {}); // Valid positive control after lock release.
  } finally { other.close(); }

} finally {
_afterEachFixture0();
}
});
}
