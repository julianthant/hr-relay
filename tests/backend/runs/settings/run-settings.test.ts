import assert from "node:assert/strict";
import { it } from "vitest";
import { selectNewRunIdentity,selectRunSettings } from "../../../../src/backend/runs/settings/run-settings.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";

const ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_C = "c".repeat(64);

it("selects the active snapshot for a new run while retained runs keep their exact snapshot", () => {
  const snapshots = new Map([[ID, { configSnapshotId: ID, fingerprint: TOKEN_A }],
    [WRITE_ID, { configSnapshotId: WRITE_ID, fingerprint: TOKEN_B }]]);
  const repositories = { configSnapshots: { get: (key: string) => snapshots.get(key) },
    runtimeConfig: { get: () => ({ configSnapshotId: WRITE_ID, configFingerprint: TOKEN_B }) } } as unknown as AuthorityRepositories;
  const oldRun = { configSnapshotId: ID, configFingerprint: TOKEN_A };
  assert.deepEqual(selectNewRunIdentity(repositories, oldRun), { configSnapshotId: WRITE_ID, configFingerprint: TOKEN_B });
  assert.deepEqual(selectRunSettings(repositories, oldRun), snapshots.get(ID));
  assert.throws(() => selectRunSettings(repositories, { ...oldRun, configFingerprint: TOKEN_C }), /run-settings-snapshot-mismatch/u);
});
