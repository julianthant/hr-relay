import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { selectActiveRunSettings } from "../../../../../../src/backend/runs/settings/run-settings.js";
import { requireLifecycleApplied } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { settingsFixture } from "../../../../../support/helpers/backend/settings-activation-fixture.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function fixture() { const f = settingsFixture(); cleanups.push(f.close); return f; }
function counts(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try { return ["settings_snapshots", "commands", "command_audits", "runs"].map((table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get()); } finally { db.close(); }
}
it("atomically saves a complete resolution, selects new groups, retains old runs and replays without effects", () => {
  const f = fixture(); const old = f.create(); const oldSnapshot = f.database.authority.configSnapshots.get(old.envelope.configSnapshotId);
  const command = f.command({ "timeouts.taskMs": { set: 90_000 } });
  const generation = f.database.getMeta().authorityGeneration;
  const result = f.execute(command); assert.equal(result.state, "applied");
  assert.ok(result.state === "applied"); assert.equal(result.restartRequired, false);
  assert.equal(f.database.getMeta().authorityGeneration, generation + 1);
  const active = selectActiveRunSettings(f.database.authority);
  assert.equal(active.config.timeouts.taskMs, 90_000); assert.equal(active.provenance["timeouts.taskMs"], "settings");
  const group = f.database.withAuthorityTransaction(() => [f.create(), f.create()]);
  for (const run of group) assert.equal(run.envelope.configSnapshotId, active.configSnapshotId);
  assert.deepEqual(f.database.authority.runs.get(old.envelope.runId), old);
  assert.deepEqual(f.database.authority.configSnapshots.get(old.envelope.configSnapshotId), oldSnapshot);
  const createdRequest = f.request(); const created = requireLifecycleApplied(f.service.create(createdRequest));
  f.save({ "timeouts.taskMs": { set: 120_000 } });
  const before = counts(f); const resolved = f.resolutions();
  assert.equal(f.execute(command).state, "already-applied");
  assert.deepEqual(requireLifecycleApplied(f.service.create(createdRequest)), created);
  assert.deepEqual(counts(f), before); assert.equal(f.resolutions(), resolved);
});
it("rolls snapshot, selection, journal, audit and generation back on an injected audit failure", () => {
  const f = fixture(); const before = counts(f); const active = f.database.authority.runtimeConfig.get();
  const generation = f.database.getMeta().authorityGeneration; const saved = readSettings(f.database.authority);
  assert.throws(() => f.execute(f.command({ "timeouts.taskMs": { set: 90_000 } }), {
    withAuthorityTransaction: (work) => f.database.withAuthorityTransaction((repositories) => work({ ...repositories,
      commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
    })),
  }), /injected audit failure/u);
  assert.deepEqual(counts(f), before); assert.deepEqual(f.database.authority.runtimeConfig.get(), active);
  assert.deepEqual(readSettings(f.database.authority), saved); assert.equal(f.database.getMeta().authorityGeneration, generation);
});
it("refuses invalid and revision-conflicting saves with no partial authority", () => {
  const f = fixture(); const before = counts(f); const generation = f.database.getMeta().authorityGeneration;
  assert.equal(f.execute(f.command({ "timeouts.taskMs": { set: 90_000 } }, 2)).state, "conflict");
  assert.equal(f.execute(f.command({ "display.screenWidth": { set: 1980 } })).state, "rejected");
  assert.deepEqual(counts(f), before); assert.equal(f.database.getMeta().authorityGeneration, generation);
});
it("clears overrides to host defaults and survives a real authority reopen with historical references", () => {
  const f = fixture(); f.save({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } });
  const run = f.create(); const retained = selectActiveRunSettings(f.database.authority);
  f.save({ "display.screenWidth": { clear: true }, "display.screenHeight": { clear: true } });
  assert.deepEqual(readSettings(f.database.authority).settings, {});
  const current = selectActiveRunSettings(f.database.authority); assert.equal(current.config.display.screenWidth, 2560);
  assert.equal(current.fingerprint, f.snapshot.fingerprint);
  f.database.close(); const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 10, migrationOwner: "reopen" }, f.clock);
  try {
    assert.deepEqual(selectActiveRunSettings(reopened.authority), current);
    assert.deepEqual(reopened.authority.configSnapshots.get(retained.configSnapshotId), retained);
    assert.deepEqual(reopened.authority.runs.get(run.envelope.runId), run);
  } finally { reopened.close(); }
});
it("independent connections observe complete before/after selections and exclude competing writers", () => {
  const f = fixture(); const other = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 1, migrationOwner: "contender" }, f.clock);
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
});
