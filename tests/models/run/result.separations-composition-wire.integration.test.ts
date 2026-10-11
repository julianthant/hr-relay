import { deriveCheckpointOutputDigest,deriveRunResultDigest } from "../../../src/models/run/result.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const worlds: DashboardWorld[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
  for (const world of worlds.splice(0)) world.dispose();
});

describe("separations — start planning through the existing service", () => {

  it("keeps protected names and signed comments out of checkpoint and result fingerprint preimages", () => {
    const first = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic First Operator", timekeeperComments: "Filed. -SFO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SFO", separationDate: "06/19/2026" } } };
    const rotated = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic Second Operator", timekeeperComments: "Filed. -SSO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SSO", separationDate: "06/19/2026" } } };
    assert.equal(deriveCheckpointOutputDigest(first), deriveCheckpointOutputDigest(rotated));
    assert.equal(deriveRunResultDigest(first), deriveRunResultDigest(rotated));
    assert.notEqual(deriveRunResultDigest(first), deriveRunResultDigest({ ...first,
      value: { ...first.value, dates: { ...first.value.dates, separationDate: "06/20/2026" } } }));
  });
});
