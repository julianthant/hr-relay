import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach,it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectActiveRunSettings } from "../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
async function fixture() { const f = await settingsFixture(); cleanups.push(f.close); return f; }
function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try { return ["settings_snapshots", "commands", "command_audits", "runs"].map((table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get()); } finally { db.close(); }
}
it("atomically saves a complete resolution, selects new groups, retains old runs and replays without effects", async () => {
  const f = await fixture(); const old = f.create(); const oldSnapshot = f.database.authority.configSnapshots.get(old.envelope.configSnapshotId);
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
